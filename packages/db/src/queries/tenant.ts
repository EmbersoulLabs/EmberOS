import { eq, and } from "drizzle-orm";
import { getDb, schema } from "../client";
import type { WorkspaceRole } from "@ceo-agent/shared";

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  admin: 100,
  operator: 80,
  editor: 60,
  reviewer: 40,
  publisher: 40,
  client_viewer: 10,
};

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

export { ROLE_HIERARCHY };

export class WorkspaceAccessError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export function withWorkspaceFilter(
  workspaceId: string,
  workspaceIdColumn: Parameters<typeof eq>[0]
) {
  return eq(workspaceIdColumn, workspaceId);
}
