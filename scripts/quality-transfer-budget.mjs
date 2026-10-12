// yt-dlp retains separate streams while writing its merged container.
// Approximate provider sizes cannot be used as a one-file staging ceiling.
export function qualityTransferReservation(estimatedPayloadBytes, actualStreamBytes = 0) {
  if (!Number.isFinite(estimatedPayloadBytes) || estimatedPayloadBytes <= 0 || !Number.isFinite(actualStreamBytes) || actualStreamBytes < 0)
    throw new Error('Invalid quality transfer size');
  return Math.ceil(Math.max(estimatedPayloadBytes, actualStreamBytes) * 2.5);
}
export const isQualityStreamFile = name => /^replacement(?:\.f[\w-]+)?\.(?:mp4|m4a|webm|mkv|mov)(?:\.part(?:-Frag\d+)?)?$/.test(name);
