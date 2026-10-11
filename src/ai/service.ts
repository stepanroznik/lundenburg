import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Ajv from 'ajv';
import type Database from 'better-sqlite3';
import { ChatGptAuth, resource } from './auth.js';
import { AiError, http, responseError, providerError, type Http } from './errors.js';

export interface AiRequest {
  model: string; instructions: string; input: string; version: string;
  /** Local cache scope; never sent to OpenAI (e.g. one source video identity). */
  cacheIdentity?: string;
  format?: { name: string; schema: Record<string, unknown> };
}
export interface AiResponse {
  status: string; output: { content?: { type: string; text?: string }[] }[];
  model?: string;
}
export type AiLog = (event: { event: string; model?: string; kind?: string; status?: number; cached?: boolean }) => void;
// Luna is the documented efficient GPT-6 model; use it with reasoning disabled.
// No Sol/Astra/Pro fallback is admitted by the educational classifier.
const lunaWithoutReasoning = (slug: string) => /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(slug);
const small = (slug: string) => lunaWithoutReasoning(slug) || /(?:^|[-.])(mini|nano)(?:[-.]|$)/.test(slug) && !/codex|reasoning|pro|deep-research/.test(slug);
export const smallClassificationModel = (model: string) => model === 'auto-small' || small(model);
const ajv = new Ajv.default({ allErrors: false, strict: true });
const incomplete = (): AiResponse => ({ status: 'incomplete', output: [] });

/** Only offline jobs import this service. It has no playout/scheduler/service-control dependencies. */
export class AiService {
  constructor(private db: Database.Database, private auth: Pick<ChatGptAuth, 'accessToken'>,
    private request: Http = http, private log: AiLog = () => {}, private sleep: (ms: number) => Promise<unknown> = delay) {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_responses (
      cache_key TEXT PRIMARY KEY, model TEXT NOT NULL, result_json TEXT NOT NULL, saved_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }
  private state(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM ai_state WHERE key=?').get(key) as { value: string } | undefined)?.value;
  }
  private set(key: string, value: string): void { this.db.prepare('INSERT OR REPLACE INTO ai_state VALUES(?,?)').run(key, value); }
  private save(key: string, model: string, response: AiResponse): void {
    this.db.prepare('INSERT OR REPLACE INTO ai_responses VALUES(?,?,?,?)').run(key, model, JSON.stringify(response), Date.now());
  }
  async models(): Promise<{ slug: string; displayName: string }[]> {
    const token = await this.auth.accessToken();
    const response = await this.request(`${resource}/models`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw await responseError(response);
    const data = await response.json() as { models?: { slug?: string; display_name?: string; visibility?: string }[] };
    if (!Array.isArray(data.models)) throw new AiError('configuration');
    return data.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string')
      .map(m => ({ slug: m.slug!, displayName: m.display_name ?? m.slug! }));
  }
  private async model(selected: string): Promise<string> {
    if (selected !== 'auto-small') return selected;
    let models: { slug: string; displayName: string }[];
    const saved = this.state('models');
    try { models = saved && Number(this.state('models-at')) > Date.now() - 3600_000 ? JSON.parse(saved) : await this.models(); }
    catch (error) { throw error instanceof AiError ? error : new AiError('configuration'); }
    if (!saved || Number(this.state('models-at')) <= Date.now() - 3600_000) {
      this.set('models', JSON.stringify(models)); this.set('models-at', String(Date.now()));
    }
    const model = models.find(m => small(m.slug));
    if (!model) throw new AiError('configuration'); // Never silently substitute an expensive model.
    return model.slug;
  }
  async respond(options: AiRequest): Promise<AiResponse> {
    const key = createHash('sha256').update(JSON.stringify(options)).digest('hex');
    const cached = this.db.prepare('SELECT result_json,model FROM ai_responses WHERE cache_key=?').get(key) as { result_json: string; model: string } | undefined;
    if (cached) { this.log({ event: 'ai-response', model: cached.model, cached: true }); return JSON.parse(cached.result_json) as AiResponse; }
    const paused = Number(this.state('next-at') ?? 0);
    if (paused > Date.now()) throw new AiError((this.state('pause-kind') ?? 'service') as AiError['kind'], 0, paused - Date.now());
    const model = await this.model(options.model);
    if (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(model)) throw new AiError('configuration');
    const body = { model, stream: true, store: false, instructions: options.instructions,
      ...(lunaWithoutReasoning(model) ? { reasoning: { effort: 'none' } } : {}),
      input: [{ role: 'user', content: [{ type: 'input_text', text: options.input }] }],
      ...(options.format ? { text: { format: { type: 'json_schema', strict: true, name: options.format.name, schema: options.format.schema } } } : {}) };
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.auth.accessToken();
      let response: Response;
      try { response = await this.request(`${resource}/responses`, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body) }); }
      catch { // A transport failure may have reached the server: leave retry to a later scan.
        throw new AiError('service');
      }
      if (!response.ok) {
        const error = await responseError(response);
        this.log({ event: 'ai-failure', kind: error.kind, status: error.status });
        const backoff = Math.max(error.retryAfterMs, 1000 * 2 ** attempt);
        if (['rate-limit', 'service'].includes(error.kind) && attempt < 2 && backoff <= 5000) { await this.sleep(backoff); continue; }
        const pause = Math.max(error.retryAfterMs, error.kind === 'allowance' ? 30 * 60_000 : 5 * 60_000);
        this.set('pause-kind', error.kind); this.set('next-at', String(Date.now() + pause));
        throw new AiError(error.kind, error.status, pause);
      }
      // HTTP success is a received analysis. Persist a conservative receipt BEFORE
      // consuming SSE: interruption/crash must not trigger a second paid analysis.
      this.save(key, model, { ...incomplete(), model });
      let result: AiResponse;
      try { result = { ...await consumeResponse(response), model }; }
      catch (error) {
        // An explicit failed inference is not a successful editorial decision.
        // Keep it retryable, unlike malformed/refused successful completions.
        this.db.prepare('DELETE FROM ai_responses WHERE cache_key=?').run(key);
        const failure = error instanceof AiError ? error : new AiError('service');
        const pause = Math.max(failure.retryAfterMs, failure.kind === 'allowance' ? 30 * 60_000 : 5 * 60_000);
        this.set('pause-kind', failure.kind); this.set('next-at', String(Date.now() + pause));
        this.log({ event: 'ai-failure', kind: failure.kind, status: failure.status });
        throw new AiError(failure.kind, failure.status, pause);
      }
      this.save(key, model, result); this.set('next-at', '0');
      this.log({ event: 'ai-response', model, cached: false }); return result;
    }
    throw new AiError('service');
  }
  async structured<T>(options: AiRequest & { format: NonNullable<AiRequest['format']> }): Promise<T> {
    const validate = ajv.compile(options.format.schema);
    const response = await this.respond(options);
    try {
      if (response.status !== 'completed') throw Error();
      const value: unknown = JSON.parse(responseText(response));
      if (!validate(value)) throw Error();
      return value as T;
    } catch { throw new AiError('output'); }
  }
}
export function responseText(response: AiResponse): string {
  return response.output.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text ?? '').join('');
}
/** Streaming UTF-8/SSE parser; bounded memory and no raw events in logs. */
export async function consumeResponse(response: Response): Promise<AiResponse> {
  // The direct ChatGPT route can omit Content-Type. Require valid Responses
  // events and completed inference rather than rejecting an absent header.
  const contentType = response.headers.get('content-type');
  if (!response.body || (contentType && !contentType.startsWith('text/event-stream'))) return incomplete();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  const textParts = new Map<string, string>();
  const items = new Map<number, AiResponse['output'][number]>();
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) return incomplete();
      bytes += chunk.value.byteLength; if (bytes > 2_000_000) return incomplete();
      buffer += decoder.decode(chunk.value, { stream: true });
      // Normalize CRLF only after full lines arrive (CR may cross chunk boundaries).
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, separator.index); buffer = buffer.slice(separator.index + separator[0].length);
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data) as { type?: string; code?: unknown; error?: { code?: unknown }; response?: AiResponse & { error?: { code?: unknown } };
          output_index?: number; content_index?: number; delta?: string; text?: string; item?: AiResponse['output'][number] };
        const index = Number.isSafeInteger(event.output_index) && event.output_index! >= 0 ? event.output_index! : 0;
        const part = Number.isSafeInteger(event.content_index) && event.content_index! >= 0 ? event.content_index! : 0;
        const key = `${index}:${part}`;
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') textParts.set(key, (textParts.get(key) ?? '') + event.delta);
        if (event.type === 'response.output_text.done' && typeof event.text === 'string') textParts.set(key, event.text);
        if (event.type === 'response.output_item.done' && event.item && Array.isArray(event.item.content)) items.set(index, event.item);
        if (event.type === 'response.completed') {
          if (event.response?.status === 'completed' && Array.isArray(event.response.output)) {
            // Direct-route terminal snapshots may omit already-streamed items.
            let output = event.response.output.length ? event.response.output : [...items].sort((a,b) => a[0]-b[0]).map(([,item]) => item);
            if (!output.some(item => item.content?.some(c => c.type === 'output_text')) && textParts.size) {
              const text = [...textParts].sort(([a],[b]) => {
                const [ai,ap] = a.split(':').map(Number), [bi,bp] = b.split(':').map(Number); return ai!-bi! || ap!-bp!;
              }).map(([,value]) => value).join('');
              output = [...output, { content: [{ type: 'output_text', text }] }];
            }
            return { ...event.response, output };
          }
          return incomplete();
        }
        if (event.type === 'error' || event.type === 'response.failed') throw providerError(event.response?.error?.code ?? event.error?.code ?? event.code);
        if (event.type === 'response.incomplete') return incomplete();
      }
    }
  } catch (error) { if (error instanceof AiError) throw error; return incomplete(); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
