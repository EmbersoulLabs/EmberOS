# Release Channel

Machine- and human-readable release channel map for EmberOS.

Governance version: **v2.2**

## Current Authority

- Worktree: `worktrees/photo-scene-v1-bounded`
- Branch: `release/photo-scene-v1-bounded`
- Immutable baseline tag: `sprint-4-ms-016`
- Immutable baseline commit: `de7509132b2a3fa442be8a07f94d6a3ef0f0d176`
- Current milestone: MS-017
- Current release: Video Studio V1 bounded RELEASED / FROZEN
- `VIDEO_STUDIO_V1_RELEASED`: YES
- Deployed revision: `eea988d5addd268d4d3356d336d7d076109b26ea`
- Photo Scene V1: IMPLEMENTATION_COMPLETE / RELEASE_PENDING
- Photo Scene bounded release candidate: tip of `release/photo-scene-v1-bounded`
- `PHOTO_SCENE_V1_BOUNDED_ASSEMBLY`: BUILT / VALIDATED

Production Video Studio authority remains `eea988d`. This file prepares a Photo Scene bounded release candidate. It does not mark Photo Scene RELEASED and does not authorize production deploy by itself.

Assembly base: `eea988d5addd268d4d3356d336d7d076109b26ea`

Production web: `emberos-iota.vercel.app` @ `eea988d5addd268d4d3356d336d7d076109b26ea`

Production worker: Railway `@ceo-agent/worker` @ `eea988d5addd268d4d3356d336d7d076109b26ea`

See also:

- [`docs/releases/photo-scene-v1-bounded-assembly.md`](docs/releases/photo-scene-v1-bounded-assembly.md)
- [`docs/releases/photo-scene-v1-migration-manifest.md`](docs/releases/photo-scene-v1-migration-manifest.md)
- [`docs/releases/photo-scene-v1-infrastructure-manifest.md`](docs/releases/photo-scene-v1-infrastructure-manifest.md)
- [`docs/releases/photo-scene-v1-production-readiness.md`](docs/releases/photo-scene-v1-production-readiness.md)
- [`docs/releases/video-studio-v1-release-roadmap.md`](docs/releases/video-studio-v1-release-roadmap.md)

## Other Channels

- Video Studio development line: `worktrees/video-studio-v1-bounded`, branch `release/video-studio-v1-bounded`
- Authority review branch: `worktrees/sprint4-phase-b`, branch `release/sprint-4-phase-b`

Do not deploy full release HEAD. Do not deploy AUTH-01. Do not deploy AI Story, Publishing, Flux, or a second Creative Studio product. Do not modify Renderer V1. Do not mark Photo Scene RELEASED. Next authorized production action is EMBEROS-PHOTO-SCENE-V1-PROD-03 after this candidate is used.
