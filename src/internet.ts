#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';
import { loadConfig } from './config.js';

const config = loadConfig();
const username = process.env.LKP_STREAM_USERNAME ?? 'lkp';
const configuredPassword = process.env.LKP_STREAM_PASSWORD;
if (!configuredPassword || configuredPassword.length < 20) throw new Error('LKP_STREAM_PASSWORD must contain at least 20 characters');
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
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
}
function send(response: ServerResponse, status: number, type: string, body: string | Buffer, cache = 'no-store') {
  security(response); response.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': Buffer.byteLength(body) }); response.end(body);
}

const player = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LKP Live</title><style>
@font-face{font-family:Fredoka;src:url('/font.ttf')}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#fffcf4;color:#004f4f;font-family:Fredoka,system-ui,sans-serif}header,main{width:min(1120px,calc(100% - 30px));margin:auto}header{display:flex;align-items:center;gap:18px;padding:22px 0 15px}header img{width:74px;height:76px;object-fit:contain}h1{margin:0;font-size:clamp(25px,5vw,42px)}header p{margin:3px 0;color:#52716c}.live{color:#fb1143;font-size:13px;letter-spacing:2px}.frame{overflow:hidden;border:4px solid #004f4f;border-radius:18px;background:#001514;box-shadow:0 18px 50px #004f4f26}video{display:block;width:100%;aspect-ratio:16/9;background:#001514}.info{display:grid;grid-template-columns:1fr 1fr;gap:15px;padding:18px 0 36px}.card{background:#fff;border:1px solid #d6e2d9;border-radius:14px;padding:17px}.label{text-transform:uppercase;letter-spacing:2px;font-size:12px;color:#6e8580}.title{font-size:clamp(18px,3vw,27px);margin:7px 0}.time{color:#647a75}.status{padding:11px 0;color:#647a75}@media(max-width:650px){.info{grid-template-columns:1fr}header img{width:58px}}</style>
<header><img src="/brand.svg" alt="LKP"><div><div class="live">● LIVE</div><h1>Lundenburg Kids Premium</h1><p>Our little channel, live from Lundenburg.</p></div></header><main><div class="frame"><video id="video" controls autoplay muted playsinline></video></div><div id="status" class="status">Connecting to the live stream…</div><section class="info"><div class="card"><div class="label">Now</div><div class="title" id="now-title">Loading…</div><div class="time" id="now-time"></div></div><div class="card"><div class="label">Next</div><div class="title" id="next-title">Loading…</div><div class="time" id="next-time"></div></div></section></main><script src="/hls.min.js"></script><script src="/player.js"></script></html>`;
const playerJs = `const video=document.getElementById('video'),status=document.getElementById('status');
const source='/hls/stream.m3u8';
let hls,restartTimer,failures=0,lastMediaRecovery=0,nativeMode=false,lastProgress=Date.now(),lastTime=0;
function online(){status.textContent='Live stream connected';failures=0;video.muted=false}
function play(){video.play().catch(()=>{status.textContent='Press play to start the live stream'})}
function rebuild(){clearTimeout(restartTimer);if(hls)hls.destroy();hls=new Hls({liveSyncDurationCount:5,liveMaxLatencyDurationCount:12,maxBufferLength:45,backBufferLength:30});hls.loadSource(source);hls.attachMedia(video);hls.on(Hls.Events.MANIFEST_PARSED,play);hls.on(Hls.Events.FRAG_LOADED,online);hls.on(Hls.Events.ERROR,(_,d)=>{if(!d.fatal)return;if(d.type===Hls.ErrorTypes.MEDIA_ERROR&&Date.now()-lastMediaRecovery>5000){lastMediaRecovery=Date.now();status.textContent='Recovering the video…';hls.recoverMediaError();return}status.textContent='Connection interrupted; reconnecting…';const delay=Math.min(10000,1000*Math.pow(2,Math.min(failures++,3)));clearTimeout(restartTimer);restartTimer=setTimeout(rebuild,delay)})}
function restartNative(){video.src=source;video.load();play()}
function native(){nativeMode=true;video.src=source;video.addEventListener('loadedmetadata',play);video.addEventListener('playing',online);video.addEventListener('error',()=>{status.textContent='Connection interrupted; reconnecting…';setTimeout(restartNative,2000)})}
video.addEventListener('waiting',()=>{status.textContent='Buffering live video…'});video.addEventListener('playing',online);
video.addEventListener('timeupdate',()=>{if(video.currentTime>lastTime+.05){lastTime=video.currentTime;lastProgress=Date.now()}});setInterval(()=>{if(!video.paused&&Date.now()-lastProgress>12000){lastProgress=Date.now();status.textContent='Playback stalled; reconnecting…';nativeMode?restartNative():rebuild()}},3000);
if(video.canPlayType('application/vnd.apple.mpegurl'))native();else if(window.Hls&&Hls.isSupported())rebuild();else status.textContent='This browser cannot play HLS video.';
const fmt=n=>new Intl.DateTimeFormat([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(n));
async function programmes(){try{const r=await fetch('/api/programme',{cache:'no-store'});if(!r.ok)throw Error();const p=await r.json();for(const k of ['now','next']){document.getElementById(k+'-title').textContent=p[k]?p[k].showTitle+' · '+p[k].episodeTitle:'Not scheduled';document.getElementById(k+'-time').textContent=p[k]?fmt(p[k].startsAtMs)+'–'+fmt(p[k].endsAtMs):''}}catch{document.getElementById('now-title').textContent='Schedule unavailable'}}programmes();setInterval(programmes,15000);`;

const database = new Database(config.storage.database, { readonly: true, fileMustExist: true });
const queryCurrent = database.prepare('SELECT show_title showTitle, episode_title episodeTitle, starts_at_ms startsAtMs, ends_at_ms endsAtMs FROM schedule_entries WHERE starts_at_ms<=? AND ends_at_ms>? ORDER BY starts_at_ms DESC LIMIT 1');
const queryNext = database.prepare('SELECT show_title showTitle, episode_title episodeTitle, starts_at_ms startsAtMs, ends_at_ms endsAtMs FROM schedule_entries WHERE starts_at_ms>=? ORDER BY starts_at_ms LIMIT 1');
const hlsPattern = /^\/(hls)\/(stream\.m3u8|segment-\d+\.ts)$/;

const server = http.createServer((request, response) => {
  if (!authorized(request)) { security(response); response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="LKP Live", charset="UTF-8"', 'Cache-Control': 'no-store' }); response.end('Authentication required'); return; }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/') return send(response, 200, 'text/html; charset=utf-8', player);
  if (url.pathname === '/player.js') return send(response, 200, 'text/javascript; charset=utf-8', playerJs);
  if (url.pathname === '/brand.svg') return send(response, 200, 'image/svg+xml', fs.readFileSync(config.logo.path), 'public, max-age=86400');
  if (url.pathname === '/font.ttf') return send(response, 200, 'font/ttf', fs.readFileSync(path.join(config.projectRoot, 'assets/weather/fonts/Fredoka.ttf')), 'public, max-age=86400');
  if (url.pathname === '/hls.min.js') {
    const file = path.join(config.projectRoot, 'node_modules/hls.js/dist/hls.min.js');
    if (!fs.existsSync(file)) return send(response, 503, 'text/plain; charset=utf-8', 'Web player dependency unavailable');
    return send(response, 200, 'text/javascript; charset=utf-8', fs.readFileSync(file), 'public, max-age=86400');
  }
  if (url.pathname === '/api/programme') {
    const now = Date.now();
    return send(response, 200, 'application/json; charset=utf-8', JSON.stringify({ now: queryCurrent.get(now, now) ?? null, next: queryNext.get(now + 1) ?? null, serverTime: now }));
  }
  const match = hlsPattern.exec(url.pathname);
  if (match) {
    const file = path.join(config.internet.hlsDirectory, match[2]!);
    if (!fs.existsSync(file)) return send(response, 404, 'text/plain; charset=utf-8', 'Stream is starting');
    return send(response, 200, match[2]!.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t', fs.readFileSync(file), match[2]!.endsWith('.m3u8') ? 'no-store' : 'private, max-age=20');
  }
  return send(response, 404, 'text/plain; charset=utf-8', 'Not found');
});
server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(config.internet.port, config.internet.bind, () => process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'info', message: 'Authenticated LKP player listening', bind: config.internet.bind, port: config.internet.port })}\n`));
const stop = () => server.close(() => { database.close(); process.exit(0); });
process.once('SIGTERM', stop); process.once('SIGINT', stop);
