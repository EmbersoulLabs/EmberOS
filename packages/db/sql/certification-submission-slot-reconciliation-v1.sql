BEGIN;

CREATE TABLE IF NOT EXISTS certification_submission_slot_reconciliations (
  reconciliation_id uuid PRIMARY KEY,
  environment text NOT NULL CHECK (environment = 'STAGING'),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  certification_scope_id uuid NOT NULL REFERENCES certification_commercial_scopes(certification_scope_id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  dispatch_id text NOT NULL REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT,
  certification_reservation_id uuid NOT NULL REFERENCES certification_commercial_reservations(certification_reservation_id) ON DELETE RESTRICT,
  source_consumption_event_id uuid NOT NULL REFERENCES certification_commercial_events(certification_commercial_event_id) ON DELETE RESTRICT,
  outcome_classification text NOT NULL CHECK (outcome_classification = 'PROVEN_NOT_SUBMITTED'),
  reason text NOT NULL CHECK (reason = 'PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION'),
  actor_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  evidence jsonb NOT NULL,
  quota_before jsonb NOT NULL,
  quota_after jsonb NOT NULL,
  integrity_hash text NOT NULL CHECK (integrity_hash ~ '^sha256:[0-9a-f]{64}$'),
  contract_version text NOT NULL CHECK (contract_version = 'certification-submission-slot-reconciliation.v1'),
  created_at timestamptz NOT NULL,
  CONSTRAINT certification_slot_reconciliation_source_unique UNIQUE(source_consumption_event_id),
  CONSTRAINT certification_slot_reconciliation_idempotency_unique UNIQUE(idempotency_key),
  CONSTRAINT certification_slot_reconciliation_integrity_unique UNIQUE(integrity_hash)
);

CREATE INDEX IF NOT EXISTS certification_slot_reconciliation_scope_idx
  ON certification_submission_slot_reconciliations(certification_scope_id, created_at);
CREATE INDEX IF NOT EXISTS certification_slot_reconciliation_scene_idx
  ON certification_submission_slot_reconciliations(scene_execution_id, created_at);

ALTER TABLE certification_submission_slot_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certification_slot_reconciliation_select ON certification_submission_slot_reconciliations;
CREATE POLICY certification_slot_reconciliation_select
  ON certification_submission_slot_reconciliations FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS certification_slot_reconciliation_insert ON certification_submission_slot_reconciliations;
CREATE POLICY certification_slot_reconciliation_insert
  ON certification_submission_slot_reconciliations FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('admin','operator')
  ));

CREATE OR REPLACE FUNCTION enforce_certification_slot_reconciliation_immutable_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Certification submission-slot reconciliation authority is immutable'
    USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS certification_slot_reconciliation_immutable_v1
  ON certification_submission_slot_reconciliations;
CREATE TRIGGER certification_slot_reconciliation_immutable_v1
  BEFORE UPDATE OR DELETE ON certification_submission_slot_reconciliations
  FOR EACH ROW EXECUTE FUNCTION enforce_certification_slot_reconciliation_immutable_v1();

-- A reconciled non-submission permits a later reservation for the same logical
-- Attempt without rewriting or reopening the historical RELEASED reservation.
ALTER TABLE certification_commercial_reservations
  ADD COLUMN IF NOT EXISTS source_slot_reconciliation_id uuid
  REFERENCES certification_submission_slot_reconciliations(reconciliation_id) ON DELETE RESTRICT;

ALTER TABLE certification_commercial_reservations
  DROP CONSTRAINT IF EXISTS certification_reservation_execution_unique;
CREATE UNIQUE INDEX IF NOT EXISTS certification_reservation_initial_execution_unique
  ON certification_commercial_reservations(certification_scope_id, execution_identity)
  WHERE source_slot_reconciliation_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS certification_reservation_reconciliation_unique
  ON certification_commercial_reservations(source_slot_reconciliation_id)
  WHERE source_slot_reconciliation_id IS NOT NULL;

COMMIT;
