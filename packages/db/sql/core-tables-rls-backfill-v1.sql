-- Final-fix-v1 P0: RLS backfill for tables that predate the RLS convention
-- established in ai-story-canonical-rls-v1.sql, plus the Sprint-3 provider
-- ledger/outbox/dispatch/envelope tables that shipped without RLS.
--
-- Threat model: application code (Drizzle via the service-role connection)
-- bypasses RLS by design and enforces ownership independently in the API
-- layer — this migration guards the OTHER path: a holder of any
-- authenticated user's Supabase JWT querying Supabase's PostgREST REST API
-- directly, bypassing the Next.js API layer entirely.
--
-- Convention (matches ai-story-canonical-rls-v1.sql): these tables are
-- populated by service-role application/worker code, never by a direct
-- authenticated client write. So every policy here is SELECT-only; no
-- authenticated INSERT/UPDATE/DELETE policy is created. Service role /
-- DB owner bypasses RLS (infrastructure, not authorization).

CREATE OR REPLACE FUNCTION user_workspace_ids()
RETURNS SETOF uuid AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── ai_stories ──────────────────────────────────────────────────────────────
ALTER TABLE ai_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_stories_select ON ai_stories;
CREATE POLICY ai_stories_select ON ai_stories
  FOR SELECT
  USING (
    ai_stories.workspace_id IN (SELECT user_workspace_ids())
    AND ai_stories.org_id = (
      SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = ai_stories.workspace_id
    )
  );

-- ── ai_story_versions (no workspace_id column — join through ai_stories) ────
ALTER TABLE ai_story_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_versions_select ON ai_story_versions;
CREATE POLICY ai_story_versions_select ON ai_story_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_versions.story_id
        AND story.workspace_id IN (SELECT user_workspace_ids())
        AND story.org_id = (
          SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = story.workspace_id
        )
    )
  );

-- ── ai_story_asset_links (no workspace_id column — join through ai_stories) ─
ALTER TABLE ai_story_asset_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_asset_links_select ON ai_story_asset_links;
CREATE POLICY ai_story_asset_links_select ON ai_story_asset_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ai_stories story
      WHERE story.id = ai_story_asset_links.story_id
        AND story.workspace_id IN (SELECT user_workspace_ids())
        AND story.org_id = (
          SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = story.workspace_id
        )
    )
  );

-- ── ai_story_creative_contexts ───────────────────────────────────────────────
ALTER TABLE ai_story_creative_contexts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_creative_contexts_select ON ai_story_creative_contexts;
CREATE POLICY ai_story_creative_contexts_select ON ai_story_creative_contexts
  FOR SELECT
  USING (
    ai_story_creative_contexts.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_creative_contexts.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_creative_contexts.workspace_id
    )
  );

-- ── ai_story_animation_packages ──────────────────────────────────────────────
ALTER TABLE ai_story_animation_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_animation_packages_select ON ai_story_animation_packages;
CREATE POLICY ai_story_animation_packages_select ON ai_story_animation_packages
  FOR SELECT
  USING (
    ai_story_animation_packages.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_animation_packages.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_animation_packages.workspace_id
    )
  );

-- ── ai_story_execution_jobs ──────────────────────────────────────────────────
ALTER TABLE ai_story_execution_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_execution_jobs_select ON ai_story_execution_jobs;
CREATE POLICY ai_story_execution_jobs_select ON ai_story_execution_jobs
  FOR SELECT
  USING (
    ai_story_execution_jobs.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_execution_jobs.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_execution_jobs.workspace_id
    )
  );

-- ── ai_story_execution_outputs ───────────────────────────────────────────────
ALTER TABLE ai_story_execution_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_execution_outputs_select ON ai_story_execution_outputs;
CREATE POLICY ai_story_execution_outputs_select ON ai_story_execution_outputs
  FOR SELECT
  USING (
    ai_story_execution_outputs.workspace_id IN (SELECT user_workspace_ids())
    AND ai_story_execution_outputs.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = ai_story_execution_outputs.workspace_id
    )
  );

-- ── knowledge_entries (org_id/workspace_id nullable — tenant rows + global
--    rows coexist in one table). Global rows (workspace_id IS NULL) stay
--    readable to any authenticated user; tenant rows are workspace-scoped.
--    No authenticated write policy: this table is a curated/learned
--    reference set maintained by service-role application code. ────────────
ALTER TABLE knowledge_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_entries_select ON knowledge_entries;
CREATE POLICY knowledge_entries_select ON knowledge_entries
  FOR SELECT
  USING (
    knowledge_entries.workspace_id IS NULL
    OR knowledge_entries.workspace_id IN (SELECT user_workspace_ids())
  );

-- ── provider_executions ──────────────────────────────────────────────────────
ALTER TABLE provider_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_executions_select ON provider_executions;
CREATE POLICY provider_executions_select ON provider_executions
  FOR SELECT
  USING (
    provider_executions.workspace_id IN (SELECT user_workspace_ids())
    AND provider_executions.org_id = (
      SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = provider_executions.workspace_id
    )
  );

-- ── provider_attempts (no workspace_id — join through provider_executions) ──
ALTER TABLE provider_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_attempts_select ON provider_attempts;
CREATE POLICY provider_attempts_select ON provider_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM provider_executions execution
      WHERE execution.execution_id = provider_attempts.execution_id
        AND execution.workspace_id IN (SELECT user_workspace_ids())
        AND execution.org_id = (
          SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = execution.workspace_id
        )
    )
  );

-- ── provider_attempt_usage (join through provider_attempts → provider_executions) ─
ALTER TABLE provider_attempt_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_attempt_usage_select ON provider_attempt_usage;
CREATE POLICY provider_attempt_usage_select ON provider_attempt_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM provider_attempts attempt
      INNER JOIN provider_executions execution ON execution.execution_id = attempt.execution_id
      WHERE attempt.attempt_id = provider_attempt_usage.attempt_id
        AND execution.workspace_id IN (SELECT user_workspace_ids())
        AND execution.org_id = (
          SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = execution.workspace_id
        )
    )
  );

-- ── provider_attempt_costs (join through provider_attempts → provider_executions) ─
ALTER TABLE provider_attempt_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_attempt_costs_select ON provider_attempt_costs;
CREATE POLICY provider_attempt_costs_select ON provider_attempt_costs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM provider_attempts attempt
      INNER JOIN provider_executions execution ON execution.execution_id = attempt.execution_id
      WHERE attempt.attempt_id = provider_attempt_costs.attempt_id
        AND execution.workspace_id IN (SELECT user_workspace_ids())
        AND execution.org_id = (
          SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = execution.workspace_id
        )
    )
  );

-- ── provider_outbox_jobs (no workspace_id — join through provider_executions) ─
ALTER TABLE provider_outbox_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_outbox_jobs_select ON provider_outbox_jobs;
CREATE POLICY provider_outbox_jobs_select ON provider_outbox_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM provider_executions execution
      WHERE execution.execution_id = provider_outbox_jobs.execution_id
        AND execution.workspace_id IN (SELECT user_workspace_ids())
        AND execution.org_id = (
          SELECT workspaces.org_id FROM workspaces WHERE workspaces.id = execution.workspace_id
        )
    )
  );

-- ── provider_execution_envelopes ─────────────────────────────────────────────
ALTER TABLE provider_execution_envelopes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_execution_envelopes_select ON provider_execution_envelopes;
CREATE POLICY provider_execution_envelopes_select ON provider_execution_envelopes
  FOR SELECT
  USING (
    provider_execution_envelopes.workspace_id IN (SELECT user_workspace_ids())
    AND provider_execution_envelopes.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = provider_execution_envelopes.workspace_id
    )
  );

-- ── provider_execution_dispatches ────────────────────────────────────────────
ALTER TABLE provider_execution_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_execution_dispatches_select ON provider_execution_dispatches;
CREATE POLICY provider_execution_dispatches_select ON provider_execution_dispatches
  FOR SELECT
  USING (
    provider_execution_dispatches.workspace_id IN (SELECT user_workspace_ids())
    AND provider_execution_dispatches.org_id = (
      SELECT workspaces.org_id FROM workspaces
      WHERE workspaces.id = provider_execution_dispatches.workspace_id
    )
  );
