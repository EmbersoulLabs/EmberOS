import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  canUseSubtitleOnlyRerender,
  narrationScriptChanged,
  syncEditPlanFromCopy,
  type CopyVariant,
  type EditPlan,
} from "@ceo-agent/shared";
import { enqueuePreviewSubtitleRerender } from "@/lib/render-queue";

export type CopyPatchInput = {
  variantId: string;
  hook?: string;
  body?: string;
  cta?: string;
  tags?: string[];
  title?: string;
};

export async function applyCreativeCopyPatch(creativeId: string, input: CopyPatchInput) {
  const db = getDb();
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, creativeId))
    .limit(1);

  if (!creative) return { error: "Creative not found" as const, code: "NOT_FOUND" as const };

  const variants = [...((creative.copyVariants ?? []) as CopyVariant[])];
  const idx = variants.findIndex((v) => v.id === input.variantId);
  if (idx === -1) return { error: "Variant not found" as const, code: "NOT_FOUND" as const };

  variants[idx] = {
    ...variants[idx]!,
    ...(input.hook !== undefined && { hook: input.hook }),
    ...(input.body !== undefined && { body: input.body }),
    ...(input.cta !== undefined && { cta: input.cta }),
    ...(input.tags !== undefined && { tags: input.tags }),
    ...(input.title !== undefined && { title: input.title }),
  };

  const scriptFieldsChanged =
    input.hook !== undefined || input.body !== undefined || input.cta !== undefined;

  const previousPlan = creative.editPlan as EditPlan | null;
  let nextEditPlan = previousPlan;
  let rerenderQueued = false;

  if (previousPlan && scriptFieldsChanged) {
    const pairLocale = variants[idx]!.locale === "zh" ? "en" : "zh";
    const altVariant = variants.find((v) => v.locale === pairLocale);
    nextEditPlan = syncEditPlanFromCopy(previousPlan, variants[idx]!, altVariant);

    const canRerender = Boolean(creative.videoUrl || creative.renderCachePath);
    const shouldRerender =
      canRerender &&
      creative.taskId &&
      (narrationScriptChanged(previousPlan, nextEditPlan) ||
        JSON.stringify(previousPlan.subtitles) !== JSON.stringify(nextEditPlan.subtitles));

    if (shouldRerender) {
      const renderMode = canUseSubtitleOnlyRerender(previousPlan, nextEditPlan)
        ? "subtitles_only"
        : "preview";

      const [updated] = await db
        .update(schema.creatives)
        .set({
          copyVariants: variants,
          editPlan: nextEditPlan,
          renderStatus: "preview_rendering",
          renderProgress: {
            percent: 0,
            phase: "queued",
            mode: renderMode,
            updatedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.creatives.id, creativeId))
        .returning();

      try {
        await enqueuePreviewSubtitleRerender(creativeId, renderMode);
        rerenderQueued = true;
        return { creative: updated, rerenderQueued };
      } catch (enqueueErr) {
        const message =
          enqueueErr instanceof Error ? enqueueErr.message : "Failed to enqueue render job";
        await db
          .update(schema.creatives)
          .set({
            renderStatus: "preview_ready",
            renderProgress: {
              percent: 0,
              phase: "queued",
              error: message,
              updatedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(schema.creatives.id, creativeId));
        return { error: message, code: "QUEUE_ERROR" as const };
      }
    }
  }

  const [updated] = await db
    .update(schema.creatives)
    .set({
      copyVariants: variants,
      ...(nextEditPlan ? { editPlan: nextEditPlan } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.creatives.id, creativeId))
    .returning();

  return { creative: updated, rerenderQueued };
}
