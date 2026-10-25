import type { AppConfig } from './types.js';
import type { LkpDatabase } from './database.js';
import { childrenPolicy, validateAge } from './children-policy.js';

/** Additive SQLite state; media, playback history and private files are untouched. */
export function childrenSettings(db: LkpDatabase, config: AppConfig): void {
  db.db.exec(`CREATE TABLE IF NOT EXISTS children_settings (id INTEGER PRIMARY KEY CHECK(id=1), target_age REAL NOT NULL, tolerance REAL NOT NULL, effective_at_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS children_show_policies (show_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL, source TEXT NOT NULL);`);
  refreshChildrenAge(db,config);
  if (!config.children) return;
  const c=config.children;
  const insert=db.db.prepare('INSERT INTO children_show_policies VALUES(?,?,?) ON CONFLICT(show_id) DO UPDATE SET policy_json=excluded.policy_json,source=excluded.source');
  db.db.transaction(()=>{
    for(const m of db.listMedia(false)) {
      const policy=childrenPolicy(m,c);
      insert.run(m.showId,JSON.stringify(policy ?? null), m.technical.childrenPolicy?'sidecar':c.policies[m.showId]?'editorial':'classification-or-unknown');
    }
  })();
}
export function saveChildrenAge(db:LkpDatabase,age:number,tolerance:number,atMs:number):void {
  validateAge(age,tolerance);
  db.db.prepare('INSERT INTO children_settings VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET target_age=excluded.target_age,tolerance=excluded.tolerance,effective_at_ms=excluded.effective_at_ms').run(age,tolerance,atMs);
}

/** Running playout sees committed age changes without a restart or catalogue writes. */
export function refreshChildrenAge(db:LkpDatabase,config:AppConfig):void {
  const row=db.db.prepare('SELECT * FROM children_settings WHERE id=1').get() as {target_age:number;tolerance:number;effective_at_ms:number}|undefined;
  if(row && config.children) {
    config.children={...config.children,targetAgeYears:row.target_age,ageToleranceYears:row.tolerance,effectiveAtMs:row.effective_at_ms};
  }
}
