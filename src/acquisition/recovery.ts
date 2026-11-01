import type { Subscription } from './model.js';
import type { AcquisitionStore } from './store.js';
import { isOrf } from './adapters.js';

const temporary=/^(?:source unavailable; manual acquisition required|Source currently unavailable|source expired|Downloader (?:unavailable|geo-restricted)|No supported non-DRM media format)/;
/** Migrate old terminal source failures without reopening editorial rejections. */
export function recoverAutomaticSources(store:AcquisitionStore,subscriptions:Subscription[],now=Date.now()):void {
  const key='automatic-source-monitoring-v1';
  if(store.state(key))return;
  const automatic=new Set(subscriptions.filter(s=>s.enabled!==false&&!['manual','existing'].includes(s.source)).map(s=>s.id));
  for(const row of store.candidates(['manual','deferred','discovered'])){
    if(!automatic.has(row.metadata.showId))continue;
    if(!row.metadata.available||temporary.test(row.reason)){
      store.transition(row.id,'monitoring','Source currently unavailable; monitoring for availability',now+86400000);
      store.resolveManual(row.id);
    }else if(row.state==='manual'&&[
      'Repeated processing failures; manual preparation required',
      'ČT detected episode needs manual acquisition: extractor unavailable or access restricted',
    ].includes(row.reason)){
      store.transition(row.id,'deferred','Automatic source retry restored',now);
      store.resolveManual(row.id);
    }
  }
  for(const s of subscriptions.filter(s=>automatic.has(s.id)))store.catalogue.db.prepare(
    "UPDATE acquisition_manual SET state='resolved' WHERE id=? AND reason='No currently discoverable approved episodes; monitoring remains active'"
  ).run(`show:${s.id}`);
  store.set(key,'1');
}

/** Gradually revisit old ORF duration failures using the placeholder checks. */
export function recoverOrfDurationFailures(store:AcquisitionStore,now=Date.now()):void {
  const key='orf-duration-verification-v1';if(store.state(key))return;
  let index=0;
  for(const row of store.candidates(['deferred'])) {
    if(isOrf(row.metadata)&&row.reason==='duration/format outside curated range')
      store.transition(row.id,'deferred','Rechecking ORF source after duration mismatch',now+index++*60_000);
  }
  store.set(key,'1');
}
