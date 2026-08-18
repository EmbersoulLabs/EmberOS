# Release Channel

Machine- and human-readable release channel map for EmberOS.

Governance version: **v2.2**

## Current Authority

- Worktree: `worktrees/photo-scene-v1-bounded`
- Branch: `release/photo-scene-v1-bounded`
- Immutable baseline tag: `sprint-4-ms-016`
- Immutable baseline commit: `de7509132b2a3fa442be8a07f94d6a3ef0f0d176`
- Current milestone: MS-017
- Current release: Video Studio V1 RELEASED / FROZEN and Photo Scene V1 RELEASED / FROZEN
- `VIDEO_STUDIO_V1_RELEASED`: YES
- `PHOTO_SCENE_V1_RELEASED`: YES
- `PHOTO_SCENE_V1_STATUS`: RELEASED / FROZEN
- Deployed Photo Scene assembly: `b447f539400f2765958c1c94add708a979c86604`
- Video Studio renderer freeze base: `eea988d5addd268d4d3356d336d7d076109b26ea`

Assembly base: `eea988d5addd268d4d3356d336d7d076109b26ea`

Production web: `emberos-iota.vercel.app` @ `b447f539400f2765958c1c94add708a979c86604` (Vercel `dpl_5s473VnKexZdGf5Sg2RKsG1tfDmx`)

Production worker: Railway `@ceo-agent/worker` @ `b447f539400f2765958c1c94add708a979c86604` (deployment `1ea483b7-bf45-4ec9-a73b-bafa5f08e589`)

See also:

- [`docs/releases/photo-scene-v1-bounded-assembly.md`](docs/releases/photo-scene-v1-bounded-assembly.md)
- [`docs/releases/photo-scene-v1-migration-manifest.md`](docs/releases/photo-scene-v1-migration-manifest.md)
- [`docs/releases/photo-scene-v1-infrastructure-manifest.md`](docs/releases/photo-scene-v1-infrastructure-manifest.md)
- [`docs/releases/photo-scene-v1-production-readiness.md`](docs/releases/photo-scene-v1-production-readiness.md)
- [`docs/releases/video-studio-v1-release-roadmap.md`](docs/releases/video-studio-v1-release-roadmap.md)

## Other Channels

- Video Studio development line: `worktrees/video-studio-v1-bounded`, branch `release/video-studio-v1-bounded`
- Authority review branch: `worktrees/sprint4-phase-b`, branch `release/sprint-4-phase-b`

Do not deploy full release HEAD. Do not deploy AUTH-01. Do not deploy AI Story, Publishing, Flux, or a second Creative Studio product. Do not modify Renderer V1. Photo Scene V1 and Video Studio V1 are both RELEASED / FROZEN.
