import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../client";
import { isUuid, type OrgRole, type WorkspaceRole } from "@ceo-agent/shared";

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  admin: 100,
  operator: 80,
  editor: 60,
  reviewer: 40,
  publisher: 40,
  client_viewer: 10,
};

/** Organization-level roles (Normal Tenant / Agency / Yuki under their org). */
const ORG_ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 100,
  admin: 80,
  member: 10,
};

export type OrganizationMemberRow = typeof schema.organizationMembers.$inferSelect;

export type OrganizationMembershipLookup = (
  orgId: string,
  userId: string
) => Promise<OrganizationMemberRow | null>;

export async function getWorkspaceMembership(workspaceId: string, userId: string) {
  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId)
      )
    )
    .limit(1);
  return member ?? null;
}

export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  minRole: WorkspaceRole
) {
  const member = await getWorkspaceMembership(workspaceId, userId);
  if (!member) {
    throw new WorkspaceAccessError("Not a member of this workspace", "FORBIDDEN");
  }
  if (ROLE_HIERARCHY[member.role as WorkspaceRole] < ROLE_HIERARCHY[minRole]) {
    throw new WorkspaceAccessError("Insufficient permissions", "FORBIDDEN");
  }
  return member;
}

/**
 * Load membership for a specific organization.
 * Never infer org access from "any" membership — callers must pass the target orgId.
 */
export async function getOrganizationMembership(orgId: string, userId: string) {
  const db = getDb();
  const [member] = await db
    .select()
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.orgId, orgId),
        eq(schema.organizationMembers.userId, userId)
      )
    )
    .limit(1);
  return member ?? null;
}

/**
 * Verify the user belongs to the given organization (server-side).
 * Super Admin is not granted org access here — that must be an explicit admin path.
 *
 * Malformed orgId is rejected before any database lookup.
 * Optional `lookup` is for tests; production callers omit it.
 */
export async function requireOrganizationMembership(
  orgId: string,
  userId: string,
  minRole: OrgRole = "member",
  lookup: OrganizationMembershipLookup = getOrganizationMembership
) {
  if (!isUuid(orgId)) {
    throw new TenantValidationError("orgId must be a valid UUID", "VALIDATION_ERROR");
  }

  const member = await lookup(orgId, userId);
  if (!member) {
    throw new OrganizationAccessError(
      "Not a member of this organization",
      "FORBIDDEN"
    );
  }
  const role = member.role as OrgRole;
  const level = ORG_ROLE_HIERARCHY[role];
  if (level == null || level < ORG_ROLE_HIERARCHY[minRole]) {
    throw new OrganizationAccessError("Insufficient organization permissions", "FORBIDDEN");
  }
  return member;
}

export { ROLE_HIERARCHY, ORG_ROLE_HIERARCHY };

export class WorkspaceAccessError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export class OrganizationAccessError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "OrganizationAccessError";
  }
}

/** Input validation failures (e.g. malformed UUID) — map to HTTP 400. */
export class TenantValidationError extends Error {
  constructor(
    message: string,
    public code: string = "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "TenantValidationError";
  }
}

export function withWorkspaceFilter(
  workspaceId: string,
  workspaceIdColumn: Parameters<typeof eq>[0]
) {
  return eq(workspaceIdColumn, workspaceId);
}
