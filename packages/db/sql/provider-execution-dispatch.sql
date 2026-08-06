CREATE TABLE IF NOT EXISTS provider_execution_dispatches (
  dispatch_id text PRIMARY KEY,
  version text NOT NULL,
  job_id text NOT NULL UNIQUE
    REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT,
  execution_id text NOT NULL
    REFERENCES provider_executions(execution_id) ON DELETE RESTRICT,
  envelope_id text NOT NULL
    REFERENCES provider_execution_envelopes(envelope_id) ON DELETE RESTRICT,
  payload_reference text NOT NULL,
  correlation_id text NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  capability_id text NOT NULL,
  capability_version text NOT NULL,
  request_hash text NOT NULL,
  envelope_hash text NOT NULL,
  worker_handoff jsonb NOT NULL,
  dispatch_hash text NOT NULL,
  status text NOT NULL CHECK (status = 'DISPATCHED'),
  created_at timestamptz NOT NULL
);

ALTER TABLE provider_execution_dispatches
  ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE provider_execution_dispatches
  ADD COLUMN IF NOT EXISTS worker_handoff jsonb;

UPDATE provider_execution_dispatches dispatch
SET correlation_id = job.correlation_id
FROM provider_outbox_jobs job
WHERE dispatch.job_id = job.job_id
  AND dispatch.correlation_id IS NULL;

UPDATE provider_execution_dispatches
SET worker_handoff = jsonb_build_object(
  'envelopeId', envelope_id,
  'payloadReference', payload_reference,
  'dispatchContractVersion', version
)
WHERE worker_handoff IS NULL;

ALTER TABLE provider_execution_dispatches
  ALTER COLUMN correlation_id SET NOT NULL;
ALTER TABLE provider_execution_dispatches
  ALTER COLUMN worker_handoff SET NOT NULL;

CREATE INDEX IF NOT EXISTS provider_execution_dispatches_execution_idx
  ON provider_execution_dispatches (execution_id);
CREATE INDEX IF NOT EXISTS provider_execution_dispatches_workspace_idx
  ON provider_execution_dispatches (workspace_id, created_at);
