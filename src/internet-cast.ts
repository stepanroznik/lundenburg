import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// A receiver cannot use the sender's HTTP Basic login. These capabilities grant
// GET/HEAD access to HLS only, expire after six hours, and die on server restart.
export class CastAccess {
  private readonly key = randomBytes(32);
  readonly lifetimeMs = 6 * 60 * 60_000;

  issue(now = Date.now()): { path: string; expiresAt: number } {
    const expiresAt = now + this.lifetimeMs;
    const payload = `${expiresAt}.${randomBytes(16).toString('hex')}`;
    const token = `${payload}.${this.sign(payload)}`;
    return { path: `/cast/${token}/stream.m3u8`, expiresAt };
  }

  valid(token: string, now = Date.now()): boolean {
    const match = /^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
    if (!match) return false;
    const expiry = Number(match[1]);
    if (expiry <= now || expiry > now + this.lifetimeMs) return false;
    const expected = Buffer.from(this.sign(`${match[1]}.${match[2]}`), 'hex');
    return timingSafeEqual(expected, Buffer.from(match[3]!, 'hex'));
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('hex');
  }
}

export function createCastHandler(options: {
  hlsDirectory: string;
  authorized: (request: IncomingMessage) => boolean;
  security: (response: ServerResponse) => void;
  access?: CastAccess;
}): (request: IncomingMessage, response: ServerResponse, url: URL) => boolean {
  const access = options.access ?? new CastAccess();
  return (request, response, url) => {
    if (url.pathname !== '/api/cast' && !url.pathname.startsWith('/cast/')) return false;
    options.security(response);
    response.setHeader('Cache-Control', 'no-store');
    const end = (status: number, message: string) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : message);
      return true;
    };
    if (url.pathname === '/api/cast') {
      if (!options.authorized(request)) return end(401, 'Sign in to start casting');
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return end(405, 'Use POST');
      }
      // Cross-origin forms cannot set this header. No CORS is granted to the
      // capability-issuing endpoint or any other authenticated API.
      if (request.headers['x-lkp-cast'] !== '1' ||
          (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin')) {
        return end(403, 'Start casting from the player');
      }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(access.issue()));
      return true;
    }

    // CORS applies only to the capability-scoped media, including errors. Cast
    // receivers fetch these URLs without cookies or the stream password.
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Range');
    response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    const match = /^\/cast\/([^/]+)\/(stream\.m3u8|segment-\d+\.ts)$/.exec(url.pathname);
    if (!match || !access.valid(match[1]!)) return end(403, 'Cast link expired or invalid; reconnect from the player');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return true; }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD, OPTIONS');
      return end(405, 'Use GET or HEAD');
    }
    let body: Buffer;
    try { body = fs.readFileSync(path.join(options.hlsDirectory, match[2]!)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return end(404, 'Stream is starting');
      return end(503, 'Stream temporarily unavailable');
    }
    // FFmpeg writes relative segment names. Resolving them against this playlist
    // keeps the capability in the path for every segment and playlist refresh.
    const playlist = match[2] === 'stream.m3u8';
    response.setHeader('Content-Type', playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    response.setHeader('Accept-Ranges', 'bytes');
    let start = 0, endByte = body.length - 1, status = 200;
    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2]));
        endByte = range[1] && range[2] ? Math.min(Number(range[2]), endByte) : endByte;
      } else start = body.length;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endByte) || start > endByte || start >= body.length) {
        response.setHeader('Content-Range', `bytes */${body.length}`);
        return end(416, 'Range not satisfiable');
      }
      response.setHeader('Content-Range', `bytes ${start}-${endByte}/${body.length}`);
      status = 206;
    }
    response.setHeader('Content-Length', String(Math.max(0, endByte - start + 1)));
    response.writeHead(status);
    response.end(request.method === 'HEAD' ? undefined : body.subarray(start, endByte + 1));
    return true;
  };
}
