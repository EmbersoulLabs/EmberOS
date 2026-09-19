BEGIN;

-- The original commercial scope CHECK compared the append-only gross counter
-- directly with the quota maximum. Once a proven non-submission has an
-- immutable reconciliation row, gross history may legitimately exceed the
-- effective quota. Keep local scalar sanity checks here and enforce the
-- ledger-aware invariant with a trigger below.
ALTER TABLE certification_commercial_scopes
  DROP CONSTRAINT IF EXISTS certification_commercial_scope_quota_check;

ALTER TABLE certification_commercial_scopes
  DROP CONSTRAINT IF EXISTS certification_commercial_scope_quota_local_sanity_check;
ALTER TABLE certification_commercial_scopes
  ADD CONSTRAINT certification_commercial_scope_quota_local_sanity_check CHECK (
    max_provider_submissions > 0
    AND consumed_provider_submissions >= 0
    AND reserved_provider_submissions >= 0
  );

CREATE OR REPLACE FUNCTION enforce_certification_commercial_effective_quota_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reconciled_non_submissions integer;
  effective_used integer;
BEGIN
  SELECT count(*)::integer
    INTO reconciled_non_submissions
    FROM certification_submission_slot_reconciliations reconciliation
   WHERE reconciliation.certification_scope_id = NEW.certification_scope_id;

  IF reconciled_non_submissions > NEW.consumed_provider_submissions THEN
    RAISE EXCEPTION 'Certification reconciliations exceed gross submission consumption'
      USING ERRCODE = '23514',
            CONSTRAINT = 'certification_commercial_scope_effective_quota_check';
  END IF;

  effective_used := NEW.consumed_provider_submissions
    - reconciled_non_submissions
    + NEW.reserved_provider_submissions;

  IF effective_used > NEW.max_provider_submissions THEN
    RAISE EXCEPTION 'Certification effective submission quota exceeded'
      USING ERRCODE = '23514',
            CONSTRAINT = 'certification_commercial_scope_effective_quota_check';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS certification_commercial_scope_effective_quota_v1
  ON certification_commercial_scopes;
CREATE TRIGGER certification_commercial_scope_effective_quota_v1
  BEFORE INSERT OR UPDATE OF max_provider_submissions,
    consumed_provider_submissions, reserved_provider_submissions
  ON certification_commercial_scopes
  FOR EACH ROW EXECUTE FUNCTION enforce_certification_commercial_effective_quota_v1();

-- Reconciliation writes take the same scope-row lock used by reservation
-- writes. This makes reservation/reconciliation races serializable at the
-- commercial-scope boundary and prevents a malformed extra credit.
CREATE OR REPLACE FUNCTION enforce_certification_slot_reconciliation_scope_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope_environment text;
  scope_org_id uuid;
  scope_workspace_id uuid;
  gross_consumed integer;
  existing_reconciliations integer;
BEGIN
  SELECT scope.environment, scope.org_id, scope.workspace_id,
         scope.consumed_provider_submissions
    INTO scope_environment, scope_org_id, scope_workspace_id, gross_consumed
    FROM certification_commercial_scopes scope
   WHERE scope.certification_scope_id = NEW.certification_scope_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Certification commercial scope not found for reconciliation'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.environment <> scope_environment
     OR NEW.org_id <> scope_org_id
     OR NEW.workspace_id <> scope_workspace_id THEN
    RAISE EXCEPTION 'Certification reconciliation scope identity mismatch'
      USING ERRCODE = '23514',
            CONSTRAINT = 'certification_slot_reconciliation_scope_identity_check';
  END IF;

  SELECT count(*)::integer
    INTO existing_reconciliations
    FROM certification_submission_slot_reconciliations reconciliation
   WHERE reconciliation.certification_scope_id = NEW.certification_scope_id;

  IF existing_reconciliations + 1 > gross_consumed THEN
    RAISE EXCEPTION 'Certification reconciliations exceed gross submission consumption'
      USING ERRCODE = '23514',
            CONSTRAINT = 'certification_slot_reconciliation_gross_check';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS certification_slot_reconciliation_scope_v1
  ON certification_submission_slot_reconciliations;
CREATE TRIGGER certification_slot_reconciliation_scope_v1
  BEFORE INSERT ON certification_submission_slot_reconciliations
  FOR EACH ROW EXECUTE FUNCTION enforce_certification_slot_reconciliation_scope_v1();

-- Refuse to certify a database that was already outside the effective model.
-- This validates pre-existing rows because newly-created triggers only protect
-- subsequent writes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM certification_commercial_scopes scope
    LEFT JOIN certification_submission_slot_reconciliations reconciliation
      ON reconciliation.certification_scope_id = scope.certification_scope_id
    GROUP BY scope.certification_scope_id
    HAVING count(reconciliation.reconciliation_id) > scope.consumed_provider_submissions
       OR scope.consumed_provider_submissions
            - count(reconciliation.reconciliation_id)
            + scope.reserved_provider_submissions
          > scope.max_provider_submissions
  ) THEN
    RAISE EXCEPTION 'Existing certification commercial quota authority is inconsistent'
      USING ERRCODE = '23514',
            CONSTRAINT = 'certification_commercial_scope_effective_quota_check';
  END IF;
END $$;

COMMIT;
