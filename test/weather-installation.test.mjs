import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {verifyWeatherDependencies} from '../scripts/verify-weather-installation.mjs';

test('weather deployment detects missing and stale installed dependencies',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-weather-install-'));
  const write=(name,data)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data));};
  try {
    write('package.json',{dependencies:{jose:'^6.2.12'}});
    write('package-lock.json',{packages:{'node_modules/jose':{version:'6.2.12'}}});
    assert.throws(()=>verifyWeatherDependencies(root),/jose/);
    write('node_modules/jose/package.json',{version:'6.2.11'});
    assert.throws(()=>verifyWeatherDependencies(root),/jose/);
    write('node_modules/jose/package.json',{version:'6.2.12'});
    assert.doesNotThrow(()=>verifyWeatherDependencies(root));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
