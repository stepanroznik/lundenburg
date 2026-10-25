import type { AppConfig } from './types.js';
import type { LkpDatabase } from './database.js';
import { childrenPolicy, validateAge } from './children-policy.js';

/** Additive SQLite state; media, playback history and private files are untouched. */
export function childrenSettings(db: LkpDatabase, config: AppConfig): void {
  db.db.exec(`CREATE TABLE IF NOT EXISTS children_settings (id INTEGER PRIMARY KEY CHECK(id=1), target_age REAL NOT NULL, tolerance REAL NOT NULL, effective_at_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS children_show_policies (show_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL, source TEXT NOT NULL);`);
  // A worker already running an older compiler must not replace age-filtered
  // programming during a release switch. Its existing transaction rolls back.
  db.db.exec(`CREATE TRIGGER IF NOT EXISTS require_children_assemblies
    BEFORE INSERT ON schedule_entries
    WHEN EXISTS(SELECT 1 FROM children_settings WHERE id=1 AND NEW.starts_at_ms>=effective_at_ms)
      AND COALESCE(json_extract(NEW.presentation_json,'$.profile'),'lkp')='lkp'
      AND NEW.show_id NOT IN ('station-lkp','lkp-weather','lkp-intermissions','lkp-advertising')
      AND COALESCE(json_type(NEW.playout_plan_json,'$.assembly.sources'),'null')<>'array'
    BEGIN SELECT RAISE(ABORT,'Age-aware children schedule requires source assemblies'); END;`);
  db.db.exec(`CREATE TRIGGER IF NOT EXISTS prevent_adjacent_lkp_intermissions
    BEFORE INSERT ON schedule_entries
    WHEN NEW.show_id='lkp-intermissions' AND EXISTS(
      SELECT 1 FROM schedule_entries WHERE show_id='lkp-intermissions'
        AND (ends_at_ms=NEW.starts_at_ms OR starts_at_ms=NEW.ends_at_ms))
    BEGIN SELECT RAISE(ABORT,'Consecutive LKP intermissions are not allowed'); END;`);
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
