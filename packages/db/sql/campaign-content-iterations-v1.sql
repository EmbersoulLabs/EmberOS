-- Campaign Unified Workflow Phase 1. Additive coordination foundation only.
-- Existing Campaign and Creative Module rows remain independently usable.

CREATE TABLE IF NOT EXISTS campaign_content_iterations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  state text NOT NULL DEFAULT 'PLANNING' CHECK (state IN (
    'PLANNING','PLAN_APPROVED','CREATIVE_IN_PROGRESS','MARKETING_REVIEW',
    'REVISION_REQUIRED','REWORK_REQUIRED','APPROVED','SOCIAL_CONTENT_READY',
    'PUBLISHED','NEXT_RECOMMENDED','COMPLETED','CANCELLED'
  )),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  creation_idempotency_key text NOT NULL,
  creation_fingerprint text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_content_iterations_campaign_sequence_unique UNIQUE (campaign_id, sequence_number),
  CONSTRAINT campaign_content_iterations_creation_idempotency_unique UNIQUE (workspace_id, campaign_id, creation_idempotency_key)
);

CREATE INDEX IF NOT EXISTS campaign_content_iterations_scope_state_idx
  ON campaign_content_iterations (workspace_id, campaign_id, state);

CREATE TABLE IF NOT EXISTS campaign_workflow_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  iteration_id uuid NOT NULL REFERENCES campaign_content_iterations(id) ON DELETE CASCADE,
  fact_type text NOT NULL CHECK (fact_type IN (
    'ITERATION_CREATED','STATE_TRANSITIONED','PLAN_PROPOSED','PLAN_APPROVED',
    'MODULE_SELECTED','ARTIFACT_ATTACHED','MARKETING_REVIEW_DECIDED',
    'SOCIAL_CONTENT_PREPARED','PUBLICATION_CONFIRMED','NEXT_CONTENT_RECOMMENDED',
    'NEXT_CONTENT_APPROVED'
  )),
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  from_state text,
  to_state text,
  iteration_version integer NOT NULL CHECK (iteration_version > 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  command_fingerprint text NOT NULL,
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_workflow_facts_idempotency_unique UNIQUE (iteration_id, idempotency_key),
  CONSTRAINT campaign_workflow_facts_sequence_unique UNIQUE (iteration_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS campaign_workflow_facts_history_idx
  ON campaign_workflow_facts (iteration_id, created_at);

CREATE OR REPLACE FUNCTION validate_campaign_workflow_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_org uuid; parent_workspace uuid; parent_campaign uuid;
BEGIN
  IF TG_TABLE_NAME = 'campaign_content_iterations' THEN
    SELECT org_id, workspace_id INTO parent_org, parent_workspace FROM campaigns WHERE id = NEW.campaign_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id OR parent_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'CAMPAIGN_ITERATION_SCOPE_MISMATCH';
    END IF;
  ELSE
    SELECT org_id, workspace_id, campaign_id INTO parent_org, parent_workspace, parent_campaign
      FROM campaign_content_iterations WHERE id = NEW.iteration_id;
    IF parent_org IS NULL OR parent_org <> NEW.org_id OR parent_workspace <> NEW.workspace_id OR parent_campaign <> NEW.campaign_id THEN
      RAISE EXCEPTION 'CAMPAIGN_WORKFLOW_FACT_SCOPE_MISMATCH';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS campaign_content_iterations_scope_guard ON campaign_content_iterations;
CREATE TRIGGER campaign_content_iterations_scope_guard BEFORE INSERT OR UPDATE ON campaign_content_iterations
FOR EACH ROW EXECUTE FUNCTION validate_campaign_workflow_scope();
DROP TRIGGER IF EXISTS campaign_workflow_facts_scope_guard ON campaign_workflow_facts;
CREATE TRIGGER campaign_workflow_facts_scope_guard BEFORE INSERT ON campaign_workflow_facts
FOR EACH ROW EXECUTE FUNCTION validate_campaign_workflow_scope();

ALTER TABLE campaign_content_iterations ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_workflow_facts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION campaign_iteration_user_workspace_ids()
RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()
$$;
REVOKE ALL ON FUNCTION campaign_iteration_user_workspace_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION campaign_iteration_user_workspace_ids() TO authenticated;

DROP POLICY IF EXISTS campaign_content_iterations_select ON campaign_content_iterations;
CREATE POLICY campaign_content_iterations_select ON campaign_content_iterations FOR SELECT TO authenticated
USING (workspace_id IN (SELECT campaign_iteration_user_workspace_ids()));
-- Mutations are server-only. Repository commands re-resolve Campaign membership and role.
-- Authenticated clients intentionally receive no INSERT/UPDATE/DELETE policy.

DROP POLICY IF EXISTS campaign_workflow_facts_select ON campaign_workflow_facts;
CREATE POLICY campaign_workflow_facts_select ON campaign_workflow_facts FOR SELECT TO authenticated
USING (workspace_id IN (SELECT campaign_iteration_user_workspace_ids()));
-- Facts are append-only through the server repository. Authenticated clients receive no
-- write policy, and the repository exposes no update/delete command.

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_content_iterations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_workflow_facts TO authenticated;
