import { sql, type SQL } from "drizzle-orm";

export type AiStoryActorScope = {
  orgId: string;
  workspaceId: string;
  actorUserId: string;
};

export type AiStoryMutationRoleSet = "STORY" | "CHARACTER";

/**
 * Canonical server-side actor predicate for AI Story authority owners.
 *
 * Ordinary Workspace membership keeps its existing role semantics. Platform
 * Superadmin access is accepted only when the same active account authority
 * has an active internal-organization scope. Platform visibility by itself is
 * deliberately insufficient, so customer Workspaces cannot consume internal
 * self-use authority.
 */
export function aiStoryActorScopePredicate(
  scope: AiStoryActorScope,
  mutation: boolean,
  mutationRoleSet: AiStoryMutationRoleSet = "STORY",
): SQL {
  const memberMutationAllowed = mutationRoleSet === "CHARACTER"
    ? sql`wm.role in ('admin','operator')`
    : sql`wm.role in ('admin','operator','editor','reviewer')`;
  return sql`(
    exists(
      select 1 from workspace_members wm
      where wm.org_id=${scope.orgId}::uuid
        and wm.workspace_id=${scope.workspaceId}::uuid
        and wm.user_id=${scope.actorUserId}::uuid
        and (${mutation}=false or ${memberMutationAllowed})
    )
    or exists(
      select 1
      from platform_admin_grants admin
      join controlled_self_use_authorities authority
        on authority.account_user_id=admin.user_id
       and authority.scope_kind='ACCOUNT'
       and authority.status='ACTIVE'
       and authority.environment='PRODUCTION'
      join controlled_self_use_organization_scopes internal_scope
        on internal_scope.authority_id=authority.authority_id
       and internal_scope.organization_id=${scope.orgId}::uuid
       and internal_scope.status='ACTIVE'
      join workspaces internal_workspace
        on internal_workspace.id=${scope.workspaceId}::uuid
       and internal_workspace.org_id=internal_scope.organization_id
      where admin.user_id=${scope.actorUserId}::uuid
        and admin.platform_role='PLATFORM_SUPER_ADMIN'
        and admin.status='ACTIVE'
    )
  )`;
}

export async function hasAiStoryActorScope(
  db: { execute: (query: SQL) => Promise<readonly { ok: boolean }[]> },
  scope: AiStoryActorScope,
  mutation: boolean,
  mutationRoleSet: AiStoryMutationRoleSet = "STORY",
): Promise<boolean> {
  const rows = await db.execute(sql`select ${aiStoryActorScopePredicate(scope, mutation, mutationRoleSet)} as ok`);
  return rows[0]?.ok === true;
}

/** Shared fallback for owners that must preserve a custom member-role check. */
export async function hasInternalSuperadminWorkspaceScope(
  db: { execute: (query: SQL) => Promise<readonly { ok: boolean }[]> },
  input: { workspaceId: string; actorUserId: string },
): Promise<boolean> {
  const rows = await db.execute(sql`
    select exists(
      select 1
      from workspaces workspace
      join controlled_self_use_organization_scopes internal_scope
        on internal_scope.organization_id=workspace.org_id
       and internal_scope.status='ACTIVE'
      join controlled_self_use_authorities authority
        on authority.authority_id=internal_scope.authority_id
       and authority.scope_kind='ACCOUNT'
       and authority.status='ACTIVE'
       and authority.environment='PRODUCTION'
      join platform_admin_grants admin
        on admin.user_id=authority.account_user_id
       and admin.platform_role='PLATFORM_SUPER_ADMIN'
       and admin.status='ACTIVE'
      where workspace.id=${input.workspaceId}::uuid
        and admin.user_id=${input.actorUserId}::uuid
    ) as ok
  `);
  return rows[0]?.ok === true;
}
