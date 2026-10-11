import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Command } from 'commander';
import { ChatGptAuth, startSignIn } from './auth.js';
import { CredentialStore, secureDirectory } from './storage.js';
import { AiService } from './service.js';
import { aiConfig } from './config.js';
import { AiError, usageSettings } from './errors.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = process.env.LKP_PROJECT_ROOT ?? (sourceRoot.endsWith(`${path.sep}dist`) ? path.dirname(sourceRoot) : sourceRoot);
const config = aiConfig(root), store = new CredentialStore(config.credentialsDirectory), auth = new ChatGptAuth(store);
const program = new Command().name('lkp-ai').description('Offline LKP AI — Using ChatGPT plan. Manage usage: ' + usageSettings);
program.command('login').description('Continue with ChatGPT (browser sign-in; loopback SSH forwarding supported)')
  .option('--port <port>', 'Loopback callback port', '1455').option('--account <client-id>', 'Reauthorize a saved registration')
  .option('--consent', 'Explicitly request plan-usage consent again').action(async options => {
    const port = Number(options.port); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new AiError('configuration');
    const flow = await startSignIn(auth, { ...options, port });
    console.log('Continue with ChatGPT: ' + flow.url);
    console.log(`For a browser on another computer, forward its port ${port} to this host's 127.0.0.1:${port} through SSH first.`);
    const account = await flow.done;
    console.log(account.scopes.includes('chatgpt.tokens.use.direct') ? 'Connected. Using ChatGPT plan.' : 'Signed in; ChatGPT plan permission was not granted. AI remains queued.');
  });
program.command('status').description('List saved registrations without showing tokens').action(() => {
  const saved = store.read();
  console.log(JSON.stringify({ provider: 'chatgpt', model: config.model, manageUsage: usageSettings,
    accounts: Object.values(saved?.accounts ?? {}).map(a => ({ clientId: a.clientId, email: a.email, active: a.clientId === saved?.active,
      connected: Boolean(a.accessToken), planEnabled: a.scopes.includes('chatgpt.tokens.use.direct'), expiresAt: new Date(a.expiresAt).toISOString() })) }, null, 2));
});
program.command('select <client-id>').action(async clientId => { await auth.select(clientId); console.log('Selected ChatGPT registration.'); });
program.command('logout <client-id>').action(async clientId => {
  console.log(await auth.signOut(clientId) ? 'Signed out and renewable session revoked.' : 'Signed out locally. Remote revocation was not confirmed; disconnect LKP in ChatGPT Settings.');
});
program.command('models').description('List models available to the active account').action(async () => {
  secureDirectory(store.directory);
  const db = new Database(path.join(store.directory, 'cache.sqlite'));
  try { console.log(JSON.stringify(await new AiService(db, auth).models(), null, 2)); } finally { db.close(); }
});
program.parseAsync().catch(error => { console.error(error instanceof AiError ? error.message : 'AI operation failed; no credentials were logged.'); process.exitCode = 1; });
