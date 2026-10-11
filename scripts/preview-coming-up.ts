import fs from 'node:fs';
import path from 'node:path';
import { comingUpCards, comingUpCardX, comingUpEase, comingUpMotion } from '../src/coming-up.js';
import type { ScheduleEntry } from '../src/types.js';

// A self-contained, interactive design preview. No schedule/database access,
// media rendering, speech generation, or broadcast process is involved.
const titles = ['Benjamin Blümchen', 'Die Sendung mit der Maus', 'Biene Maja', 'Pettersson und Findus', 'LKP Wetterfreunde'];
const entries: ScheduleEntry[] = titles.map((showTitle, i) => ({
  id: `preview-${i}`, sequence: i, mediaId: `preview-${i}`, showId: `preview-${i}`, showTitle,
  episodeTitle: '', description: '', startsAtMs: i * 1_320_000, endsAtMs: (i + 1) * 1_320_000,
  durationMs: 1_320_000, mediaPath: '', subtitleLanguages: [],
  ...(i === 4 ? {} : { season: 1, episode: i + 3 }),
}));
const cards = comingUpCards(entries, 1920, 1080);
const xml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const font = fs.readFileSync(path.resolve('assets/weather/fonts/Fredoka.ttf')).toString('base64');
const panelMarkup = [...cards].reverse().map((card, reverseIndex) => {
  const i = 4 - reverseIndex;
  return `<g id="card-${i}" transform="translate(-1000 832)"><rect width="${card.width}" height="${card.height}" fill="${card.color}"/>` +
    card.lines.map(line => `<text x="${card.inset}" y="${line.top}" dominant-baseline="text-before-edge" font-size="${line.size}" fill="${card.ink}">${xml(line.text)}</text>`).join('') + '</g>';
}).join('');
const html = `<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LKP · Gleich im Programm</title>
<style>@font-face{font-family:Fredoka;src:url(data:font/ttf;base64,${font})}*{box-sizing:border-box}body{margin:0;background:#f3f6f4;color:#004f4f;font-family:Fredoka,sans-serif;padding:32px}main{max-width:1440px;margin:auto}h1{font-weight:500;font-size:30px;margin:0 0 8px}p{margin:0 0 24px;font-size:18px}svg{display:block;width:100%;height:auto;border-radius:8px;background:#213f49;box-shadow:0 16px 48px #004f4f22}svg text{font-family:Fredoka,sans-serif}nav{display:flex;align-items:center;gap:16px;padding:24px 0;flex-wrap:wrap}button{font:inherit;font-size:17px;border:0;padding:12px 22px;border-radius:8px;color:white;background:#004f4f;cursor:pointer}input{flex:1;min-width:160px;accent-color:#004f4f}output{min-width:75px;font-variant-numeric:tabular-nums}.note{font-size:15px;color:#496b6b}</style>
<main><h1>Gleich im Programm</h1><p>Fünf Farben. Ein fließender Ausblick auf LKP.</p>
<svg viewBox="0 0 1920 1080" role="img" aria-label="Animationsvorschau mit fünf farbigen Programmfeldern"><defs><linearGradient id="back" x2="1" y2="1"><stop stop-color="#33525d"/><stop offset="1" stop-color="#122b35"/></linearGradient></defs><rect width="1920" height="1080" fill="url(#back)"/><text x="96" y="115" fill="#bed0d4" font-size="32">LKP</text><text x="960" y="470" text-anchor="middle" fill="#bed0d4" font-size="44">Hier läuft die Sendung weiter.</text><text x="960" y="535" text-anchor="middle" fill="#8aa5ac" font-size="26">Animationsvorschau · Beispielsendeplan</text>${panelMarkup}</svg>
<nav><button id="play">Pause</button><button id="replay">Noch einmal</button><input id="scrub" type="range" min="0" max="20" step="0.01" value="0" aria-label="Animationszeit"><output id="time">0,0 s</output></nav>
<p class="note">Einblenden → nacheinander entfalten → lesen → wieder zusammenfalten → nach links ausfliegen. Die Sendung und ihr Ton laufen durchgehend weiter.</p></main>
<script>const comingUpMotion=${JSON.stringify(comingUpMotion)};const comingUpEase=${comingUpEase.toString()};const comingUpCardX=${comingUpCardX.toString()};const cards=${JSON.stringify(cards)};
const slider=document.getElementById('scrub'),play=document.getElementById('play'),output=document.getElementById('time');let elapsed=0,playing=true,previous=performance.now();
function draw(){cards.forEach((c,i)=>{const g=document.getElementById('card-'+i);g.setAttribute('transform','translate('+comingUpCardX(elapsed,20,i,c.left,cards[0].width)+',832)');g.style.display=elapsed>=20?'none':'';});slider.value=elapsed;output.value=elapsed.toFixed(1).replace('.',',')+' s';}
play.onclick=()=>{playing=!playing;play.textContent=playing?'Pause':'Abspielen';};document.getElementById('replay').onclick=()=>{elapsed=0;playing=true;play.textContent='Pause';draw();};slider.oninput=()=>{elapsed=Number(slider.value);playing=false;play.textContent='Abspielen';draw();};
function tick(now){if(playing){elapsed+=(now-previous)/1000;if(elapsed>22)elapsed=0;draw();}previous=now;requestAnimationFrame(tick);}draw();requestAnimationFrame(tick);</script></html>`;
const output = path.resolve('runtime/coming-up-preview/index.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
process.stdout.write(`Animation preview: ${output}\n`);
