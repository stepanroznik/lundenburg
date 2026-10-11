import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, type MonitorState } from '../src/notifications/monitor.js';
const state=():MonitorState=>({armed:false,incidents:{},retryAt:0});
test('brief outages and recoveries are silent; sustained incidents notify once',()=>{
  const s=state();assert.deepEqual(evaluate(s,{broadcast:'Stopped'},0),[]);
  assert.deepEqual(evaluate(s,{broadcast:''},60_000),[]);
  assert.deepEqual(evaluate(s,{broadcast:''},200_000),[]);
  evaluate(s,{broadcast:'Stopped'},300_000);
  const notices=evaluate(s,{broadcast:'Stopped'},420_000);assert.equal(notices.length,1);
  s.incidents.broadcast!.notified=notices[0]!.value;
  assert.deepEqual(evaluate(s,{broadcast:'Stopped'},900_000),[]);
  assert.deepEqual(evaluate(s,{broadcast:''},910_000),[]);
  assert.equal(evaluate(s,{broadcast:''},1_030_000)[0]?.message,'Resolved: broadcast.');
});
test('failed delivery stays pending and multiple faults can be combined',()=>{
  const s=state();evaluate(s,{broadcast:'Stopped',storage:'Missing'},0);
  assert.equal(evaluate(s,{broadcast:'Stopped',storage:'Missing'},120_000).length,2);
  assert.equal(evaluate(s,{broadcast:'Stopped',storage:'Missing'},240_000).length,2);
  // No recovery message if delivery never succeeded.
  evaluate(s,{broadcast:'',storage:''},300_000);
  assert.deepEqual(evaluate(s,{broadcast:'',storage:''},420_000),[]);
});
