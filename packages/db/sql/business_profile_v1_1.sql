-- SPEC-001 v1.1 patch migration (legacy → current shape)
-- Run: pnpm --filter @ceo-agent/db sql:business-profile-v1-1
--
-- Fresh installs that used business_profile.sql already have the final schema;
-- this patch is a no-op on that shape.
-- Legacy installs: migrates text `industry` / text `business_hours` when present.
-- Idempotent: safe to re-run.

-- Ensure industry_* columns exist (no-op if already present from business_profile.sql)
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry_id text;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry_display_name text;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry_custom_value text;

DO $$
BEGIN
  -- Legacy text `industry` → industry_* fields, then drop legacy column
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_profiles'
      AND column_name = 'industry'
  ) THEN
    EXECUTE $sql$
      UPDATE business_profiles
      SET
        industry_custom_value = COALESCE(NULLIF(industry_custom_value, ''), industry),
        industry_display_name = COALESCE(NULLIF(industry_display_name, ''), industry),
        industry_id = COALESCE(industry_id, 'custom')
      WHERE industry IS NOT NULL
        AND industry <> ''
    $sql$;
    ALTER TABLE business_profiles DROP COLUMN industry;
  END IF;
END $$;

DO $$
BEGIN
  -- Already on final jsonb `business_hours`: drop leftover staging column if any, then stop
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_profiles'
      AND column_name = 'business_hours'
      AND udt_name = 'jsonb'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'business_profiles'
        AND column_name = 'business_hours_json'
    ) THEN
      ALTER TABLE business_profiles DROP COLUMN business_hours_json;
    END IF;
    RETURN;
  END IF;

  -- Legacy text `business_hours` → jsonb via staging column
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_profiles'
      AND column_name = 'business_hours'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS business_hours_json jsonb NOT NULL DEFAULT '[]';
    UPDATE business_profiles
    SET business_hours_json = '[]'::jsonb
    WHERE business_hours_json IS NULL;
    ALTER TABLE business_profiles DROP COLUMN business_hours;
    ALTER TABLE business_profiles RENAME COLUMN business_hours_json TO business_hours;
    RETURN;
  END IF;

  -- Interrupted migrate: staging column exists, final name missing
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_profiles'
      AND column_name = 'business_hours_json'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_profiles'
      AND column_name = 'business_hours'
  ) THEN
    ALTER TABLE business_profiles RENAME COLUMN business_hours_json TO business_hours;
    RETURN;
  END IF;

  -- No business_hours column at all (unusual intermediate state)
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'business_profiles'
      AND column_name = 'business_hours'
  ) THEN
    ALTER TABLE business_profiles ADD COLUMN business_hours jsonb NOT NULL DEFAULT '[]';
  END IF;
END $$;
