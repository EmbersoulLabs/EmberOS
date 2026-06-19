-- EmberOS Marketing OS schema (Phase 1)
-- Run in Supabase SQL editor or: pnpm --filter @ceo-agent/db push

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS industry text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS strategy_json jsonb;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS objectives text[] DEFAULT '{}';

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS strategy_json jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS hooks_json jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS marketing_score_json jsonb;

ALTER TABLE creatives ADD COLUMN IF NOT EXISTS marketing_score_json jsonb;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS selected_hook_id text;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS publish_status text DEFAULT 'none';

CREATE TABLE IF NOT EXISTS marketing_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  creative_id uuid REFERENCES creatives(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  overall_score numeric(5,2),
  hook_score numeric(5,2),
  visual_score numeric(5,2),
  copy_score numeric(5,2),
  cta_score numeric(5,2),
  platform_fit_score numeric(5,2),
  improvements jsonb DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_scores_creative_idx ON marketing_scores(creative_id);

CREATE TABLE IF NOT EXISTS knowledge_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  workspace_id uuid,
  industry text NOT NULL,
  category text NOT NULL,
  hook_type text,
  locale text DEFAULT 'zh-CN',
  title text,
  content jsonb NOT NULL,
  performance_score numeric(5,2),
  usage_count int DEFAULT 0,
  is_active int DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_entries_industry_idx ON knowledge_entries(industry, category);

CREATE TABLE IF NOT EXISTS content_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  creative_id uuid NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  publish_job_id uuid REFERENCES publish_jobs(id),
  platform text NOT NULL,
  metric_date timestamptz NOT NULL,
  views bigint DEFAULT 0,
  reach bigint DEFAULT 0,
  engagement bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  leads bigint DEFAULT 0,
  conversions bigint DEFAULT 0,
  raw jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_analytics_creative_idx ON content_analytics(creative_id, platform);

CREATE TABLE IF NOT EXISTS workspace_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  insight_type text NOT NULL,
  platform text,
  payload jsonb NOT NULL,
  sample_size int DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_insights_ws_idx ON workspace_insights(workspace_id, insight_type);

ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_status text DEFAULT 'none';
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_progress jsonb;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_cache_path text;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS render_cache_fingerprint text;
