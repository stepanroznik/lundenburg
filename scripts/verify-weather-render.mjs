#!/usr/bin/env node
// Run with node --import tsx from the isolated weather installation. This
// reuses existing speech; it never requests TTS or publishes a programme.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {renderEpisode} from '../src/weather/render.ts';
import {loadWeatherConfig} from '../src/weather/config.ts';

const [timeline,output]=process.argv.slice(2);
if(!timeline || !output || !output.endsWith('.preview.mp4'))throw new Error('Provide an existing timeline and a new .preview.mp4 output');
if(fs.existsSync(output)||fs.existsSync(`${output}.partial.mp4`))throw new Error('Verification output must be new');
fs.mkdirSync(path.dirname(output),{recursive:true});
const episode=JSON.parse(fs.readFileSync(timeline,'utf8'));
const beat=episode.beats.find(b=>b.purpose==='condition'&&b.from>=episode.fps*3)??episode.beats[0];
const first=beat.from,last=Math.min(episode.durationInFrames-1,first+episode.fps*2-1);
await renderEpisode(episode,`${output}.partial.mp4`,loadWeatherConfig(),{frames:[first,last]});
const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',`${output}.partial.mp4`],{encoding:'utf8',timeout:30000}));
const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
if(video?.codec_name!=='h264'||video.width!==1920||video.height!==1080||video.avg_frame_rate!=='30/1'||audio?.codec_name!=='aac')throw new Error('Weather render does not match the production video/audio profile');
fs.renameSync(`${output}.partial.mp4`,output);
const result={passed:true,preview:true,usesArchivedForecast:true,newSpeechRequests:0,published:false,frames:last-first+1,width:video.width,height:video.height,video:video.codec_name,audio:audio.codec_name,output};
fs.writeFileSync(`${output}.verification.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
