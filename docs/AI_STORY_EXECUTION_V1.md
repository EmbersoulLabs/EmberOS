# AI Story Execution Engine (Sprint 3)

Last updated: 2026-07-31

## Boundary

- Starts only from approved Animation Package (`ready_for_execution`).
- Does not modify Sprint 2 planning schemas or Blueprint.
- Provider selection is capability-driven; UI never hardcodes vendors.
- **Video only** — animation-video via Seedance. No Flux / marketing-image generation.

## Flow

Animation Package READY FOR EXECUTION
→ Generate Review
→ Confirm Execute
→ Execution Job (queued → preparing → running → collecting_assets → completed)
→ Execution Outputs (`ai_story_execution_outputs`, animation_video)
→ Review (approve / reject / regenerate one / regenerate all)
→ Export approved only (ZIP via task export)

## PD-054 / PD-055 (audit)

- AI Story execution uses `MARKETING_OUTPUT_STRATEGY` (target 5, quality-first 3–5) for **execution output variant selection only**.
- Auto Clip runtime remains Sprint 1 frozen: `AUTO_CLIP.CLIP_COUNT = 3` (PD-055 does not authorize Sprint 3 Auto Clip runtime changes).
- Product identity constraints are compiled into the Seedance request from referenced Campaign Assets.

## Apply DB

```bash
pnpm --filter @ceo-agent/db sql:ai-story-execution
```

## Provider env

- `SEEDANCE_API_KEY` (+ optional `SEEDANCE_API_BASE_URL`) for `animation-video-generation`
- OpenAI JSON remains registered for `json-generation`
- Runway / Kling / Veo / ComfyUI are future-ready stubs (not registered until credentials exist)
- Tests: set `EMBEROS_TEST_PROVIDERS=1` (or `NODE_ENV=test`) to register `DeterministicSeedanceTestAdapter` when Seedance key is missing

## Tests

```bash
pnpm test tests/sprint-3-execution-engine.test.ts tests/sprint-3-prompt-builder.test.ts tests/sprint-3-seedance-contract.test.ts
```
