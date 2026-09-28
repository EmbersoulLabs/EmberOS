CREATE TABLE IF NOT EXISTS ai_story_script_semantic_proposals (
  proposal_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  contract_version text NOT NULL CONSTRAINT ai_story_script_semantic_proposal_contract_check CHECK (contract_version = 'ai-story-script-semantic-proposal.v1'),
  profile_id text NOT NULL CONSTRAINT ai_story_script_semantic_proposal_profile_check CHECK (profile_id IN ('PRODUCT_STORY', 'COMMERCIAL_STORY')),
  lifecycle_state text NOT NULL CONSTRAINT ai_story_script_semantic_proposal_lifecycle_check CHECK (lifecycle_state = 'AUTHORIZED'),
  proposal jsonb NOT NULL,
  content_hash text NOT NULL CONSTRAINT ai_story_script_semantic_proposal_hash_check CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  semantic_input_fingerprint text NOT NULL CONSTRAINT ai_story_script_semantic_proposal_fingerprint_check CHECK (semantic_input_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  originating_run_id text NOT NULL,
  grounding_lineage jsonb NOT NULL,
  authorized_by uuid NOT NULL,
  authorized_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_script_semantic_proposal_story_version_unique UNIQUE (story_id, story_version_id)
);

CREATE INDEX IF NOT EXISTS ai_story_script_semantic_proposal_workspace_idx
  ON ai_story_script_semantic_proposals (workspace_id, story_id, story_version_id);

ALTER TABLE ai_story_script_semantic_proposals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enforce_ai_story_script_semantic_proposal_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Authorized AI Story Script semantic proposal is immutable' USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS ai_story_script_semantic_proposal_immutable_v1 ON ai_story_script_semantic_proposals;
CREATE TRIGGER ai_story_script_semantic_proposal_immutable_v1
  BEFORE UPDATE ON ai_story_script_semantic_proposals
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_script_semantic_proposal_immutable_v1();

DROP POLICY IF EXISTS ai_story_script_semantic_proposal_select ON ai_story_script_semantic_proposals;
CREATE POLICY ai_story_script_semantic_proposal_select ON ai_story_script_semantic_proposals
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS ai_story_script_semantic_proposal_insert ON ai_story_script_semantic_proposals;
CREATE POLICY ai_story_script_semantic_proposal_insert ON ai_story_script_semantic_proposals
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'operator', 'editor', 'reviewer')
  ));

DROP POLICY IF EXISTS ai_story_script_semantic_proposal_update ON ai_story_script_semantic_proposals;
CREATE POLICY ai_story_script_semantic_proposal_update ON ai_story_script_semantic_proposals
  FOR UPDATE TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'operator', 'editor', 'reviewer')
  ))
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'operator', 'editor', 'reviewer')
  ));
