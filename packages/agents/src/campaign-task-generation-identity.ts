import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  CampaignVideoGenerationFingerprintSchema,
  CampaignVideoGenerationIdentityV1Schema,
  type CampaignVideoGenerationIdentityV1,
} from "@ceo-agent/shared";
import { fingerprintCampaignVideoGenerationIdentityV1 } from "@ceo-agent/shared/server";

export class CampaignTaskGenerationIdentityError extends Error {
  readonly code:
    | "LEGACY_TASK_IDENTITY_UNKNOWN"
    | "TASK_GENERATION_IDENTITY_INVALID"
    | "FROZEN_SOURCE_IDENTITY_MISMATCH";
  constructor(code: CampaignTaskGenerationIdentityError["code"], message: string) {
    super(message);
    this.name = "CampaignTaskGenerationIdentityError";
    this.code = code;
  }
}

export async function loadTrackedCampaignTaskInputs(taskId: string) {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.generationInputCapsule == null && task.generationInputFingerprint == null) {
    throw new CampaignTaskGenerationIdentityError(
      "LEGACY_TASK_IDENTITY_UNKNOWN",
      "Legacy task cannot be retried with reconstructed Campaign inputs"
    );
  }
  const parsed = CampaignVideoGenerationIdentityV1Schema.safeParse(task.generationInputCapsule);
  const fingerprint = CampaignVideoGenerationFingerprintSchema.safeParse(
    task.generationInputFingerprint
  );
  if (
    !parsed.success ||
    !fingerprint.success ||
    fingerprintCampaignVideoGenerationIdentityV1(parsed.data) !== fingerprint.data
  ) {
    throw new CampaignTaskGenerationIdentityError(
      "TASK_GENERATION_IDENTITY_INVALID",
      "Task generation capsule or fingerprint is invalid"
    );
  }
  const capsule = parsed.data;
  if (
    capsule.authority.organizationId !== task.orgId ||
    capsule.authority.workspaceId !== task.workspaceId ||
    capsule.authority.campaignId !== task.campaignId
  ) {
    throw new CampaignTaskGenerationIdentityError(
      "TASK_GENERATION_IDENTITY_INVALID",
      "Task generation authority does not match task ownership"
    );
  }
  const ids = capsule.generation.sources.map((source) => source.assetId);
  const rows = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        inArray(schema.assets.id, ids),
        eq(schema.assets.orgId, task.orgId),
        eq(schema.assets.workspaceId, task.workspaceId)
      )
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const assets = capsule.generation.sources.map((source) => {
    const asset = byId.get(source.assetId);
    const metadata = (asset?.metadata ?? {}) as Record<string, unknown>;
    if (
      !asset ||
      metadata.rejected === true ||
      asset.contentHash !== source.contentHash ||
      asset.type !== source.mediaKind
    ) {
      throw new CampaignTaskGenerationIdentityError(
        "FROZEN_SOURCE_IDENTITY_MISMATCH",
        `Frozen source identity no longer matches Asset ${source.assetId}`
      );
    }
    return asset;
  });
  const campaignAssets = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.campaignId, task.campaignId),
        eq(schema.assets.workspaceId, task.workspaceId)
      )
    );
  const videoIds = capsule.generation.sources
    .filter((source) => source.mediaKind === "video")
    .map((source) => source.assetId);
  const merged = campaignAssets.find((asset) => {
    const metadata = asset.metadata as Record<string, unknown> | null;
    return (
      metadata?.merged === true &&
      Array.isArray(metadata.mergedFrom) &&
      metadata.mergedFrom.length === videoIds.length &&
      metadata.mergedFrom.every((id, index) => id === videoIds[index])
    );
  });
  return {
    task,
    capsule,
    assets: merged ? [...assets, merged] : assets,
  };
}
