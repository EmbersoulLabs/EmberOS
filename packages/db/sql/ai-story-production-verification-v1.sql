create table if not exists ai_story_execute_verifications (
  execution_plan_id uuid primary key references ai_story_execution_plans(id) on delete restrict,
  runtime_authorization_id uuid not null unique references ai_story_runtime_authorized_facts(runtime_authorization_id) on delete restrict,
  scene_execution_id uuid not null references ai_story_scene_executions(id) on delete restrict,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  outbox_job_id text not null unique references provider_outbox_jobs(job_id) on delete restrict,
  verification_mode boolean not null default true check (verification_mode = true),
  verification_policy_version text not null,
  authorized_by text not null check (authorized_by = 'ACTIVE_PLATFORM_ADMIN'),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_story_execute_verification_workspace_idx
  on ai_story_execute_verifications(workspace_id, created_at);
