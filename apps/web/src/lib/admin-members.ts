import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { WorkspaceRoleSchema, type WorkspaceRole } from "@ceo-agent/shared";

export interface WorkspaceMemberRow {
  id: string;
  userId: string;
  role: string;
  email: string | null;
  createdAt: string | null;
}

async function findAuthUserByEmail(email: string): Promise<{ id: string; email: string | null } | null> {
  const db = getDb();
  const rows = await db.execute<{ id: string; email: string | null }>(sql`
    SELECT id, email FROM auth.users WHERE lower(email) = lower(${email.trim()}) LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function listWorkspaceMembersAdmin(workspaceId: string): Promise<WorkspaceMemberRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.workspaceMembers.id,
      userId: schema.workspaceMembers.userId,
      role: schema.workspaceMembers.role,
      createdAt: schema.workspaceMembers.createdAt,
    })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));

  const emails = rows.length
    ? await db.execute<{ id: string; email: string | null }>(sql`
        SELECT id, email FROM auth.users
        WHERE id IN (${sql.join(
          rows.map((r) => sql`${r.userId}::uuid`),
          sql`, `
        )})
      `)
    : [];

  const emailById = new Map(emails.map((u) => [u.id, u.email]));

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId!,
    role: r.role,
    email: r.userId ? (emailById.get(r.userId) ?? null) : null,
    createdAt: r.createdAt?.toISOString() ?? null,
  }));
}

export async function addWorkspaceMemberAdmin(
  workspaceId: string,
  params: { email: string; role: WorkspaceRole }
): Promise<{ member: WorkspaceMemberRow } | { error: string; code: string }> {
  const parsed = WorkspaceRoleSchema.safeParse(params.role);
  if (!parsed.success) {
    return { error: "Invalid role", code: "VALIDATION_ERROR" };
  }

  const email = params.email.trim();
  if (!email) {
    return { error: "Email is required", code: "VALIDATION_ERROR" };
  }

  const authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    return {
      error: "No account with this email. Ask them to sign up first.",
      code: "USER_NOT_FOUND",
    };
  }

  const db = getDb();
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) {
    return { error: "Workspace not found", code: "NOT_FOUND" };
  }

  const [existing] = await db
    .select({ id: schema.workspaceMembers.id })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, authUser.id)
      )
    )
    .limit(1);

  if (existing) {
    return { error: "User is already a member of this workspace", code: "ALREADY_MEMBER" };
  }

  const [orgMember] = await db
    .select({ id: schema.organizationMembers.id })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.orgId, workspace.orgId),
        eq(schema.organizationMembers.userId, authUser.id)
      )
    )
    .limit(1);

  if (!orgMember) {
    await db.insert(schema.organizationMembers).values({
      orgId: workspace.orgId,
      userId: authUser.id,
      role: "member",
    });
  }

  const [inserted] = await db
    .insert(schema.workspaceMembers)
    .values({
      orgId: workspace.orgId,
      workspaceId,
      userId: authUser.id,
      role: parsed.data,
    })
    .returning();

  return {
    member: {
      id: inserted!.id,
      userId: authUser.id,
      role: inserted!.role,
      email: authUser.email,
      createdAt: inserted!.createdAt?.toISOString() ?? null,
    },
  };
}

export async function updateWorkspaceMemberRoleAdmin(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole
): Promise<{ ok: true } | { error: string; code: string }> {
  const parsed = WorkspaceRoleSchema.safeParse(role);
  if (!parsed.success) {
    return { error: "Invalid role", code: "VALIDATION_ERROR" };
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.workspaceMembers)
    .set({ role: parsed.data })
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId)
      )
    )
    .returning({ id: schema.workspaceMembers.id });

  if (!updated) {
    return { error: "Member not found", code: "NOT_FOUND" };
  }

  return { ok: true };
}

export async function removeWorkspaceMemberAdmin(
  workspaceId: string,
  userId: string
): Promise<{ ok: true } | { error: string; code: string }> {
  const db = getDb();
  const members = await db
    .select({ userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.workspaceId, workspaceId));

  const target = members.find((m) => m.userId === userId);
  if (!target) {
    return { error: "Member not found", code: "NOT_FOUND" };
  }

  const adminCount = members.filter((m) => m.role === "admin").length;
  if (target.role === "admin" && adminCount <= 1) {
    return { error: "Cannot remove the last admin from a workspace", code: "LAST_ADMIN" };
  }

  await db
    .delete(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId)
      )
    );

  return { ok: true };
}
