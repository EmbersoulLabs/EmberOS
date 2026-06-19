import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  syncSubtitlesFromCopy,
  canUseSubtitleOnlyRerender,
  type CopyVariant,
  type EditPlan,
} from "@ceo-agent/shared";
import { enqueuePreviewSubtitleRerender } from "@/lib/render-queue";

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

    const variants = [...((creative.copyVariants ?? []) as CopyVariant[])];
    const idx = variants.findIndex((v) => v.id === variantId);
    if (idx === -1) return apiError("Variant not found", "NOT_FOUND", 404);

    variants[idx] = {
      ...variants[idx]!,
      ...(hook !== undefined && { hook }),
      ...(copyBody !== undefined && { body: copyBody }),
      ...(cta !== undefined && { cta }),
      ...(tags !== undefined && { tags }),
      ...(title !== undefined && { title }),
    };

    const previousPlan = creative.editPlan as EditPlan | null;
    let nextEditPlan = previousPlan;
    let rerenderSubtitles = false;

    if (previousPlan && (hook !== undefined || copyBody !== undefined || cta !== undefined)) {
      const pairLocale = variants[idx]!.locale === "zh" ? "en" : "zh";
      const altVariant = variants.find((v) => v.locale === pairLocale);
      nextEditPlan = syncSubtitlesFromCopy(previousPlan, variants[idx]!, altVariant);
      rerenderSubtitles = canUseSubtitleOnlyRerender(previousPlan, nextEditPlan);
    }

    const [updated] = await db
      .update(schema.creatives)
      .set({
        copyVariants: variants,
        ...(nextEditPlan ? { editPlan: nextEditPlan } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.creatives.id, id))
      .returning();

    if (rerenderSubtitles && creative.taskId && creative.renderStatus === "preview_ready") {
      await enqueuePreviewSubtitleRerender(id);
    }

    return apiSuccess({
      creative: updated,
      rerenderQueued: rerenderSubtitles,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
