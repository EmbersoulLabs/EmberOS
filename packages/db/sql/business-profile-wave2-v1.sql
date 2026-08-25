-- Wave 2: Blueprint Business Profile Default Publishing Platforms.
-- Additive, idempotent, and profile-ID preserving.
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS default_publishing_platforms text[] NOT NULL DEFAULT '{}';
