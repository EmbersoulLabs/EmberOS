-- VS-RC-01A.2C -- canonical byte identity for source Assets.
-- Legacy rows remain NULL until safely finalized from actual storage bytes.

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'assets_content_hash_format_check'
  ) THEN
    ALTER TABLE assets
      ADD CONSTRAINT assets_content_hash_format_check
      CHECK (
        content_hash IS NULL
        OR content_hash ~ '^sha256:[a-f0-9]{64}$'
      );
  END IF;
END $$;
