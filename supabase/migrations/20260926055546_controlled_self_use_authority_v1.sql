begin;

create table if not exists public.controlled_self_use_authorities (
  authority_id uuid primary key,
  environment text not null check (environment in ('STAGING', 'PRODUCTION')),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purpose text not null check (purpose = 'CONTROLLED_SELF_USE'),
  status text not null check (status in ('ACTIVE', 'DISABLED', 'REVOKED')),
  max_usd_per_execution numeric(12,2) not null check (max_usd_per_execution > 0 and max_usd_per_execution <= 5.00),
  daily_cap_usd numeric(12,2) not null check (daily_cap_usd > 0 and daily_cap_usd <= 10.00),
  max_automatic_retries integer not null check (max_automatic_retries = 0),
  allowed_providers jsonb not null,
  allowed_capabilities jsonb not null,
  authorized_by uuid not null,
  reason text not null,
  created_at timestamptz not null,
  disabled_at timestamptz,
  revoked_at timestamptz,
  integrity_hash text not null unique,
  contract_version text not null check (contract_version = 'controlled-self-use-authority.v1'),
  constraint controlled_self_use_production_org_check check (
    environment <> 'PRODUCTION'
    or organization_id = '52519c8c-4011-478f-bf09-34e087e4bbdd'::uuid
  ),
  unique (environment, organization_id, purpose)
);

create table if not exists public.controlled_self_use_reservations (
  reservation_id uuid primary key,
  authority_id uuid not null references public.controlled_self_use_authorities(authority_id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  capability_key text not null check (capability_key in ('campaign.generate', 'ai_story.plan', 'ai_story.execute')),
  execution_identity text not null,
  provider_key text not null check (provider_key in ('openai', 'seedance')),
  reserved_cost_usd numeric(12,2) not null check (reserved_cost_usd > 0 and reserved_cost_usd <= 5.00),
  settled_cost_usd numeric(12,2) check (settled_cost_usd is null or (settled_cost_usd >= 0 and settled_cost_usd <= reserved_cost_usd)),
  retry_ordinal integer not null default 0 check (retry_ordinal = 0),
  status text not null check (status in ('RESERVED', 'SUBMITTED', 'SETTLED', 'RELEASED')),
  budget_day date not null,
  provider_request_id text,
  created_at timestamptz not null,
  submitted_at timestamptz,
  settled_at timestamptz,
  released_at timestamptz,
  integrity_hash text not null unique,
  contract_version text not null check (contract_version = 'controlled-self-use-reservation.v1'),
  unique (authority_id, execution_identity)
);

create index if not exists controlled_self_use_reservations_daily_idx
  on public.controlled_self_use_reservations(authority_id, budget_day, status);
create index if not exists controlled_self_use_reservations_workspace_idx
  on public.controlled_self_use_reservations(workspace_id, created_at);

create table if not exists public.controlled_self_use_events (
  event_id uuid primary key,
  authority_id uuid not null references public.controlled_self_use_authorities(authority_id) on delete restrict,
  reservation_id uuid references public.controlled_self_use_reservations(reservation_id) on delete restrict,
  event_type text not null check (event_type in ('CREATED', 'ENABLED', 'DISABLED', 'REVOKED', 'RESERVED', 'SUBMITTED', 'SETTLED', 'RELEASED')),
  actor_user_id uuid,
  cost_usd numeric(12,2),
  evidence jsonb not null,
  occurred_at timestamptz not null,
  integrity_hash text not null unique,
  contract_version text not null check (contract_version = 'controlled-self-use-event.v1')
);

create index if not exists controlled_self_use_events_authority_idx
  on public.controlled_self_use_events(authority_id, occurred_at);

create or replace function public.reject_controlled_self_use_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'CONTROLLED_SELF_USE_EVENT_IMMUTABLE';
end;
$$;

drop trigger if exists controlled_self_use_events_immutable on public.controlled_self_use_events;
create trigger controlled_self_use_events_immutable
before update or delete on public.controlled_self_use_events
for each row execute function public.reject_controlled_self_use_event_mutation();

alter table public.controlled_self_use_authorities enable row level security;
alter table public.controlled_self_use_reservations enable row level security;
alter table public.controlled_self_use_events enable row level security;

revoke all privileges on table public.controlled_self_use_authorities from anon, authenticated;
revoke all privileges on table public.controlled_self_use_reservations from anon, authenticated;
revoke all privileges on table public.controlled_self_use_events from anon, authenticated;

comment on table public.controlled_self_use_authorities is
  'Server-only, organization-scoped Production Controlled Self-Use authority. Never grants customer/global dispatch.';
comment on table public.controlled_self_use_reservations is
  'Concurrency-safe USD reservation ledger for bounded owner self-use Provider execution.';

commit;
