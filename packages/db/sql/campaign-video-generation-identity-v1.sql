-- VS-RC-01A.3B -- immutable Campaign video generation identity for new tasks.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS generation_input_capsule JSONB,
  ADD COLUMN IF NOT EXISTS generation_input_fingerprint TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_generation_input_pair_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_generation_input_pair_check CHECK (
      (generation_input_capsule IS NULL AND generation_input_fingerprint IS NULL)
      OR (generation_input_capsule IS NOT NULL AND generation_input_fingerprint IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_generation_input_fingerprint_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_generation_input_fingerprint_check CHECK (
      generation_input_fingerprint IS NULL
      OR generation_input_fingerprint ~ '^sha256:[a-f0-9]{64}$'
    );
  END IF;
END $$;
