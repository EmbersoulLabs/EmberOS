-- Forward-only Episode intent authority. Historical rows stay NULL. Do not backfill from original_idea.
ALTER TABLE ai_stories ADD COLUMN IF NOT EXISTS episode_intent jsonb;
