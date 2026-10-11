import type { Command } from 'commander';

import { loadConfig } from '../config.js';
import { LkpDatabase } from '../database.js';
import { loadAcquisitionConfig } from './model.js';
import { ContentAcquisition } from './service.js';
export function registerContent(program:Command):void {
  const content=program.command('content').description('unattended bounded content discovery and canonical ingestion');
  content.option('--policy <file>','acquisition policy YAML');
  const context=()=>{const app=loadConfig(program.opts<{config?:string}>().config);const db=new LkpDatabase(app.storage.database);try{return {db,service:new ContentAcquisition(app,db,loadAcquisitionConfig(app,content.opts<{policy?:string}>().policy))};}catch(e){db.close();throw e;}};
  for(const command of ['status','subscriptions','pending-manual','history','storage','quarantine'])content.command(command).action(()=>{const {db,service}=context();try{console.log(JSON.stringify(service.report(command),null,2));}finally{db.close();}});
  content.command('run').description('index, discover, ingest, enrich, and safely regenerate future scheduling').option('--scheduled','continue queued batches; poll idle sources periodically').action(async(options:{scheduled?:boolean})=>{const {db,service}=context();try{console.log(JSON.stringify(await service.run({scheduled:Boolean(options.scheduled)}),null,2));}finally{db.close();}});
  content.command('discover').description('discover candidates without downloading').action(async()=>{const {db,service}=context();try{console.log(JSON.stringify(await service.run({discoverOnly:true}),null,2));}finally{db.close();}});
  content.command('index').option('--limit <count>','maximum uncatalogued probes',Number,25).action(async(options:{limit:number})=>{
    if(!Number.isSafeInteger(options.limit)||options.limit<0)throw new Error('Index limit must be a nonnegative integer');
    const {db,service}=context();try{console.log(JSON.stringify(await service.run({indexOnly:true,indexLimit:options.limit}),null,2));}finally{db.close();}
  });
}
