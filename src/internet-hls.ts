import { observeHlsResponse } from './internet-health.js';
import { open, type FileHandle } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Callers authenticate and whitelist the filename before reaching this helper.
// Open before stat/read: FFmpeg may unlink a rolling segment during a request,
// but an open descriptor stays readable for the rest of that download.
export async function serveHlsFile(
  request: IncomingMessage, response: ServerResponse, file: string,
  playlist: boolean, segmentCache = 'private, max-age=20',
): Promise<void> {
  observeHlsResponse(request, response, playlist);
  response.setHeader('Cache-Control', playlist ? 'no-store' : segmentCache);
  const fail = (status: number, message: string) => {
    if (response.destroyed) return;
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : message);
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    fail(405, 'Use GET or HEAD');
    return;
  }
  let handle: FileHandle | undefined;
  try {
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (response.destroyed) { await handle.close(); return; }
    if (!stat.isFile()) { await handle.close(); fail(404, 'Stream is starting'); return; }
    const size = stat.size;
    let start = 0, end = size - 1, status = 200;
    if (request.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end;
      } else start = size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        await handle.close();
        response.setHeader('Content-Range', `bytes */${size}`);
        fail(416, 'Range not satisfiable');
        return;
      }
      response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      status = 206;
    }
    response.setHeader('Content-Type', playlist ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Length', String(Math.max(0, end - start + 1)));
    if (request.method === 'HEAD' || size === 0) {
      await handle.close();
      response.writeHead(status); response.end();
      return;
    }
    const stream = handle.createReadStream({ start, end, autoClose: true });
    // The stream now owns the descriptor. Respect socket backpressure and stop
    // reading immediately when a viewer cancels a download or starts casting.
    handle = undefined;
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    response.writeHead(status);
    stream.pipe(response);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 503,
      (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Stream is starting' : 'Stream temporarily unavailable');
  }
}
