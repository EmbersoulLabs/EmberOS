-- Photo Scene 10B — photo_scene_generations execution identity.
-- Additive. No Video Studio task/creative changes. No production apply.

CREATE TABLE IF NOT EXISTS photo_scene_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  operation text NOT NULL DEFAULT 'product_extraction',
  status text NOT NULL DEFAULT 'queued',
  source_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  source_content_hash text NOT NULL,
  input_capsule jsonb NOT NULL,
  input_fingerprint text NOT NULL,
  output_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  provider_key text,
  attempt_count integer NOT NULL DEFAULT 0,
  error_code text,
  bounded_error text,
  cost_usd numeric,
  created_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photo_scene_generations_workspace_idx
  ON photo_scene_generations (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS photo_scene_generations_campaign_idx
  ON photo_scene_generations (campaign_id, created_at);

CREATE INDEX IF NOT EXISTS photo_scene_generations_reuse_idx
  ON photo_scene_generations (workspace_id, operation, input_fingerprint, status);

CREATE UNIQUE INDEX IF NOT EXISTS photo_scene_generations_inflight_fingerprint_idx
  ON photo_scene_generations (workspace_id, operation, input_fingerprint)
  WHERE status IN ('queued', 'processing');

ALTER TABLE photo_scene_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS photo_scene_generations_all ON photo_scene_generations;
CREATE POLICY photo_scene_generations_all ON photo_scene_generations
  FOR ALL USING (
    workspace_id IN (SELECT user_workspace_ids())
    AND campaign_id IN (SELECT id FROM campaigns WHERE workspace_id IN (SELECT user_workspace_ids()))
  );
