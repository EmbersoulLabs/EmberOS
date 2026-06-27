import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import {
  MARKETING_PLATFORM_IDS,
  PlatformMarketingAssetSchema,
  normalizeMarketingContentPackage,
  resolvePlatformAssets,
  type MarketingCaptions,
  type MarketingPlatformId,
  type PlatformMarketingAsset,
  type StepProgress,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

// Platforms that have a flat legacy caption entry (threads is assets-only).
const CAPTION_KEYS = MARKETING_PLATFORM_IDS.filter(
  (id) => id !== "threads"
) as Exclude<MarketingPlatformId, "threads">[];

function isCaptionKey(id: MarketingPlatformId): id is Exclude<MarketingPlatformId, "threads"> {
  return (CAPTION_KEYS as MarketingPlatformId[]).includes(id);
}

/** Save an inline-edited platform marketing asset. */
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
      asset?: Partial<PlatformMarketingAsset>;
    } | null;

    const platformId = body?.platformId as MarketingPlatformId | undefined;
    if (!platformId || !MARKETING_PLATFORM_IDS.includes(platformId)) {
      return apiError("Invalid platformId", "INVALID", 400);
    }
    if (!body?.asset || typeof body.asset !== "object") {
      return apiError("Missing asset", "INVALID", 400);
    }

    const progress = (task.stepProgress as StepProgress) ?? {};
    const step = progress.content_generate;
    if (step?.status !== "completed" || !step.output) {
      return apiError("Marketing pack not ready", "NOT_READY", 400);
    }

    const existing = normalizeMarketingContentPackage(step.output);
    if (!existing) return apiError("Invalid marketing pack", "INVALID", 400);

    const assets = { ...resolvePlatformAssets(existing) };
    const prev = assets[platformId] ?? { caption: "", cta: "", hashtags: [] };
    const merged: PlatformMarketingAsset = {
      ...prev,
      ...body.asset,
      caption: (body.asset.caption ?? prev.caption ?? "").toString(),
      cta: (body.asset.cta ?? prev.cta ?? "").toString(),
      hashtags: Array.isArray(body.asset.hashtags)
        ? body.asset.hashtags.filter((h): h is string => typeof h === "string")
        : (prev.hashtags ?? []),
    };

    const validated = PlatformMarketingAssetSchema.safeParse(merged);
    if (!validated.success) return apiError("Invalid asset", "INVALID", 400);
    assets[platformId] = validated.data;

    // Mirror the edited caption into every locale map so it displays regardless
    // of the active language tab (edits are authoritative across locales).
    const captions = { ...existing.captions } as MarketingCaptions;
    const captionsEn = { ...(existing.captionsEn ?? {}) } as Partial<MarketingCaptions>;
    const captionsMs = { ...(existing.captionsMs ?? {}) } as Partial<MarketingCaptions>;
    if (isCaptionKey(platformId)) {
      const text = validated.data.caption;
      captions[platformId] = text;
      captionsEn[platformId] = text;
      captionsMs[platformId] = text;
    }

    const updatedPackage = normalizeMarketingContentPackage({
      ...existing,
      platformAssets: assets,
      captions,
      captionsEn,
      captionsMs,
    });
    if (!updatedPackage) return apiError("Invalid marketing pack", "INVALID", 400);

    const updatedProgress: StepProgress = {
      ...progress,
      content_generate: { ...step, output: updatedPackage },
    };

    await db
      .update(schema.tasks)
      .set({ stepProgress: updatedProgress })
      .where(eq(schema.tasks.id, id));

    return apiSuccess({ contentPackage: updatedPackage });
  } catch (error) {
    return handleApiError(error);
  }
}
