#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { check, publish, savePrivate, type Settings, type MonitorState } from './monitor.js';

const program=new Command().name('lkp-notifications').option('-c, --config <file>','channel configuration');
const directory='/home/lundenburg/lundenburg/runtime/notifications';
const settingsFile=path.join(directory,'settings.json'),stateFile=path.join(directory,'state.json');
function settings():Settings {
  const stat=fs.statSync(settingsFile);if((stat.mode&0o077)!==0)throw new Error('Settings must be owner-only');
  const value=JSON.parse(fs.readFileSync(settingsFile,'utf8')) as Settings;
  if(!/^lkp-[a-f0-9]{32}$/.test(value.topic)||!Number.isFinite(Date.parse(value.vpnExpiresAt))||!Number.isFinite(value.reserveBytes)||value.reserveBytes<1)throw new Error('Invalid settings');
  return value;
}
function date(value:string):string {if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Use an ISO date with timezone');return new Date(value).toISOString();}
program.command('setup').description('create private topic/config without sending a message').action(()=>{
  if(!fs.existsSync(settingsFile))savePrivate(settingsFile,{topic:`lkp-${crypto.randomBytes(16).toString('hex')}`,vpnExpiresAt:'2026-11-06T15:29:00Z',mutedUntil:'',reserveBytes:100*1024**3});
  console.log('Private settings ready. On the Pi open runtime/notifications/settings.json in nano, and subscribe to its topic in the ntfy phone app (server https://ntfy.sh). No message sent.');
});
program.command('check').action(async()=>{
  const app=loadConfig(program.opts<{config?:string}>().config),config=settings();
  let state:MonitorState={armed:false,incidents:{},retryAt:0};
  if(fs.existsSync(stateFile))state=JSON.parse(fs.readFileSync(stateFile,'utf8')) as MonitorState;
  const result=await check(app,config,state);savePrivate(stateFile,result.state);console.log(`Notification check complete; messages sent: ${result.sent}.`);
});
program.command('test').description('send one phone notification').action(async()=>{await publish(settings().topic,'LKP notifications are connected. Routine downloads will stay quiet.');console.log('Test notification accepted by ntfy.');});
program.command('renewed').argument('<expiry>','new membership expiry, ISO date including timezone').action((expiry:string)=>{const value=settings();value.vpnExpiresAt=date(expiry);savePrivate(settingsFile,value);console.log('Renewal reminder updated.');});
program.command('mute').argument('<until>','suppress alerts until ISO date including timezone').action((until:string)=>{const value=settings();value.mutedUntil=date(until);savePrivate(settingsFile,value);console.log('Alerts muted until the specified time.');});
program.command('status').action(()=>{const value=settings();console.log(JSON.stringify({configured:true,vpnExpiresAt:value.vpnExpiresAt,mutedUntil:value.mutedUntil,settingsFile},null,2));});
program.parseAsync().catch(()=>{console.error('Notification command failed. Check private settings and connectivity; credentials and provider responses are not logged.');process.exitCode=1;});
