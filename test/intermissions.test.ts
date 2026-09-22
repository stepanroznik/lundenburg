import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { catalogue, soapDialogue, validateCatalogue } from '../src/intermissions/catalogue.js';
import { prepareFilm } from '../src/intermissions/prepare.js';
import { seasonAt, eligibleSkits } from '../src/intermissions/model.js';
import { presenters } from '../src/characters/registry.js';
import { presenters as weatherPresenters } from '../src/weather/characters.js';
import { spokenNames } from '../src/weather/speech.js';

test('the set contains two silent films per season, six voiced sketches and an ident', () => {
  validateCatalogue();
  for (const season of ['spring','summer','autumn','winter']) assert.equal(catalogue.filter(s=>s.season===season&&s.kind==='silent').length,2);
  assert.equal(catalogue.filter(s=>s.kind==='voiced').length,6);
  assert.equal(catalogue.filter(s=>s.kind==='ident').length,1);
  assert.strictEqual(presenters,weatherPresenters);
});
test('the soap dialogue is verbatim and each character keeps their language', () => {
  assert.deepEqual(soapDialogue,[
    'Haluško, ty se sprchuješ s mýdlem?',
    'Hej. U nás na Slovensku sa normálne mydlia ovce aj barany.',
    'Zajímavé. No, já si vystačím s vodou ve Svratce.',
  ]);
  assert.deepEqual(catalogue.find(s=>s.scene==='soap')!.lines.map(l=>l.text),soapDialogue);
  const bad = structuredClone(catalogue.find(s=>s.scene==='soap')!);
  bad.lines[1]!.language='cs';
  assert.throws(()=>validateCatalogue([bad]),/language mismatch/);
});
test('Czech and Slovak character names are phonetic only in speech requests', () => {
  assert.equal(spokenNames('Schalinka a Haluschka', 'cs'), 'Šalinka a Haluška');
  assert.equal(spokenNames('Schalinka a Haluschka', 'sk'), 'Šalinka a Haluška');
  assert.equal(spokenNames('Schalinka und Haluschka', 'de'), 'Schalinka und Haluschka');
  assert.equal(catalogue.find(s=>s.scene==='dragon')!.lines[0]!.text, 'Schalinka, a ty si vlastne aké zviera?');
});
test('revised dialogue tells the Brdy story and uses standard Czech agreement', () => {
  const dam=catalogue.find(s=>s.scene==='dam')!;
  assert.match(dam.lines.map(l=>l.text).join(' '), /Feuchtgebiet.*dreißig Millionen/s);
  assert.deepEqual(dam.lines.slice(-2).map(l=>l.text), ['Und eine Baugenehmigung?','Was ist das?']);
  assert.equal(catalogue.find(s=>s.scene==='quiet')!.lines.at(-1)!.text, 'To bylo jen průběžné skóre.');
});
test('all eight silent films prepare in paid mode with zero network calls', async () => {
  const original=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async()=>{requests++;throw new Error('No network allowed');};
  try {
    for (const skit of catalogue.filter(s=>s.kind==='silent')) {
      const f=await prepareFilm(skit,'tts');
      assert.equal(f.cues.length,0);
      assert.equal(f.preview,false);
      assert.equal(f.durationInFrames,skit.seconds!*30);
      assert.equal(f.durationInFrames-f.logoFrom,30);
    }
    assert.equal(requests,0);
  } finally {globalThis.fetch=original;}
});
test('season selection follows Prague dates at UTC month boundaries', () => {
  assert.equal(seasonAt(new Date('2026-02-28T22:59:59Z')),'winter');
  assert.equal(seasonAt(new Date('2026-02-28T23:00:00Z')),'spring');
  assert.equal(seasonAt(new Date('2026-05-31T22:00:00Z')),'summer');
  assert.equal(seasonAt(new Date('2026-08-31T22:00:00Z')),'autumn');
  const autumn=eligibleSkits(catalogue,new Date('2026-09-21T17:00:00Z'));
  assert.equal(autumn.length,9);
  assert.ok(autumn.every(s=>!s.season||s.season==='autumn'));
});
test('generated dialogue never overlaps, extends past the picture, or loses its source text', () => {
  const root='runtime/intermissions/manifests';
  if(!fs.existsSync(root))return;
  for(const skit of catalogue){
    const file=`${root}/${skit.id}.json`;if(!fs.existsSync(file))continue;
    const f=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(f.preview,false);
    assert.deepEqual(f.cues.map((c:{text:string})=>c.text),skit.lines.map(l=>l.text));
    let previous=0;
    for(const cue of f.cues){
      assert.ok(cue.from>=previous);
      assert.ok(cue.frames>=Math.ceil(cue.asset.duration*f.fps));
      assert.ok(cue.asset.audio);
      previous=cue.from+cue.frames;
    }
    assert.ok(f.logoFrom>=previous);
    assert.ok(f.durationInFrames>=f.logoFrom+30);
  }
});
