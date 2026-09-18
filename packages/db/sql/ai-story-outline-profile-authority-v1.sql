-- Adds nullable Story-owned Outline Profile authority without rewriting legacy Stories.
ALTER TABLE ai_stories
  ADD COLUMN IF NOT EXISTS outline_profile jsonb;
