import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import {
  MARKETING_PLATFORM_IDS,
  PlatformMarketingAssetSchema,
  applyPlatformLocaleEdit,
  normalizeMarketingContentPackage,
  readMarketingPackRevision,
  type MarketingPackLocale,
  type MarketingPlatformId,
  type StepProgress,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { saveMarketingPackIfCurrent } from "@/lib/marketing-pack-persistence";

const LOCALES = new Set<MarketingPackLocale>(["zh", "en", "ms"]);

/** Save an inline-edited platform marketing asset for one locale. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return apiError("Task not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(task.workspaceId, user.id, "editor");

    const body = (await request.json().catch(() => null)) as {
      platformId?: string;
      asset?: unknown;
      locale?: string;
      contentRevision?: number;
    } | null;

    const platformId = body?.platformId as MarketingPlatformId | undefined;
    if (!platformId || !MARKETING_PLATFORM_IDS.includes(platformId)) {
      return apiError("Invalid platformId", "INVALID", 400);
    }
    const locale = body?.locale;
    if (locale !== undefined && !LOCALES.has(locale as MarketingPackLocale)) {
      return apiError("Invalid locale", "INVALID", 400);
    }
    const validated = PlatformMarketingAssetSchema.safeParse(body?.asset);
    if (!validated.success) return apiError("Invalid asset", "INVALID", 400);

    const progress = (task.stepProgress as StepProgress) ?? {};
    const step = progress.content_generate;
    if (step?.status !== "completed" || !step.output) {
      return apiError("Marketing pack not ready", "NOT_READY", 400);
    }

    const existing = normalizeMarketingContentPackage(step.output);
    if (!existing) return apiError("Invalid marketing pack", "INVALID", 400);

    const expectedRevision =
      typeof body?.contentRevision === "number" ? body.contentRevision : readMarketingPackRevision(progress);
    const updatedPackage = applyPlatformLocaleEdit(
      existing,
      platformId,
      validated.data,
      (locale as MarketingPackLocale | undefined) ?? "zh"
    );

    const saved = await saveMarketingPackIfCurrent({
      taskId: id,
      expectedRevision,
      contentPackage: updatedPackage,
    });
    if (!saved.ok) {
      return apiError(
        "Marketing pack was updated by someone else. Your draft is still in the editor.",
        "CONFLICT",
        409
      );
    }

    return apiSuccess({ contentPackage: updatedPackage, contentRevision: saved.revision });
  } catch (error) {
    return handleApiError(error);
  }
}
