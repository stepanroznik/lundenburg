// Runs inside the new isolated acquisition release on the Pi. Never prints secrets.
import fs from 'node:fs';
import path from 'node:path';
import { parse,stringify } from 'yaml';
const active='/home/lundenburg/lundenburg';
const raw=parse(fs.readFileSync(path.join(active,'config/lkp.yaml'),'utf8'));
let env={};
// Read only path overrides, never the stream credential file.
if(fs.existsSync('/etc/lkp.env')){
  try{
    for(const line of fs.readFileSync('/etc/lkp.env','utf8').split(/\r?\n/)){
      const match=/^(LKP_(?:CONFIG|DATABASE|MEDIA_ROOT|GENERATED_MEDIA_ROOT))=(.*)$/.exec(line);
      if(match)env[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,'$2');
    }
  }catch{}
}
const channel=env.LKP_CONFIG?parse(fs.readFileSync(path.resolve(active,env.LKP_CONFIG),'utf8')):raw;
const resolve=value=>path.resolve(active,value);
channel.storage.database=resolve(env.LKP_DATABASE??channel.storage.database);
channel.storage.runtimeDirectory=resolve(channel.storage.runtimeDirectory);
channel.media.root=resolve(env.LKP_MEDIA_ROOT??channel.media.root);
channel.media.generatedRoot=resolve(env.LKP_GENERATED_MEDIA_ROOT??channel.media.generatedRoot);
channel.media.mountPoint=resolve(channel.media.mountPoint);
channel.epg.output=resolve(channel.epg.output);
channel.schedule.spokenLanguageTargets??={de:.55,en:.30,cs:.15};
for(const [section,keys] of [['logo',['path']],['broadcast',['fifo','transmitter']],['intermissions',['manifest']],['advertising',['root','bumperManifest']]])for(const key of keys)if(channel[section]?.[key])channel[section][key]=resolve(channel[section][key]);
fs.writeFileSync('config/lkp.yaml',stringify(channel));
const policy=parse(fs.readFileSync('config/content-acquisition.yaml','utf8'));
policy.credentialsFile=path.join(active,'runtime/weather/credentials.env');
if(policy.vpnFallback){policy.vpnFallback.helper=path.resolve('download-hide-vpn.py');policy.vpnFallback.tokenFile=resolve(policy.vpnFallback.tokenFile);}
fs.writeFileSync('config/content-acquisition.yaml',stringify(policy));
// Reuse the existing supported downloader without copying runtime secrets or caches.
fs.mkdirSync('runtime/tools',{recursive:true});fs.symlinkSync(path.join(active,'runtime/tools/yt-dlp'),'runtime/tools/yt-dlp');
console.log('Acquisition configuration points to the authoritative Pi catalogue and media drive.');

// A stable npm entrypoint in the active checkout follows acquisition releases.
const packageFile=path.join(active,'package.json');
const manifest=JSON.parse(fs.readFileSync(packageFile,'utf8'));
manifest.scripts??={};
if(!manifest.scripts.content){
  manifest.scripts.content='node /home/lundenburg/lkp-content/current/dist/src/acquisition/main.js content';
  fs.writeFileSync(packageFile,JSON.stringify(manifest,null,2)+'\n');
}
