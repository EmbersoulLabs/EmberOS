-- Campaign creative brief fields (optional user input on upload)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_brief text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS voice_preset text DEFAULT 'auto';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS content_style text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_goal text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bgm_preference text DEFAULT 'auto';
