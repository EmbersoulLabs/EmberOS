-- Append-only commercial audio assembly. The generation asset is never overwritten.
create table public.ai_story_commercial_audio_assemblies (
  assembly_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  execution_plan_id uuid not null references public.ai_story_execution_plans(id) on delete restrict,
  scene_execution_id uuid not null references public.ai_story_scene_executions(id) on delete restrict,
  package_id uuid not null references public.ai_story_local_generation_packages(package_id) on delete restrict,
  generation_result_id uuid not null references public.ai_story_generation_results(generation_result_id) on delete restrict,
  source_asset_id uuid not null references public.assets(id) on delete restrict,
  source_content_hash text not null check (source_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  generation_policy text not null check (generation_policy in ('SILENT_GENERATION', 'NATIVE_PRESERVED')),
  final_policy text not null check (final_policy in ('EXPLICIT_SILENCE', 'LICENSED_BGM', 'NATIVE_PLUS_BGM')),
  blockers jsonb not null default '[]'::jsonb,
  bgm_track_id text,
  bgm_license text check (bgm_license is null or bgm_license in ('royalty_free', 'licensed')),
  bgm_license_url text,
  output_asset_id uuid references public.assets(id) on delete restrict,
  output_content_hash text check (output_content_hash is null or output_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  has_audio boolean not null default false,
  state text not null check (state in ('PENDING', 'RUNNING', 'ASSEMBLED', 'FAILED', 'SUPERSEDED')),
  error_code text,
  actor_user_id uuid not null,
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  check ((final_policy in ('LICENSED_BGM', 'NATIVE_PLUS_BGM')) = (bgm_track_id is not null and bgm_license is not null and bgm_license_url is not null)),
  check (state <> 'ASSEMBLED' or final_policy = 'EXPLICIT_SILENCE' or (output_asset_id is not null and output_content_hash is not null and has_audio))
);

create index ai_story_commercial_audio_pending_idx
  on public.ai_story_commercial_audio_assemblies(state, created_at);
create index ai_story_commercial_audio_result_idx
  on public.ai_story_commercial_audio_assemblies(workspace_id, generation_result_id, created_at desc);

create or replace function public.enforce_ai_story_commercial_audio_identity_v1()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'COMMERCIAL_AUDIO_ASSEMBLY_IMMUTABLE';
  end if;
  if (new.assembly_id, new.org_id, new.workspace_id, new.campaign_id, new.execution_plan_id,
      new.scene_execution_id, new.package_id, new.generation_result_id, new.source_asset_id,
      new.source_content_hash, new.generation_policy, new.final_policy, new.bgm_track_id,
      new.bgm_license, new.bgm_license_url, new.actor_user_id, new.created_at)
     is distinct from
     (old.assembly_id, old.org_id, old.workspace_id, old.campaign_id, old.execution_plan_id,
      old.scene_execution_id, old.package_id, old.generation_result_id, old.source_asset_id,
      old.source_content_hash, old.generation_policy, old.final_policy, old.bgm_track_id,
      old.bgm_license, old.bgm_license_url, old.actor_user_id, old.created_at)
  then
    raise exception 'COMMERCIAL_AUDIO_ASSEMBLY_IMMUTABLE';
  end if;
  return new;
end $$;

create trigger ai_story_commercial_audio_identity
  before update or delete on public.ai_story_commercial_audio_assemblies
  for each row execute function public.enforce_ai_story_commercial_audio_identity_v1();

alter table public.ai_story_commercial_audio_assemblies enable row level security;
revoke all on public.ai_story_commercial_audio_assemblies from anon, authenticated;
