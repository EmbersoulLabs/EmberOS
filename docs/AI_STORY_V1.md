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
| `ai_story_animation_packages` | Animation Package payload + consistency report + approval metadata |

Statuses:

- Sprint 1 draft freeze: `draft` → `generating` → `review` → `approved` → `ready_for_animation` (also `failed`, `archived`).
- Sprint 2 planning: `ready_for_animation` → `planning` → `planning_review` → `ready_for_execution`.
- `planning_review` may return to `planning`; `failed` may return to `draft`, `generating`, or `planning`.

Structured Story Draft schema: `@ceo-agent/shared` (`AiStoryStructuredDraftSchema`).
Planning schemas: `CreativeContextSchema`, `DirectorThinkingSchema`, `StoryBeatSchema`, `ScenePlanItemSchema`, `ShotPlanItemSchema`, `AnimationPackagePayloadSchema`.

## API routes

All routes require Supabase JWT and workspace membership via `requireWorkspaceRole`.

| Method | Path | Role | Purpose |
| --- | --- | --- | --- |
| GET | `/api/campaigns/:id/ai-stories` | client_viewer+ | List Campaign AI Stories |
| POST | `/api/campaigns/:id/ai-stories` | operator+ | Create AI Story |
| GET | `/api/campaigns/:id/ai-stories/:storyId` | client_viewer+ | Read story + versions |
| PATCH | `/api/campaigns/:id/ai-stories/:storyId` | operator+ | Edit draft (creates new version) |
| POST | `/api/campaigns/:id/ai-stories/:storyId/generate` | operator+ | AI polish → Story Draft |
| POST | `/api/campaigns/:id/ai-stories/:storyId/approve` | operator+ | Approve + freeze → ready_for_animation |
| GET | `/api/campaigns/:id/ai-stories/:storyId/planning` | client_viewer+ | Read latest Creative Context + Animation Package |
| POST | `/api/campaigns/:id/ai-stories/:storyId/planning/generate` | operator+ | Run full planning pipeline → planning_review |
| POST | `/api/campaigns/:id/ai-stories/:storyId/planning/approve` | operator+ | Approve Animation Package → ready_for_execution |

## UI entrypoints

- Campaign Workspace overview: **Create Story** (alongside existing Marketing generate).
- `/w/:slug/campaigns/:id/ai-stories/new` — plain-language idea + optional assets.
- `/w/:slug/campaigns/:id/ai-stories/:storyId` — review, edit, approve, Ready for Animation display, Generate Planning, Animation Package review, and Ready for Execution display.

## AI polish service

- Package: `@ceo-agent/agents` → `polishAiStoryDraft()`.
- Provider-neutral interface; current implementation uses existing JSON LLM helper.
- Validates structured output strictly; missing optional Business Profile / Campaign context yields user-facing warnings only.

## AI planning service

- Package: `@ceo-agent/agents` → `runFullStoryPlanningPipeline()`.
- Uses the existing provider-neutral `callJsonModel` helper and validates every stage with shared Zod schemas.
- Stage order is fixed:
  1. Creative Context
  2. Director Thinking
  3. Story Beats
  4. Scene Plan
  5. Shot Plan
  6. Character Continuity
  7. World Continuity
  8. Animation Package assembly
- `validatePlanningConsistency()` checks beat coverage, scene-to-shot coverage, character continuity names/ids, and non-empty world continuity. The report is saved with the package for human review.
- The package status moves from `review` to `ready_for_execution` only through the planning approval route.

## Database apply

```bash
pnpm --filter @ceo-agent/db sql:ai-story
pnpm --filter @ceo-agent/db sql:ai-story-planning
```

Requires `DATABASE_URL` in `.env.local` or `apps/worker/.env`.

## Tests

```bash
pnpm test tests/ai-story-vertical-slice.test.ts tests/ai-story-planning.test.ts
```

## Not implemented (planned)

- Character profiles
- Archive API (status model supports `archived`; dedicated endpoint optional)
- Provider execution pipeline integration for Story polish (direct LLM call in V1 slice)
- Provider execution from Animation Package
- Video rendering, billing, and finalization for AI Story animation
