-- Character DNA analysis jobs are server-internal durable workflow state.
-- Browser clients reach this authority only through authenticated server routes.
-- Keep the public-schema table fail-closed at the Data API boundary.

ALTER TABLE public.ai_story_character_dna_analysis_jobs
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.ai_story_character_dna_analysis_jobs
  FROM anon, authenticated;
