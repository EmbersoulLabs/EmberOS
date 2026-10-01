BEGIN;

CREATE TABLE ai_story_local_generation_packages (
  package_id uuid PRIMARY KEY,
  package_fingerprint text NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  execution_plan_id uuid NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  runtime_authorization_id uuid NOT NULL REFERENCES ai_story_runtime_authorized_facts(runtime_authorization_id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  unit_order integer NOT NULL CHECK (unit_order > 0),
  retry_of_package_id uuid REFERENCES ai_story_local_generation_packages(package_id) ON DELETE RESTRICT,
  retry_number integer NOT NULL DEFAULT 0 CHECK (retry_number >= 0),
  contract_version text NOT NULL CHECK (contract_version = 'local-generation-package.v1'),
  package jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_local_generation_package_fingerprint_unique UNIQUE (workspace_id, package_fingerprint),
  CONSTRAINT ai_story_local_generation_unit_retry_unique UNIQUE (runtime_authorization_id, unit_id, retry_number)
);

CREATE INDEX ai_story_local_generation_plan_order_idx
  ON ai_story_local_generation_packages(execution_plan_id, unit_order);

CREATE TABLE ai_story_local_generation_outputs (
  output_id uuid PRIMARY KEY,
  package_id uuid NOT NULL REFERENCES ai_story_local_generation_packages(package_id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  media_type text NOT NULL CHECK (media_type = 'video/mp4'),
  duration_sec numeric NOT NULL CHECK (duration_sec > 0),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  qc_state text NOT NULL DEFAULT 'PENDING' CHECK (qc_state IN ('PENDING','PASS','LOCAL_REGENERATION_REQUIRED')),
  continuity_frame_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL,
  CONSTRAINT ai_story_local_generation_output_package_unique UNIQUE (package_id),
  CONSTRAINT ai_story_local_generation_output_asset_unique UNIQUE (asset_id)
);

CREATE INDEX ai_story_local_generation_output_unit_idx
  ON ai_story_local_generation_outputs(unit_id, uploaded_at);

ALTER TABLE ai_story_local_generation_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_local_generation_outputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_story_local_generation_packages, ai_story_local_generation_outputs FROM anon, authenticated;
GRANT SELECT ON ai_story_local_generation_packages, ai_story_local_generation_outputs TO authenticated;

CREATE POLICY ai_story_local_generation_packages_select
  ON ai_story_local_generation_packages FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
CREATE POLICY ai_story_local_generation_packages_insert
  ON ai_story_local_generation_packages FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

CREATE POLICY ai_story_local_generation_outputs_select
  ON ai_story_local_generation_outputs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ai_story_local_generation_packages package
    WHERE package.package_id = ai_story_local_generation_outputs.package_id
      AND package.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  ));
CREATE POLICY ai_story_local_generation_outputs_insert
  ON ai_story_local_generation_outputs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM ai_story_local_generation_packages package
    WHERE package.package_id = ai_story_local_generation_outputs.package_id
      AND package.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator'))
      AND package.unit_id = ai_story_local_generation_outputs.unit_id
      AND package.scene_execution_id = ai_story_local_generation_outputs.scene_execution_id
  ));

CREATE FUNCTION reject_ai_story_local_generation_package_mutation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LOCAL_GENERATION_PACKAGE_IMMUTABLE';
END;
$$;
CREATE TRIGGER ai_story_local_generation_package_immutable_update
BEFORE UPDATE ON ai_story_local_generation_packages
FOR EACH ROW EXECUTE FUNCTION reject_ai_story_local_generation_package_mutation_v1();
CREATE TRIGGER ai_story_local_generation_package_immutable_delete
BEFORE DELETE ON ai_story_local_generation_packages
FOR EACH ROW EXECUTE FUNCTION reject_ai_story_local_generation_package_mutation_v1();
CREATE TRIGGER ai_story_local_generation_output_immutable
BEFORE UPDATE OR DELETE ON ai_story_local_generation_outputs
FOR EACH ROW EXECUTE FUNCTION reject_ai_story_local_generation_package_mutation_v1();

COMMIT;
