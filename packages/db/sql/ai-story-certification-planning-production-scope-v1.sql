BEGIN;

-- Widen only certification contracts needed by the final real episode.
-- Existing STAGING rows and their commercial counters are not updated.
-- The live STAGING predecessor uses PostgreSQL-generated plural names for two
-- checks; CI's predecessor used the singular Drizzle-owned names. Accept only
-- those exact names and an exact STAGING-only definition, then converge to the
-- Drizzle-owned names. Unexpected or duplicate environment checks roll back.
DO $$
DECLARE
  target record;
  relation_id regclass;
  qualified_table text;
  environment_attnum smallint;
  environment_check_count integer;
  predecessor_validated boolean;
  predecessor_name text;
  predecessor_definition text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('certification_commercial_scopes',
       ARRAY['certification_commercial_scope_environment_check', 'certification_commercial_scopes_environment_check'],
       'certification_commercial_scope_environment_check'),
      ('certification_submission_slot_reconciliations',
       ARRAY['certification_slot_reconciliation_environment_check', 'certification_submission_slot_reconciliations_environment_check'],
       'certification_slot_reconciliation_environment_check'),
      ('ai_story_post_terminal_provider_retry_authorizations',
       ARRAY['ai_story_post_terminal_retry_environment_check'],
       'ai_story_post_terminal_retry_environment_check')
    ) AS predecessors(table_name, accepted_names, canonical_name)
  LOOP
    relation_id := to_regclass(format('%I', target.table_name));
    IF relation_id IS NULL THEN
      RAISE EXCEPTION 'CERTIFICATION_ENVIRONMENT_PREDECESSOR_INVALID: missing table %', target.table_name;
    END IF;
    SELECT format('%I.%I', namespace.nspname, relation.relname)
      INTO qualified_table
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE relation.oid = relation_id;
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE', qualified_table);
    SELECT attnum INTO environment_attnum
      FROM pg_attribute
      WHERE attrelid = relation_id AND attname = 'environment' AND NOT attisdropped;
    IF environment_attnum IS NULL THEN
      RAISE EXCEPTION 'CERTIFICATION_ENVIRONMENT_PREDECESSOR_INVALID: missing environment column on %', target.table_name;
    END IF;

    SELECT count(*), bool_and(convalidated), min(conname::text),
           min(regexp_replace(pg_get_constraintdef(oid), '[[:space:]()]', '', 'g'))
      INTO environment_check_count, predecessor_validated, predecessor_name, predecessor_definition
      FROM pg_constraint
      WHERE conrelid = relation_id AND contype = 'c'
        AND (conkey @> ARRAY[environment_attnum]::smallint[]
             OR pg_get_constraintdef(oid) ~* '\menvironment\M');
    IF environment_check_count <> 1
       OR predecessor_validated IS DISTINCT FROM true
       OR NOT (predecessor_name = ANY(target.accepted_names))
       OR predecessor_definition NOT IN
            ('CHECKenvironment=''STAGING''', 'CHECKenvironment=''STAGING''::text') THEN
      RAISE EXCEPTION
        'CERTIFICATION_ENVIRONMENT_PREDECESSOR_INVALID: %, count %, name %, definition %',
        target.table_name, environment_check_count, predecessor_name, predecessor_definition;
    END IF;

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', qualified_table, predecessor_name);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I CHECK (environment IN (''STAGING'', ''PRODUCTION''))',
      qualified_table, target.canonical_name
    );
  END LOOP;
END $$;

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
