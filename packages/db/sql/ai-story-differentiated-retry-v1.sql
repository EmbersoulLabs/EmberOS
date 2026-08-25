-- Additive human creative retry authorities. Provider truth is never rewritten.
ALTER TABLE ai_story_generated_scene_reviews
  DROP CONSTRAINT IF EXISTS ai_story_generated_scene_reviews_decision_check;
ALTER TABLE ai_story_generated_scene_reviews
  ADD CONSTRAINT ai_story_generated_scene_reviews_decision_check
  CHECK (decision IN ('PENDING_REVIEW','APPROVED','REJECTED','RETRY_REQUESTED','REJECTED_TERMINAL'));

CREATE TABLE IF NOT EXISTS ai_story_scene_retry_eligibility_facts (
  retry_eligibility_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  source_review_id UUID NOT NULL REFERENCES ai_story_generated_scene_reviews(generated_scene_review_id) ON DELETE RESTRICT,
  source_attempt_id TEXT NOT NULL,
  eligibility TEXT NOT NULL CHECK (eligibility IN ('ELIGIBLE','INELIGIBLE_MAX_ATTEMPTS','INELIGIBLE_TERMINAL_POLICY','INELIGIBLE_AUTHORITY_CONFLICT')),
  next_attempt_number INTEGER,
  reason TEXT NOT NULL CHECK (reason IN ('INSUFFICIENT_SCENE_DIFFERENTIATION','PRODUCT_IDENTITY_DRIFT','COMPOSITION_UNACCEPTABLE','CAMERA_MOTION_UNACCEPTABLE','VISUAL_QUALITY_UNACCEPTABLE','CONTINUITY_UNACCEPTABLE','OTHER_CREATIVE_REASON')),
  canonical_fingerprint TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL,
  contract_version TEXT NOT NULL,
  fact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_retry_eligibility_review_unique UNIQUE(source_review_id),
  CONSTRAINT ai_story_scene_retry_eligibility_hash_unique UNIQUE(canonical_fingerprint)
);
CREATE INDEX IF NOT EXISTS ai_story_scene_retry_eligibility_scene_idx ON ai_story_scene_retry_eligibility_facts(scene_execution_id,created_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_retry_eligibility_workspace_idx ON ai_story_scene_retry_eligibility_facts(workspace_id,created_at);

CREATE TABLE IF NOT EXISTS ai_story_scene_attempt_input_revisions (
  retry_input_revision_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number BETWEEN 1 AND 3),
  parent_revision_id UUID REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT,
  source_attempt_id TEXT NOT NULL,
  source_review_id UUID NOT NULL REFERENCES ai_story_generated_scene_reviews(generated_scene_review_id) ON DELETE RESTRICT,
  retry_reason TEXT NOT NULL CHECK (retry_reason IN ('INSUFFICIENT_SCENE_DIFFERENTIATION','PRODUCT_IDENTITY_DRIFT','COMPOSITION_UNACCEPTABLE','CAMERA_MOTION_UNACCEPTABLE','VISUAL_QUALITY_UNACCEPTABLE','CONTINUITY_UNACCEPTABLE','OTHER_CREATIVE_REASON')),
  creative_direction JSONB NOT NULL,
  product_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  product_authority_hash TEXT NOT NULL,
  visual_authority_certification_hash TEXT NOT NULL,
  provider_mode_requirement TEXT NOT NULL CHECK (provider_mode_requirement='FIRST_FRAME_I2V'),
  canonical_fingerprint TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  contract_version TEXT NOT NULL,
  fact JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_attempt_input_revision_number_unique UNIQUE(scene_execution_id,revision_number),
  CONSTRAINT ai_story_scene_attempt_input_revision_hash_unique UNIQUE(canonical_fingerprint)
);
CREATE INDEX IF NOT EXISTS ai_story_scene_attempt_input_revision_workspace_idx ON ai_story_scene_attempt_input_revisions(workspace_id,accepted_at);

CREATE OR REPLACE FUNCTION reject_ai_story_attempt_input_revision_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI_STORY_ATTEMPT_INPUT_REVISION_IMMUTABLE';
END $$;
DROP TRIGGER IF EXISTS ai_story_attempt_input_revision_immutable ON ai_story_scene_attempt_input_revisions;
CREATE TRIGGER ai_story_attempt_input_revision_immutable
  BEFORE UPDATE ON ai_story_scene_attempt_input_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_ai_story_attempt_input_revision_mutation();

CREATE TABLE IF NOT EXISTS ai_story_scene_retry_authorizations (
  retry_authorization_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  source_review_id UUID NOT NULL REFERENCES ai_story_generated_scene_reviews(generated_scene_review_id) ON DELETE RESTRICT,
  source_attempt_id TEXT NOT NULL,
  authorized_attempt_number INTEGER NOT NULL CHECK (authorized_attempt_number BETWEEN 2 AND 3),
  authorized_by UUID NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('INSUFFICIENT_SCENE_DIFFERENTIATION','PRODUCT_IDENTITY_DRIFT','COMPOSITION_UNACCEPTABLE','CAMERA_MOTION_UNACCEPTABLE','VISUAL_QUALITY_UNACCEPTABLE','CONTINUITY_UNACCEPTABLE','OTHER_CREATIVE_REASON')),
  retry_input_revision_id UUID NOT NULL REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT,
  retry_input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('AUTHORIZED','CONSUMED')),
  canonical_fingerprint TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  fact JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_retry_authorization_attempt_unique UNIQUE(scene_execution_id,authorized_attempt_number),
  CONSTRAINT ai_story_scene_retry_authorization_revision_unique UNIQUE(retry_input_revision_id),
  CONSTRAINT ai_story_scene_retry_authorization_hash_unique UNIQUE(canonical_fingerprint)
);
CREATE INDEX IF NOT EXISTS ai_story_scene_retry_authorization_workspace_idx ON ai_story_scene_retry_authorizations(workspace_id,created_at);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_scene_retry_eligibility_value_v1') THEN
    ALTER TABLE ai_story_scene_retry_eligibility_facts ADD CONSTRAINT ai_story_scene_retry_eligibility_value_v1
      CHECK (eligibility IN ('ELIGIBLE','INELIGIBLE_MAX_ATTEMPTS','INELIGIBLE_TERMINAL_POLICY','INELIGIBLE_AUTHORITY_CONFLICT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_scene_retry_eligibility_attempt_v1') THEN
    ALTER TABLE ai_story_scene_retry_eligibility_facts ADD CONSTRAINT ai_story_scene_retry_eligibility_attempt_v1
      CHECK ((eligibility = 'ELIGIBLE' AND next_attempt_number BETWEEN 2 AND 3) OR (eligibility <> 'ELIGIBLE' AND next_attempt_number IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_scene_retry_revision_number_v1') THEN
    ALTER TABLE ai_story_scene_attempt_input_revisions ADD CONSTRAINT ai_story_scene_retry_revision_number_v1
      CHECK (revision_number BETWEEN 1 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_scene_retry_revision_mode_v1') THEN
    ALTER TABLE ai_story_scene_attempt_input_revisions ADD CONSTRAINT ai_story_scene_retry_revision_mode_v1
      CHECK (provider_mode_requirement = 'FIRST_FRAME_I2V');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_scene_retry_revision_parent_v1') THEN
    ALTER TABLE ai_story_scene_attempt_input_revisions ADD CONSTRAINT ai_story_scene_retry_revision_parent_v1
      FOREIGN KEY (parent_revision_id) REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_scene_retry_authorization_attempt_v1') THEN
    ALTER TABLE ai_story_scene_retry_authorizations ADD CONSTRAINT ai_story_scene_retry_authorization_attempt_v1
      CHECK (authorized_attempt_number BETWEEN 2 AND 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_scene_retry_authorization_status_v1') THEN
    ALTER TABLE ai_story_scene_retry_authorizations ADD CONSTRAINT ai_story_scene_retry_authorization_status_v1
      CHECK (status IN ('AUTHORIZED','CONSUMED'));
  END IF;
END $$;

ALTER TABLE ai_story_scene_scheduling_correlations ADD COLUMN IF NOT EXISTS retry_input_revision_id UUID;
DO $$ BEGIN
  ALTER TABLE ai_story_scene_scheduling_correlations
    ADD CONSTRAINT ai_story_scene_scheduling_retry_input_revision_fk
    FOREIGN KEY (retry_input_revision_id) REFERENCES ai_story_scene_attempt_input_revisions(retry_input_revision_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE ai_story_scene_retry_eligibility_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_scene_attempt_input_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_scene_retry_authorizations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS ai_story_scene_retry_eligibility_service_role ON ai_story_scene_retry_eligibility_facts;
    CREATE POLICY ai_story_scene_retry_eligibility_service_role ON ai_story_scene_retry_eligibility_facts FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS ai_story_scene_attempt_input_revision_service_role ON ai_story_scene_attempt_input_revisions;
    CREATE POLICY ai_story_scene_attempt_input_revision_service_role ON ai_story_scene_attempt_input_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS ai_story_scene_retry_authorization_service_role ON ai_story_scene_retry_authorizations;
    CREATE POLICY ai_story_scene_retry_authorization_service_role ON ai_story_scene_retry_authorizations FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
