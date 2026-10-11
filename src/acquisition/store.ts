import type { LkpDatabase } from '../database.js';
import type { Candidate } from './model.js';
export interface CandidateRow { id: string; metadata: Candidate; state: string; reason: string; attempts: number; retryAt: number; catalogueId?: string }
export interface FileRow { path: string; size: number; mtime: number; show_id: string; language: string; keys_json: string; catalogue_id: string | null; state: string; new_asset: number; acquired_at: number }
import { stableId } from '../util.js';
import { preserveEpisodeIdentity } from './adapters.js';
import { preserveClassification } from './classification.js';
export class AcquisitionStore {

    constructor(readonly catalogue: LkpDatabase) {
    catalogue.db.exec(`
      CREATE TABLE IF NOT EXISTS acquisition_candidates (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, url_identity TEXT NOT NULL,
        show_id TEXT NOT NULL, metadata_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'discovered',
        reason TEXT NOT NULL DEFAULT '', first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, catalogue_id TEXT,
        UNIQUE(source,source_id));
      CREATE INDEX IF NOT EXISTS acquisition_candidate_state ON acquisition_candidates(state,retry_at);
      CREATE INDEX IF NOT EXISTS acquisition_candidate_url ON acquisition_candidates(url_identity);
      CREATE TABLE IF NOT EXISTS acquisition_files (
        path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, show_id TEXT NOT NULL,
        language TEXT NOT NULL, keys_json TEXT NOT NULL, catalogue_id TEXT,
        state TEXT NOT NULL, new_asset INTEGER NOT NULL DEFAULT 0, acquired_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS acquisition_probe_cache (path TEXT PRIMARY KEY,size INTEGER NOT NULL,mtime REAL NOT NULL,probe_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS acquisition_history (id INTEGER PRIMARY KEY, at INTEGER NOT NULL,item TEXT NOT NULL,event TEXT NOT NULL,reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS acquisition_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS acquisition_manual (id TEXT PRIMARY KEY,show_id TEXT NOT NULL,candidate_id TEXT,reason TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,catalogue_id TEXT);
      CREATE TABLE IF NOT EXISTS acquisition_lock (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires INTEGER NOT NULL);
      INSERT OR IGNORE INTO schema_migrations(version,applied_at_ms) VALUES(3,${Date.now()});
    `);
  }
    state(key: string): string | undefined { return (this.catalogue.db.prepare('SELECT value FROM acquisition_state WHERE key=?').get(key) as {value:string}|undefined)?.value; }
    set(key: string, value: string): void { this.catalogue.db.prepare('INSERT INTO acquisition_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value); }
    event(item: string, event: string, reason = ''): void {
    this.catalogue.db.prepare('INSERT INTO acquisition_history(at,item,event,reason) VALUES(?,?,?,?)').run(Date.now(),item,event,reason);
  }
    remember(c: Candidate) : string {
        const id = stableId(c.source, c.sourceId), now = Date.now();
        const previous = (this.catalogue.db.prepare('SELECT metadata_json,state FROM acquisition_candidates WHERE id=?').get(id) as {metadata_json:string;state:string}|undefined);
        if (previous) { const old = JSON.parse(previous.metadata_json); preserveEpisodeIdentity(old, c); preserveClassification(old, c); }
        this.catalogue.db.prepare(`INSERT INTO acquisition_candidates(id,source,source_id,url_identity,show_id,metadata_json,first_seen,last_seen)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET metadata_json=excluded.metadata_json,last_seen=excluded.last_seen`)
            .run(id, c.source, c.sourceId, c.sourceUrl, c.showId, JSON.stringify(c), now, now);
        if (previous && previous.state !== 'imported' && previous.state === 'manual' && !JSON.parse(previous.metadata_json).available && c.available)
            this.transition(id, 'discovered', 'Source became available');
        return id;
    }
    candidates(states?: string[]): CandidateRow[] {
    const rows = this.catalogue.db.prepare(`SELECT * FROM acquisition_candidates ${states ? `WHERE state IN (${states.map(()=>'?').join(',')})` : ''} ORDER BY first_seen,id`).all(...(states ?? [])) as Array<Record<string,unknown>>;
    return rows.map(r=>({id:String(r.id),metadata:JSON.parse(String(r.metadata_json)),state:String(r.state),reason:String(r.reason),attempts:Number(r.attempts),retryAt:Number(r.retry_at),...(r.catalogue_id ? {catalogueId:String(r.catalogue_id)}:{})}));
  }
    transition(id: string, state: string, reason = '', retryAt = 0, catalogueId?: string): void {
    const old = this.catalogue.db.prepare('SELECT state,reason FROM acquisition_candidates WHERE id=?').get(id) as {state:string;reason:string}|undefined;
    this.catalogue.db.prepare('UPDATE acquisition_candidates SET state=?,reason=?,retry_at=?,catalogue_id=COALESCE(?,catalogue_id) WHERE id=?').run(state,reason,retryAt,catalogueId ?? null,id);
    if (old?.state !== state || old?.reason !== reason) this.event(id,state,reason);
  }
    manual(id: string, showId: string, reason: string, candidateId?: string): void {
    const changed = this.catalogue.db.prepare(`INSERT INTO acquisition_manual(id,show_id,candidate_id,reason,first_seen,last_seen) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,reason=excluded.reason`).run(id,showId,candidateId ?? null,reason,Date.now(),Date.now());
    if (changed.changes && !this.state(`reported:${id}`)) { this.event(id,'manual',reason); this.set(`reported:${id}`,'1'); }
  }
    files(): FileRow[] { return this.catalogue.db.prepare('SELECT path,size,mtime,show_id,language,keys_json,catalogue_id,state,new_asset,acquired_at FROM acquisition_files ORDER BY path').all() as FileRow[]; }
    file(row: Omit<FileRow,'acquired_at'> & {acquired_at?:number}): void {
    // Explicit columns also support older databases with an unused hash column.
    this.catalogue.db.prepare(`INSERT INTO acquisition_files(path,size,mtime,show_id,language,keys_json,catalogue_id,state,new_asset,acquired_at) VALUES(@path,@size,@mtime,@show_id,@language,@keys_json,@catalogue_id,@state,@new_asset,@acquired_at)
      ON CONFLICT(path) DO UPDATE SET size=excluded.size,mtime=excluded.mtime,show_id=excluded.show_id,language=excluded.language,keys_json=excluded.keys_json,
      catalogue_id=excluded.catalogue_id,state=excluded.state,new_asset=excluded.new_asset`)
      .run({...row,acquired_at:row.acquired_at ?? Date.now()});
  }
    acquire(owner: string, leaseMs = 60_000): boolean {
    return this.catalogue.db.transaction(()=> {
      this.catalogue.db.prepare('DELETE FROM acquisition_lock WHERE expires<?').run(Date.now());
      const current=this.catalogue.db.prepare('SELECT owner FROM acquisition_lock WHERE id=1').get() as {owner:string}|undefined;
      const pid=current&&/^(\d+):/.exec(current.owner)?.[1];
      if(pid){try{process.kill(Number(pid),0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')this.catalogue.db.prepare('DELETE FROM acquisition_lock WHERE owner=?').run(current!.owner);}}
      return this.catalogue.db.prepare('INSERT OR IGNORE INTO acquisition_lock VALUES(1,?,?)').run(owner,Date.now()+leaseMs).changes === 1;
    }).immediate();
  }
    renew(owner: string, leaseMs = 60_000): void {
    if (this.catalogue.db.prepare('UPDATE acquisition_lock SET expires=? WHERE owner=?').run(Date.now()+leaseMs,owner).changes !== 1) throw new Error('Acquisition lease lost');
  }
    release(owner: string): void { this.catalogue.db.prepare('DELETE FROM acquisition_lock WHERE owner=?').run(owner); }
}
