# AI Provider Environment Foundation

Last updated: 2026-08-02

Configuration-only foundation for EmberOS V1 AI providers.

Architecture target (this document covers **Config** only):

```text
Environment → Config → Provider Registry → Provider Router
```

- Provider adapters are **out of scope** for this foundation task.
- Routing logic is **out of scope**.
- Billing, credits, entitlements, Feature Flags, and AI Story permissions are unchanged.

---

## Provider list (V1)

| Provider ID | Product name | Purpose |
|-------------|--------------|---------|
| `openai` | OpenAI | AI Marketing, Planning, Text generation |
| `seedance` | BytePlus Dreamina Seedance | Video generation |
| `minimax` | MiniMax | Video generation |
| `fal` | fal.ai (Topaz Video Upscale) | Video upscaling |

**Flux is not included.** Flux belongs to Creative Assets and will be implemented in a future sprint.

Capability defaults (routing mode `fixed`):

| Role | Env | Default |
|------|-----|---------|
| Text | `AI_DEFAULT_TEXT_PROVIDER` | `openai` |
| Video | `AI_DEFAULT_VIDEO_PROVIDER` | `seedance` |
| Upscale | `AI_DEFAULT_UPSCALE_PROVIDER` | `fal` |

---

## Environment variables

All keys are **server-only**. Never use `NEXT_PUBLIC_` or `VITE_` prefixes for provider secrets.

### AI Runtime

| Variable | Example / default | Notes |
|----------|-------------------|-------|
| `AI_PROVIDER_ROUTING_MODE` | `fixed` | V1 supports `fixed` only |
| `AI_DEFAULT_TEXT_PROVIDER` | `openai` | Must be a text-capable provider ID |
| `AI_DEFAULT_VIDEO_PROVIDER` | `seedance` | `seedance` \| `minimax` |
| `AI_DEFAULT_UPSCALE_PROVIDER` | `fal` | Must be `fal` in V1 |
| `AI_COST_TRACKING_ENABLED` | `true` | Config flag only (no billing wiring here) |
| `AI_USAGE_LOG_ENABLED` | `true` | Config flag only |
| `AI_PROVIDER_TIMEOUT_MS` | `600000` | Positive integer (ms) |
| `AI_PROVIDER_MAX_RETRIES` | `3` | Integer ≥ 0 |

### OpenAI

| Variable | Default |
|----------|---------|
| `AI_PROVIDER_OPENAI_ENABLED` | `false` |
| `AI_PROVIDER_OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `AI_PROVIDER_OPENAI_API_KEY` | _(empty)_ |
| `AI_PROVIDER_OPENAI_DEFAULT_MODEL` | `gpt-5.5` |

### Seedance (BytePlus Dreamina)

| Variable | Default |
|----------|---------|
| `AI_PROVIDER_SEEDANCE_ENABLED` | `false` |
| `AI_PROVIDER_SEEDANCE_BASE_URL` | `https://ark.ap-southeast.bytepluses.com` |
| `AI_PROVIDER_SEEDANCE_API_KEY` | _(empty)_ |
| `AI_PROVIDER_SEEDANCE_DEFAULT_MODEL` | `dreamina-seedance-2-0-260128` |

### MiniMax

| Variable | Default |
|----------|---------|
| `AI_PROVIDER_MINIMAX_ENABLED` | `false` |
| `AI_PROVIDER_MINIMAX_BASE_URL` | _(empty — required when enabled)_ |
| `AI_PROVIDER_MINIMAX_API_KEY` | _(empty)_ |
| `AI_PROVIDER_MINIMAX_DEFAULT_MODEL` | _(empty — required when enabled)_ |

### fal.ai

| Variable | Default |
|----------|---------|
| `AI_PROVIDER_FAL_ENABLED` | `false` |
| `AI_PROVIDER_FAL_BASE_URL` | `https://queue.fal.run` |
| `AI_PROVIDER_FAL_API_KEY` | _(empty)_ |
| `AI_PROVIDER_FAL_DEFAULT_MODEL` | `fal-ai/topaz/upscale/video` |

### Legacy note

Existing runtime code may still read `OPENAI_API_KEY` / `SEEDANCE_API_KEY` until adapters are migrated onto this config layer. Those legacy keys remain in `.env.example` for compatibility. **New work must use `AI_PROVIDER_*` via `loadAiProviderConfigFromEnv` / `getAiProviderConfig`.**

---

## Local setup

1. Copy `.env.example` → `.env.local` (and worker env as needed).
2. Leave all `AI_PROVIDER_*_ENABLED=false` until you have real keys.
3. To enable a provider locally:
   - Set `AI_PROVIDER_<NAME>_ENABLED=true`
   - Fill `API_KEY`, `BASE_URL`, and `DEFAULT_MODEL`
4. Load config in server/worker startup (future wiring):

```ts
import {
  getAiProviderConfig,
  redactAiProviderConfig,
} from "@ceo-agent/shared";

const config = getAiProviderConfig(); // fail-fast if invalid
console.info("AI providers", redactAiProviderConfig(config));
```

5. Run unit tests:

```bash
pnpm test tests/ai-provider-environment.test.ts
```

---

## Security

- Never commit real secrets. `.env.example` values for keys stay empty.
- Never expose server API keys to browser code (`NEXT_PUBLIC_` / `VITE_` forbidden for these vars).
- Never print secrets. Use `redactAiProviderConfig()` for logs (`apiKey` → `[REDACTED]` or `unset`).
- Store production secrets in the host secret manager (Vercel / Railway / etc.), not in git.

---

## Validation

Typed module: `packages/shared/src/ai-provider-env.ts`

Rules:

| Condition | Behaviour |
|-----------|-----------|
| Provider **disabled** | Missing API key / base URL / model allowed |
| Provider **enabled** | API key, absolute `http(s)` base URL, and default model **required** |
| Routing mode | Must be `fixed` (V1) |
| Timeout | `AI_PROVIDER_TIMEOUT_MS` must be a positive integer |
| Retries | `AI_PROVIDER_MAX_RETRIES` must be ≥ 0 |
| Defaults | Text / video / upscale IDs must match allowed capability sets |

Invalid config throws `AiProviderConfigError` (`code: AI_PROVIDER_CONFIG_INVALID`) — fail fast at load/startup.

---

## Key rotation

1. Create a new key in the provider console (OpenAI / BytePlus / MiniMax / fal).
2. Update the corresponding `AI_PROVIDER_*_API_KEY` in the secret store.
3. Restart web + worker processes so `getAiProviderConfig()` reloads (cache clears on process restart).
4. Confirm health with redacted config logs (no key material).
5. Revoke the old key only after the new deployment is healthy.
6. Rotate one provider at a time; keep `ENABLED=false` for unused providers.

---

## OpenAI API notes (ops check)

Use these when enabling OpenAI for Marketing / Planning / Text. This foundation does **not** call the API; it only records defaults.

| Item | Value |
|------|--------|
| Base URL | `https://api.openai.com/v1` |
| Auth | `Authorization: Bearer <AI_PROVIDER_OPENAI_API_KEY>` |
| Default model (config) | `gpt-5.5` |
| Related model | `gpt-5.5-pro` (higher cost; not the V1 default) |
| Preferred text endpoint (future adapters) | `POST /v1/responses` (recommended for reasoning + tools) |
| Legacy endpoint | `POST /v1/chat/completions` (still used by some existing EmberOS code) |
| Docs | [GPT-5.5 model](https://developers.openai.com/api/docs/models/gpt-5.5), [Text generation](https://developers.openai.com/api/docs/guides/text), [Latest model guidance](https://developers.openai.com/api/docs/guides/latest-model) |

Operational checks (manual, outside this config task):

1. Ensure `AI_PROVIDER_OPENAI_ENABLED=true` and key/model/base URL validate via `getAiProviderConfig()`.
2. When adapters migrate, prefer Responses API for `gpt-5.5` + tools/reasoning.
3. Pin snapshots (e.g. dated model IDs) in production if behaviour stability is required.
4. Do not put the OpenAI key in any `NEXT_PUBLIC_*` variable.

---

## Out of scope (explicit)

- Provider adapter implementation
- Provider Registry / Router implementation
- Changing existing adapter `process.env` reads (migration is a later task)
- Billing, credits, entitlements
- Feature Flags
- AI Story permission changes
- External API calls from this foundation
- Flux / marketing-image providers
