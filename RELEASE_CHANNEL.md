# Release Channel

Machine- and human-readable release channel map for EmberOS.

Governance version: **v2.2**

## Current Authority

- Worktree: `worktrees/ai-story-self-use-v1-bounded`
- Branch: `release/ai-story-self-use-v1-bounded`
- Production overlay revision: `36b5241636c6e6828cef82b8ae165e2eea71f42b`
- Frozen product pin under the overlay: `b447f539400f2765958c1c94add708a979c86604`
- Current release: Video Studio V1 RELEASED / FROZEN; Photo Scene V1 RELEASED / FROZEN
- `VIDEO_STUDIO_V1_RELEASED`: YES
- `PHOTO_SCENE_V1_RELEASED`: YES
- AI Story Self-Use V1: **DEPLOYED / AWAITING REAL EPISODE CERT**
- `AI_STORY_SELF_USE_V1_STATUS`: RELEASE_PENDING
- `AI_STORY_PUBLIC_COMMERCIAL_RELEASE`: NO

Production web: `emberos-iota.vercel.app` Vercel `dpl_4BgYwuJ4pE8bvkCDuiU3cSx3CEyk` @ `36b5241`

Production worker: Railway `@ceo-agent/worker` `5d775841-cbea-47a6-a2de-ef64fe014851` @ `36b5241`

Do not mark AI Story RELEASED / FROZEN until complete-episode certification PASSes. Access remains Super Admin + Agency only.

See also:

- [`docs/releases/photo-scene-v1-bounded-assembly.md`](docs/releases/photo-scene-v1-bounded-assembly.md)
- [`docs/releases/photo-scene-v1-migration-manifest.md`](docs/releases/photo-scene-v1-migration-manifest.md)
- [`docs/releases/photo-scene-v1-infrastructure-manifest.md`](docs/releases/photo-scene-v1-infrastructure-manifest.md)
- [`docs/releases/photo-scene-v1-production-readiness.md`](docs/releases/photo-scene-v1-production-readiness.md)
- [`docs/releases/video-studio-v1-release-roadmap.md`](docs/releases/video-studio-v1-release-roadmap.md)

## Other Channels

- Video Studio development line: `worktrees/video-studio-v1-bounded`, branch `release/video-studio-v1-bounded`
- Authority review branch: `worktrees/sprint4-phase-b`, branch `release/sprint-4-phase-b`

Do not deploy full release HEAD. Do not deploy AUTH-01. Do not deploy Publishing, Flux, or a second Creative Studio product. Do not modify Renderer V1. Do not mark AI Story RELEASED. Next authorized production action is `EMBEROS-AI-STORY-SELF-USE-PROD-CERT` from the real provider execution gate.
