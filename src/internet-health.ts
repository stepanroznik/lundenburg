import type { IncomingMessage, ServerResponse } from 'node:http';

type RecordHealth = (entry: Record<string, unknown>) => void;
const writeHealth: RecordHealth = entry => process.stdout.write(JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
const events = new Set(['loading', 'loaded', 'unloaded', 'waiting', 'playing', 'paused', 'buffering', 'idle', 'error']);

// Accept only fixed enums and bounded numbers. Never copy URLs, tokens, device
// names, request headers, error messages or arbitrary client fields into logs.
export function createPlaybackHealthHandler(options: {
  authorized: (request: IncomingMessage) => boolean;
  security: (response: ServerResponse) => void;
  record?: RecordHealth;
}): (request: IncomingMessage, response: ServerResponse, url: URL) => boolean {
  let windowStart = Date.now(), count = 0;
  return (request, response, url) => {
    if (url.pathname !== '/api/playback-health') return false;
    options.security(response); response.setHeader('Cache-Control', 'no-store');
    const end = (status: number) => { response.writeHead(status); response.end(); };
    if (!options.authorized(request)) { end(401); return true; }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); end(405); return true; }
    if (request.headers['x-lkp-playback'] !== '1' ||
      (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) { end(403); return true; }
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); count = 0; }
    if (++count > 120) { request.resume(); end(429); return true; }
    let body = '', size = 0, rejected = false;
    request.on('error', () => {});
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2048) { if (!rejected) end(413); rejected = true; body = ''; return; }
      if (!rejected) body += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (rejected) return;
      try {
        const sample = JSON.parse(body) as Record<string, unknown>;
        if (!sample || (sample.player !== 'browser' && sample.player !== 'cast') || typeof sample.event !== 'string' || !events.has(sample.event)) { end(400); return; }
        const entry: Record<string, unknown> = { message: 'Playback health', player: String(sample.player), event: String(sample.event) };
        for (const key of ['mediaTime', 'bufferAhead', 'rangeStart', 'rangeEnd', 'errorCode']) {
          const value = sample[key];
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1e12) entry[key] = Math.round(value * 1000) / 1000;
        }
        if (typeof sample.idleReason === 'string' && ['ERROR', 'FINISHED', 'CANCELLED', 'INTERRUPTED'].includes(String(sample.idleReason))) entry.idleReason = sample.idleReason;
        (options.record ?? writeHealth)(entry);
        end(204);
      } catch { end(400); }
    });
    return true;
  };
}

export function observeHlsResponse(request: IncomingMessage, response: ServerResponse, playlist: boolean, record = writeHealth): void {
  const started = performance.now();
  let finished = false;
  const report = (aborted: boolean) => {
    const milliseconds = Math.round(performance.now() - started);
    if (aborted || response.statusCode >= 400 || milliseconds > 2000) {
      record({ message: 'HLS delivery health', player: request.url?.startsWith('/cast/') ? 'cast' : 'browser',
        media: playlist ? 'playlist' : 'segment', status: response.statusCode, milliseconds, aborted });
    }
  };
  response.once('finish', () => { finished = true; report(false); });
  response.once('close', () => { if (!finished) report(true); });
}

export const healthPlayerJs = `window.lkpReportPlayback = sample => {
  void fetch('/api/playback-health', {method:'POST', credentials:'same-origin', keepalive:true,
    headers:{'Content-Type':'application/json','X-LKP-Playback':'1'}, body:JSON.stringify(sample)}).catch(()=>{});
};`;
