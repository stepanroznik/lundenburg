import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {parse,stringify} from 'yaml';
import {prepareRelease} from '../scripts/prepare-content-release.mjs';

test('an isolated acquisition release retains active policy and shares the maintained child-age configuration',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-age-release-'));
  const repo=path.join(root,'repo'),baseline=path.join(root,'active'),release=path.join(root,'release');
  const write=(base,file,value)=>{const target=path.join(base,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
  try{
    for(const file of ['dist/src/catalogue.js','dist/src/acquisition/service.js','dist/src/ai/service.js','scripts/download-hide-vpn.py'])write(repo,file,'');
    fs.mkdirSync(path.join(repo,'tools'));
    const app={schedule:{spokenLanguageTargets:{de:.55,en:.3,cs:.15}}};
    write(repo,'config/lkp.yaml',stringify(app));write(baseline,'config/lkp.yaml',stringify(app));
    write(repo,'config/channels.yaml','enabled: true\n');write(repo,'config/children.yaml','enabled: true\ntargetAgeYears: 3\nageToleranceYears: 1\n');
    write(repo,'config/ai.yaml','provider: chatgpt\ncredentialsDirectory: runtime/ai\nmodel: auto-small\n');
    const policy={publishToSchedule:true,reserveBytes:80000000000,subscriptions:[{id:'ms-rachel',minimumEditorialRank:'A'}]};
    write(baseline,'config/content-acquisition.yaml',stringify(policy));
    prepareRelease(baseline,release,repo);
    assert.equal(fs.realpathSync(path.join(release,'config/children.yaml')),path.join(repo,'config/children.yaml'));
    assert.equal(parse(fs.readFileSync(path.join(release,'config/children.yaml'),'utf8')).targetAgeYears,3);
    assert.deepEqual(parse(fs.readFileSync(path.join(release,'config/content-acquisition.yaml'),'utf8')),policy);
    assert.equal(fs.readlinkSync(path.join(release,'runtime')),path.join(repo,'runtime'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
