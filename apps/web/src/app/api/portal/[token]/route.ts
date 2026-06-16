import { eq, and, gt } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { apiSuccess, apiError } from "@/lib/api";

async function validatePortalToken(token: string) {
  const db = getDb();
  const [invite] = await db
    .select()
    .from(schema.clientInvites)
    .where(
      and(eq(schema.clientInvites.token, token), gt(schema.clientInvites.expiresAt, new Date()))
    )
    .limit(1);

  return invite ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const invite = await validatePortalToken(token);
    if (!invite) return apiError("Invalid or expired token", "FORBIDDEN", 403);

    const db = getDb();
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, invite.workspaceId))
      .limit(1);

    if (!invite.creativeId) {
      return apiError("Invite not scoped to a creative", "VALIDATION_ERROR");
    }

    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(
        and(
          eq(schema.creatives.id, invite.creativeId),
          eq(schema.creatives.workspaceId, invite.workspaceId)
        )
      )
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, creative.campaignId))
      .limit(1);

    const reviews = await db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.creativeId, creative.id));

    return apiSuccess({
      creative,
      campaign,
      brandName: workspace?.name,
      reviews,
    });
  } catch (error) {
    console.error(error);
    return apiError("Internal server error", "INTERNAL_ERROR", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const invite = await validatePortalToken(token);
    if (!invite || !invite.creativeId) {
      return apiError("Invalid or expired token", "FORBIDDEN", 403);
    }

    const body = await request.json();
    const { decision, comment } = body as {
      decision: "approved" | "rejected";
      comment?: string;
    };

    const db = getDb();
    const [review] = await db
      .insert(schema.reviews)
      .values({
        orgId: invite.orgId,
        workspaceId: invite.workspaceId,
        creativeId: invite.creativeId,
        reviewerType: "client",
        reviewerEmail: invite.email,
        decision,
        comment,
        decidedAt: new Date(),
      })
      .returning();

    const newStatus = decision === "approved" ? "approved" : "compliance_failed";
    await db
      .update(schema.creatives)
      .set({ status: newStatus })
      .where(eq(schema.creatives.id, invite.creativeId));

    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, invite.creativeId))
      .limit(1);

    if (creative) {
      await db
        .update(schema.campaigns)
        .set({ status: decision === "approved" ? "approved" : "pending_internal_review" })
        .where(eq(schema.campaigns.id, creative.campaignId));
    }

    await db
      .update(schema.clientInvites)
      .set({ usedAt: new Date() })
      .where(eq(schema.clientInvites.id, invite.id));

    return apiSuccess({ review, status: newStatus });
  } catch (error) {
    console.error(error);
    return apiError("Internal server error", "INTERNAL_ERROR", 500);
  }
}
