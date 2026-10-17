#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';
import { readPlayoutStatus } from './playout-status.js';
import { loadConfig } from './config.js';
import { serveHlsFile } from './internet-hls.js';
import { createCastHandler } from './internet-cast.js';
import { castPlayerJs } from './internet-cast-player.js';
import { player, playerJs } from './internet-player.js';

const config = loadConfig();
const username = process.env.LKP_STREAM_USERNAME ?? 'lkp';
const configuredPassword = process.env.LKP_STREAM_PASSWORD;
if (!configuredPassword || configuredPassword.length < 8) throw new Error('LKP_STREAM_PASSWORD must contain at least 8 characters');
const password: string = configuredPassword;

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function authorized(request: IncomingMessage): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = Buffer.from(value.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const at = decoded.indexOf(':');
  return at >= 0 && equal(decoded.slice(0, at), username) && equal(decoded.slice(at + 1), password);
}
function security(response: ServerResponse) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; media-src 'self' blob:; script-src 'self' https://www.gstatic.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://www.gstatic.com; frame-src https://www.gstatic.com; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}
function send(response: ServerResponse, status: number, type: string, body: string | Buffer, cache = 'no-store') {
  security(response); response.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': Buffer.byteLength(body) }); response.end(body);
}

const database = new Database(config.storage.database, { readonly: true, fileMustExist: true });
const queryCurrent = database.prepare(`SELECT s.show_title showTitle, s.episode_title episodeTitle, s.starts_at_ms startsAtMs,
  COALESCE((SELECT MIN(n.starts_at_ms) FROM schedule_entries n WHERE n.starts_at_ms>s.starts_at_ms AND (n.show_id='lkp-weather' OR (n.listing_visibility!='hidden' AND n.show_id NOT LIKE 'lkp-%'))),s.ends_at_ms) endsAtMs
  FROM schedule_entries s WHERE s.starts_at_ms<=? AND (s.show_id='lkp-weather' OR (s.listing_visibility!='hidden' AND s.show_id NOT LIKE 'lkp-%')) ORDER BY s.starts_at_ms DESC LIMIT 1`);
const queryNext = database.prepare(`SELECT show_title showTitle,episode_title episodeTitle,starts_at_ms startsAtMs,ends_at_ms endsAtMs FROM schedule_entries
  WHERE starts_at_ms>=? AND (show_id='lkp-weather' OR (listing_visibility!='hidden' AND show_id NOT LIKE 'lkp-%')) ORDER BY starts_at_ms LIMIT 1`);
const queryCatalog = database.prepare(`SELECT id,show_id showId,show_title showTitle,season,episode,episode_title episodeTitle,description,media_path mediaPath,duration_ms durationMs,
  effective_editorial_duration_ms effectiveEditorialDurationMs,external_ids_json externalIds,editorial_markers_json editorialMarkers,credits_policy creditsPolicy,breakpoints_json breakpoints,
  subtitles_json subtitles,ingest_state ingestState,qc_warnings_json qcWarnings FROM media_items WHERE enabled=1 ORDER BY show_title,season,episode,episode_title`);
const queryPlans = database.prepare(`SELECT id,media_id mediaId,show_title showTitle,episode_title episodeTitle,starts_at_ms startsAtMs,ends_at_ms endsAtMs,playout_plan_json playoutPlan
  FROM schedule_entries WHERE starts_at_ms>=? AND playout_plan_json IS NOT NULL ORDER BY starts_at_ms LIMIT 20`);
const hlsPattern = /^\/(hls)\/((?:master|stream)\.m3u8|segment-\d+\.ts)$/;

const handleCast = createCastHandler({ hlsDirectory: config.internet.hlsDirectory, authorized, security });
const server = http.createServer((request, response) => {
  let url: URL;
  try { url = new URL(request.url ?? '/', 'http://localhost'); }
  catch { return send(response, 400, 'text/plain; charset=utf-8', 'Invalid URL'); }
  if (handleCast(request, response, url)) return;
  if (!authorized(request)) { security(response); response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="LKP Live", charset="UTF-8"', 'Cache-Control': 'no-store' }); response.end('Authentication required'); return; }
  if (url.pathname === '/') return send(response, 200, 'text/html; charset=utf-8', player);
  if (url.pathname === '/cast.js') return send(response, 200, 'text/javascript; charset=utf-8', castPlayerJs);
  if (url.pathname === '/player.js') return send(response, 200, 'text/javascript; charset=utf-8', playerJs);
  if (url.pathname === '/brand.svg') return send(response, 200, 'image/svg+xml', fs.readFileSync(config.logo.path), 'public, max-age=86400');
  if (url.pathname === '/font.ttf') return send(response, 200, 'font/ttf', fs.readFileSync(path.join(config.projectRoot, 'assets/weather/fonts/Fredoka.ttf')), 'public, max-age=86400');
  if (url.pathname === '/hls.min.js') {
    const file = path.join(config.projectRoot, 'node_modules/hls.js/dist/hls.min.js');
    if (!fs.existsSync(file)) return send(response, 503, 'text/plain; charset=utf-8', 'Web player dependency unavailable');
    return send(response, 200, 'text/javascript; charset=utf-8', fs.readFileSync(file), 'public, max-age=86400');
  }
  if (url.pathname === '/api/playout') return send(response, 200, 'application/json; charset=utf-8', JSON.stringify(readPlayoutStatus(path.join(config.storage.runtimeDirectory, 'playout-status.json'))));
  if (url.pathname === '/api/programme') {
    const now = Date.now();
    return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({ now: queryCurrent.get(now) ?? null, next: queryNext.get(now + 1) ?? null, serverTime: now }));
  }
  if (url.pathname === '/api/catalog') {
    const decode = (value: unknown): unknown => JSON.parse(String(value));
    const items = (queryCatalog.all() as Array<Record<string, unknown>>).map((row) => ({
      ...row, externalIds: decode(row.externalIds), editorialMarkers: decode(row.editorialMarkers),
      breakpoints: decode(row.breakpoints), subtitles: decode(row.subtitles), qcWarnings: decode(row.qcWarnings),
    }));
    const plans = (queryPlans.all(Date.now()) as Array<Record<string, unknown>>).map((row) => ({ ...row, playoutPlan: decode(row.playoutPlan) }));
    return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({ items, upcomingPlans: plans, serverTime: Date.now() }));
  }
  const match = hlsPattern.exec(url.pathname);
  if (match) {
    const file = path.join(config.internet.hlsDirectory, match[2]!);
    security(response);
    void serveHlsFile(request, response, file, match[2]!.endsWith('.m3u8'));
    return;
  }
  return send(response, 404, 'text/plain; charset=utf-8', 'Not found');
});
// HLS requests arrive roughly every four seconds. Keep idle connections long
// enough for playlist and segment reuse instead of racing a five-second close.
server.keepAliveTimeout = 30000;
server.headersTimeout = 60000;
server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(config.internet.port, config.internet.bind, () => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'info', message: 'Authenticated LKP player listening', bind: config.internet.bind, port: config.internet.port })}\n`));
const stop = () => server.close(() => { database.close(); process.exit(0); });
process.once('SIGTERM', stop); process.once('SIGINT', stop);
