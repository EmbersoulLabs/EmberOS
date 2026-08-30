create table if not exists ai_story_scene_release_states (
  scene_execution_id uuid primary key references ai_story_scene_executions(id) on delete restrict,
  execution_plan_id uuid not null references ai_story_execution_plans(id) on delete restrict,
  runtime_authorization_id uuid not null references ai_story_runtime_authorized_facts(runtime_authorization_id) on delete restrict,
  workspace_id uuid not null references workspaces(id) on delete restrict,
  scene_order integer not null,
  release_state text not null check (release_state in ('AUTHORIZED_NOT_RELEASED','RELEASED')),
  release_stage integer,
  released_by uuid,
  released_at timestamptz,
  gate_scene_execution_id uuid references ai_story_scene_executions(id) on delete restrict,
  gate_provider_attempt_id text,
  gate_scene_result_id uuid references ai_story_scene_results(scene_result_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_story_scene_release_plan_order_unique unique (execution_plan_id, scene_order)
);
create index if not exists ai_story_scene_release_plan_idx on ai_story_scene_release_states(execution_plan_id, scene_order);
create index if not exists ai_story_scene_release_workspace_idx on ai_story_scene_release_states(workspace_id, created_at);
