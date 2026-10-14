-- Campaign Unified Workflow Phase 4. Actual artifact evidence and human review authority.
CREATE TABLE IF NOT EXISTS campaign_marketing_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES campaign_content_iterations(id) ON DELETE CASCADE,
  approved_plan_id uuid NOT NULL REFERENCES campaign_marketing_plan_versions(id) ON DELETE RESTRICT,
  creative_handoff_id uuid NOT NULL REFERENCES campaign_creative_handoffs(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision>0), creative_module text NOT NULL CHECK (creative_module IN ('VIDEO_STUDIO','PHOTO_SCENE','AI_STORY')),
  destination_reference text NOT NULL, artifact_type text NOT NULL CHECK (artifact_type IN ('VIDEO_CREATIVE','PHOTO_SCENE_GENERATION','AI_STORY_FINAL_RESULT')),
  artifact_id uuid NOT NULL, artifact_identity text NOT NULL, business_profile_snapshot_ref text NOT NULL,
  asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb, findings jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','APPROVED','CHANGES_REQUESTED')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0), create_idempotency_key text NOT NULL, create_fingerprint text NOT NULL,
  decided_by uuid, decided_at timestamptz, decision_note text, decision_idempotency_key text, decision_fingerprint text,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_marketing_reviews_handoff_revision_unique UNIQUE(creative_handoff_id,revision),
  CONSTRAINT campaign_marketing_reviews_artifact_unique UNIQUE(creative_handoff_id,artifact_identity),
  CONSTRAINT campaign_marketing_reviews_create_key_unique UNIQUE(iteration_id,create_idempotency_key)
);
CREATE INDEX IF NOT EXISTS campaign_marketing_reviews_scope_idx ON campaign_marketing_reviews(workspace_id,campaign_id,iteration_id);

CREATE OR REPLACE FUNCTION validate_campaign_marketing_review_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE h campaign_creative_handoffs%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.org_id,NEW.workspace_id,NEW.campaign_id,NEW.iteration_id,NEW.approved_plan_id,NEW.creative_handoff_id,
    NEW.revision,NEW.creative_module,NEW.destination_reference,NEW.artifact_type,NEW.artifact_id,NEW.artifact_identity,
    NEW.business_profile_snapshot_ref,NEW.asset_ids,NEW.findings,NEW.create_idempotency_key,NEW.create_fingerprint,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.org_id,OLD.workspace_id,OLD.campaign_id,OLD.iteration_id,OLD.approved_plan_id,OLD.creative_handoff_id,
    OLD.revision,OLD.creative_module,OLD.destination_reference,OLD.artifact_type,OLD.artifact_id,OLD.artifact_identity,
    OLD.business_profile_snapshot_ref,OLD.asset_ids,OLD.findings,OLD.create_idempotency_key,OLD.create_fingerprint,OLD.created_by,OLD.created_at)
    THEN RAISE EXCEPTION 'CAMPAIGN_MARKETING_REVIEW_IMMUTABLE_EVIDENCE'; END IF;
  SELECT * INTO h FROM campaign_creative_handoffs WHERE id=NEW.creative_handoff_id;
  IF h.id IS NULL OR (h.org_id,h.workspace_id,h.campaign_id,h.iteration_id,h.approved_plan_id,h.selected_module,h.destination_reference,
      h.business_profile_snapshot_ref,h.asset_ids) IS DISTINCT FROM
     (NEW.org_id,NEW.workspace_id,NEW.campaign_id,NEW.iteration_id,NEW.approved_plan_id,NEW.creative_module,NEW.destination_reference,
      NEW.business_profile_snapshot_ref,NEW.asset_ids)
     OR (NEW.creative_module='VIDEO_STUDIO' AND NEW.artifact_type<>'VIDEO_CREATIVE')
     OR (NEW.creative_module='PHOTO_SCENE' AND NEW.artifact_type<>'PHOTO_SCENE_GENERATION')
     OR (NEW.creative_module='AI_STORY' AND NEW.artifact_type<>'AI_STORY_FINAL_RESULT')
    THEN RAISE EXCEPTION 'CAMPAIGN_MARKETING_REVIEW_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_marketing_review_scope_guard ON campaign_marketing_reviews;
CREATE TRIGGER campaign_marketing_review_scope_guard BEFORE INSERT OR UPDATE ON campaign_marketing_reviews FOR EACH ROW EXECUTE FUNCTION validate_campaign_marketing_review_scope();
ALTER TABLE campaign_marketing_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_marketing_reviews_select ON campaign_marketing_reviews;
CREATE POLICY campaign_marketing_reviews_select ON campaign_marketing_reviews FOR SELECT TO authenticated
USING (workspace_id IN (SELECT campaign_iteration_user_workspace_ids()));
GRANT SELECT,INSERT,UPDATE,DELETE ON campaign_marketing_reviews TO authenticated;
