import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  PRODUCT_TRANSPARENCY_INSPECTION_POLICY,
  deriveProductBackgroundSuitabilityAuthority,
  type ProductBackgroundSuitabilityAuthority,
} from "@ceo-agent/shared/server";
import { resolveStoryProductSources } from "@/lib/ai-story-product-sources";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof getDb>;

export class AiStoryProductBackgroundSuitabilityError extends Error {
  readonly code = "PRODUCT_BACKGROUND_SUITABILITY_AUTHORITY_REQUIRED" as const;

  constructor(message: string) {
    super(message);
    this.name = "AiStoryProductBackgroundSuitabilityError";
  }
}

type Dependencies = {
  resolveSources: typeof resolveStoryProductSources;
  readStoredBytes: (storagePath: string) => Promise<Buffer>;
};

async function readCanonicalPrivateAssetBytes(storagePath: string): Promise<Buffer> {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  const { data, error } = await createAdminClient().storage.from(bucket).download(storagePath);
  if (error || !data) {
    throw new AiStoryProductBackgroundSuitabilityError(
      error?.message ?? "Canonical Product source object is unavailable"
    );
  }
  const maximum = PRODUCT_TRANSPARENCY_INSPECTION_POLICY.maximumSourceBytes;
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const reader = data.stream().getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximum) {
      await reader.cancel("Product source byte bound exceeded");
      throw new AiStoryProductBackgroundSuitabilityError(
        "Product source exceeds the bounded inspection size"
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, byteLength);
}

/**
 * Derives read-only suitability for one exact persisted Story product_source.
 * It never finalizes Asset identity, writes metadata, or requests extraction.
 */
export async function deriveStoryProductBackgroundSuitability(
  db: Db,
  input: {
    storyId: string;
    orgId: string;
    workspaceId: string;
    campaignId: string;
    productAuthorityId: string;
  },
  dependencies: Dependencies = {
    resolveSources: resolveStoryProductSources,
    readStoredBytes: readCanonicalPrivateAssetBytes,
  }
): Promise<ProductBackgroundSuitabilityAuthority> {
  const sources = await dependencies.resolveSources(db, input);
  const source = sources.find((candidate) => candidate.assetId === input.productAuthorityId);
  if (!source) {
    throw new AiStoryProductBackgroundSuitabilityError(
      "Product authority is not an exact current Story product_source"
    );
  }

  const [asset] = await db
    .select({
      id: schema.assets.id,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
      status: schema.assets.status,
      deletedAt: schema.assets.deletedAt,
      contentHash: schema.assets.contentHash,
      mimeType: schema.assets.mimeType,
      storagePath: schema.assets.storagePath,
      fileSizeBytes: schema.assets.fileSizeBytes,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.id, source.assetId),
        eq(schema.assets.orgId, input.orgId),
        eq(schema.assets.workspaceId, input.workspaceId),
        eq(schema.assets.status, "ready"),
        isNull(schema.assets.deletedAt)
      )
    )
    .limit(1);
  if (
    !asset ||
    asset.contentHash !== source.contentHash ||
    !asset.mimeType ||
    (asset.fileSizeBytes != null &&
      asset.fileSizeBytes > PRODUCT_TRANSPARENCY_INSPECTION_POLICY.maximumSourceBytes)
  ) {
    throw new AiStoryProductBackgroundSuitabilityError(
      "Canonical Product source is stale, unavailable, unsupported in size, or lacks media identity"
    );
  }

  const bytes = await dependencies.readStoredBytes(asset.storagePath);
  return deriveProductBackgroundSuitabilityAuthority({
    source: {
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      productAuthorityId: source.assetId,
      sourceAssetId: source.assetId,
      sourceAssetContentHash: source.contentHash,
      mimeType: asset.mimeType,
    },
    bytes,
  });
}
