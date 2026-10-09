-- Sequential Manual Local Package V3 schema.
-- PHASE 1 ONLY: write/review this migration; DO NOT APPLY in this phase.
-- Historical package JSON and package_fingerprint values are never rewritten.
BEGIN;

/*
 * Freeze a proof-only classification before any historical UPDATE.
 *
 * Direct Remote proof is a scheduling correlation bound to the same Plan,
 * Runtime Authorization, and Workspace. Manual Local proof is a package bound
 * to that same tuple.
 *
 * One older failure window needs repository-certified historical proof:
 * before 417fa7106f8941744c1c6559816a6a000c9418c8 introduced Manual Local
 * (2026-10-01T03:44:36Z), canonical Execute could only initialize this exact
 * release ledger and then attempt Provider scheduling. Classification therefore
 * additionally requires the complete ordered Runtime Authorization ledger,
 * exact Scene/Plan/Workspace relations, zero Manual Local package lineage, and
 * the initial release actor to equal the Runtime Authorization actor. Time or
 * release-row shape alone is never sufficient.
 */
CREATE TEMP TABLE sequential_local_v3_release_classification
ON COMMIT DROP
AS
WITH plan_lineage AS (
  SELECT
    release.execution_plan_id,
    bool_or(EXISTS (
      SELECT 1
      FROM ai_story_scene_scheduling_correlations correlation
      WHERE correlation.execution_plan_id = release.execution_plan_id
        AND correlation.runtime_authorization_id = release.runtime_authorization_id
        AND correlation.workspace_id = release.workspace_id
    )) AS provider_plan_proven,
    bool_or(EXISTS (
      SELECT 1
      FROM ai_story_local_generation_packages package
      WHERE package.execution_plan_id = release.execution_plan_id
        AND package.runtime_authorization_id = release.runtime_authorization_id
        AND package.workspace_id = release.workspace_id
    )) AS manual_plan_proven,
    bool_and(
      release.created_at < timestamptz '2026-10-01T03:44:36Z'
    ) AS predates_manual_local_code,
    bool_and(
      scene.execution_plan_id = release.execution_plan_id
      AND scene.workspace_id = release.workspace_id
      AND scene.scene_order + 1 = release.scene_order
      AND "authorization".execution_plan_id = release.execution_plan_id
      AND "authorization".workspace_id = release.workspace_id
      AND "authorization".runtime_authorization_id = release.runtime_authorization_id
      AND "authorization".ordered_scene_execution_ids
        ->> (release.scene_order - 1) = release.scene_execution_id::text
    ) AS canonical_runtime_ledger,
    count(*) = max(
      jsonb_array_length("authorization".ordered_scene_execution_ids)
    ) AS complete_runtime_ledger,
    bool_or(
      release.scene_order = 1
      AND release.release_state = 'RELEASED'
      AND release.released_by = "authorization".authorized_by
      AND release.released_at IS NOT NULL
    ) AS canonical_initial_actor
  FROM ai_story_scene_release_states release
  JOIN ai_story_scene_executions scene
    ON scene.id = release.scene_execution_id
  JOIN ai_story_runtime_authorized_facts "authorization"
    ON "authorization".runtime_authorization_id = release.runtime_authorization_id
  GROUP BY release.execution_plan_id
)
SELECT
  release.scene_execution_id,
  release.execution_plan_id,
  CASE
    WHEN lineage.manual_plan_proven
      AND NOT (
        lineage.provider_plan_proven
        OR (
          lineage.predates_manual_local_code
          AND lineage.canonical_runtime_ledger
          AND lineage.complete_runtime_ledger
          AND lineage.canonical_initial_actor
        )
      )
      THEN 'MANUAL_LOCAL_PROVEN'
    WHEN NOT lineage.manual_plan_proven
      AND (
        lineage.provider_plan_proven
        OR (
          lineage.predates_manual_local_code
          AND lineage.canonical_runtime_ledger
          AND lineage.complete_runtime_ledger
          AND lineage.canonical_initial_actor
        )
      )
      THEN 'REMOTE_PROVIDER_PROVEN'
    ELSE 'UNKNOWN'
  END AS classification,
  CASE
    WHEN release.scene_order = 1 THEN 'INITIAL_UNIT'
    WHEN release.release_state = 'AUTHORIZED_NOT_RELEASED'
      THEN 'PREDECESSOR_PROVIDER_RESULT'
    ELSE 'PREDECESSOR_PROVIDER_RESULT'
  END AS gate_kind
FROM ai_story_scene_release_states release
JOIN plan_lineage lineage
  ON lineage.execution_plan_id = release.execution_plan_id;

DO $preflight$
DECLARE
  package_rows bigint;
  release_rows bigint;
  continuity_rows bigint;
  remote_release_rows bigint;
  manual_release_rows bigint;
  unknown_release_rows bigint;
  package_contract_checks integer;
  package_retry_uniques integer;
  release_state_checks integer;
  observed_release_states text;
  observed_package_contract_checks text;
  observed_package_retry_uniques text;
  observed_release_state_checks text;
BEGIN
  IF to_regclass('public.ai_story_local_generation_packages') IS NULL
    OR to_regclass('public.ai_story_scene_release_states') IS NULL
    OR to_regclass('public.ai_story_generation_result_continuity_frames') IS NULL THEN
    RAISE EXCEPTION 'SEQUENTIAL_LOCAL_V3_REQUIRED_TABLE_MISSING';
  END IF;

  SELECT count(*) INTO package_rows FROM ai_story_local_generation_packages;
  SELECT count(*) INTO release_rows FROM ai_story_scene_release_states;
  SELECT count(*) INTO continuity_rows FROM ai_story_generation_result_continuity_frames;
  SELECT string_agg(release_state || ':' || row_count, ',' ORDER BY release_state)
    INTO observed_release_states
  FROM (
    SELECT release_state, count(*)::text AS row_count
    FROM ai_story_scene_release_states
    GROUP BY release_state
  ) observed;

  RAISE NOTICE 'SEQUENTIAL_LOCAL_V3_PREFLIGHT package_rows=% release_rows=% continuity_rows=% release_states=%',
    package_rows, release_rows, continuity_rows, coalesce(observed_release_states, '<none>');

  IF EXISTS (
    SELECT 1 FROM ai_story_scene_release_states
    WHERE release_state NOT IN ('AUTHORIZED_NOT_RELEASED', 'RELEASED')
  ) THEN
    RAISE EXCEPTION 'SEQUENTIAL_LOCAL_V3_UNKNOWN_RELEASE_STATE';
  END IF;

  SELECT count(*) INTO remote_release_rows
  FROM sequential_local_v3_release_classification
  WHERE classification = 'REMOTE_PROVIDER_PROVEN';
  SELECT count(*) INTO manual_release_rows
  FROM sequential_local_v3_release_classification
  WHERE classification = 'MANUAL_LOCAL_PROVEN';
  SELECT count(*) INTO unknown_release_rows
  FROM sequential_local_v3_release_classification
  WHERE classification = 'UNKNOWN';

  RAISE NOTICE 'SEQUENTIAL_LOCAL_V3_RELEASE_CLASSIFICATION remote=% manual=% unknown=%',
    remote_release_rows, manual_release_rows, unknown_release_rows;

  -- This guard intentionally runs before every historical UPDATE below.
  IF unknown_release_rows <> 0 THEN
    RAISE EXCEPTION 'SEQUENTIAL_LOCAL_V3_UNCLASSIFIABLE_RELEASE_ROWS:%', unknown_release_rows;
  END IF;

  SELECT count(*) INTO package_contract_checks
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%contract_version%'
    AND pg_get_constraintdef(oid) ILIKE '%local-generation-package.v1%'
    AND pg_get_constraintdef(oid) ILIKE '%local-generation-package.v2%';
  IF package_contract_checks <> 1 THEN
    RAISE EXCEPTION 'SEQUENTIAL_LOCAL_V3_PACKAGE_CONTRACT_CHECK_COUNT:%', package_contract_checks;
  END IF;

  SELECT count(*) INTO package_retry_uniques
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%runtime_authorization_id%'
    AND pg_get_constraintdef(oid) ILIKE '%unit_id%'
    AND pg_get_constraintdef(oid) ILIKE '%retry_number%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%successor_number%';
  IF package_retry_uniques <> 1 THEN
    RAISE EXCEPTION 'SEQUENTIAL_LOCAL_V3_PACKAGE_RETRY_UNIQUE_COUNT:%', package_retry_uniques;
  END IF;

  SELECT count(*) INTO release_state_checks
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_scene_release_states'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%release_state%'
    AND pg_get_constraintdef(oid) ILIKE '%AUTHORIZED_NOT_RELEASED%'
    AND pg_get_constraintdef(oid) ILIKE '%RELEASED%';
  IF release_state_checks <> 1 THEN
    RAISE EXCEPTION 'SEQUENTIAL_LOCAL_V3_RELEASE_STATE_CHECK_COUNT:%', release_state_checks;
  END IF;

  SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), '; ' ORDER BY conname)
    INTO observed_package_contract_checks
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%contract_version%';
  SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), '; ' ORDER BY conname)
    INTO observed_package_retry_uniques
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%runtime_authorization_id%'
    AND pg_get_constraintdef(oid) ILIKE '%unit_id%'
    AND pg_get_constraintdef(oid) ILIKE '%retry_number%';
  SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), '; ' ORDER BY conname)
    INTO observed_release_state_checks
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_scene_release_states'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%release_state%';
  RAISE NOTICE 'SEQUENTIAL_LOCAL_V3_PREFLIGHT package_contract_checks=%',
    observed_package_contract_checks;
  RAISE NOTICE 'SEQUENTIAL_LOCAL_V3_PREFLIGHT package_retry_uniques=%',
    observed_package_retry_uniques;
  RAISE NOTICE 'SEQUENTIAL_LOCAL_V3_PREFLIGHT release_state_checks=%',
    observed_release_state_checks;
END
$preflight$;

ALTER TABLE ai_story_local_generation_packages
  ADD COLUMN successor_number integer NOT NULL DEFAULT 0 CHECK (successor_number >= 0),
  ADD COLUMN successor_of_package_id uuid
    REFERENCES ai_story_local_generation_packages(package_id) ON DELETE RESTRICT,
  ADD COLUMN release_authority_id uuid,
  ADD COLUMN release_authority_fingerprint text
    CHECK (
      release_authority_fingerprint IS NULL
      OR release_authority_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    );

DO $drop_package_constraints$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%runtime_authorization_id%'
    AND pg_get_constraintdef(oid) ILIKE '%unit_id%'
    AND pg_get_constraintdef(oid) ILIKE '%retry_number%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%successor_number%';
  EXECUTE format(
    'ALTER TABLE ai_story_local_generation_packages DROP CONSTRAINT %I',
    constraint_name
  );

  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_local_generation_packages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%contract_version%'
    AND pg_get_constraintdef(oid) ILIKE '%local-generation-package.v1%'
    AND pg_get_constraintdef(oid) ILIKE '%local-generation-package.v2%';
  EXECUTE format(
    'ALTER TABLE ai_story_local_generation_packages DROP CONSTRAINT %I',
    constraint_name
  );
END
$drop_package_constraints$;

ALTER TABLE ai_story_local_generation_packages
  ADD CONSTRAINT ai_story_local_generation_package_contract_version_v3_check
    CHECK (contract_version IN (
      'local-generation-package.v1',
      'local-generation-package.v2',
      'local-generation-package.v3'
    )),
  ADD CONSTRAINT ai_story_local_generation_unit_successor_retry_unique
    UNIQUE (runtime_authorization_id, unit_id, successor_number, retry_number),
  ADD CONSTRAINT ai_story_local_generation_v3_release_authority_check
    CHECK (
      contract_version <> 'local-generation-package.v3'
      OR (
        release_authority_id IS NOT NULL
        AND release_authority_fingerprint IS NOT NULL
      )
    );

ALTER TABLE ai_story_scene_release_states
  ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD COLUMN execution_mode text,
  ADD COLUMN gate_kind text,
  ADD COLUMN release_revision integer NOT NULL DEFAULT 0 CHECK (release_revision >= 0),
  ADD COLUMN release_authority_id uuid,
  ADD COLUMN release_authority_fingerprint text
    CHECK (
      release_authority_fingerprint IS NULL
      OR release_authority_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    ),
  ADD COLUMN predecessor_authority_fingerprint text
    CHECK (
      predecessor_authority_fingerprint IS NULL
      OR predecessor_authority_fingerprint ~ '^sha256:[0-9a-f]{64}$'
    ),
  ADD COLUMN gate_generation_result_id uuid
    REFERENCES ai_story_generation_results(generation_result_id) ON DELETE RESTRICT,
  ADD COLUMN gate_generation_result_decision_id uuid
    REFERENCES ai_story_generation_result_decisions(decision_id) ON DELETE RESTRICT,
  ADD COLUMN current_local_generation_package_id uuid
    REFERENCES ai_story_local_generation_packages(package_id) ON DELETE RESTRICT;

-- Ownership is independently and unambiguously derived from Workspace.
UPDATE ai_story_scene_release_states release
SET org_id = workspace.org_id
FROM workspaces workspace
WHERE workspace.id = release.workspace_id;

-- Mode is filled only from the proof table; ownership never implies mode.
UPDATE ai_story_scene_release_states release
SET execution_mode = CASE classification.classification
      WHEN 'REMOTE_PROVIDER_PROVEN' THEN 'REMOTE_PROVIDER'
      WHEN 'MANUAL_LOCAL_PROVEN' THEN 'MANUAL_LOCAL'
    END,
    gate_kind = classification.gate_kind
FROM sequential_local_v3_release_classification classification
WHERE classification.scene_execution_id = release.scene_execution_id
  AND classification.classification IN (
    'REMOTE_PROVIDER_PROVEN',
    'MANUAL_LOCAL_PROVEN'
  );

ALTER TABLE ai_story_scene_release_states
  ALTER COLUMN org_id SET NOT NULL,
  ALTER COLUMN execution_mode SET NOT NULL,
  ALTER COLUMN gate_kind SET NOT NULL;

DO $drop_release_state_check$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.ai_story_scene_release_states'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%release_state%'
    AND pg_get_constraintdef(oid) ILIKE '%AUTHORIZED_NOT_RELEASED%'
    AND pg_get_constraintdef(oid) ILIKE '%RELEASED%';
  EXECUTE format(
    'ALTER TABLE ai_story_scene_release_states DROP CONSTRAINT %I',
    constraint_name
  );
END
$drop_release_state_check$;

ALTER TABLE ai_story_scene_release_states
  ADD CONSTRAINT ai_story_scene_release_state_v2_check
    CHECK (release_state IN (
      'AUTHORIZED_NOT_RELEASED',
      'WAITING_FOR_PREDECESSOR',
      'RELEASED'
    )),
  ADD CONSTRAINT ai_story_scene_release_execution_mode_check
    CHECK (execution_mode IN ('REMOTE_PROVIDER', 'MANUAL_LOCAL')),
  ADD CONSTRAINT ai_story_scene_release_gate_kind_check
    CHECK (gate_kind IN (
      'INITIAL_UNIT',
      'PREDECESSOR_PROVIDER_RESULT',
      'PREDECESSOR_CONTINUITY'
    )),
  ADD CONSTRAINT ai_story_scene_release_manual_gate_shape_check
    CHECK (
      execution_mode <> 'MANUAL_LOCAL'
      OR release_state <> 'RELEASED'
      OR (
        gate_kind = 'INITIAL_UNIT'
        AND gate_generation_result_id IS NULL
        AND gate_generation_result_decision_id IS NULL
        AND predecessor_authority_fingerprint IS NULL
        AND release_authority_id IS NOT NULL
        AND release_authority_fingerprint IS NOT NULL
        AND current_local_generation_package_id IS NOT NULL
      )
      OR (
        gate_kind = 'PREDECESSOR_CONTINUITY'
        AND gate_generation_result_id IS NOT NULL
        AND gate_generation_result_decision_id IS NOT NULL
        AND predecessor_authority_fingerprint IS NOT NULL
        AND release_authority_id IS NOT NULL
        AND release_authority_fingerprint IS NOT NULL
        AND current_local_generation_package_id IS NOT NULL
        AND gate_provider_attempt_id IS NULL
      )
    );

CREATE UNIQUE INDEX ai_story_scene_release_authority_unique
  ON ai_story_scene_release_states(release_authority_id)
  WHERE release_authority_id IS NOT NULL;
CREATE INDEX ai_story_scene_release_pending_order_v2_idx
  ON ai_story_scene_release_states(
    workspace_id, execution_plan_id, release_state, scene_order
  );
CREATE INDEX ai_story_scene_release_generation_result_idx
  ON ai_story_scene_release_states(gate_generation_result_id)
  WHERE gate_generation_result_id IS NOT NULL;

/*
 * Existing frame rows remain untouched and honestly have no recorded
 * extraction-contract version. New V3-authorizing frames must provide tenant
 * ownership and a recognized extraction contract; no historical value is
 * fabricated.
 */
ALTER TABLE ai_story_generation_result_continuity_frames
  ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN extraction_contract_version text,
  ADD CONSTRAINT ai_story_continuity_frame_versioned_ownership_check
    CHECK (
      extraction_contract_version IS NULL
      OR (
        org_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND length(btrim(extraction_contract_version)) > 0
      )
    );

-- Intentionally absent in Phase 1:
-- - RELEASE_NEXT_UNIT job kind/worker
-- - release service or Manual Local adapter
-- - UI changes
-- - any UPDATE of historical package JSON/fingerprints

COMMIT;
