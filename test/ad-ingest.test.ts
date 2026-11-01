import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {AdIngestService} from '../src/ads.js';
import {LkpDatabase} from '../src/database.js';
import {config} from './helpers.js';

test('ad fallback requests bounded source quality and never exposes provider stderr',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lkp-ad-ingest-'));
  const app=config(root),previous=process.env.LKP_YT_DLP;
  app.advertising={enabled:true,root:path.join(root,'ads'),programmeInterval:2,minEditorialMinutes:35,targetSeconds:{min:30,max:60},searchWindowMinutes:5,minimumBreakpointScore:12,bumperManifest:path.join(root,'bumpers.json')};
  const downloader=path.join(root,'downloader'),args=path.join(root,'download-args');
  fs.writeFileSync(downloader,`#!/bin/sh
if [ "$1" = --dump-single-json ]; then
  printf '%s\\n' '{"id":"fixture-ad","title":"Fixture ad"}'
  exit 0
fi
printf '%s\\n' "$@" > '${args}'
printf '%s\\n' 'https://example.invalid/?signature=sentinel-sensitive-value' >&2
exit 1
`,{mode:0o700});
  const db=new LkpDatabase(app.storage.database);
  try {
    process.env.LKP_YT_DLP=downloader;
    await assert.rejects(new AdIngestService(app,db).ingest('https://www.youtube.com/watch?v=fixture-ad'),error=>{
      assert.ok(error instanceof Error);assert.match(error.message,/failed \(1\)/);
      assert.doesNotMatch(error.message,/sentinel|signature|example\.invalid/);return true;
    });
    const selection=fs.readFileSync(args,'utf8');
    assert.match(selection,/height>=360/);assert.match(selection,/height<=1080/);
    assert.match(selection,/height,vcodec:h264/);
  }finally{db.close();if(previous===undefined)delete process.env.LKP_YT_DLP;else process.env.LKP_YT_DLP=previous;fs.rmSync(root,{recursive:true,force:true});}
});
