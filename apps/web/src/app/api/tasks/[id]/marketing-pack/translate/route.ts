import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { enrichMarketingPackTranslations } from "@ceo-agent/agents";
import {
  isMarketingPackLocaleReady,
  normalizeMarketingContentPackage,
  readMarketingPackRevision,
  type MarketingPackLocale,
  type StepProgress,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  beginPaidMarketingCall,
  cancelPaidMarketingCall,
  finishPaidMarketingCall,
  saveMarketingPackIfCurrent,
} from "@/lib/marketing-pack-persistence";

const LOCALES = new Set<MarketingPackLocale>(["zh", "en", "ms"]);

export async function POST(
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
      locale?: string;
      contentRevision?: number;
    } | null;
    const locale = body?.locale;
    if (locale !== undefined && !LOCALES.has(locale as MarketingPackLocale)) {
      return apiError("Invalid locale", "INVALID", 400);
    }

    const progress = (task.stepProgress as StepProgress) ?? {};
    const step = progress.content_generate;
    if (step?.status !== "completed" || !step.output) {
      return apiError("Marketing pack not ready", "NOT_READY", 400);
    }

    const existing = normalizeMarketingContentPackage(step.output);
    if (!existing) return apiError("Invalid marketing pack", "INVALID", 400);

    const requested = (locale as MarketingPackLocale | undefined) ?? "en";
    if (requested !== "zh" && isMarketingPackLocaleReady(existing, requested)) {
      return apiSuccess({
        contentPackage: existing,
        contentRevision: readMarketingPackRevision(progress),
        usage: { input: 0, output: 0, costUsd: 0 },
        translationComplete: true,
      });
    }

    const gate = await beginPaidMarketingCall(id);
    if (!gate.ok) {
      return apiError("Task AI budget is exhausted", "BUDGET_EXCEEDED", 402);
    }

    let usageRecorded = false;
    try {
      const { contentPackage, usage } = await enrichMarketingPackTranslations(existing);
      await finishPaidMarketingCall(gate.reservation, {
        orgId: task.orgId,
        workspaceId: task.workspaceId,
        agent: "marketing_translate",
        usage,
      });
      usageRecorded = true;

      const complete = requested === "zh" || isMarketingPackLocaleReady(contentPackage, requested);
      if (!complete) {
        return apiError("Translation did not produce a complete locale", "TRANSLATION_INCOMPLETE", 422);
      }

      const expectedRevision =
        typeof body?.contentRevision === "number" ? body.contentRevision : readMarketingPackRevision(progress);
      const saved = await saveMarketingPackIfCurrent({
        taskId: id,
        expectedRevision,
        contentPackage,
      });
      if (!saved.ok) {
        return apiError("Marketing pack was updated by someone else.", "CONFLICT", 409);
      }

      return apiSuccess({
        contentPackage,
        contentRevision: saved.revision,
        usage,
        translationComplete: true,
      });
    } catch (error) {
      if (!usageRecorded) await cancelPaidMarketingCall(gate.reservation);
      return handleApiError(error);
    }
  } catch (error) {
    return handleApiError(error);
  }
}
