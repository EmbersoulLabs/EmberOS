begin;

alter table public.controlled_self_use_authorities
  drop constraint if exists controlled_self_use_production_org_check;

create table public.controlled_self_use_workspace_scopes (
  scope_id uuid primary key,
  authority_id uuid not null references public.controlled_self_use_authorities(authority_id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  status text not null check (status in ('ACTIVE', 'REVOKED')),
  authorized_by uuid not null,
  reason text not null,
  created_at timestamptz not null,
  revoked_at timestamptz,
  integrity_hash text not null unique,
  contract_version text not null check (contract_version = 'controlled-self-use-workspace-scope.v1'),
  unique (authority_id, workspace_id)
);

create index controlled_self_use_workspace_scopes_lookup_idx
  on public.controlled_self_use_workspace_scopes(organization_id, workspace_id, status);

alter table public.controlled_self_use_workspace_scopes enable row level security;
revoke all privileges on table public.controlled_self_use_workspace_scopes from anon, authenticated;

insert into public.controlled_self_use_workspace_scopes (
  scope_id, authority_id, organization_id, workspace_id, status,
  authorized_by, reason, created_at, integrity_hash, contract_version
)
select
  md5('controlled-self-use-workspace-scope:legacy:' || authority.authority_id::text || ':' || workspace.id::text)::uuid,
  authority.authority_id,
  authority.organization_id,
  workspace.id,
  'ACTIVE',
  authority.authorized_by,
  'Backfill of workspace access already authorized by controlled-self-use-authority.v1',
  authority.created_at,
  md5('controlled-self-use-workspace-scope:legacy:' || authority.authority_id::text || ':' || workspace.id::text),
  'controlled-self-use-workspace-scope.v1'
from public.controlled_self_use_authorities authority
join public.workspaces workspace on workspace.org_id = authority.organization_id
on conflict (authority_id, workspace_id) do nothing;

comment on table public.controlled_self_use_workspace_scopes is
  'Server-only, explicit workspace allowlist for bounded internal self-use. Platform Admin identity alone never grants customer workspace access.';

commit;
