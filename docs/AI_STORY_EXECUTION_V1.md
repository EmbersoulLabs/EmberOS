# AI Story Execution Engine (Sprint 3)

Last updated: 2026-07-30

## Boundary

- Starts only from approved Animation Package (`ready_for_execution`).
- Does not modify Sprint 2 planning schemas or Blueprint.
- Provider selection is capability-driven; UI never hardcodes vendors.

## Flow

Animation Package READY FOR EXECUTION
→ Generate Review
→ Confirm Execute
→ Execution Job (queued → preparing → running → collecting_assets → completed)
→ Marketing Outputs
→ Review (approve / reject / regenerate one / regenerate all)
→ Export approved only (ZIP via task export)

## PD-054 / PD-055

- Default target: 5 marketing videos or 5 marketing creatives.
- Quality-first: may return 3–5; never pad low-quality filler.
- Auto Clip `pickSegmentsFromHighlightIndex` uses the same strategy.

## Apply DB

```bash
pnpm --filter @ceo-agent/db sql:ai-story-execution
```

## Provider env

- `SEEDANCE_API_KEY` (+ optional `SEEDANCE_API_BASE_URL`) for `animation-video-generation`
- `FLUX_API_KEY` (+ optional `FLUX_API_BASE_URL`) for `marketing-image-generation`
- OpenAI JSON remains registered for `json-generation`
- Runway / Kling / Veo / ComfyUI are future-ready stubs (not registered until credentials exist)

## Tests

```bash
pnpm test tests/sprint-3-execution-engine.test.ts tests/sprint-3-prompt-builder.test.ts
```
