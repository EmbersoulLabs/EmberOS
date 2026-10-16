# OpenAI model migration audit — 2026-10-15

## Scope and evidence boundary

- Audited baseline and fetched `origin/main`: `423d86b8cd36e6690e6f9a7ae98947b64acbf46b` (identical at audit start).
- This change is offline compatibility work only. No OpenAI request, GPU job, Production write, migration, deployment, or social publish was executed.
- Source reachability is not Production enablement. Production environment values, active release SHAs, campaign authority rows, and live provider behavior were not read; those states remain **UNKNOWN**.
- Official model/API evidence: GPT-6 Luna supports text and image input, Chat Completions, Structured Outputs, and `reasoning_effort: none`; Chat Completions documents `max_completion_tokens` and deprecates `max_tokens`. Prices below use the public Standard processing rates observed on 2026-10-15.

## Entrypoint inventory and trace

| Category | Business entrypoint → wrapper/adapter | Request/decoder | authorization and billing | Migration decision |
|---|---|---|---|---|
| General agents | CEO, Strategy, Vision, Hook, Copy, Compliance, Score, classification and translation → `packages/agents/src/llm.ts` | Chat Completions JSON/JSON Schema; caller schemas validate canonical output | controlled-self-use fetch when configured; caller ledgers | Default `gpt-6-luna`, explicit `reasoning_effort: none`; no fallback |
| Business Profile | analyzer skill → router → OpenAI provider → `callJsonModel` | provider-neutral normalization | skill runner validation | Luna default |
| Provider adapter | OpenAI JSON adapter → `callJsonModel` | existing payload/output validation | provider registry and execution authority | Luna default; legacy models remain readable/selectable |
| Marketing package | `marketing-content.ts` → `callJsonModel` | large package normalization, grounding and fallback | Marketing paid-call authority | explicit `gpt-6.1-sol`, `reasoning_effort: low`; never automatic escalation |
| Social Content | Web generate route → Social generator → strict structured wrapper | Zod JSON Schema plus platform validation | workspace role + approved Review + controlled-self-use + durable claim | Luna claim/request/fingerprint/model-aware settlement; old mini claims preserved |
| AI Story planning | polish, context, Director, beats, Scene, Shot, continuity and semantic writer → `llm.ts` | strict schemas and caller validation | configured/campaign certification authority and immutable model-bound claim | old authorities remain mini snapshot; new explicitly configured authorities may select Luna |
| Character DNA | Character DNA analyzer → vision wrapper | Character DNA schema and validation | asset/Workspace authorization | Luna vision input |
| Visual analysis / observation | visual analyzer and Worker video analysis runtime → vision wrapper | JSON plus canonical snapshot schemas | media and snapshot authority | Luna for new observations; historical snapshots unchanged |
| Direct keyframe QC | injected visual QC client | bounded JSON; refusal/truncation handling | paid execution authorization and independent QC | explicit Sol quality path; no retry/fallback |
| Creative image | OpenAI creative image adapter | Images API | image execution authority | `gpt-image-2` unchanged; separate product/notice |
| Speech | `tts.ts`, AI Story TTS adapter | `audio.speech.create` | voice execution authority | `tts-1-hd` unchanged; not replaced by Realtime |
| Manual listening | local voice-listening script | `audio.speech.create` | manual review authority | `gpt-4o-mini-tts` unchanged; manual-only |
| Transcription | `vision.ts` | `audio.transcriptions.create` | task authority | `whisper-1` unchanged; separate product/notice |

Historical strings in fixtures, receipts, snapshots, approval hashes, and settled rows are evidence and are intentionally not rewritten.

## Contract and persistence changes

- `packages/agents/src/openai-model-policy.ts` is the single non-agent policy module for supported text model IDs, reasoning controls, and Standard token prices.
- OpenAI SDK is pinned to compatible 6.x (`^6.49.0`). Version 4.104.0 lacked the `none` type. SDK 7.34.0 was evaluated offline but rejected because its stricter Zod conversion broke existing valid structured-output schemas.
- `supabase/migrations/20261015143000_openai_gpt6_luna_model_authority.sql` is forward-only. It expands, and never rewrites, Social and Certification model constraints.
- Social reservation fingerprints include the selected model. Generation receives the persisted claim model. Settlement prices that claim model, not the current default. `SUBMITTED` and `UNKNOWN` replays remain blocked; `RESULT_READY` resumes persistence without another provider call; `SETTLED` returns the existing draft.
- Certification authorities and HTTP grants bind the model. Claim and settlement use the persisted model. Existing mini-snapshot authorities continue to work, and no Luna authority is auto-provisioned.
- Workspace, platform, Review/approval, stale revision, idempotency, reference, Character DNA, canonical Scene, LOCAL_GPU, and Post-QC validation are unchanged.

## Offline cost comparison

Standard token-only estimate (images may add model-specific token usage):

| Model | Input / 1M | Output / 1M | 12k input + 1.2k output |
|---|---:|---:|---:|
| `gpt-6-luna` | $0.10 | $0.50 | $0.001800 |
| `gpt-4o-mini` (historical) | $0.15 | $0.60 | $0.002520 |
| `gpt-6.1-sol` | $2.00 | $10.00 | $0.036000 |
| `gpt-4o` (historical) | $2.50 | $10.00 | $0.042000 |

These are policy/accounting calculations, not invoices and not quality evidence.

## Rollout and rollback (not executed)

1. Apply the additive DB migration first and verify both old/new CHECK values in an isolated/pre-Production database.
2. Deploy Web and Worker from the same tested commit. Set `AI_STORY_CERTIFICATION_MODEL=gpt-6-luna` only for an already-authorized scope with a Luna-bound authority row; otherwise omit it to retain the legacy snapshot.
3. Verify non-generating health, claim reads, Workspace isolation, Post-QC and LOCAL_GPU routing. LOCAL_GPU remains the normal video execution path.
4. A separately authorized future canary may compare Luna against existing fixtures. It must use a new idempotency identity and finite budget, never retry UNKNOWN, and never auto-escalate to Sol. No canary is authorized or run by this PR.

Rollback application code first to the prior SHA. Keep the additive DB constraints so new Luna claims remain readable and historical records remain valid. Do not delete or rewrite receipts or authority rows. If configuration enabled Luna certification, remove that explicit configuration only after stopping new traffic; do not mutate existing claims.

## Result classification

- `OFFLINE_COMPATIBILITY_PASS`: request capture, schema preservation, refusal/truncation handling, cost policy, migration constraint, Social state transitions, and relevant Story/Character/Marketing tests are exercised without external network.
- `LIVE_QUALITY_UNVERIFIED`: no live model canary is authorized, so output quality, latency, exact provider snapshots, and live billing are unverified.
- `PRODUCTION_ENABLEMENT_UNKNOWN`: no Production runtime evidence was accessed and no deployment was performed.

## Audio follow-up (separate PR)

Inventory `tts-1-hd`, manual `gpt-4o-mini-tts`, and `whisper-1` runtime notices and pricing independently, then add request-capture tests at their own SDK boundaries. Do not substitute Realtime for `audio.speech`, and do not couple that work to this text/vision migration.
