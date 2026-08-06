import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { executeSkill } from "@ceo-agent/agents";
import { VisionAnalysisSchema, type VisionAnalysis } from "@ceo-agent/shared";

export function contentIntelligenceFromVision(vision: VisionAnalysis) {
  const contentLabels = Array.from(new Set([
    ...vision.products.map((product) => product.name),
    ...vision.products.flatMap((product) => product.attributes ?? []),
    ...vision.subjects,
  ].map((value) => value.trim()).filter(Boolean))).slice(0, 20);
  const contentSummary = [
    ...vision.products.map((product) => [product.name, ...(product.attributes ?? [])].join(" — ")),
    ...vision.scenes.slice(0, 4).map((scene) => scene.description),
    vision.transcriptSummary ?? "",
  ].filter(Boolean).join(". ").slice(0, 4000);
  return { contentSummary, contentLabels };
}

/** Best-effort post-vision naming; upload/pipeline success never depends on it. */
export async function refreshAnalyzedAssetDisplayName(taskId: string): Promise<void> {
  try {
    const db = getDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
    const progress = (task?.stepProgress ?? {}) as Record<string, { output?: unknown }>;
    const parsed = VisionAnalysisSchema.safeParse(progress.vision_analyze?.output);
    if (!task || !parsed.success) return;
    const [asset] = await db.select().from(schema.assets).where(and(eq(schema.assets.id, parsed.data.assetId), eq(schema.assets.workspaceId, task.workspaceId))).limit(1);
    if (!asset) return;
    const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
    if (metadata.displayNameSource === "manual") return;
    const intelligence = contentIntelligenceFromVision(parsed.data);
    if (!intelligence.contentSummary && !intelligence.contentLabels.length) return;
    let displayName = asset.displayName;
    let displayNameSource: "ai" | "fallback" = "fallback";
    try {
      const result = await executeSkill("asset-display-name", { originalFilename: asset.originalFilename || asset.displayName || "asset", type: asset.type, mimeType: asset.mimeType, ...intelligence });
      if (result.displayName?.trim()) { displayName = result.displayName.trim(); displayNameSource = "ai"; }
    } catch (error) {
      console.warn(`[asset-auto-name] naming failed asset=${asset.id}:`, error instanceof Error ? error.message : error);
    }
    await db.update(schema.assets).set({ displayName, metadata: { ...metadata, ...intelligence, visionAnalyzedAt: new Date().toISOString(), displayNameSource }, updatedAt: new Date() }).where(and(eq(schema.assets.id, asset.id), sql`coalesce(${schema.assets.metadata}->>'displayNameSource', '') <> 'manual'`));
  } catch (error) {
    console.warn(`[asset-auto-name] post-analysis update failed task=${taskId}:`, error instanceof Error ? error.message : error);
  }
}
