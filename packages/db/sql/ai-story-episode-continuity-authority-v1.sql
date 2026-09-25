BEGIN;

CREATE TABLE ai_story_episode_continuity_authorities (
  continuity_authority_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  from_episode_id uuid NOT NULL,
  from_episode_version integer NOT NULL,
  from_episode_order integer NOT NULL,
  from_story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  to_episode_id uuid NOT NULL,
  to_episode_version integer,
  to_episode_order integer NOT NULL,
  source_final_story_result_id uuid NOT NULL REFERENCES ai_story_final_story_results(final_story_result_id) ON DELETE RESTRICT,
  version integer NOT NULL,
  contract_version text NOT NULL,
  fingerprint text NOT NULL,
  authority jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  frozen_at timestamptz NOT NULL,
  CONSTRAINT ai_story_episode_continuity_adjacent_check CHECK (to_episode_order = from_episode_order + 1),
  CONSTRAINT ai_story_episode_continuity_version_check CHECK (version > 0 AND from_episode_version > 0),
  CONSTRAINT ai_story_episode_continuity_contract_check CHECK (contract_version = 'ai-story-episode-continuity-authority.v1'),
  CONSTRAINT ai_story_episode_continuity_identity_unique UNIQUE (
    organization_id, workspace_id, campaign_id, story_id,
    from_episode_id, from_episode_version, to_episode_id, version
  ),
  CONSTRAINT ai_story_episode_continuity_fingerprint_unique UNIQUE (workspace_id, fingerprint)
);

CREATE INDEX ai_story_episode_continuity_destination_idx
  ON ai_story_episode_continuity_authorities (
    organization_id, workspace_id, campaign_id, story_id, to_episode_id, to_episode_order
  );

ALTER TABLE ai_story_episode_continuity_authorities ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_story_episode_continuity_select
  ON ai_story_episode_continuity_authorities
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_episode_continuity_authorities.story_id
        AND story.org_id = ai_story_episode_continuity_authorities.organization_id
        AND story.workspace_id = ai_story_episode_continuity_authorities.workspace_id
        AND story.campaign_id = ai_story_episode_continuity_authorities.campaign_id
    )
  );

CREATE POLICY ai_story_episode_continuity_insert
  ON ai_story_episode_continuity_authorities
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'operator')
    )
    AND EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_episode_continuity_authorities.story_id
        AND story.org_id = ai_story_episode_continuity_authorities.organization_id
        AND story.workspace_id = ai_story_episode_continuity_authorities.workspace_id
        AND story.campaign_id = ai_story_episode_continuity_authorities.campaign_id
    )
  );

CREATE FUNCTION reject_ai_story_episode_continuity_mutation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EPISODE_CONTINUITY_AUTHORITY_IMMUTABLE';
END;
$$;

CREATE TRIGGER ai_story_episode_continuity_immutable_update
BEFORE UPDATE ON ai_story_episode_continuity_authorities
FOR EACH ROW EXECUTE FUNCTION reject_ai_story_episode_continuity_mutation_v1();

CREATE TRIGGER ai_story_episode_continuity_immutable_delete
BEFORE DELETE ON ai_story_episode_continuity_authorities
FOR EACH ROW EXECUTE FUNCTION reject_ai_story_episode_continuity_mutation_v1();

COMMIT;
