#!/usr/bin/env python3
"""Headless DVB-T transmitter. RF cannot start without an explicit safety flag."""
import argparse
import pathlib
import signal
import stat
import sys

from gnuradio import blocks, digital, dtv, filter, gr, soapy
import pmt

SAMPLE_RATE = 64_000_000 / 7
HACKRF_SAMPLE_RATE = 10_000_000
MAX_TX_GAIN_DB = 30
DEFAULT_TX_GAIN_DB = 14


class Transmitter(gr.top_block):
    def __init__(self, source_path: str, frequency: float, gain: float, amplitude: float, seconds: float):
        super().__init__("Lundenburg Kids Premium DVB-T transmitter", catch_exceptions=True)
        # Runtime playout is a FIFO and must never loop. Regular files retain
        # loop mode for offline RF tests.
        repeat = not stat.S_ISFIFO(pathlib.Path(source_path).stat().st_mode)
        source = blocks.file_source(gr.sizeof_char, source_path, repeat, 0, 0)
        source.set_begin_tag(pmt.PMT_NIL)
        energy = dtv.dvbt_energy_dispersal(1)
        rs = dtv.dvbt_reed_solomon_enc(2, 8, 0x11D, 255, 239, 8, 51, 8)
        outer = dtv.dvbt_convolutional_interleaver(136, 12, 17)
        coder = dtv.dvbt_inner_coder(1, 1512, dtv.MOD_QPSK, dtv.NH, dtv.C1_2)
        bit_interleave = dtv.dvbt_bit_inner_interleaver(1512, dtv.MOD_QPSK, dtv.NH, dtv.T2k)
        symbol_interleave = dtv.dvbt_symbol_inner_interleaver(1512, dtv.T2k, 1)
        mapper = dtv.dvbt_map(1512, dtv.MOD_QPSK, dtv.NH, dtv.T2k, 1)
        reference = dtv.dvbt_reference_signals(
            gr.sizeof_gr_complex, 1512, 2048, dtv.MOD_QPSK, dtv.NH,
            dtv.C1_2, dtv.C1_2, dtv.GI_1_4, dtv.T2k, 1, 0
        )
        prefix = digital.ofdm_cyclic_prefixer(2048, 2560, 0, "")
        # Ignore the GNU Radio modulator's initial FFT transient, then preserve OFDM headroom.
        skip = blocks.skiphead(gr.sizeof_gr_complex, 25_600)
        scale = blocks.multiply_const_cc(amplitude)
        # SoapyHackRF advertises integer-MHz rates. 35/32 converts the exact
        # 64/7 MHz DVB-T rate to 10 MHz without changing the RF bandwidth.
        resample = filter.rational_resampler_ccc(interpolation=35, decimation=32)

        sink = soapy.sink("driver=hackrf", "fc32", 1, "driver=hackrf", "buffers=64", [""], [""])
        sink.set_sample_rate(0, HACKRF_SAMPLE_RATE)
        sink.set_bandwidth(0, 8_000_000)
        sink.set_antenna(0, "TX/RX")
        sink.set_frequency(0, frequency)
        sink.set_frequency_correction(0, 0)
        sink.set_gain(0, gain)
        sink.set_dc_offset(0, 0)
        sink.set_iq_balance(0, 0)

        chain = [source, energy, rs, outer, coder, bit_interleave, symbol_interleave, mapper, reference, prefix, skip, scale, resample]
        for left, right in zip(chain, chain[1:]):
            self.connect(left, right)
        if seconds > 0:
            head = blocks.head(gr.sizeof_gr_complex, round(HACKRF_SAMPLE_RATE * seconds))
            self.connect(resample, head, sink)
        else:
            self.connect(resample, sink)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(pathlib.Path.home() / "lundenburg/runtime/lkp.ts"))
    parser.add_argument("--frequency", type=float, default=634e6, help="center frequency in Hz")
    parser.add_argument("--gain", type=float, default=DEFAULT_TX_GAIN_DB, help="HackRF TX gain (service default: 14 dB)")
    parser.add_argument("--amplitude", type=float, default=0.8, help="complex sample multiplier")
    parser.add_argument("--seconds", type=float, default=0, help="RF duration; 0 means until interrupted")
    parser.add_argument("--i-understand-rf", action="store_true", help="required acknowledgement")
    parser.add_argument("--check-source-only", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    if not args.i_understand_rf:
        parser.error("RF is disabled unless --i-understand-rf is supplied")
    source = pathlib.Path(args.source)
    try:
        source_mode = source.stat().st_mode
    except FileNotFoundError:
        parser.error(f"transport stream not found: {args.source}")
    if not (stat.S_ISREG(source_mode) or stat.S_ISFIFO(source_mode)):
        parser.error(f"transport stream must be a regular file or FIFO: {args.source}")
    if not 0 <= args.gain <= MAX_TX_GAIN_DB:
        parser.error(f"HackRF TX gain must be between 0 and {MAX_TX_GAIN_DB} dB")
    if not 0 < args.amplitude <= 1:
        parser.error("amplitude must be greater than 0 and no more than 1")
    if args.check_source_only:
        print(f"Transport stream source is valid: {args.source}")
        return

    print(f"RF START: {args.frequency / 1e6:.3f} MHz, 8 MHz DVB-T, gain {args.gain:.0f} dB, amplitude {args.amplitude:.2f}")
    print(f"Duration: {'until interrupted' if args.seconds == 0 else f'{args.seconds:.0f} seconds'}")
    flowgraph = Transmitter(args.source, args.frequency, args.gain, args.amplitude, args.seconds)

    def stop(_signal=None, _frame=None):
        print("Stopping RF...")
        flowgraph.stop()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    flowgraph.start()
    flowgraph.wait()
    print("RF STOPPED")


if __name__ == "__main__":
    main()
