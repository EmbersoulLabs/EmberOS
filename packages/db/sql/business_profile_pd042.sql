-- PD-042: Default Publishing Platforms on Business Profile
-- Idempotent. Safe on fresh and existing databases.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS default_publishing_platforms text[] NOT NULL DEFAULT '{}';
