create table if not exists public.ai_story_local_gpu_dispatch_authorities (
  dispatch_authority_id uuid primary key,
  authority_fingerprint text not null unique,
  idempotency_key text not null,
  org_id uuid not null references public.organizations(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  story_id uuid not null references public.ai_stories(id) on delete restrict,
  execution_plan_id uuid not null references public.ai_story_execution_plans(id) on delete restrict,
  scene_execution_id uuid not null references public.ai_story_scene_executions(id) on delete restrict,
  package_id uuid not null references public.ai_story_local_generation_packages(package_id) on delete restrict,
  runtime_authorization_id uuid not null references public.ai_story_runtime_authorized_facts(runtime_authorization_id) on delete restrict,
  platform_admin_assignment_id uuid not null references public.platform_admin_grants(platform_admin_assignment_id) on delete restrict,
  authorized_by_user_id uuid not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  execution_identity text not null,
  dispatch_snapshot jsonb not null,
  authorized_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (scene_execution_id, package_id, runtime_authorization_id)
);

create index if not exists ai_story_local_gpu_dispatch_authority_scope_idx
  on public.ai_story_local_gpu_dispatch_authorities(workspace_id, story_id, scene_execution_id);

alter table public.ai_story_local_gpu_dispatch_authorities enable row level security;
revoke all on table public.ai_story_local_gpu_dispatch_authorities from anon, authenticated;
grant select, insert, update on table public.ai_story_local_gpu_dispatch_authorities to service_role;

comment on table public.ai_story_local_gpu_dispatch_authorities is
  'Server-only immutable LOCAL_GPU V3 dispatch authority; no browser Data API access.';
