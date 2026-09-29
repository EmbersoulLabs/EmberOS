-- Additive confirmed product variant. Historical rows stay NULL. Do not backfill from prose.
ALTER TABLE ai_story_asset_links ADD COLUMN IF NOT EXISTS confirmed_variant text;
