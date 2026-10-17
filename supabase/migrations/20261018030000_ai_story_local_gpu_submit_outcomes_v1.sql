create table if not exists public.ai_story_local_gpu_submit_outcomes (
  outcome_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  story_id uuid not null references public.ai_stories(id) on delete restrict,
  scene_execution_id uuid not null references public.ai_story_scene_executions(id) on delete restrict,
  package_id uuid not null references public.ai_story_local_generation_packages(package_id) on delete restrict,
  dispatch_authority_id uuid not null references public.ai_story_local_gpu_dispatch_authorities(dispatch_authority_id) on delete restrict,
  job_id text not null,
  attempt_number integer not null check (attempt_number > 0),
  kind text not null check (kind in (
    'SUBMIT_STARTED',
    'SUBMIT_ACCEPTED',
    'SUBMIT_REJECTED',
    'SUBMIT_UNCERTAIN',
    'STATUS_NOT_FOUND_EXHAUSTED',
    'HUMAN_RETRY_AUTHORIZED'
  )),
  http_status integer,
  desktop_error_code text check (desktop_error_code is null or desktop_error_code ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  desktop_error_message text check (desktop_error_message is null or char_length(desktop_error_message) <= 300),
  uncertain_reason text,
  diagnostic jsonb not null default '{}'::jsonb,
  recorded_by text not null check (recorded_by in ('WORKER', 'HUMAN')),
  recorded_by_user_id uuid,
  created_at timestamptz not null default now(),
  unique (job_id, attempt_number, kind),
  check ((recorded_by = 'HUMAN') = (recorded_by_user_id is not null)),
  check ((kind = 'HUMAN_RETRY_AUTHORIZED') = (recorded_by = 'HUMAN'))
);

create index if not exists ai_story_local_gpu_submit_outcome_scope_idx
  on public.ai_story_local_gpu_submit_outcomes(workspace_id, scene_execution_id, job_id, attempt_number);

create or replace function public.enforce_ai_story_local_gpu_submit_outcome_immutable_v1()
returns trigger language plpgsql as $$
begin
  raise exception 'LOCAL_GPU submit outcomes are append-only' using errcode = '23514';
end $$;

drop trigger if exists ai_story_local_gpu_submit_outcome_immutable_v1 on public.ai_story_local_gpu_submit_outcomes;
create trigger ai_story_local_gpu_submit_outcome_immutable_v1
  before update or delete on public.ai_story_local_gpu_submit_outcomes
  for each row execute function public.enforce_ai_story_local_gpu_submit_outcome_immutable_v1();

alter table public.ai_story_local_gpu_submit_outcomes enable row level security;
revoke all on table public.ai_story_local_gpu_submit_outcomes from anon, authenticated;
grant select, insert on table public.ai_story_local_gpu_submit_outcomes to service_role;

comment on table public.ai_story_local_gpu_submit_outcomes is
  'Server-only append-only LOCAL_GPU submit evidence; secret-free Desktop rejection codes and reconciliation outcomes.';
