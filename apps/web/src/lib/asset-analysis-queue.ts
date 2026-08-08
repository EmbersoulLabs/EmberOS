import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueAssetAnalysis } from "@ceo-agent/queue";

export type AssetAnalysisStatus =
  | "pending"
  | "analyzing"
  | "completed"
  | "failed"
  | "not_applicable";

function analysisStatus(metadata: unknown): AssetAnalysisStatus | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const state = (metadata as Record<string, unknown>).assetAnalysis;
  if (!state || typeof state !== "object") return undefined;
  const status = (state as Record<string, unknown>).status;
  return typeof status === "string" ? (status as AssetAnalysisStatus) : undefined;
}

async function mergeAnalysisState(
  assetId: string,
  workspaceId: string,
  state: Record<string, unknown>
) {
  const db = getDb();
  const patch = JSON.stringify({ assetAnalysis: state });
  await db
    .update(schema.assets)
    .set({
      metadata: sql`coalesce(${schema.assets.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.assets.id, assetId),
        eq(schema.assets.workspaceId, workspaceId),
        isNull(schema.assets.deletedAt)
      )
    );
}

/**
 * Best-effort post-confirm enqueue. Upload success never depends on provider or
 * queue availability; failures are recorded on the Asset for a later retry.
 */
export async function enqueueImageAnalysisAfterConfirm(input: {
  assetId: string;
  workspaceId: string;
  type: string;
  metadata: unknown;
}): Promise<AssetAnalysisStatus> {
  if (input.type !== "image") return "not_applicable";

  const current = analysisStatus(input.metadata);
  if (current === "pending" || current === "analyzing" || current === "completed") {
    return current;
  }

  const queuedAt = new Date().toISOString();
  await mergeAnalysisState(input.assetId, input.workspaceId, {
    status: "pending",
    queuedAt,
    attempts: 0,
  });

  try {
    await enqueueAssetAnalysis({
      assetId: input.assetId,
      workspaceId: input.workspaceId,
    });
    return "pending";
  } catch (error) {
    await mergeAnalysisState(input.assetId, input.workspaceId, {
      status: "failed",
      queuedAt,
      failedAt: new Date().toISOString(),
      error: "Asset analysis could not be queued. Retry the upload confirmation.",
    }).catch(() => undefined);
    console.warn(
      `[asset-analysis] enqueue failed asset=${input.assetId}:`,
      error instanceof Error ? error.message : error
    );
    return "failed";
  }
}
