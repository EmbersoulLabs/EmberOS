-- Sprint 3 PR 3.6 — additive RLS for Assembly Runtime artifacts + job facts.
-- Authenticated clients: SELECT within workspace membership only.
-- No authenticated INSERT / UPDATE / DELETE on immutable assembly facts or artifacts.
-- Service role / DB owner bypasses RLS for infrastructure writes.

ALTER TABLE ai_story_assembly_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_assembly_job_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_assembly_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_assembly_jobs_select ON ai_story_assembly_jobs;
DROP POLICY IF EXISTS ai_story_assembly_jobs_insert ON ai_story_assembly_jobs;
DROP POLICY IF EXISTS ai_story_assembly_jobs_update ON ai_story_assembly_jobs;
DROP POLICY IF EXISTS ai_story_assembly_jobs_delete ON ai_story_assembly_jobs;

CREATE POLICY ai_story_assembly_jobs_select ON ai_story_assembly_jobs
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));

DROP POLICY IF EXISTS ai_story_assembly_job_facts_select ON ai_story_assembly_job_facts;
DROP POLICY IF EXISTS ai_story_assembly_job_facts_insert ON ai_story_assembly_job_facts;
DROP POLICY IF EXISTS ai_story_assembly_job_facts_update ON ai_story_assembly_job_facts;
DROP POLICY IF EXISTS ai_story_assembly_job_facts_delete ON ai_story_assembly_job_facts;

CREATE POLICY ai_story_assembly_job_facts_select ON ai_story_assembly_job_facts
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));

DROP POLICY IF EXISTS ai_story_assembly_artifacts_select ON ai_story_assembly_artifacts;
DROP POLICY IF EXISTS ai_story_assembly_artifacts_insert ON ai_story_assembly_artifacts;
DROP POLICY IF EXISTS ai_story_assembly_artifacts_update ON ai_story_assembly_artifacts;
DROP POLICY IF EXISTS ai_story_assembly_artifacts_delete ON ai_story_assembly_artifacts;

CREATE POLICY ai_story_assembly_artifacts_select ON ai_story_assembly_artifacts
  FOR SELECT
  USING (workspace_id IN (SELECT user_workspace_ids()));
