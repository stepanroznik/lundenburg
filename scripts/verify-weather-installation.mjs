#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Check the installed tree, not only the manifest: partial source deployments
// can otherwise leave unattended weather failing before its command starts.
export function verifyWeatherDependencies(root) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  for(const name of Object.keys({...manifest.dependencies,...manifest.devDependencies})) {
    const expected=lock.packages?.[`node_modules/${name}`]?.version;
    let installed;
    try {installed=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8')).version;} catch {}
    if(!expected || installed!==expected)throw new Error(`Weather dependency missing or out of sync: ${name}`);
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const root=process.cwd();verifyWeatherDependencies(root);
    if(!process.argv.includes('--dependencies-only')) {
      const result=spawnSync(process.execPath,['--import','tsx','src/weather/cli.ts','--help'],{cwd:root,encoding:'utf8',timeout:60_000});
      if(result.error || result.status!==0)throw new Error('Weather command cannot load; installation is incomplete');
    }
    console.log('Weather installation verified.');
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
