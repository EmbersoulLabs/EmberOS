-- Sprint 0003 Campaign Workspace fields (SPEC-002 / UI-SPEC-002)

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS objective text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS objective_custom text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_audience_override text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS output_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS subtitle_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cta_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hashtag_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS generate_status text NOT NULL DEFAULT 'idle';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS generate_summary jsonb;

-- Asset reference migration has already backfilled historical campaign-owned Assets.
-- From this point forward, an empty reference set is an intentional empty selection.
UPDATE campaigns
SET metadata = coalesce(metadata, '{}'::jsonb)
  || '{"mediaReferencesAuthoritative":true}'::jsonb
WHERE coalesce((metadata->>'mediaReferencesAuthoritative')::boolean, false) = false;
