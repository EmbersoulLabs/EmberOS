-- Campaign Unified Workflow Phase 2. Immutable pre-production Marketing Plan revisions.
CREATE TABLE IF NOT EXISTS campaign_marketing_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES campaign_content_iterations(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  content jsonb NOT NULL,
  content_fingerprint text NOT NULL,
  business_profile_version integer NOT NULL CHECK (business_profile_version > 0),
  business_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED')),
  selected_module text CHECK (selected_module IS NULL OR selected_module IN ('VIDEO_STUDIO','PHOTO_SCENE','AI_STORY')),
  created_by uuid NOT NULL,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CONSTRAINT campaign_marketing_plan_versions_revision_unique UNIQUE (iteration_id, revision),
  CONSTRAINT campaign_marketing_plan_versions_fingerprint_unique UNIQUE (iteration_id, content_fingerprint)
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_marketing_plan_versions_one_approved_idx
  ON campaign_marketing_plan_versions(iteration_id) WHERE status='APPROVED';
CREATE INDEX IF NOT EXISTS campaign_marketing_plan_versions_scope_idx
  ON campaign_marketing_plan_versions(workspace_id,campaign_id,iteration_id);

CREATE OR REPLACE FUNCTION validate_campaign_marketing_plan_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i_org uuid; i_workspace uuid; i_campaign uuid;
BEGIN
  SELECT org_id,workspace_id,campaign_id INTO i_org,i_workspace,i_campaign
  FROM campaign_content_iterations WHERE id=NEW.iteration_id;
  IF i_org IS NULL OR i_org<>NEW.org_id OR i_workspace<>NEW.workspace_id OR i_campaign<>NEW.campaign_id THEN
    RAISE EXCEPTION 'CAMPAIGN_MARKETING_PLAN_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_marketing_plan_scope_guard ON campaign_marketing_plan_versions;
CREATE TRIGGER campaign_marketing_plan_scope_guard BEFORE INSERT OR UPDATE ON campaign_marketing_plan_versions
FOR EACH ROW EXECUTE FUNCTION validate_campaign_marketing_plan_scope();

ALTER TABLE campaign_marketing_plan_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS campaign_marketing_plan_versions_select ON campaign_marketing_plan_versions;
CREATE POLICY campaign_marketing_plan_versions_select ON campaign_marketing_plan_versions FOR SELECT TO authenticated
USING (workspace_id IN (SELECT campaign_iteration_user_workspace_ids()));
GRANT SELECT,INSERT,UPDATE,DELETE ON campaign_marketing_plan_versions TO authenticated;
