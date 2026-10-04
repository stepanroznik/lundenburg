import type { RotationClip } from './intermissions/rotation.js';
import { seasonAt } from './intermissions/season.js';

// Recover timing with whole published clips, never by cutting content. Choose
// a longer clip when early, a shorter one when late; carry any remainder.
export function recoveryIntermission(clips: RotationClip[], plannedDurationMs: number,
  leadMs: number, atMs: number): RotationClip | undefined {
  if (Math.abs(leadMs) < 250) return undefined;
  // Treat sub-250ms mux/frame rounding as on-time, matching the live status.
  const targetMs = plannedDurationMs + leadMs;
  const eligible = clips.filter((clip) => !clip.season || clip.season === seasonAt(new Date(atMs)));
  if (leadMs > 0) return eligible.filter((clip) =>
    clip.durationMs > plannedDurationMs && clip.durationMs <= targetMs + 250)
    .sort((a, b) => b.durationMs - a.durationMs || a.id.localeCompare(b.id))[0];
  return eligible.filter((clip) => clip.durationMs < plannedDurationMs && clip.durationMs >= targetMs - 250)
    .sort((a, b) => a.durationMs - b.durationMs || a.id.localeCompare(b.id))[0];
}

const clockWrap = 2 ** 33;
const wrap = (ticks: number): number => ((ticks % clockWrap) + clockWrap) % clockWrap;

function shiftPesClock(packet: Buffer, at: number, ticks: number): void {
  const value = ((packet[at]! >> 1) & 7) * 2 ** 30 + packet[at + 1]! * 2 ** 22 +
    (packet[at + 2]! >> 1) * 2 ** 15 + packet[at + 3]! * 128 + (packet[at + 4]! >> 1);
  const shifted = wrap(value + ticks);
  packet[at] = (packet[at]! & 0xf1) | ((Math.floor(shifted / 2 ** 30) & 7) << 1);
  packet[at + 1] = Math.floor(shifted / 2 ** 22) & 0xff;
  packet[at + 2] = ((Math.floor(shifted / 2 ** 15) & 0x7f) << 1) | 1;
  packet[at + 3] = Math.floor(shifted / 128) & 0xff;
  packet[at + 4] = ((shifted & 0x7f) << 1) | 1;
}

function shiftPcr(packet: Buffer, at: number, ticks: number): void {
  const value = packet[at]! * 2 ** 25 + packet[at + 1]! * 2 ** 17 +
    packet[at + 2]! * 512 + packet[at + 3]! * 2 + (packet[at + 4]! >> 7);
  const shifted = wrap(value + ticks);
  packet[at] = Math.floor(shifted / 2 ** 25) & 0xff;
  packet[at + 1] = Math.floor(shifted / 2 ** 17) & 0xff;
  packet[at + 2] = Math.floor(shifted / 512) & 0xff;
  packet[at + 3] = Math.floor(shifted / 2) & 0xff;
  packet[at + 4] = (packet[at + 4]! & 0x7f) | ((shifted & 1) << 7);
}

// A prepared encoder uses the planned start. Retimestamp its MPEG-TS clocks at
// acquisition so an early handoff can reuse its ready frames without a restart.
export function shiftTransportClocks(packet: Buffer, ticks: number): void {
  if (!ticks) return;
  const adaptation = (packet[3]! >> 4) & 3;
  let payload = 4;
  if (adaptation & 2) {
    const size = packet[4]!;
    if (size >= 7 && (packet[5]! & 0x10)) shiftPcr(packet, 6, ticks);
    if (packet[5]! & 0x08) {
      const at = packet[5]! & 0x10 ? 12 : 6;
      if (size >= at + 1) shiftPcr(packet, at, ticks);
    }
    payload += size + 1;
  }
  if (!(adaptation & 1) || !(packet[1]! & 0x40) || payload + 14 > packet.length) return;
  if (packet[payload] !== 0 || packet[payload + 1] !== 0 || packet[payload + 2] !== 1) return;
  const flags = packet[payload + 7]!;
  if (flags & 0x80) shiftPesClock(packet, payload + 9, ticks);
  if ((flags & 0x40) && payload + 19 <= packet.length) shiftPesClock(packet, payload + 14, ticks);
}
