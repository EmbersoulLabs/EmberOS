-- Additive repair: one Character Virtualizer job may consume 0 or 1 real image Provider call.
-- Staging already applied the mock-only CHECK (real_image_provider_calls = 0).
-- Resolve that obsolete CHECK from pg_constraint rather than assuming its generated name.

DO $$
DECLARE
  obsolete text;
BEGIN
  IF to_regclass('public.ai_story_character_virtualization_jobs') IS NULL THEN
    RETURN;
  END IF;

  FOR obsolete IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'ai_story_character_virtualization_jobs'
      AND c.contype = 'c'
      AND c.conname <> 'as_cvj_real_image_calls_chk'
      AND pg_get_constraintdef(c.oid) ~* 'real_image_provider_calls\s*=\s*0'
      AND pg_get_constraintdef(c.oid) !~* 'real_image_provider_calls\s*(>=|BETWEEN)'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.ai_story_character_virtualization_jobs DROP CONSTRAINT %I',
      obsolete
    );
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.ai_story_character_virtualization_jobs
  DROP CONSTRAINT IF EXISTS as_cvj_real_image_calls_chk;

ALTER TABLE IF EXISTS public.ai_story_character_virtualization_jobs
  ADD CONSTRAINT as_cvj_real_image_calls_chk
  CHECK (real_image_provider_calls >= 0 AND real_image_provider_calls <= 1);
