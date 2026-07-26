CREATE TABLE IF NOT EXISTS provider_outbox_jobs (
  job_id text PRIMARY KEY,
  contract_version text NOT NULL,
  execution_id text NOT NULL UNIQUE
    REFERENCES provider_executions(execution_id) ON DELETE RESTRICT,
  payload_reference text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  priority integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_visible_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  retry_delay_ms integer CHECK (retry_delay_ms IS NULL OR retry_delay_ms >= 0),
  retry_classification text,
  last_error_category text,
  dead_letter_reason text,
  dead_letter_at timestamptz,
  operator_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'CLAIMED' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'CLAIMED' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    status <> 'DEAD_LETTER'
    OR (dead_letter_reason IS NOT NULL AND dead_letter_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS provider_outbox_jobs_claim_idx
  ON provider_outbox_jobs (status, next_visible_at, priority);
CREATE INDEX IF NOT EXISTS provider_outbox_jobs_lease_idx
  ON provider_outbox_jobs (status, lease_expires_at);
