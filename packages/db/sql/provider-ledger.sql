CREATE TABLE IF NOT EXISTS provider_executions (
  execution_id text PRIMARY KEY,
  contract_version text NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid,
  pipeline_run_id text NOT NULL,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  deterministic_fingerprint text NOT NULL,
  request_hash text NOT NULL,
  output_schema_id text NOT NULL,
  output_schema_version text NOT NULL,
  status text NOT NULL,
  execution_metadata jsonb NOT NULL,
  accepted_attempt_id text,
  accepted_result jsonb,
  accepted_response_hash text,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS provider_executions_workspace_idx
  ON provider_executions (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS provider_executions_fingerprint_idx
  ON provider_executions (deterministic_fingerprint);

CREATE TABLE IF NOT EXISTS provider_attempts (
  attempt_id text PRIMARY KEY,
  execution_id text NOT NULL REFERENCES provider_executions(execution_id) ON DELETE RESTRICT,
  contract_version text NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 0),
  provider_id text NOT NULL,
  provider_version text NOT NULL,
  model_version text NOT NULL,
  provider_request_id text,
  request_hash text NOT NULL,
  response_hash text,
  status text NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  failure jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (execution_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS provider_attempts_execution_idx
  ON provider_attempts (execution_id, attempt_number);

CREATE TABLE IF NOT EXISTS provider_attempt_usage (
  attempt_id text PRIMARY KEY REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT,
  usage jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_attempt_costs (
  attempt_id text PRIMARY KEY REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT,
  cost jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
