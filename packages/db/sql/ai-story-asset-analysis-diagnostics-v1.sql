ALTER TABLE asset_analysis_attempts
  ADD COLUMN IF NOT EXISTS failure_stage text,
  ADD COLUMN IF NOT EXISTS outcome_certainty text,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS provider_model_id text,
  ADD COLUMN IF NOT EXISTS provider_usage jsonb;

UPDATE asset_analysis_attempts
SET failure_stage = CASE WHEN status = 'FAILED' THEN 'PROVIDER_REQUEST' ELSE NULL END,
    outcome_certainty = 'DEFINITE'
WHERE outcome_certainty IS NULL;

ALTER TABLE asset_analysis_attempts
  DROP CONSTRAINT IF EXISTS asset_analysis_attempt_outcome_check;

ALTER TABLE asset_analysis_attempts
  DROP CONSTRAINT IF EXISTS asset_analysis_attempts_status_check;

ALTER TABLE asset_analysis_attempts
  DROP CONSTRAINT IF EXISTS asset_analysis_attempt_status_check;

ALTER TABLE asset_analysis_attempts
  ADD CONSTRAINT asset_analysis_attempt_status_check
  CHECK (status IN ('SUCCEEDED', 'FAILED', 'UNKNOWN'));

ALTER TABLE asset_analysis_attempts
  ADD CONSTRAINT asset_analysis_attempt_outcome_check CHECK (
    (
      status = 'SUCCEEDED'
      AND snapshot_id IS NOT NULL
      AND error_code IS NULL
      AND outcome_certainty = 'DEFINITE'
    )
    OR (
      status IN ('FAILED', 'UNKNOWN')
      AND snapshot_id IS NULL
      AND error_code IS NOT NULL
      AND failure_stage IS NOT NULL
      AND outcome_certainty IN ('DEFINITE', 'UNKNOWN')
    )
  );

ALTER TABLE asset_analysis_attempts
  DROP CONSTRAINT IF EXISTS asset_analysis_attempt_provider_usage_object_check;

ALTER TABLE asset_analysis_attempts
  ADD CONSTRAINT asset_analysis_attempt_provider_usage_object_check
  CHECK (provider_usage IS NULL OR jsonb_typeof(provider_usage) = 'object');

CREATE INDEX IF NOT EXISTS asset_analysis_attempt_unknown_idx
  ON asset_analysis_attempts (
    workspace_id,
    content_hash,
    analyzer_version,
    schema_version,
    completed_at
  )
  WHERE status = 'UNKNOWN';

