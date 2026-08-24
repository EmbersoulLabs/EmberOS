import { and, eq } from "drizzle-orm";
import {
  type MinimaxAssetAccessResolver,
  type SeedanceAssetAccessResolver,
} from "@ceo-agent/agents";
import { getDb, schema } from "@ceo-agent/db";
import { createSignedStorageReadUrl } from "./storage";

type ProviderAssetAccessInput = Parameters<
  SeedanceAssetAccessResolver["resolveProviderAccessibleUri"]
>[0];

type AuthorizedAsset = {
  readonly storagePath: string;
  readonly mimeType: string | null;
};

export type WorkerProviderAssetAccessDependencies = {
  readonly loadAuthorizedAsset?: (
    input: ProviderAssetAccessInput
  ) => Promise<AuthorizedAsset | null>;
  readonly mintSignedUrl?: (storagePath: string) => Promise<string>;
};

async function loadAuthorizedAsset(
  input: ProviderAssetAccessInput
): Promise<AuthorizedAsset | null> {
  const [asset] = await getDb()
    .select({
      storagePath: schema.assets.storagePath,
      mimeType: schema.assets.mimeType,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.id, input.assetId),
        eq(schema.assets.orgId, input.orgId),
        eq(schema.assets.workspaceId, input.workspaceId),
        eq(schema.assets.campaignId, input.campaignId)
      )
    )
    .limit(1);
  return asset ?? null;
}

/**
 * Resolve a stable Campaign Asset ID to a provider-readable URL just in time.
 * Authorization is proved from server-owned DB fields; caller paths and URLs are not authority.
 */
export function createWorkerProviderAssetAccessResolver(
  deps: WorkerProviderAssetAccessDependencies = {}
): SeedanceAssetAccessResolver & MinimaxAssetAccessResolver {
  const load = deps.loadAuthorizedAsset ?? loadAuthorizedAsset;
  const mint = deps.mintSignedUrl ?? createSignedStorageReadUrl;
  return {
    async resolveProviderAccessibleUri(input): Promise<string> {
      const asset = await load(input);
      if (!asset) {
        throw new Error("Campaign Asset is not authorized for this execution envelope");
      }
      if (!asset.mimeType?.toLowerCase().startsWith("image/")) {
        throw new Error("Campaign Asset is not a supported visual reference");
      }
      if (input.storagePath && input.storagePath !== asset.storagePath) {
        throw new Error("Campaign Asset storage identity mismatch");
      }
      const signedUrl = await mint(asset.storagePath);
      if (!/^https:\/\//i.test(signedUrl)) {
        throw new Error("Provider asset resolver returned an invalid URL");
      }
      return signedUrl;
    },
  };
}
