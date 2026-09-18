-- ai-story-provider-create-response-diagnostic.v1
-- Append-only, secret-safe Provider create-response diagnostic evidence.
--
-- Captured before EmberOS normalization discards Provider-native detail, so a
-- terminal NOT_ACCEPTED outcome stays classifiable after the fact.
--
-- Never UPDATE/DELETE these rows. Historical attempts recorded before this
-- table existed legitimately have no row: absent evidence stays absent and is
-- never backfilled or fabricated.
--
-- Secret-safe by contract: no Authorization headers, API keys, bearer tokens,
-- cookies, signed URLs, signed query parameters or raw response bodies. Only a
-- SHA-256 of the response is retained.

CREATE TABLE IF NOT EXISTS ai_story_provider_create_response_diagnostics (
  diagnostic_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,

  -- Immutable binding. No FK on provider_attempt_id so evidence can be appended
  -- for attempts held in either the AI Story runtime or the Provider ledger.
  provider_attempt_id TEXT NOT NULL,
  compiled_request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,

  contract_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint_family TEXT NOT NULL,
  observation_kind TEXT NOT NULL,

  -- Provider-native evidence. NULL means NOT PERSISTED / UNKNOWN, never zero.
  http_status INTEGER,
  native_error_code TEXT,
  native_error_type TEXT,
  native_error_message TEXT,
  provider_trace_id TEXT,
  task_id TEXT,
  error_category TEXT NOT NULL,

  -- Transport-only evidence.
  transport_error_message TEXT,

  accepted BOOLEAN NOT NULL,
  retryable BOOLEAN NOT NULL,
  reconciliation_required BOOLEAN NOT NULL,

  response_hash TEXT NOT NULL,
  normalization_result TEXT NOT NULL,
  diagnostic_fingerprint TEXT NOT NULL,
  diagnostic JSONB NOT NULL,

  observed_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_story_provider_create_diagnostic_fingerprint_unique
    UNIQUE (diagnostic_fingerprint),

  CONSTRAINT ai_story_provider_create_diagnostic_kind_check
    CHECK (observation_kind IN ('PROVIDER_RESPONSE', 'TRANSPORT_FAILURE')),

  CONSTRAINT ai_story_provider_create_diagnostic_category_check
    CHECK (error_category IN (
      'AUTHENTICATION',
      'AUTHORIZATION',
      'MODEL_OR_ENDPOINT',
      'REQUEST_SCHEMA',
      'MEDIA',
      'CONTENT_POLICY',
      'RATE_LIMIT',
      'PROVIDER_QUOTA',
      'PROVIDER_INTERNAL',
      'UNKNOWN'
    )),

  -- Transport uncertainty must stay structurally distinct from a Provider
  -- rejection: it carries no HTTP status and can never be an acceptance.
  CONSTRAINT ai_story_provider_create_diagnostic_transport_check
    CHECK (
      (observation_kind = 'TRANSPORT_FAILURE'
        AND http_status IS NULL
        AND accepted = FALSE)
      OR
      (observation_kind = 'PROVIDER_RESPONSE'
        AND http_status IS NOT NULL
        AND transport_error_message IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS ai_story_provider_create_diagnostic_attempt_idx
  ON ai_story_provider_create_response_diagnostics (provider_attempt_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_provider_create_diagnostic_compiled_idx
  ON ai_story_provider_create_response_diagnostics (compiled_request_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_provider_create_diagnostic_workspace_idx
  ON ai_story_provider_create_response_diagnostics (workspace_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_provider_create_diagnostic_category_idx
  ON ai_story_provider_create_response_diagnostics (error_category, observed_at DESC);
