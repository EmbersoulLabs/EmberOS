import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { isCanonicalSourceContentHash } from "@ceo-agent/shared";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof getDb>;
type Asset = typeof schema.assets.$inferSelect;

export class SourceAssetIdentityNotFinalizedError extends Error {
  readonly code = "SOURCE_ASSET_IDENTITY_NOT_FINALIZED";

  constructor(message: string) {
    super(message);
    this.name = "SourceAssetIdentityNotFinalizedError";
  }
}

export function canSafelyFinalizeLegacySourceAsset(
  asset: Pick<Asset, "type" | "durationSec" | "metadata"> & {
    deletedAt?: Date | string | null;
    source?: string | null;
  }
): boolean {
  if (asset.deletedAt) return false;
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  if (metadata.rejected === true) return false;
  if (asset.type !== "video") return true;
  if (asset.source === "library_upload") return true;
  if (asset.source === "system_generated" && metadata.merged === true) {
    return asset.durationSec != null;
  }
  return asset.durationSec != null && typeof metadata.codec === "string";
}

async function hashStoredAsset(storagePath: string): Promise<string> {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  const { data, error } = await createAdminClient().storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw new SourceAssetIdentityNotFinalizedError(
      error?.message ?? "Canonical source object is unavailable"
    );
  }

  const hash = createHash("sha256");
  const reader = data.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function finalizeStoredSourceAssetIdentity(
  db: Db,
  asset: Asset
): Promise<Asset> {
  if (isCanonicalSourceContentHash(asset.contentHash)) return asset;
  if (!canSafelyFinalizeLegacySourceAsset(asset)) {
    throw new SourceAssetIdentityNotFinalizedError(
      `Source Asset ${asset.id} has not completed canonical byte finalization`
    );
  }

  const contentHash = await hashStoredAsset(asset.storagePath);
  await db
    .update(schema.assets)
    .set({ contentHash })
    .where(and(eq(schema.assets.id, asset.id), isNull(schema.assets.contentHash)));

  const [current] = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.id, asset.id))
    .limit(1);
  if (!current || !isCanonicalSourceContentHash(current.contentHash)) {
    throw new SourceAssetIdentityNotFinalizedError(
      `Source Asset ${asset.id} content identity could not be persisted`
    );
  }
  return current;
}

export async function requireFinalizedCampaignSourceAssets(
  db: Db,
  assets: Asset[],
  expected: { organizationId: string; workspaceId: string }
): Promise<Asset[]> {
  const finalized: Asset[] = [];
  for (const asset of assets) {
    if (asset.orgId !== expected.organizationId || asset.workspaceId !== expected.workspaceId) {
      throw new SourceAssetIdentityNotFinalizedError(
        `Source Asset ${asset.id} ownership is invalid`
      );
    }
    finalized.push(await finalizeStoredSourceAssetIdentity(db, asset));
  }
  return finalized;
}
