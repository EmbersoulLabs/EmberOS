-- Additive immutable Character Voice DNA authorities.
-- Currentness is explicit supersession, not newest created_at.
-- This file does not alter Sequential Local V3 tables.

CREATE TABLE IF NOT EXISTS ai_story_character_voice_dna_authorities (
  voice_dna_id uuid PRIMARY KEY,
  org_id uuid NOT NULL CONSTRAINT as_voice_dna_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_voice_dna_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  reusable_character_id uuid NOT NULL CONSTRAINT as_voice_dna_root_fk REFERENCES ai_story_reusable_characters(reusable_character_id) ON DELETE RESTRICT,
  reusable_character_version_id uuid NOT NULL CONSTRAINT as_voice_dna_ver_fk REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) ON DELETE RESTRICT,
  character_identity_fingerprint text NOT NULL CHECK (character_identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  voice_dna_fingerprint text NOT NULL CHECK (voice_dna_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  contract_version text NOT NULL CHECK (contract_version = 'ai-story-character-voice-dna.v1'),
  status text NOT NULL CHECK (status IN ('APPROVED','FROZEN')),
  supersedes_voice_dna_id uuid CONSTRAINT as_voice_dna_supersede_fk REFERENCES ai_story_character_voice_dna_authorities(voice_dna_id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_character_voice_dna_version_fingerprint_unique UNIQUE (reusable_character_version_id, voice_dna_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_character_voice_dna_scope_idx
  ON ai_story_character_voice_dna_authorities (org_id, workspace_id);
CREATE INDEX IF NOT EXISTS ai_story_character_voice_dna_version_idx
  ON ai_story_character_voice_dna_authorities (workspace_id, reusable_character_id, reusable_character_version_id);

CREATE OR REPLACE FUNCTION protect_ai_story_character_voice_dna_authority_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story Character Voice DNA authorities are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS ai_story_character_voice_dna_immutable_v1 ON ai_story_character_voice_dna_authorities;
CREATE TRIGGER ai_story_character_voice_dna_immutable_v1
  BEFORE UPDATE ON ai_story_character_voice_dna_authorities
  FOR EACH ROW EXECUTE FUNCTION protect_ai_story_character_voice_dna_authority_v1();

ALTER TABLE ai_story_character_voice_dna_authorities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_character_voice_dna_select ON ai_story_character_voice_dna_authorities;
CREATE POLICY ai_story_character_voice_dna_select ON ai_story_character_voice_dna_authorities
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS ai_story_character_voice_dna_insert ON ai_story_character_voice_dna_authorities;
CREATE POLICY ai_story_character_voice_dna_insert ON ai_story_character_voice_dna_authorities
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

REVOKE UPDATE, DELETE ON ai_story_character_voice_dna_authorities FROM authenticated;
