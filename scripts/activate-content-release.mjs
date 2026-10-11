// Activate acquisition at a batch boundary, using its existing SQLite lease.
// The existing systemd timer picks up the atomic release switch. No service
// control privileges, broadcaster changes, or schedule writes are needed.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parse, stringify } from 'yaml';

const [prepared, release] = process.argv.slice(2, 4).map(p => path.resolve(p));
const afterCurrentBatch = process.argv.includes('--after-current-batch');
const enablePublication = process.argv.includes('--publish-to-schedule');
const preservePublication = process.argv.includes('--preserve-publication-policy');
if (enablePublication && preservePublication) throw new Error('Cannot both enable and preserve publication');
const releases = '/home/lundenburg/lkp-content/releases';
const current = '/home/lundenburg/lkp-content/current';
if (!prepared || !release || path.dirname(release) !== releases || fs.existsSync(release))
  throw new Error('Provide a prepared release and a new isolated acquisition release directory');
const manifest = JSON.parse(fs.readFileSync(path.join(prepared, 'ACQUISITION-CHANGES.json'), 'utf8'));
const previous = fs.realpathSync(current);
const previousPolicy = parse(fs.readFileSync(path.join(previous, 'config/content-acquisition.yaml'), 'utf8'));
// Preservation cannot enable publication: bind it to the currently active policy.
const publishToSchedule = preservePublication ? previousPolicy.publishToSchedule === true : enablePublication;
if (manifest.baseline !== previous) throw new Error('Active acquisition release changed; prepare again');
const switchTo = destination => {
  const temporary = `${current}.${process.pid}.tmp`;
  fs.symlinkSync(destination, temporary);
  fs.renameSync(temporary, current);
};

// Copy and validate everything before taking the acquisition lease.
fs.cpSync(prepared, release, { recursive: true, verbatimSymlinks: true });
const policyPath = path.join(release, 'config/content-acquisition.yaml');
const policy = parse(fs.readFileSync(policyPath, 'utf8'));
if (policy.publishToSchedule !== publishToSchedule) throw new Error('Schedule publication must match the requested activation mode');
if (preservePublication && policy.publishToSchedule !== previousPolicy.publishToSchedule)
  throw new Error('This activation mode cannot change publication policy');
if (policy.vpnFallback) policy.vpnFallback.helper = path.join(release, 'download-hide-vpn.py');
fs.writeFileSync(policyPath, stringify(policy));
const config = parse(fs.readFileSync(path.join(release, 'config/lkp.yaml'), 'utf8'));
if (config.storage.database !== '/home/lundenburg/lundenburg/data/lkp.sqlite')
  throw new Error('Unexpected acquisition catalogue path');
const db = new Database(config.storage.database, { fileMustExist: true });
const owner = `release-activation:${process.pid}`;
let leased = false, switched = false;
try {
  // Loaded workers keep their immutable old release. Changing only the entry
  // symlink is safe while a batch runs; leave its lease and SQLite state alone.
  // The next worker performs migrations after acquiring the normal lease.
  const activeLease = db.prepare('SELECT expires FROM acquisition_lock WHERE id=1').get();
  if (afterCurrentBatch && activeLease?.expires > Date.now()) {
    const backups = '/home/lundenburg/lundenburg/runtime/acquisition/backups';
    fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
    const backup = path.join(backups, `${path.basename(release)}.sqlite`);
    if (fs.existsSync(backup)) throw new Error('Acquisition deployment backup already exists');
    await db.backup(backup);
    fs.chmodSync(backup, 0o600);
    if (fs.realpathSync(current) !== previous) throw new Error('Active release changed');
    switchTo(release);
    switched = true;
    fs.writeFileSync(path.join(release, 'ACTIVATION.json'), JSON.stringify({
      previous, backup, activatedAt: new Date().toISOString(), afterCurrentBatch: true,
    }, null, 2) + '\n');
    console.log('Acquisition release activated for the next batch; the running download and its lease are unchanged.');
  } else {

  db.transaction(() => {
    const lease = db.prepare('SELECT expires FROM acquisition_lock WHERE id=1').get();
    if (lease && lease.expires > Date.now()) throw new Error('ACQUISITION_BUSY');
    db.prepare('DELETE FROM acquisition_lock WHERE id=1').run();
    db.prepare('INSERT INTO acquisition_lock VALUES(1,?,?)').run(owner, Date.now() + 300000);
  }).immediate();
  leased = true;
  const backups = '/home/lundenburg/lundenburg/runtime/acquisition/backups';
  fs.mkdirSync(backups, { recursive: true, mode: 0o700 });
  const backup = path.join(backups, `${path.basename(release)}.sqlite`);
  if (fs.existsSync(backup)) throw new Error('Acquisition deployment backup already exists');
  await db.backup(backup);
  fs.chmodSync(backup, 0o600);
  switchTo(release);
  switched = true;
  db.transaction(() => {
    db.prepare('UPDATE acquisition_state SET value=? WHERE key=?').run('0', 'last-discovery');
    // Give any old process that has not yet acquired the lease time to exit.
    const due = Date.now() + 30000;
    db.prepare('UPDATE acquisition_state SET value=? WHERE key=?').run(String(due), 'next-automatic-run');
    db.prepare('UPDATE acquisition_lock SET expires=? WHERE owner=?').run(due, owner);
  }).immediate();
  fs.writeFileSync(path.join(release, 'ACTIVATION.json'), JSON.stringify({
    previous, backup, activatedAt: new Date().toISOString(),
  }, null, 2) + '\n');
  console.log(`Acquisition release activated with a catalogue backup; the existing timer resumes it in thirty seconds. Schedule publication is ${publishToSchedule ? 'enabled at guarded future boundaries' : 'disabled'}.`);
  }
} catch (error) {
  if (switched) switchTo(previous);
  if (leased) db.prepare('DELETE FROM acquisition_lock WHERE owner=?').run(owner);
  // Never expose subprocess output, provider diagnostics or environment values.
  throw new Error(error.message === 'ACQUISITION_BUSY'
    ? 'Acquisition is between active batches only; wait for its worker lease to end and prepare another destination'
    : `Acquisition activation failed (${error.code ?? 'UNEXPECTED'}); previous release retained`);
} finally { db.close(); }
