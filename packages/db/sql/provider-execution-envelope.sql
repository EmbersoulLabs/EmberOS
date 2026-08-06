CREATE TABLE IF NOT EXISTS provider_execution_envelopes (
  envelope_id text PRIMARY KEY,
  version text NOT NULL,
  payload_reference text NOT NULL UNIQUE,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  execution_context jsonb NOT NULL,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  provider_policy_snapshot jsonb NOT NULL,
  canonical_request jsonb NOT NULL,
  request_hash text NOT NULL,
  envelope_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_execution_envelopes_workspace_idx
  ON provider_execution_envelopes (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS provider_execution_envelopes_request_hash_idx
  ON provider_execution_envelopes (request_hash);
