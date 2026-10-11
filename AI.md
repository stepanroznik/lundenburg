# ChatGPT-plan AI for LKP

LKP uses the documented [Sign in with ChatGPT local-client flow](https://developers.openai.com/siwc/token-sharing-open-source), not Codex credentials or private ChatGPT endpoints. Inference goes to `https://api.openai.com/v1/responses` with `stream: true`, `store: false` and explicit input history. No API key, client secret or separately billed API fallback is used by this provider.

The documented route covers open-source/local applications and self-hosted runtimes; paid or remotely hosted products require OpenAI's separate interest process. LKP runs locally on the owner's Pi and does not offer an AI service to remote customers. Its existing GitHub repository is public. An MIT [LICENSE](LICENSE) was added locally with the owner's permission; these integration and license changes have not been pushed or published. This deployment fits the documented local/self-hosted architecture. Account/workspace eligibility and plan permission are ultimately enforced during authorization and admission; a local implementation cannot guarantee an account's acceptance.

Plus usage shares the account's five-hour allowance with other apps; it is not an extra unlimited allowance. Review [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage), grant LKP plan access, set an appropriate app limit, and disable use of additional ChatGPT credits there if you want allowance-only operation. LKP does not control that server-side credit setting. Allowance errors pause acquisition without purchasing credits or changing billing paths.

## Sign in on the headless Pi

From the repository on the Pi:

```bash
npm run ai -- login
```

Before opening the link, run this on the computer with your browser:

```bash
ssh -N -L 1455:127.0.0.1:1455 lkp-pi
```

Open **http://127.0.0.1:1455/sign-in** on that computer and choose **Continue with ChatGPT**. The callback travels through the SSH tunnel to the Pi. The listener binds only to `127.0.0.1`; do not expose it through a public proxy. Complete sign-in within ten minutes. Use the same port for `--port` and both ends of the tunnel if 1455 is occupied. No browser is needed on the Pi, and no tokens or callback URLs need to be pasted into chat.

The host ID is generated once, before authorization, and survives restarts and account changes. PKCE/state/nonce are fresh per attempt. Initial dynamic registration uses the returned issued client ID for exchange; subsequent sign-ins reuse that ID. Signature, issuer, audience, expiry, nonce and account identity are verified with `jose` before credentials become active. The authorization URL, including any retained ID-token hint, is generated privately by the loopback server and is never printed.

```bash
npm run ai -- status
npm run ai -- models
npm run ai -- login --account oaiapp_YOUR_SAVED_CLIENT_ID
npm run ai -- select oaiapp_YOUR_SAVED_CLIENT_ID
npm run ai -- logout oaiapp_YOUR_SAVED_CLIENT_ID
```

Registrations stay separate by issued client ID and verified subject, even for identical email addresses. To explicitly enable previously declined plan permission, use `login --account … --consent`. Sign-out attempts remote refresh-token revocation and always clears local tokens; unconfirmed remote revocation is reported. Disconnect LKP in ChatGPT settings if needed.

`runtime/ai/credentials.json` is written atomically with mode 600 in a mode-700 directory. It is covered by the existing `runtime/` Git ignore. It contains access/refresh/ID tokens: never print it, commit it, or copy it into logs. SQLite OS locks serialize refresh across CLI and worker processes, including after process crashes. Rotating credentials and scopes are saved together. Transient refresh failures retain credentials; confirmed revocation clears tokens while preserving client/account/host mappings. Protect Pi filesystem backups as credentials too.

Recurring acquisition scans also renew an existing session near expiry when there are no new uploads. This makes no inference request and prevents an otherwise idle 30-day refresh session from expiring. A Pi left offline beyond the provider's refresh-token lifetime needs browser sign-in again.

## Models and unattended operation

`config/ai.yaml` configures the shared service. `LKP_AI_MODEL` and `LKP_AI_CREDENTIALS_DIR` override its model and protected directory. The default `auto-small` selects the first listed mini/nano or GPT-6 Luna model available to this account, preserves server model order and caches the list for one hour. GPT-6 Luna uses `reasoning.effort: none`; it is OpenAI's documented efficient model for focused tasks. If none is available, acquisition remains queued; no Sol/Astra/Pro model is substituted. Set an exact available small model slug for stable selection. The reusable service accepts other explicit models for future tasks, but educational classification admits only lightweight models.

The acquisition overlay selects `aiProvider: chatgpt`. Released workers use the shared Pi credential directory, independent of immutable release paths. The existing content timer supplies low CPU/I/O priority, one download at a time, staging, disk reserve and acquisition lease. No broadcast unit or live playout code imports the AI client. Missing consent, exhausted allowances, rate limits and network failures defer candidates. Guarded future schedule regeneration runs only after successful ingestion, through the existing scheduler; it makes no AI call.

Existing ingestion's non-German EPG translation also uses this provider, with its existing metadata budget and local fallback. Educational uploads reuse the German copy from their classification and never invoke translation as a second model pass. Already-German source descriptions require no model call. Existing API-key translation remains available only through an explicitly different acquisition provider configuration; the deployed policy selects ChatGPT.

`educational-v4` in `src/acquisition/classification.ts` sends only bounded title/description, duration/date, programme identity and cheap compilation signals. One decision supplies rank, German title/EPG description, topics, format, seasons, age suitability and metadata-only duplicate assessment. Structured educational episodes take priority over standalone songs; substantial teaching through music can still earn A/A+. Compilations, recaps and recycled material receive C with no exception. Independent admission and scheduling gates exclude detected compilations, bundles and probable repackaging even if a saved decision rated them A+. The recurring cleanup removes validated acquired copies after retiring their safe future schedule references, while protecting active/preloaded assets. Actual duplicate detection remains independent. Successful decisions retain their original prompt version and are reused by video ID across prompt revisions, without another call. Ms Rachel admits only A+/A; Miss Josi retains A+/A/B. Original existing imports remain available. C/D/X persist without download. Stream refusals, malformed output and interrupted successful responses are conservatively cached C, with no second analysis. Explicit failed SSE responses, including allowance errors, stay queued without an editorial rejection. Failures before a successful response remain retryable; service/rate retries are bounded and allowance pauses persist across restart.

## Reuse and verification

`AiService.respond()` provides streamed text Responses, and `AiService.structured<T>()` uses strict JSON output plus local Ajv validation. Supply a versioned prompt/input/model; persistent SQLite caching avoids repeating identical work. Logs contain fixed event names, model slugs, cache status and error categories, never tokens, prompts, descriptions, provider messages or raw streams. HTTP success is recorded before stream consumption, preventing a crash from causing another successful analysis. Invalid cached output raises `AiError('output')` rather than invoking a model again.

```typescript
import { aiConfig, createAiService } from './ai/index.js';
const settings = aiConfig(projectRoot);
const ai = createAiService(database, projectRoot, safeEventLogger);
const metadata = await ai.structured({ model: settings.model, version: 'metadata-v1',
  cacheIdentity: sourceVideoId, instructions: metadataPrompt, input: JSON.stringify(sourceMetadata),
  format: { name: 'episode_metadata', schema: metadataSchema } });
```

For metadata, weather scripts, scheduling advice or intermissions, call this service from a preparation job using the existing database or a separate runtime SQLite cache. Persist the resulting approved artifact before scheduling it. Keep cached/local fallbacks in each consumer and never await AI from the live FFmpeg/GNU Radio/TSDuck path. This change does not replace existing spoken weather or rendering services.

```bash
npm run check
npm run build
npm test
# Exercise preserved deployed acquisition code with fixture media, never live media:
LKP_ACQUISITION_RELEASE=/path/to/prepared node --test test/acquisition-release.test.mjs
```

Tests cover PKCE/dynamic registration, OIDC rejection, protected storage, concurrent refresh/rotation, revocation, headless loopback, SSE chunk boundaries, structured output, persistent caching, bounded retry/allowance pause, model admission, source identity, rank/season rules, duplicate handling, storage exhaustion and protected future scheduling. A real account sign-in and an account-admitted inference are still required for end-to-end production verification.

Provider references: [sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [sessions/usage](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [models](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [headless hosts](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms), [preview constraints](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations), [errors](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery).
