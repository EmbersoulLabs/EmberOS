# EmberOS Video Studio — Product & Implementation Plan

> **Status:** Planning (Quick Mode first)  
> **Last updated:** 2026-06-23  
> **Related:** [EMBEROS_V1_ARCHITECTURE.md](./EMBEROS_V1_ARCHITECTURE.md) · [EMBEROS_V2_V4_ARCHITECTURE.md](./EMBEROS_V2_V4_ARCHITECTURE.md)

---

## Product Positioning

EmberOS is **not** a video editor, CapCut clone, or Canva clone.

EmberOS is an **AI Marketing Operating System**.

**Target users:** florists, restaurants, cafés, pet shops, beauty salons, retail SMB owners.

**Their problem is not** “I don’t know how to edit.”

**Their problem is:** no time to consistently produce marketing content.

**Desired user feeling:**

> “I uploaded a video of my daily work. EmberOS turned it into content I can post over the next few days.”

The system should feel like an **AI Marketing Team**, not an **AI Video Editor**.

### Identity Guardrails

EmberOS must behave like an operating system for small-business marketing, not a creative tool that expects the user to know what to make.

Users should not need:

- Video editing skills
- Marketing knowledge
- Content planning skills
- Manual trimming, timeline editing, or music selection

The core promise:

> “I uploaded my daily work process and EmberOS automatically created multiple days of marketing content.”

---

## EmberOS System Architecture

```text
EmberOS
├── CEO Agent
├── Market Intelligence
├── Competitor Intelligence
├── Campaign Planner
├── Content Planner
├── Video Studio
├── Asset Library
├── Publisher
├── Analytics
└── Recommendation Engine
```

CEO Agent is **not** a separate product. It is the core intelligence module inside EmberOS.

| Module | Responsibility |
|--------|----------------|
| **CEO Agent** | Weekly brief, strategy, campaign suggestions, content priorities |
| **Market Intelligence** | Trends, seasonal hooks, category signals |
| **Competitor Intelligence** | Competitor topics, content formats, offers, positioning |
| **Campaign Planner** | Convert opportunities into campaigns |
| **Content Planner** | Decide what assets should be produced |
| **Video Studio** | Turn raw footage into marketing creatives |
| **Asset Library** | Store reusable product, brand, and content assets |
| **Publisher** | Generate platform-specific assets and posting recommendations |
| **Analytics** | Track performance and conversion signals |
| **Recommendation Engine** | Recommend next actions from performance feedback |

---

## CEO Agent Responsibilities

CEO Agent is the **brain**. Video Studio is the **production team**.

CEO Agent generates:

- Weekly Marketing Brief
- Campaign Suggestions
- Seasonal Promotions
- Competitor Insights
- Trending Topics
- Content Strategy
- Publishing Recommendations
- Growth Opportunities

CEO Agent provides instructions to Video Studio: what business objective to optimize for, which offer to feature, which audience to target, and which content archetypes matter most this week.

---

## Where Video Studio Sits

Video Studio is the **execution layer** inside a Campaign — not a separate product.

```text
CEO Agent          →  strategy, monthly goals, audience, content priorities
        ↓
Video Studio       →  ingest, analyze, multiply, render
        ↓
Publisher          →  schedule, post (V3)
        ↓
Analytics          →  performance feedback (V3)
        ↓
Recommendation     →  feeds back into CEO Agent (V4)
```

**Codebase mapping today:**

| Layer | Current location |
|-------|------------------|
| CEO / strategy | `packages/agents/src/orchestrator.ts`, `ceo.ts`, `strategy.ts` |
| Video execution | `packages/agents/src/auto-clip-pipeline.ts` |
| Segment picking | `packages/agents/src/auto-clip.ts` |
| Vision | `packages/agents/src/vision.ts`, `apps/worker/src/media/vision-prep.ts` |
| Render | `apps/worker/src/ffmpeg/pipeline.ts` |
| Creatives output | `creatives` table + `copyVariants` + `editPlan` |
| UI pipeline | `apps/web/src/lib/pipeline-config.ts`, campaign wizard |

---

## Two Modes (Roadmap)

| Mode | Source length | Primary use case | Phase |
|------|---------------|------------------|-------|
| **Quick Mode** | 5–10 min | Product intro, customer stories, in-store footage, unboxing | **Phase 1 (now)** |
| **Studio Mode** | 30–120 min | Full process videos (bouquet making, baking, coffee prep, salon service) | Phase 2 |

This document **prioritizes Quick Mode**.

---

# Phase 1 — Quick Mode

## Goal

From **up to several source clips totaling 5–10 minutes** (or one continuous take), automatically produce **ready-to-post marketing shorts** with copy, subtitles, and BGM — zero manual editing.

## Output by Plan Tier (Content Multiplication)

| Plan | Videos per upload | Notes |
|------|-------------------|-------|
| **Starter** | 3 | Matches current `AUTO_CLIP.CLIP_COUNT` |
| **Pro** | 5 | Five distinct marketing archetypes |
| **Agency** | 5–10 | Higher quota + batch export |

**Rule:** Never output only one video from a single upload.

## Quick Mode Video Archetypes (Pro / 5-pack target)

| # | Type | Marketing goal | Target length | Maps from today |
|---|------|----------------|---------------|-----------------|
| 1 | **Sales** | Drive conversion | 15–30s | `hook` variant + strong CTA |
| 2 | **Brand story** | Build trust | 30–60s | `storytelling` style + emotional BGM |
| 3 | **Educational** | Establish expertise | 30–60s | Tutorial / how-to moments |
| 4 | **Engagement** | Watch time / saves | 15–30s | Dynamic motion + curiosity hook |
| 5 | **Growth** | Reach / discovery | 15–30s | Fast pace + upbeat BGM |

**Starter (3-pack)** ships first three: Sales · Brand story · Educational (or Overall · Hook · Product until archetypes land).

## Per-Video Auto-Generated Assets

Each creative must include:

- Hook (opening line)
- Title
- Caption (platform-ready body)
- CTA
- Hashtags
- Subtitles (burned in render)
- BGM recommendation (+ optional swap)

---

## User Flow (Zero Manual Steps)

```text
1. User uploads video in Campaign wizard
2. System compresses (H.264 MP4, AI-friendly size, keeps analysis quality)
3. System uploads to workspace storage
4. System auto-enqueues analysis + pipeline (no “Start analysis” button)
5. User sees progress: Analyzing → Generating content → Ready
6. User receives N videos + copy pack per tier
```

### Upload & Compression

| Step | Technology | Notes |
|------|------------|-------|
| Compress | FFmpeg (Worker) | H.264, sensible CRF, faststart, max ~1080p for analysis |
| Store | `{workspace_id}/campaigns/...` | Existing storage path convention |
| Trigger | BullMQ `agent.pipeline` | Auto on upload confirm |

**Gap vs today:** V1 doc describes `ffmpeg.compress` queue; Campaign flow mostly uploads raw to Storage. Quick Mode should add compress-before-analyze.

### Compression Requirements

Video Studio should automatically normalize uploaded footage before analysis/render:

- MP4 container
- H.264 video
- Max 1080p
- Max 30 FPS
- Optimized bitrate for analysis and render cost
- Faststart enabled for preview playback

Store the compressed version by default. Do **not** permanently store original video for standard SaaS plans. Agency Plan may allow original footage retention as an upsell / agency-service feature.

---

## AI Analysis Pipeline (Quick Mode)

**Cost principle:** Prefer cheap signals first; LLM vision only on top candidates. Target **< SGD 3** per long-video job.

```text
Upload (compressed)
  → Whisper transcript (chunked if needed)
  → Scene hints (sparse frames + optional light scene detection)
  → Highlight Index (score all candidate segments)
  → Top-N segments → GPT vision refine (optional)
  → Archetype assignment (sales / brand / edu / …)
  → Edit plans + copy per creative
  → FFmpeg render × N
```

### What to Detect

- Scene changes
- Product “hero” moments
- Product reveal moments
- Product completion moments
- Packaging / reveal moments
- Teaching-value clips
- Educational moments
- Emotional / storytelling beats
- Customer value moments
- High engagement moments
- Satisfying process moments
- High-attention hooks (first 3s potential)

### What to Auto-Remove (Scoring Penalty / Skip)

- Waiting / idle time
- Dead air
- Repeated actions
- Long static frames
- Low speech + low motion segments
- Low-value repetitive actions

**Quick Mode v1:** Rule-based + transcript gaps + vision `suggestedMoments` (already in `VisionAnalysis`).  
**Studio Mode later:** PySceneDetect + stronger dead-air removal.

---

## Marketing Value Scoring (Per Segment)

Every candidate segment gets five scores (0–100):

| Score | Meaning |
|-------|---------|
| **Attention** | Scroll-stop / hook potential |
| **Engagement** | Comments, saves, watch time |
| **Conversion** | Purchase / inquiry intent |
| **Educational** | Teachable / expertise signal |
| **Brand** | Trust, aesthetic, brand fit |

**Today:** `marketing_score` uses hook / visual / copy / cta / platformFit on the **finished creative** (`packages/agents/src/score.ts`).  
**Quick Mode:** Add **segment-level** `HighlightIndex` before clip selection; keep creative-level score for QA.

Segment scoring should identify the highest-value marketing moments before creative generation, using:

- Attention Score
- Engagement Score
- Conversion Score
- Educational Score
- Brand Score

### Cheap Scoring Signals (implement first)

| Signal | Source |
|--------|--------|
| Speech density | Whisper segments |
| Motion / novelty | Frame diff between sparse samples |
| Product keywords | Transcript + campaign brief |
| Scene boundaries | Timestamp alignment |
| LLM refinement | Top 5–8 candidates only |

---

## CEO Agent Integration

CEO Agent provides **what to make**; Video Studio provides **how to make it**.

| CEO output | Video Studio uses it for |
|------------|---------------------------|
| Campaign theme | Copy tone, hook angles |
| Monthly marketing goal | Archetype weighting (e.g. more sales vs brand) |
| Target audience | Voice locale, platform, hashtag style |
| Content strategy | Which archetypes to prioritize |
| Promotion focus | CTA and product moments |

**Wiring today:**

- `parseCampaignCreativeBrief` + `buildVideoAnalysisPrompt` → vision/copy prompts
- `effectiveCampaignGoal` → goal heuristics
- `runStrategyAgent` runs on **agency** path only; Quick Mode should **read** `strategyJson` / brief when present, not require full agency pipeline

**Quick Mode rule:** Video campaigns with a single video asset route to `runAutoClipPipeline` (`orchestrator.ts`). CEO context should be injected at the start of that pipeline, not a separate product.

---

## Technical Stack (Required / Preferred)

| Component | Use |
|-----------|-----|
| **FFmpeg** | Compress, 9:16 render, subtitles, BGM mix, dynamic camera |
| **Whisper** | Transcript (`vision-prep.ts`, `transcribeAudio`) |
| **OpenAI** | Vision frames, copy, scoring |
| **BullMQ + Worker** | `agent.pipeline`, `ffmpeg.render` |
| **PySceneDetect** | Phase 2 / Studio; optional light use in Quick v1.1 |

**Avoid as primary engine:** Runway, expensive per-second video APIs, heavy third-party video platforms.

---

## Rendering & Motion (Already Started)

Recent capabilities to **keep** as execution details (not editor UX):

- TikTok-style dynamic camera (`packages/shared/src/dynamic-camera.ts`, `apps/worker/src/ffmpeg/dynamic-motion.ts`)
- Virtual cuts every ~2.5s, Ken Burns, subject-centered crop
- AI BGM recommendation (`packages/shared/src/bgm/recommend.ts`)
- Hook title card + TikTok caption styles (`ass-subtitles.ts`)

**UI principle:** Show “Marketing match score”, “Content type”, “Suggested caption” — hide timeline / tracks.

---

## AI BGM Recommendation Engine (Phase A — Complete)

Video Studio includes an **AI BGM Engine** that selects and mixes music automatically. Users do **not** need to pick tracks manually (optional override via campaign brief `bgmPreference`).

### Analysis Dimensions

Before track selection, the engine infers (`packages/shared/src/bgm/analyze.ts`):

| Dimension | Values |
|-----------|--------|
| **Energy** | low · medium · high |
| **Emotional tone** | professional · luxury · elegant · relaxing · romantic · inspirational · premium · playful · exciting |
| **Content type** | sales · story · educational · engagement · trend |

**Inputs:** campaign brief, industry, marketing goal, content style, platform, video archetype, vision hooks, voice preset.

### Auto Matching Examples

| Business | Content | Typical tracks |
|----------|---------|----------------|
| Florist | Luxury sales | Luxury Piano, Soft Floral, Luxury Strings |
| Café | Promotion | Upbeat Acoustic, Coffeehouse, Lifestyle Acoustic |
| Beauty salon | Brand / sales | Modern Luxury, Luxury Soft Piano, Luxury Ambient |
| Retail | Promotion | Upbeat Retail, Retail Promotion, Upbeat Energy |

### Content Multiplication — Unique BGM per Video

When one upload produces multiple creatives, each clip gets a **different music style**. This must be enforced by underlying audio source, not just track name. Multiple catalog IDs pointing to the same mp3 still count as the same music and should not be repeated in a 3-pack.

| Clip (Starter 3-pack) | Archetype | BGM intent |
|-----------------------|-----------|------------|
| Sales / Product Focus | sales | Conversion / promo energy |
| Story / Brand Trust | story | Warm narrative or premium bed |
| Engagement / Growth Hook | engagement | Higher energy, scroll-stop |

**Code:** `packages/agents/src/auto-clip-pipeline.ts` — per-creative `recommendBgm()` with previous track exclusions. `packages/shared/src/bgm/recommend.ts` should dedupe by true audio source, not only track ID.

### Smart Audio Mixing (Automatic)

Implemented in `apps/worker/src/ffmpeg/bgm-mix.ts`:

- Loudness normalize (`loudnorm -14 LUFS`)
- BGM fade in (~0.6s) / fade out (~0.8s)
- Sidechain duck under voiceover
- Duck under original dialogue when keeping source audio
- Smooth amix transitions between voice + bed

Users never adjust levels manually.

---

## AI Audio Enhancement

Video Studio should automatically improve source audio before final render. This is part of making SMB footage feel professional, not a manual audio-editing feature.

Automatically:

- Remove noise
- Reduce fan noise
- Reduce traffic noise
- Enhance speech clarity
- Rebalance source audio, voiceover, and BGM
- Normalize loudness across generated videos

Implementation direction:

| Capability | Preferred approach |
|------------|--------------------|
| Noise reduction | FFmpeg filters first; optional model-based enhancement later |
| Speech clarity | EQ / compression presets, voiceover-first mix |
| Loudness consistency | `loudnorm` target around -14 LUFS |
| BGM balance | Sidechain ducking under speech / voiceover |

Users should hear “finished marketing content”, not raw phone footage.

### Music Library

| Source | Status |
|--------|--------|
| Royalty-free (FMA Chad Crouch, CC BY-NC) | **Active** — bundled via `pnpm bgm:refresh` |
| Licensed commercial | Schema ready (`license: licensed`) |
| AI-generated music | Schema ready (`license: ai_generated`) |
| Marketplace | Future integration |

All current renders default to `royalty_free`.

### UI

- **MusicMatchPanel** — track name, match score, energy / tone / content type, benefits, royalty-free badge
- **Change Music** — optional alternatives (secondary action, not primary workflow)

### Key Files

```
packages/shared/src/bgm/
  analyze.ts      # BGM content analysis
  recommend.ts    # Scoring + recommendation + batch
  library.ts      # Track catalog + industry pools
apps/worker/src/ffmpeg/
  bgm-mix.ts      # Smart mix filters
  voiceover-mix.ts
  audio-mix.ts
```

---

## Data Model Extensions (Quick Mode)

Minimal additions on top of existing `campaigns` → `tasks` → `creatives`:

```typescript
// Campaign or task metadata
interface VideoStudioJob {
  mode: "quick" | "studio";
  sourceDurationSec: number;
  clipQuota: number;              // 3 | 5 | 10 from org plan
  highlightIndex?: HighlightSegment[];
}

interface HighlightSegment {
  startSec: number;
  endSec: number;
  attentionScore: number;
  engagementScore: number;
  conversionScore: number;
  educationalScore: number;
  brandScore: number;
  deadAir: boolean;
  sceneType?: string;
  reason: string;
}

// Per creative
interface ClipMeta {
  archetype: "sales" | "brand_story" | "educational" | "engagement" | "growth";
  // ... existing index, title, hookType, platform
}
```

**Plan tier → clipQuota:** Extend `packages/shared/src/billing.ts` (today only gates 1080p export).

---

## Publisher, Analytics, and Recommendation Loop

Video Studio should not be the end of the workflow. Generated creatives should flow into Publisher, Analytics, and Recommendation Engine so EmberOS behaves like an ongoing marketing team.

### Publisher

Supported platforms:

- TikTok
- Instagram Reels
- Facebook Reels
- YouTube Shorts

Publisher should generate platform-specific assets:

- Platform-ready captions
- Hashtags
- CTA variants
- Suggested posting times
- Export packages per platform

### Analytics

Track:

- Views
- Reach
- Engagement
- Watch time
- CTR
- Conversions / enquiries where available

### Recommendation Engine

Analyze performance and recommend:

- New topics
- Better posting times
- New campaigns
- Better hooks
- Better content styles
- Which video archetypes to make more often

### Weekly CEO Report

Every week, EmberOS should automatically generate:

- Performance Summary
- Competitor Insights
- Trending Topics
- Next Week Content Plan
- Campaign Recommendations
- Publishing Schedule

The report should support **one-click execution**: CEO Agent proposes the plan, Video Studio produces assets, Publisher schedules them, Analytics closes the loop.

---

## Cost Targets

Primary video processing should be self-hosted. Avoid dependency on expensive per-second rendering providers for standard SaaS jobs.

| Mode | Target processing cost |
|------|------------------------|
| **Quick Mode** | SGD 0.20–0.80 |
| **Studio Mode (30 min)** | SGD 1–3 |
| **Studio Mode (60+ min)** | Below SGD 5 |

Cost principles:

- Use FFmpeg, Whisper, queue workers, Supabase, Vercel, and Redis as the default stack
- Use LLM vision only where it adds marketing value
- Score cheaply first, refine only top candidate segments
- Keep Runway / premium generation out of standard SaaS cost structure

---

## Internal Creator Studio (Super Admin Only)

Internal Creator Studio is **not available to SaaS users**. It is for EmberOS internal production and agency-grade marketing services.

Features:

- AI B-Roll Generation
- Runway Integration
- AI Avatar
- AI Character Replacement
- AI Scene Expansion
- AI Visual Effects
- Premium Voice Generation
- Advanced Advertising Production

Purpose:

- Create agency-grade content
- Produce EmberOS marketing assets
- Serve high-touch agency clients

Do **not** include Internal Creator Studio costs in standard SaaS plan economics.

---

## Implementation Phases (Quick Mode)

### Phase A — Video Studio shell + AI BGM Engine ✅

- [x] AI BGM analysis (energy, tone, content type)
- [x] Industry + archetype track pools (florist, café, beauty, retail)
- [x] Per-creative unique BGM (content multiplication)
- [x] Smart audio mix (normalize, duck, fade in/out)
- [x] MusicMatchPanel with analysis + royalty-free badge
- [x] Auto-apply on pipeline (no manual selection required)
- [ ] Rename Campaign results UI as **Video Studio** (cosmetic)
- [ ] `studioMode: "quick"` flag on campaign create

### Phase B — Ingest (1 week)

- [ ] `ffmpeg.compress` job after upload confirm
- [ ] Auto-enqueue pipeline on compress complete (no manual run)
- [ ] Store `compressed_storage_path` on asset metadata

### Phase C — Highlight Index (2 weeks)

- [ ] `HighlightIndex` builder: transcript + vision moments + heuristics
- [ ] Five dimension scores per segment
- [ ] Replace / augment `pickAutoClipSegments` with scored selection
- [ ] Persist index on `task.stepProgress` or `campaign.metadata`

### Phase D — Content multiplication (2 weeks)

- [ ] Configurable `CLIP_COUNT` from plan tier
- [ ] Archetype → `buildStandaloneClipEditPlan` mapping (duration, BGM, motion, copy prompt)
- [ ] Per-creative: hook, title, caption, CTA, hashtags (extend `runCopyAgent`)

### Phase E — CEO context (1 week)

- [ ] Optional lightweight strategy snippet for video-only campaigns (no full agency graph)
- [ ] Pass monthly goal / audience from workspace `brandProfile` + campaign brief into all agents

### Phase F — Polish (1 week)

- [ ] Export pack: all videos + captions CSV / per-platform JSON
- [ ] Success metrics: time-to-first-preview, cost per job, user completion rate

**Total estimate:** ~8–10 weeks solo; Phases A+B+C unlock usable Quick Mode MVP.

---

## Success Criteria (Quick Mode)

- [ ] User uploads 5–10 min video and receives **≥3 distinct** marketing videos without editing
- [ ] Each video has hook, subtitles, BGM, and platform caption
- [ ] Processing cost **< SGD 3** per job (monitor via `tasks.costUsd`)
- [ ] Median time to first preview **< 15 minutes** on typical hardware
- [ ] User describes product as “marketing team”, not “video editor”

---

## Phase 2 Preview — Studio Mode (Not in Scope Yet)

| Capability | Beyond Quick Mode |
|------------|-------------------|
| Source length | 30–120 min |
| Scene detection | PySceneDetect + stronger dead-air cut |
| Output count | 5–10 videos |
| Batch | “Weekly content pack” from one session |
| Library | Reuse highlights across campaigns (V2 workspace) |

See [EMBEROS_V2_V4_ARCHITECTURE.md](./EMBEROS_V2_V4_ARCHITECTURE.md) for workspace, calendar, and publisher evolution.

---

## What NOT to Build (Anti-Patterns)

- Timeline-based NLE UI
- Manual clip in/out as primary workflow
- Runway / generative video as default render path
- Full-video GPT-4V every second
- Exposing FFmpeg concepts to end users

---

## Open Questions

1. **Starter 3-pack:** Keep current Overall / Hook / Product labels or switch UI to Sales / Brand / Educational immediately?
2. **Compress mandatory?** Always re-encode on upload vs skip if already H.264 1080p under size cap?
3. **Pro tier:** Ship 5 archetypes before or after Publisher (V3)?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-06-23 | Initial plan — Quick Mode first, aligned with existing auto-clip pipeline |
| 2026-06-23 | Phase A: AI BGM Engine (analyze, variation, smart mix, UI) |
| 2026-06-23 | Added EmberOS identity, CEO Agent role, Publisher/Analytics loop, cost targets, and Internal Creator Studio boundaries |
