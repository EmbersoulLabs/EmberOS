-- SPEC-001 v1.1 patch migration
-- Run: pnpm --filter @ceo-agent/db sql:business-profile-v1-1

ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry_id text;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry_display_name text;
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS industry_custom_value text;

ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS business_hours_json jsonb NOT NULL DEFAULT '[]';

-- Migrate legacy industry text into custom industry fields
UPDATE business_profiles
SET
  industry_custom_value = industry,
  industry_display_name = industry,
  industry_id = 'custom'
WHERE industry IS NOT NULL
  AND industry <> ''
  AND (industry_custom_value IS NULL OR industry_custom_value = '');

-- Migrate legacy text business_hours into jsonb column when present
UPDATE business_profiles
SET business_hours_json = '[]'::jsonb
WHERE business_hours_json IS NULL;

-- Drop legacy columns after migration (safe if new code uses jsonb + industry_* columns)
ALTER TABLE business_profiles DROP COLUMN IF EXISTS industry;
ALTER TABLE business_profiles DROP COLUMN IF EXISTS business_hours;

ALTER TABLE business_profiles RENAME COLUMN business_hours_json TO business_hours;
