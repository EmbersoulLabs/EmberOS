-- Sprint 3 Phase 3 PR 3.3: freeze routerVersion on persisted Routing Decisions.
-- Additive/idempotent. Does not unlock execution.

ALTER TABLE ai_story_scene_routing_decisions
  ADD COLUMN IF NOT EXISTS router_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE ai_story_scene_routing_decisions
  DROP CONSTRAINT IF EXISTS ai_story_scene_routing_router_version_check;

ALTER TABLE ai_story_scene_routing_decisions
  ADD CONSTRAINT ai_story_scene_routing_router_version_check
  CHECK (router_version = 1);
