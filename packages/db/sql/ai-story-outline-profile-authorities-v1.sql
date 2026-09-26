-- Converge canonical Outline/Script persistence with the certified profile registry.
-- Existing authority rows are preserved; only the stale CORE-only checks change.

ALTER TABLE public.ai_story_outline_versions
  DROP CONSTRAINT IF EXISTS ai_story_outline_profile_id_check;

ALTER TABLE public.ai_story_outline_versions
  ADD CONSTRAINT ai_story_outline_profile_id_check
  CHECK (profile_id IN ('CORE', 'PRODUCT_STORY', 'COMMERCIAL_STORY'));

ALTER TABLE public.ai_story_script_versions
  DROP CONSTRAINT IF EXISTS ai_story_script_profile_check;

ALTER TABLE public.ai_story_script_versions
  ADD CONSTRAINT ai_story_script_profile_check
  CHECK (profile_id IN ('CORE', 'PRODUCT_STORY', 'COMMERCIAL_STORY'));

