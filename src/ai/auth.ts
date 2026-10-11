import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { CredentialStore, type Account } from './storage.js';
import { AiError, http, type Http } from './errors.js';

export const issuer = 'https://auth.openai.com';
export const resource = 'https://api.openai.com/v1';
export const scopes = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', 'chatgpt.tokens.use.direct'];
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const requiredPlanScopes = ['resource.invoke', 'chatgpt.tokens.use.direct'];
const random = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const revokedCodes = ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'];
interface TokenResponse { access_token: string; refresh_token?: string; id_token?: string; token_type: string; expires_in: number; earliest_refresh_at?: number; scope?: string }
interface Attempt { state: string; nonce: string; verifier: string; redirectUri: string; clientId: string; hostId: string; selected?: Account }

export function createAttempt(hostId: string, port: number, selected?: Account, pendingClientId?: string): Attempt {
  const attempt: Attempt = { state: random(), nonce: random(), verifier: random(), hostId,
    redirectUri: `http://127.0.0.1:${port}/auth/callback`, clientId: selected?.clientId ?? pendingClientId ?? 'dynamic_agent_client' };
  if (selected) attempt.selected = selected;
  return attempt;
}
export function authorizationUrl(attempt: Attempt, consent = false): string {
  const url = new URL(`${issuer}/api/accounts/authorize`);
  const values: Record<string, string> = { client_id: attempt.clientId, ext_agent_host_id: attempt.hostId,
    response_type: 'code', redirect_uri: attempt.redirectUri, scope: scopes.join(' '), resource,
    state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') };
  if (attempt.clientId === 'dynamic_agent_client') values.agent_name_hint = 'Lundenburg Kids Premium';
  else {
    if (attempt.selected?.idToken) values.id_token_hint = attempt.selected.idToken;
    if (attempt.selected?.email) values.login_hint = attempt.selected.email;
  }
  if (consent) values.prompt = 'consent';
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return url.href;
}
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
export async function validateIdentity(idToken: string, clientId: string, nonce?: string, keys: JWTVerifyGetKey = jwks): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(idToken, keys, { issuer, audience: clientId,
      requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5, algorithms: ['RS256', 'ES256'] });
    if (typeof payload.sub !== 'string' || !payload.sub || (nonce !== undefined && payload.nonce !== nonce)) throw Error();
    return payload;
  } catch { throw new AiError('authentication'); }
}
function tokenFields(tokens: TokenResponse, previous?: Account): Pick<Account, 'accessToken' | 'refreshToken' | 'idToken' | 'expiresAt' | 'earliestRefreshAt' | 'scopes'> {
  if (tokens.token_type?.toLowerCase() !== 'bearer' || typeof tokens.access_token !== 'string' || !tokens.access_token ||
    !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 ||
    (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token)) ||
    (previous && !tokens.refresh_token)) throw new AiError('authentication');
  const result = { accessToken: tokens.access_token, ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    expiresAt: Date.now() + tokens.expires_in * 1000, earliestRefreshAt: Number(tokens.earliest_refresh_at ?? 0) * 1000,
    scopes: tokens.scope === undefined ? previous?.scopes ?? [] : tokens.scope.split(/\s+/).filter(Boolean) };
  const idToken = tokens.id_token ?? previous?.idToken;
  return idToken ? { ...result, idToken } : result;
}

export class ChatGptAuth {
  constructor(readonly store: CredentialStore, private request: Http = http,
    private verify: typeof validateIdentity = validateIdentity) {}
  async complete(attempt: Attempt, callback: URL): Promise<Account> {
    if (!equal(callback.searchParams.get('state') ?? '', attempt.state)) throw new AiError('authentication');
    if (callback.searchParams.has('error')) throw new AiError('authentication');
    const issued = callback.searchParams.get('client_id');
    const clientId = attempt.clientId === 'dynamic_agent_client' ? issued : attempt.clientId;
    if (!clientId || clientId === 'dynamic_agent_client' || (attempt.clientId !== 'dynamic_agent_client' && issued && issued !== clientId)) throw new AiError('authentication');
    const code = callback.searchParams.get('code');
    if (!code) throw new AiError('authentication');
    if (attempt.clientId === 'dynamic_agent_client') {
      // The client already exists after consent, even if exchange later fails.
      // Keep it separate from validated accounts and reuse it on the next attempt.
      await this.store.locked(async () => {
        const saved = this.store.read(); if (!saved || saved.hostId !== attempt.hostId) throw new AiError('configuration');
        saved.pendingClientId = clientId; this.store.write(saved);
      });
    }
    const response = await this.request(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
        code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource }) });
    if (!response.ok) throw new AiError(response.status >= 500 ? 'service' : 'authentication', response.status);
    const tokens = await response.json() as TokenResponse;
    if (!tokens.id_token) throw new AiError('authentication');
    const identity = await this.verify(tokens.id_token, clientId, attempt.nonce);
    if (attempt.selected && identity.sub !== attempt.selected.subject) throw new AiError('authentication');
    const account: Account = { clientId, subject: identity.sub!, issuer, ...tokenFields(tokens) };
    if (typeof identity.email === 'string') account.email = identity.email;
    await this.store.locked(async () => {
      const credentials = this.store.read();
      if (!credentials || credentials.hostId !== attempt.hostId) throw new AiError('configuration');
      const existing = credentials.accounts[clientId];
      if (existing && existing.subject !== account.subject) throw new AiError('authentication');
      credentials.accounts[clientId] = account; credentials.active = clientId;
      if (credentials.pendingClientId === clientId) delete credentials.pendingClientId;
      this.store.write(credentials);
    });
    return account;
  }
  /** Serialize all refreshes; re-read after locking so rotating tokens are never replayed. */
  async accessToken(): Promise<string> {
    return this.store.locked(async () => {
      const credentials = this.store.read();
      const account = credentials?.active ? credentials.accounts[credentials.active] : undefined;
      if (!credentials || !account || !account.accessToken || !requiredPlanScopes.every(s => account.scopes.includes(s))) throw new AiError('authentication');
      const now = Date.now();
      if (account.expiresAt > now + 120_000 || (account.expiresAt > now + 5000 && account.earliestRefreshAt > now)) return account.accessToken;
      if (!account.refreshToken) throw new AiError('authentication');
      if (account.earliestRefreshAt > now) throw new AiError('service', 0, account.earliestRefreshAt - now);
      const response = await this.request(tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken, resource }) });
      if (!response.ok) {
        let code: unknown; try { code = (await response.json() as { error?: string | { code?: string } }).error; if (typeof code === 'object' && code) code = (code as { code?: string }).code; } catch {}
        if (revokedCodes.includes(String(code))) {
          delete account.accessToken; delete account.refreshToken; delete account.idToken; this.store.write(credentials);
          throw new AiError('authentication', response.status);
        }
        throw new AiError(response.status >= 500 || response.status === 429 ? 'service' : 'authentication', response.status);
      }
      const tokens = await response.json() as TokenResponse;
      if (tokens.id_token) {
        const identity = await this.verify(tokens.id_token, account.clientId);
        if (identity.sub !== account.subject) throw new AiError('authentication');
      }
      Object.assign(account, tokenFields(tokens, account)); this.store.write(credentials);
      if (!requiredPlanScopes.every(s => account.scopes.includes(s))) throw new AiError('authentication');
      return account.accessToken!;
    });
  }
  async select(clientId: string): Promise<void> {
    await this.store.locked(async () => {
      const credentials = this.store.read();
      if (!credentials?.accounts[clientId]) throw new AiError('configuration');
      credentials.active = clientId; this.store.write(credentials);
    });
  }
  /** Subscription scans keep the renewable session alive even in upload-free months.
   * This only refreshes OAuth; it never sends an inference request. */
  async maintain(): Promise<boolean> {
    if (!this.store.read()?.active) return false;
    await this.accessToken(); return true;
  }
  async signOut(clientId: string): Promise<boolean> {
    return this.store.locked(async () => {
      const credentials = this.store.read(); const account = credentials?.accounts[clientId];
      if (!credentials || !account) throw new AiError('configuration');
      let revoked = !account.refreshToken;
      try {
        if (account.refreshToken) {
          const discovery = await this.request(`${issuer}/.well-known/openid-configuration`);
          const { revocation_endpoint: endpoint } = await discovery.json() as { revocation_endpoint?: string };
          if (!discovery.ok || !endpoint || new URL(endpoint).origin !== issuer) throw Error();
          const response = await this.request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }) });
          revoked = response.status === 200;
        }
      } catch { /* Report unconfirmed remote revocation, but always stop local usage. */ }
      delete account.accessToken; delete account.refreshToken; delete account.idToken;
      if (credentials.active === clientId) delete credentials.active;
      this.store.write(credentials); return revoked;
    });
  }
}

/** Browser link contains no token hints; only the loopback server builds the authorization URL. */
export async function startSignIn(auth: ChatGptAuth, options: { port?: number; account?: string; consent?: boolean } = {}): Promise<{ server: Server; url: string; done: Promise<Account> }> {
  const credentials = await auth.store.initialize();
  const selected = options.account ? credentials.accounts[options.account] : undefined;
  if (options.account && !selected) throw new AiError('configuration');
  let attempt: Attempt, processing = false;
  let resolve!: (account: Account) => void, reject!: (error: Error) => void;
  const done = new Promise<Account>((res, rej) => { resolve = res; reject = rej; });
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    let url: URL;
    try { url = new URL(req.url ?? '/', attempt.redirectUri); }
    catch { res.writeHead(400).end(); return; }
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${new URL(attempt.redirectUri).port}`) { res.writeHead(400).end(); return; }
    if (url.pathname === '/sign-in') { res.writeHead(302, { Location: authorizationUrl(attempt, options.consent) }).end(); return; }
    if (url.pathname !== '/auth/callback') { res.writeHead(404).end(); return; }
    if (processing || !equal(url.searchParams.get('state') ?? '', attempt.state)) { res.writeHead(400).end('Invalid authorization attempt.'); return; }
    processing = true;
    void auth.complete(attempt, url).then(account => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('LKP connected. You can close this browser tab.'); resolve(account);
    }, () => { res.writeHead(400).end('Sign-in failed. Start a new attempt.'); reject(new AiError('authentication')); }).finally(() => server.close());
  });
  await new Promise<void>((res, rej) => { server.once('error', rej); server.listen(options.port ?? 1455, '127.0.0.1', res); });
  const address = server.address(); if (!address || typeof address === 'string') throw new AiError('configuration');
  attempt = createAttempt(credentials.hostId, address.port, selected, selected ? undefined : credentials.pendingClientId);
  const timeout = setTimeout(() => { server.close(); reject(new AiError('authentication')); }, 10 * 60_000);
  void done.then(() => clearTimeout(timeout), () => clearTimeout(timeout));
  return { server, url: `http://127.0.0.1:${address.port}/sign-in`, done };
}
