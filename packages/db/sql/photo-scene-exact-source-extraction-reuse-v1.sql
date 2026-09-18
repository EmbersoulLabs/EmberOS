-- Photo Scene V1 exact-source extraction reuse authority.
-- Index-only migration: no generation, Asset, or historical lineage rows are rewritten.

BEGIN;

LOCK TABLE photo_scene_generations IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM photo_scene_generations
    WHERE status IN ('queued', 'processing')
    GROUP BY workspace_id, operation, source_asset_id, input_fingerprint
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing Photo Scene inflight exact-source authority is ambiguous'
      USING ERRCODE = '23505';
  END IF;
END $$;

DROP INDEX IF EXISTS photo_scene_generations_reuse_idx;
CREATE INDEX photo_scene_generations_reuse_idx
  ON photo_scene_generations (
    workspace_id,
    operation,
    source_asset_id,
    input_fingerprint,
    status
  );

DROP INDEX IF EXISTS photo_scene_generations_inflight_fingerprint_idx;
CREATE UNIQUE INDEX photo_scene_generations_inflight_fingerprint_idx
  ON photo_scene_generations (
    workspace_id,
    operation,
    source_asset_id,
    input_fingerprint
  )
  WHERE status IN ('queued', 'processing');

COMMIT;
