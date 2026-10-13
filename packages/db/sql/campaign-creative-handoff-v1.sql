-- Campaign Unified Workflow Phase 3. Non-generating approved Plan handoff authority.
CREATE TABLE IF NOT EXISTS campaign_creative_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES campaign_content_iterations(id) ON DELETE CASCADE,
  approved_plan_id uuid NOT NULL REFERENCES campaign_marketing_plan_versions(id) ON DELETE RESTRICT,
  selected_module text NOT NULL CHECK (selected_module IN ('VIDEO_STUDIO','PHOTO_SCENE','AI_STORY')),
  asset_mode text NOT NULL CHECK (asset_mode IN ('ASSET_BASED','ZERO_ASSET')),
  asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_profile_snapshot_ref text NOT NULL,
  idempotency_key text NOT NULL,
  command_fingerprint text NOT NULL,
  destination_reference text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_creative_handoffs_iteration_unique UNIQUE(iteration_id),
  CONSTRAINT campaign_creative_handoffs_plan_module_unique UNIQUE(approved_plan_id,selected_module),
  CONSTRAINT campaign_creative_handoffs_idempotency_unique UNIQUE(iteration_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS campaign_creative_handoffs_scope_idx ON campaign_creative_handoffs(workspace_id,campaign_id,iteration_id);

CREATE OR REPLACE FUNCTION validate_campaign_creative_handoff_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE p_org uuid; p_workspace uuid; p_campaign uuid; p_iteration uuid; p_status text; p_module text;
BEGIN
  SELECT org_id,workspace_id,campaign_id,iteration_id,status,selected_module
    INTO p_org,p_workspace,p_campaign,p_iteration,p_status,p_module
  FROM campaign_marketing_plan_versions WHERE id=NEW.approved_plan_id;
  IF p_org IS NULL OR p_org<>NEW.org_id OR p_workspace<>NEW.workspace_id OR p_campaign<>NEW.campaign_id
     OR p_iteration<>NEW.iteration_id OR p_status<>'APPROVED' OR p_module<>NEW.selected_module THEN
    RAISE EXCEPTION 'CAMPAIGN_CREATIVE_HANDOFF_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_creative_handoff_scope_guard ON campaign_creative_handoffs;
CREATE TRIGGER campaign_creative_handoff_scope_guard BEFORE INSERT OR UPDATE ON campaign_creative_handoffs
FOR EACH ROW EXECUTE FUNCTION validate_campaign_creative_handoff_scope();

ALTER TABLE campaign_creative_handoffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_creative_handoffs_select ON campaign_creative_handoffs;
CREATE POLICY campaign_creative_handoffs_select ON campaign_creative_handoffs FOR SELECT TO authenticated
USING (workspace_id IN (SELECT campaign_iteration_user_workspace_ids()));
GRANT SELECT,INSERT,UPDATE,DELETE ON campaign_creative_handoffs TO authenticated;
