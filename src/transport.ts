import { Transform, type TransformCallback } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { shiftTransportClocks } from './continuity.js';

// Pace the constant-bitrate TS in every output mode, including HLS and previews.
// Small, complete-packet bursts bound both memory and the handoff's output gap.
export class TransportPacer extends Transform {
  private bytes = 0;
  private remainder = Buffer.alloc(0);
  private timer: NodeJS.Timeout | undefined;
  private readonly startsAtMonotonicMs: number;

  constructor(private readonly bitrate: number, private readonly startsAtMs: number,
    private readonly continuity = new Map<number, number>(), private readonly timestampOffsetMs = 0) {
    super({ highWaterMark: 188 * 64 });
    if (!Number.isFinite(bitrate) || bitrate <= 0) throw new Error('Invalid transport bitrate');
    // NTP or host clock corrections must never interrupt constant-rate output.
    this.startsAtMonotonicMs = performance.now() + startsAtMs - Date.now();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    const length = data.length - data.length % 188;
    this.remainder = Buffer.from(data.subarray(length));
    let offset = 0;
    const next = (): void => {
      if (offset === length) { callback(); return; }
      const packets = data.subarray(offset, Math.min(length, offset + 188 * 64));
      const emit = (): void => {
        for (let index = 0; index < packets.length; index += 188) {
          if (packets[index] !== 0x47) { callback(new Error('Unaligned MPEG-TS output')); return; }
          shiftTransportClocks(packets.subarray(index, index + 188), Math.round(this.timestampOffsetMs * 90));
          const pid = ((packets[index + 1]! & 0x1f) << 8) | packets[index + 2]!;
          if (pid === 0x1fff) continue;
          const header = packets[index + 3]!;
          const previous = this.continuity.get(pid);
          const counter = previous === undefined ? header & 0x0f : (previous + ((header & 0x10) ? 1 : 0)) & 0x0f;
          packets[index + 3] = (header & 0xf0) | counter;
          this.continuity.set(pid, counter);
        }
        this.bytes += packets.length;
        offset += packets.length;
        this.push(packets);
        next();
      };
      const delayMs = this.startsAtMonotonicMs + this.bytes * 8000 / this.bitrate - performance.now();
      if (delayMs <= 0) emit();
      else this.timer = setTimeout(() => { this.timer = undefined; emit(); }, delayMs);
    };
    next();
  }

  override _flush(callback: TransformCallback): void {
    if (this.remainder.length) { callback(new Error('Incomplete MPEG-TS packet at EOF')); return; }
    const tailMs = this.startsAtMonotonicMs + this.bytes * 8000 / this.bitrate - performance.now();
    if (tailMs <= 0) callback();
    else this.timer = setTimeout(() => { this.timer = undefined; callback(); }, tailMs);
  }

  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    clearTimeout(this.timer);
    callback(error);
  }
}
