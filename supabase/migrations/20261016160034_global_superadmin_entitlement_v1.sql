begin;

alter table public.controlled_self_use_authorities
  add column if not exists scope_kind text not null default 'ORGANIZATION'
    check (scope_kind in ('ORGANIZATION', 'ACCOUNT')),
  add column if not exists account_user_id uuid;

alter table public.controlled_self_use_authorities
  add constraint controlled_self_use_account_scope_check check (
    (scope_kind = 'ORGANIZATION' and account_user_id is null)
    or (scope_kind = 'ACCOUNT' and account_user_id is not null)
  ) not valid;
alter table public.controlled_self_use_authorities
  validate constraint controlled_self_use_account_scope_check;

create unique index if not exists controlled_self_use_account_authority_unique
  on public.controlled_self_use_authorities(environment, account_user_id, purpose)
  where scope_kind = 'ACCOUNT';

alter table public.controlled_self_use_reservations
  add column if not exists actor_user_id uuid;

-- ACCOUNT-scoped Superadmin usage is metered, not budget-authorized. Keep the
-- reservation as the idempotency/UNKNOWN/accounting claim, but permit actual
-- Provider cost to exceed the caller's estimate. Organization-scoped legacy
-- authorities remain capped by application policy.
alter table public.controlled_self_use_reservations
  drop constraint if exists controlled_self_use_reservations_reserved_cost_usd_check,
  drop constraint if exists controlled_self_use_reservations_settled_cost_usd_check;
do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='public.controlled_self_use_reservations'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) like '%settled_cost_usd <= reserved_cost_usd%'
  loop
    execute format('alter table public.controlled_self_use_reservations drop constraint %I', constraint_name);
  end loop;
end;
$$;
alter table public.controlled_self_use_reservations
  add constraint controlled_self_use_reservations_reserved_cost_positive_check
    check (reserved_cost_usd > 0),
  add constraint controlled_self_use_reservations_settled_cost_nonnegative_check
    check (settled_cost_usd is null or settled_cost_usd >= 0);

create table if not exists public.controlled_self_use_organization_scopes (
  scope_id uuid primary key,
  authority_id uuid not null references public.controlled_self_use_authorities(authority_id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  owner_user_id uuid not null,
  status text not null check (status in ('ACTIVE', 'REVOKED')),
  source text not null check (source in ('OWNER_MEMBERSHIP', 'LEGACY_WORKSPACE_AUTHORITY', 'MANUAL_REVOCATION')),
  created_at timestamptz not null,
  revoked_at timestamptz,
  integrity_hash text not null unique,
  contract_version text not null check (contract_version = 'controlled-self-use-organization-scope.v1'),
  unique (authority_id, organization_id)
);

create index if not exists controlled_self_use_organization_scopes_lookup_idx
  on public.controlled_self_use_organization_scopes(owner_user_id, organization_id, status);

alter table public.controlled_self_use_organization_scopes enable row level security;
revoke all privileges on table public.controlled_self_use_organization_scopes from anon, authenticated;

-- Promote one existing, explicitly authorized self-use authority per active
-- Superadmin into the account-scoped policy anchor. Existing numeric fields are
-- retained for historical compatibility, but ACCOUNT policy does not enforce
-- them as authorization gates.
with candidates as (
  select authority_id, authorized_by,
         row_number() over (partition by environment, authorized_by order by created_at, authority_id) as rank
  from public.controlled_self_use_authorities authority
  where authority.status = 'ACTIVE'
    and authority.purpose = 'CONTROLLED_SELF_USE'
    and exists (
      select 1 from public.platform_admin_grants admin
      where admin.user_id = authority.authorized_by
        and admin.platform_role = 'PLATFORM_SUPER_ADMIN'
        and admin.status = 'ACTIVE'
    )
)
update public.controlled_self_use_authorities authority
set scope_kind = 'ACCOUNT', account_user_id = candidates.authorized_by
from candidates
where authority.authority_id = candidates.authority_id and candidates.rank = 1;

insert into public.controlled_self_use_organization_scopes (
  scope_id, authority_id, organization_id, owner_user_id, status, source,
  created_at, integrity_hash, contract_version
)
select
  md5('global-internal-self-use:' || authority.authority_id::text || ':' || member.org_id::text)::uuid,
  authority.authority_id,
  member.org_id,
  authority.account_user_id,
  'ACTIVE',
  'OWNER_MEMBERSHIP',
  now(),
  md5('global-internal-self-use:' || authority.authority_id::text || ':' || member.org_id::text),
  'controlled-self-use-organization-scope.v1'
from public.controlled_self_use_authorities authority
join public.organization_members member
  on member.user_id = authority.account_user_id and member.role = 'owner'
where authority.scope_kind = 'ACCOUNT' and authority.status = 'ACTIVE'
on conflict (authority_id, organization_id) do nothing;

insert into public.controlled_self_use_organization_scopes (
  scope_id, authority_id, organization_id, owner_user_id, status, source,
  created_at, integrity_hash, contract_version
)
select distinct on (account.authority_id, legacy.organization_id)
  md5('global-internal-self-use:' || account.authority_id::text || ':' || legacy.organization_id::text)::uuid,
  account.authority_id, legacy.organization_id, account.account_user_id,
  'ACTIVE', 'LEGACY_WORKSPACE_AUTHORITY', legacy.created_at,
  md5('global-internal-self-use:' || account.authority_id::text || ':' || legacy.organization_id::text),
  'controlled-self-use-organization-scope.v1'
from public.controlled_self_use_authorities account
join public.controlled_self_use_authorities legacy
  on legacy.environment=account.environment
 and legacy.authorized_by=account.account_user_id
 and legacy.status='ACTIVE'
join public.controlled_self_use_workspace_scopes workspace_scope
  on workspace_scope.authority_id=legacy.authority_id
 and workspace_scope.organization_id=legacy.organization_id
 and workspace_scope.status='ACTIVE'
where account.scope_kind='ACCOUNT' and account.status='ACTIVE'
order by account.authority_id, legacy.organization_id, legacy.created_at
on conflict (authority_id, organization_id) do nothing;

create or replace function public.inherit_global_internal_self_use_from_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.role <> 'owner' then return new; end if;
  insert into public.controlled_self_use_organization_scopes (
    scope_id, authority_id, organization_id, owner_user_id, status, source,
    created_at, integrity_hash, contract_version
  )
  select
    md5('global-internal-self-use:' || authority.authority_id::text || ':' || new.org_id::text)::uuid,
    authority.authority_id, new.org_id, new.user_id, 'ACTIVE',
    'OWNER_MEMBERSHIP', now(),
    md5('global-internal-self-use:' || authority.authority_id::text || ':' || new.org_id::text),
    'controlled-self-use-organization-scope.v1'
  from public.controlled_self_use_authorities authority
  join public.platform_admin_grants admin
    on admin.user_id = authority.account_user_id
   and admin.user_id = new.user_id
   and admin.platform_role = 'PLATFORM_SUPER_ADMIN'
   and admin.status = 'ACTIVE'
  where authority.scope_kind = 'ACCOUNT'
    and authority.status = 'ACTIVE'
  on conflict (authority_id, organization_id) do nothing;
  return new;
end;
$$;
revoke all on function public.inherit_global_internal_self_use_from_owner() from public, anon, authenticated;

drop trigger if exists organization_owner_global_internal_self_use on public.organization_members;
create trigger organization_owner_global_internal_self_use
after insert or update of role on public.organization_members
for each row execute function public.inherit_global_internal_self_use_from_owner();

comment on table public.controlled_self_use_organization_scopes is
  'Server-only ownership boundary for account-level internal self-use. Platform access alone never creates a scope.';
comment on column public.controlled_self_use_authorities.account_user_id is
  'Persistent Platform Superadmin account that owns an ACCOUNT-scoped Provider access authority.';
comment on column public.controlled_self_use_reservations.actor_user_id is
  'Active Platform Superadmin identity validated when the paid reservation is created.';

commit;
