// Build from maintained source before staging. No compiled JavaScript patches.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

export function prepareRelease(baseline, destination, repository) {
  if (fs.existsSync(destination)) throw new Error('Release destination must be new');
  for (const file of ['dist/src/catalogue.js', 'dist/src/acquisition/service.js', 'dist/src/ai/service.js'])
    if (!fs.existsSync(path.join(repository, file))) throw new Error('Build the merged source before preparing a release');
  const previous = fs.realpathSync(baseline);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(repository, 'dist'), path.join(destination, 'dist'), { recursive: true });
  fs.cpSync(path.join(previous, 'config'), path.join(destination, 'config'), { recursive: true });
  for (const name of ['channels.yaml', 'nacht-acquisition.yaml']) {
    const source = path.join(repository, 'config', name);
    if (fs.existsSync(source)) {
      const target = path.join(destination, 'config', name);
      if (name === 'channels.yaml') {
        // This station policy is shared by the broadcaster and the acquisition
        // worker so schedule regeneration always sees the same enabled profile.
        fs.rmSync(target, { force: true });
        fs.symlinkSync(path.resolve(source), target);
      } else fs.copyFileSync(source, target);
    }
  }
  const appPath = path.join(destination, 'config/lkp.yaml');
  const app = parse(fs.readFileSync(appPath, 'utf8'));
  const sourceApp = parse(fs.readFileSync(path.join(repository, 'config/lkp.yaml'), 'utf8'));
  if (sourceApp.comingUp) app.comingUp = sourceApp.comingUp;
  if (sourceApp.schedule.spokenLanguageTargets) app.schedule.spokenLanguageTargets = sourceApp.schedule.spokenLanguageTargets;
  fs.writeFileSync(appPath, stringify(app));
  // Retain the active publication, collection, storage and credential policy.
  const policy = parse(fs.readFileSync(path.join(previous, 'config/content-acquisition.yaml'), 'utf8'));
  if (policy.vpnFallback) policy.vpnFallback.helper = path.join(destination, 'download-hide-vpn.py');
  fs.writeFileSync(path.join(destination, 'config/content-acquisition.yaml'), stringify(policy));
  const ai = parse(fs.readFileSync(path.join(repository, 'config/ai.yaml'), 'utf8'));
  ai.credentialsDirectory = path.resolve(repository, ai.credentialsDirectory);
  fs.writeFileSync(path.join(destination, 'config/ai.yaml'), stringify(ai));
  fs.copyFileSync(path.join(repository, 'scripts/download-hide-vpn.py'), path.join(destination, 'download-hide-vpn.py'));
  fs.cpSync(path.join(repository, 'tools'), path.join(destination, 'tools'), { recursive: true, filter: file => !file.includes('__pycache__') });
  for (const directory of ['node_modules', 'runtime', 'assets'])
    fs.symlinkSync(path.join(repository, directory), path.join(destination, directory));
  fs.writeFileSync(path.join(destination, 'ACQUISITION-CHANGES.json'), JSON.stringify({
    version: 2, baseline: previous, preparedAt: new Date().toISOString(),
    changes: ['merged-maintained-source', 'deterministic-catalogue-v1', 'stable-local-episode-numbers', 'movies-without-numbering', 'preserved-production-policy'],
  }, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseline, destination] = process.argv.slice(2);
  if (!baseline || !destination) throw new Error('Usage: node scripts/prepare-content-release.mjs BASELINE DESTINATION');
  prepareRelease(path.resolve(baseline), path.resolve(destination), path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  console.log('Merged source release prepared with the active acquisition policy.');
}
