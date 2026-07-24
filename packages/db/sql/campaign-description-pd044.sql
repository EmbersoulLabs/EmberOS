-- PD-044: remove campaigns.description (Campaign Description)
--
-- Data preservation (before DROP):
--   IF campaign_brief is empty AND legacy description is non-empty
--     THEN campaign_brief = legacy description
--   IF campaign_brief already has content
--     THEN keep campaign_brief; discard description on DROP
--
-- Idempotent: safe when description column is already absent.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_brief text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'campaigns'
      AND column_name = 'description'
  ) THEN
    UPDATE campaigns
    SET campaign_brief = description
    WHERE (campaign_brief IS NULL OR btrim(campaign_brief) = '')
      AND description IS NOT NULL
      AND btrim(description) <> '';
  END IF;
END $$;

ALTER TABLE campaigns DROP COLUMN IF EXISTS description;
