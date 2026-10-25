import type { Command } from 'commander';

import { loadConfig } from '../config.js';
import { LkpDatabase } from '../database.js';
import { loadAcquisitionConfig } from './model.js';
import { ContentAcquisition } from './service.js';
import fs from 'node:fs';
import { parse } from 'yaml';
import { NachtClassifier, validateNachtClassification } from './nacht-classification.js';
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
  content.command('override-ln <candidateId> <file>').description('save a reviewed structured LN decision and requeue the candidate').action((id: string, file: string) => {
    const { db, service } = context();
    try {
      const row = service.store.candidates().find(r => r.id === id); if (!row) throw new Error('Unknown acquisition candidate');
      if (service.config.subscriptions.find(s => s.id === row.metadata.showId)?.profile !== 'ln') throw new Error('Candidate is not an LN subscription');
      new NachtClassifier(db.db).override(row.metadata, validateNachtClassification(parse(fs.readFileSync(file, 'utf8'))));
      service.store.transition(id, 'discovered', 'Manual LN classification override', 0);
      console.log('Reviewed LN decision saved.');
    } finally { db.close(); }
  });
  content.command('retry-ln <candidateId>').description('deliberately retry a pending, rejected or evicted LN item with refreshed metadata').action((id: string) => {
    const { db, service } = context();
    try {
      const row = service.store.candidates().find(r => r.id === id); if (!row) throw new Error('Unknown acquisition candidate');
      if (row.state === 'imported' || service.config.subscriptions.find(s => s.id === row.metadata.showId)?.profile !== 'ln') throw new Error('Only unacquired LN candidates can be retried');
      delete row.metadata.nachtClassification; delete row.metadata.broadcastPolicy;
      db.db.prepare('DELETE FROM acquisition_state WHERE key=?').run(`nacht-metadata:${row.metadata.sourceId}`);
      db.db.prepare('UPDATE acquisition_candidates SET metadata_json=?,attempts=0 WHERE id=?').run(JSON.stringify(row.metadata), id);
      service.store.transition(id, 'discovered', 'Explicit LN retry requested', 0); console.log('LN candidate requeued with metadata refresh.');
    } finally { db.close(); }
  });
}
