# AI Story V1 Runtime (Campaign-owned)

Last updated: 2026-07-30

## Product boundary (locked)

- **AI Story** is a Campaign-owned V1 module, parallel to Create Marketing inside the same Campaign.
- **Workspace Asset Story** (`stories` table, PD-037) is a separate concept and is **not** the canonical AI Story product.
- Sprint 1 freezes the Story Draft at **Ready for Animation**.
- Sprint 2 adds planning only: Creative Context, Director Thinking, Story Beats, Scene Plan, Shot Plan, Continuity, and Narrative Integration. It ends at **Animation Package READY FOR EXECUTION**.
- Provider execution, video rendering, billing, and finalization tables are intentionally out of scope.

## Domain model

| Table | Purpose |
| --- | --- |
| `ai_stories` | Campaign-owned story record (title, idea, status, current version) |
| `ai_story_versions` | Structured Story Draft versions with optional freeze metadata |
| `ai_story_asset_links` | Campaign asset references selected for polish context |
| `ai_story_creative_contexts` | Planning context extracted from approved Story Draft + campaign/brand context |
| `ai_story_animation_packages` | Animation Package payload + consistency report + approval metadata (also stores in-progress `planning_draft`) |

Statuses:

- Sprint 1 draft freeze: `draft` → `generating` → `review` → `approved` → `ready_for_animation` (also `failed`, `archived`).
- Sprint 2 planning: `ready_for_animation` → `planning` → `planning_review` → `ready_for_execution`.
- `planning_review` may return to `planning`; `failed` may return to `draft`, `generating`, or `planning`.

Structured Story Draft schema: `@ceo-agent/shared` (`AiStoryStructuredDraftSchema`).
Planning schemas: `CreativeContextSchema`, `DirectorThinkingSchema`, `StoryBeatSchema`, `ScenePlanItemSchema`, `ShotPlanItemSchema`, `StoryPlanningDraftSchema`, `AnimationPackagePayloadSchema`.

## API routes

All routes require Supabase JWT and workspace membership via `requireWorkspaceRole`.

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/api/campaigns/:id/ai-stories` | client_viewer+ | List Campaign AI Stories |
| POST | `/api/campaigns/:id/ai-stories` | operator+ | Create AI Story |
| GET | `/api/campaigns/:id/ai-stories/:storyId` | client_viewer+ | Read story + versions |
| PATCH | `/api/campaigns/:id/ai-stories/:storyId` | operator+ | Edit draft (creates new version) |
| POST | `/api/campaigns/:id/ai-stories/:storyId/generate` | operator+ | AI polish → Story Draft |
| POST | `/api/campaigns/:id/ai-stories/:storyId/rewrite` | operator+ | AI rewrite of current Story Draft |
| POST | `/api/campaigns/:id/ai-stories/:storyId/approve` | operator+ | Approve + freeze → ready_for_animation |
| POST | `/api/campaigns/:id/ai-stories/:storyId/screenwriter` | operator+ | Characters / dialogue / narrative → Creative Context |
| GET | `/api/campaigns/:id/ai-stories/:storyId/planning` | client_viewer+ | Read Creative Context + planning draft / Animation Package |
| POST | `/api/campaigns/:id/ai-stories/:storyId/planning/generate` | operator+ | Run full planning pipeline → planning_review |
| POST | `/api/campaigns/:id/ai-stories/:storyId/planning/stages/:stage` | operator+ | Run one planning stage (`creative_context` … `animation_package`) |
| POST | `/api/campaigns/:id/ai-stories/:storyId/planning/approve` | operator+ | Approve Animation Package → ready_for_execution |

## UI entrypoints

- Campaign Workspace overview: **Create Story** (alongside existing Marketing generate).
- `/w/:slug/campaigns/:id/ai-stories/new` — plain-language idea + optional assets.
- `/w/:slug/campaigns/:id/ai-stories/:storyId` — review, rewrite, approve, per-stage planning CTAs, Animation Package review, Ready for Execution.

## AI polish / screenwriter

- Package: `@ceo-agent/agents` → `polishAiStoryDraft()`, `rewriteAiStoryDraft()`, `generateStoryCharacters()`, `generateStoryDialogue()`, `generateStoryNarrative()`.
- Provider-neutral JSON LLM helper; outputs validated with shared Zod schemas.
- Screenwriter character / dialogue / narrative results persist into `ai_story_creative_contexts`.

## AI planning service

- Package: `@ceo-agent/agents` → stage generators + `runFullStoryPlanningPipeline()` + `buildAnimationPackage()`.
- Web runner: `runSinglePlanningStage()` persists progressive `StoryPlanningDraft` rows, then a complete Animation Package on `animation_package`.
- Stage order (`STORY_PLANNING_STAGE_ORDER`):
  1. Creative Context
  2. Director Thinking
  3. Story Beats
  4. Scene Plan
  5. Shot Plan
  6. Character Continuity
  7. World Continuity
  8. Animation Package assembly
- `validatePlanningConsistency()` checks beat coverage, scene-to-shot coverage, character continuity names/ids, and non-empty world continuity.
- Package status moves from `review` to `ready_for_execution` only through the planning approval route.

## Database apply

```bash
pnpm --filter @ceo-agent/db sql:ai-story
pnpm --filter @ceo-agent/db sql:ai-story-planning
```

Requires `DATABASE_URL` in `.env.local` or `apps/worker/.env`.

## Tests

```bash
pnpm test tests/ai-story-vertical-slice.test.ts tests/ai-story-planning.test.ts tests/ai-story-planning-pipeline.test.ts tests/ai-story-screenwriter.test.ts
pnpm e2e:ai-story-planning
```

## Not implemented (planned)

- Archive API (status model supports `archived`; dedicated endpoint optional)
- Provider execution from Animation Package (Sprint 3)
- Video rendering, billing, and finalization for AI Story animation
