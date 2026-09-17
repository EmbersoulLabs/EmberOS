BEGIN;

-- Widen only certification contracts needed by the final real episode.
-- Existing STAGING rows and their commercial counters are not updated.
ALTER TABLE certification_commercial_scopes
  DROP CONSTRAINT certification_commercial_scope_environment_check;
ALTER TABLE certification_commercial_scopes
  ADD CONSTRAINT certification_commercial_scope_environment_check
  CHECK (environment IN ('STAGING', 'PRODUCTION'));

ALTER TABLE certification_submission_slot_reconciliations
  DROP CONSTRAINT certification_slot_reconciliation_environment_check;
ALTER TABLE certification_submission_slot_reconciliations
  ADD CONSTRAINT certification_slot_reconciliation_environment_check
  CHECK (environment IN ('STAGING', 'PRODUCTION'));

ALTER TABLE ai_story_post_terminal_provider_retry_authorizations
  DROP CONSTRAINT ai_story_post_terminal_retry_environment_check;
ALTER TABLE ai_story_post_terminal_provider_retry_authorizations
  ADD CONSTRAINT ai_story_post_terminal_retry_environment_check
  CHECK (environment IN ('STAGING', 'PRODUCTION'));

CREATE TABLE certification_planning_authorities (
  planning_authority_id uuid PRIMARY KEY,
  environment text NOT NULL,
  certification_run_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid REFERENCES ai_stories(id) ON DELETE RESTRICT,
  model text NOT NULL,
  max_planning_cost_usd numeric(12,2) NOT NULL,
  spent_planning_cost_usd numeric(12,2) NOT NULL DEFAULT 0,
  reserved_planning_cost_usd numeric(12,2) NOT NULL DEFAULT 0,
  max_logical_calls integer NOT NULL,
  consumed_logical_calls integer NOT NULL DEFAULT 0,
  reserved_logical_calls integer NOT NULL DEFAULT 0,
  max_transport_attempts integer NOT NULL,
  status text NOT NULL,
  authorized_by uuid NOT NULL,
  authorization_reason text NOT NULL,
  authorized_at timestamptz NOT NULL,
  closed_at timestamptz,
  revoked_at timestamptz,
  integrity_hash text NOT NULL,
  contract_version text NOT NULL,
  CONSTRAINT certification_planning_run_environment_unique UNIQUE(environment, certification_run_id),
  CONSTRAINT certification_planning_environment_check CHECK (environment IN ('STAGING', 'PRODUCTION')),
  CONSTRAINT certification_planning_model_check CHECK (model = 'gpt-4o-mini-2024-07-18'),
  CONSTRAINT certification_planning_status_check CHECK (status IN ('ACTIVE','CLOSED','REVOKED')),
  CONSTRAINT certification_planning_limits_check CHECK (max_planning_cost_usd > 0 AND max_logical_calls > 0 AND max_transport_attempts > 0),
  CONSTRAINT certification_planning_counters_check CHECK (
    spent_planning_cost_usd >= 0 AND reserved_planning_cost_usd >= 0
    AND consumed_logical_calls >= 0 AND reserved_logical_calls >= 0
    AND spent_planning_cost_usd + reserved_planning_cost_usd <= max_planning_cost_usd
    AND consumed_logical_calls + reserved_logical_calls <= max_logical_calls
  )
);

CREATE TABLE certification_planning_claims (
  planning_claim_id uuid PRIMARY KEY,
  planning_authority_id uuid NOT NULL REFERENCES certification_planning_authorities(planning_authority_id) ON DELETE RESTRICT,
  logical_call_identity text NOT NULL,
  requested_by uuid NOT NULL,
  provider_attempt_id text,
  stage text NOT NULL,
  model text NOT NULL,
  max_output_tokens integer NOT NULL,
  projected_input_tokens integer NOT NULL,
  reserved_maximum_usd numeric(12,2) NOT NULL,
  actual_input_tokens integer,
  actual_output_tokens integer,
  actual_cost_usd numeric(12,2),
  provider_request_id text,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  integrity_hash text NOT NULL,
  contract_version text NOT NULL,
  CONSTRAINT certification_planning_logical_call_unique UNIQUE(planning_authority_id, logical_call_identity),
  CONSTRAINT certification_planning_claim_status_check CHECK (status IN ('RESERVED','SETTLED','FAILED','RELEASED')),
  CONSTRAINT certification_planning_claim_limits_check CHECK (max_output_tokens > 0 AND projected_input_tokens > 0 AND reserved_maximum_usd > 0)
);
CREATE INDEX certification_planning_claims_authority_status_idx
  ON certification_planning_claims(planning_authority_id, status);
CREATE UNIQUE INDEX certification_planning_provider_attempt_unique
  ON certification_planning_claims(provider_attempt_id) WHERE provider_attempt_id IS NOT NULL;

ALTER TABLE certification_planning_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_planning_claims ENABLE ROW LEVEL SECURITY;

COMMIT;
