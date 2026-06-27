import { eq, and, isNull, gt } from "drizzle-orm";
import type { getDb } from "@ceo-agent/db";
import { schema } from "@ceo-agent/db";
import { PORTAL_TOKEN_EXPIRY_DAYS, skipClientReview } from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

export function portalInviteUrl(token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${appUrl}/portal/${token}`;
}

export async function createClientInvite(
  db: Db,
  params: {
    orgId: string;
    workspaceId: string;
    creativeId: string;
    token: string;
    createdBy?: string;
    email?: string;
    expiresInDays?: number;
  }
) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (params.expiresInDays ?? PORTAL_TOKEN_EXPIRY_DAYS));

  const [invite] = await db
    .insert(schema.clientInvites)
    .values({
      orgId: params.orgId,
      workspaceId: params.workspaceId,
      creativeId: params.creativeId,
      token: params.token,
      email: params.email,
      expiresAt,
      createdBy: params.createdBy ?? null,
    })
    .returning();

  return {
    invite,
    inviteUrl: portalInviteUrl(params.token),
    expiresAt: invite!.expiresAt,
  };
}

/** Recompute campaign status from child creative statuses. */
export async function syncCampaignStatusFromCreatives(
  db: Db,
  campaignId: string,
  workspaceId: string
): Promise<string> {
  const creatives = await db
    .select({ status: schema.creatives.status })
    .from(schema.creatives)
    .where(
      and(eq(schema.creatives.campaignId, campaignId), eq(schema.creatives.workspaceId, workspaceId))
    );

  if (creatives.length === 0) return "draft";

  const statuses = creatives.map((c) => c.status);
  if (statuses.every((s) => s === "exported")) return "export_ready";
  if (statuses.every((s) => s === "approved" || s === "exported")) return "approved";
  if (statuses.some((s) => s === "pending_client_review")) return "pending_client_review";
  if (statuses.some((s) => s === "pending_internal_review" || s === "compliance_failed")) {
    return "pending_internal_review";
  }
  if (statuses.some((s) => s === "processing")) return "processing";

  return "approved";
}

export async function resolveWorkspaceReviewSettings(db: Db, workspaceId: string) {
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  return {
    workspace,
    skipClient: skipClientReview(workspace?.settings as Record<string, unknown> | undefined),
  };
}

export async function findActiveClientInvite(
  db: Db,
  creativeId: string,
  workspaceId: string
) {
  const [invite] = await db
    .select()
    .from(schema.clientInvites)
    .where(
      and(
        eq(schema.clientInvites.creativeId, creativeId),
        eq(schema.clientInvites.workspaceId, workspaceId),
        gt(schema.clientInvites.expiresAt, new Date()),
        isNull(schema.clientInvites.usedAt)
      )
    )
    .limit(1);

  return invite
    ? { invite, inviteUrl: portalInviteUrl(invite.token) }
    : null;
}
