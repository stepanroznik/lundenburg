export type AiErrorKind = 'authentication' | 'allowance' | 'rate-limit' | 'service' | 'configuration' | 'output';
/** Only fixed categories/statuses enter logs: provider messages may contain input or credentials. */
export class AiError extends Error {
  constructor(readonly kind: AiErrorKind, readonly status = 0, readonly retryAfterMs = 0) {
    super(`AI ${kind}${status ? ` (HTTP ${status})` : ''}; acquisition remains queued`);
  }
}
export const usageSettings = 'https://chatgpt.com/settings/usage';
export type Http = (url: string, options?: RequestInit) => Promise<Response>;
export const http: Http = async (url, options = {}) => {
  try { return await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(90_000), redirect: 'error' }); }
  catch { throw new AiError('service'); }
};
export async function responseError(response: Response): Promise<AiError> {
  let code = '';
  try { const data = await response.json() as { error?: { code?: string } }; code = data.error?.code ?? ''; } catch { /* nonstandard admission errors */ }
  const retry = response.headers.get('retry-after');
  const seconds = Number(retry);
  const retryAfterMs = retry ? Math.max(0, Math.min(24 * 3600_000, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now())) : 0;
  return providerError(code, response.status, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
}
/** Known codes also occur after SSE starts. Never propagate provider messages. */
export function providerError(code: unknown, status = 500, retryAfterMs = 0): AiError {
  if (['subscription_sharing_usage_limit_exceeded', 'insufficient_quota', 'credit_balance_exhausted'].includes(String(code))) return new AiError('allowance', 429, retryAfterMs);
  if (code === 'subscription_sharing_usage_unavailable') return new AiError('service', 503, retryAfterMs);
  const kind = [401, 403].includes(status) ? 'authentication' : status === 429 ? 'rate-limit' : status >= 500 ? 'service' : 'configuration';
  return new AiError(kind, status, retryAfterMs);
}
