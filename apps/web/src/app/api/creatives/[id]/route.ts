import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "client_viewer");

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, creative.campaignId))
      .limit(1);

    const reviews = await db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.creativeId, id));

    return apiSuccess({ creative, campaign, reviews });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const { variantId, hook, body: copyBody, cta, tags, title } = body as {
      variantId: string;
      hook?: string;
      body?: string;
      cta?: string;
      tags?: string[];
      title?: string;
    };

    const db = getDb();
    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "editor");

    const variants = [...((creative.copyVariants ?? []) as Record<string, unknown>[])];
    const idx = variants.findIndex((v) => v.id === variantId);
    if (idx === -1) return apiError("Variant not found", "NOT_FOUND", 404);

    variants[idx] = {
      ...variants[idx],
      ...(hook !== undefined && { hook }),
      ...(copyBody !== undefined && { body: copyBody }),
      ...(cta !== undefined && { cta }),
      ...(tags !== undefined && { tags }),
      ...(title !== undefined && { title }),
    };

    const [updated] = await db
      .update(schema.creatives)
      .set({ copyVariants: variants, updatedAt: new Date() })
      .where(eq(schema.creatives.id, id))
      .returning();

    return apiSuccess({ creative: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
