import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qualityTransferReservation, isQualityStreamFile } from '../scripts/quality-transfer-budget.mjs';

test('separate streams plus a growing merged file fit the quality transfer reservation', () => {
  const video=901066715,audio=49555181,merged=video+audio,estimate=1101616840/1.25;
  const ceiling=qualityTransferReservation(estimate,video+audio);
  assert.ok(video+audio+merged<=ceiling);
  assert.ok(video+audio+469762048>estimate*1.25,'regression fixture reproduces the premature merge termination');
});
test('actual stream bytes correct approximate provider sizes without counting merged output twice', () => {
  assert.ok(qualityTransferReservation(100,1000)>=2000);
  for (const name of ['replacement.f137.mp4','replacement.f251.webm','replacement.f137.mp4.part','replacement.f137.mp4.part-Frag12','replacement.mp4.part']) assert.equal(isQualityStreamFile(name),true);
  for (const name of ['replacement.temp.mkv','replacement.mux.partial.mkv','playout.mp4','original.rollback','swap.json']) assert.equal(isQualityStreamFile(name),false);
  assert.throws(()=>qualityTransferReservation(NaN));assert.throws(()=>qualityTransferReservation(100,-1));
});
