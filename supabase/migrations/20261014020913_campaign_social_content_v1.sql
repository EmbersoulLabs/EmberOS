CREATE TABLE IF NOT EXISTS campaign_social_content_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES campaign_content_iterations(id) ON DELETE CASCADE,
  marketing_review_id uuid NOT NULL REFERENCES campaign_marketing_reviews(id) ON DELETE RESTRICT,
  approved_plan_id uuid NOT NULL REFERENCES campaign_marketing_plan_versions(id) ON DELETE RESTRICT,
  creative_handoff_id uuid NOT NULL REFERENCES campaign_creative_handoffs(id) ON DELETE RESTRICT,
  artifact_identity text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('YOUTUBE','TIKTOK')),
  revision integer NOT NULL CHECK (revision>0),
  content jsonb NOT NULL,
  disclosure jsonb NOT NULL,
  generation_mode text NOT NULL DEFAULT 'MANUAL' CHECK (generation_mode IN ('MANUAL','AI')),
  max_ai_cost_usd numeric(12,6),
  actual_ai_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','READY_FOR_PUBLISHING')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  content_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  command_fingerprint text NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  approval_idempotency_key text,
  approval_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_social_content_revision_unique UNIQUE(marketing_review_id,platform,revision),
  CONSTRAINT campaign_social_content_idempotency_unique UNIQUE(iteration_id,idempotency_key),
  CONSTRAINT campaign_social_content_ai_cost_valid CHECK (actual_ai_cost_usd>=0 AND (max_ai_cost_usd IS NULL OR (max_ai_cost_usd>0 AND actual_ai_cost_usd<=max_ai_cost_usd)))
);
CREATE INDEX IF NOT EXISTS campaign_social_content_scope_idx ON campaign_social_content_drafts(workspace_id,campaign_id,iteration_id,platform);

CREATE OR REPLACE FUNCTION validate_campaign_social_content_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r campaign_marketing_reviews%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.org_id,NEW.workspace_id,NEW.campaign_id,NEW.iteration_id,NEW.marketing_review_id,
    NEW.approved_plan_id,NEW.creative_handoff_id,NEW.artifact_identity,NEW.platform,NEW.revision,NEW.content,
    NEW.disclosure,NEW.generation_mode,NEW.max_ai_cost_usd,NEW.actual_ai_cost_usd,NEW.content_fingerprint,
    NEW.idempotency_key,NEW.command_fingerprint,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.org_id,OLD.workspace_id,OLD.campaign_id,OLD.iteration_id,OLD.marketing_review_id,
    OLD.approved_plan_id,OLD.creative_handoff_id,OLD.artifact_identity,OLD.platform,OLD.revision,OLD.content,
    OLD.disclosure,OLD.generation_mode,OLD.max_ai_cost_usd,OLD.actual_ai_cost_usd,OLD.content_fingerprint,
    OLD.idempotency_key,OLD.command_fingerprint,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'CAMPAIGN_SOCIAL_CONTENT_IMMUTABLE_REVISION'; END IF;
  SELECT * INTO r FROM campaign_marketing_reviews WHERE id=NEW.marketing_review_id;
  IF r.id IS NULL OR r.status<>'APPROVED' OR
    (r.org_id,r.workspace_id,r.campaign_id,r.iteration_id,r.approved_plan_id,r.creative_handoff_id,r.artifact_identity)
    IS DISTINCT FROM
    (NEW.org_id,NEW.workspace_id,NEW.campaign_id,NEW.iteration_id,NEW.approved_plan_id,NEW.creative_handoff_id,NEW.artifact_identity)
    THEN RAISE EXCEPTION 'CAMPAIGN_SOCIAL_CONTENT_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_social_content_scope_guard ON campaign_social_content_drafts;
CREATE TRIGGER campaign_social_content_scope_guard BEFORE INSERT OR UPDATE ON campaign_social_content_drafts
FOR EACH ROW EXECUTE FUNCTION validate_campaign_social_content_scope();

ALTER TABLE campaign_social_content_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_social_content_select ON campaign_social_content_drafts;
CREATE POLICY campaign_social_content_select ON campaign_social_content_drafts FOR SELECT TO authenticated
USING (workspace_id IN (SELECT campaign_iteration_user_workspace_ids()));
GRANT SELECT,INSERT,UPDATE,DELETE ON campaign_social_content_drafts TO authenticated;
