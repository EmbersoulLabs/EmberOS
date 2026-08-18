import {
  isPhotoSceneTenantStoragePath,
  isPublicUrlStorageIdentity,
} from "@ceo-agent/shared";
import { createAdminClient } from "@/lib/supabase/admin";

export const ASSET_SIGNED_URL_TTL_SECONDS = 10 * 60;

function configuredBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
}

export function resolveExpectedPrivateAssetKey(
  reference: string,
  expectedObjectKey: string
): string {
  if (reference === expectedObjectKey) return expectedObjectKey;
  throw new Error("Invalid or unauthorized asset object reference");
}

export async function signPrivateCampaignAsset(input: {
  workspaceId: string;
  storagePath: string;
  download?: string;
}): Promise<string> {
  if (isPublicUrlStorageIdentity(input.storagePath)) {
    throw new Error("Public URL cannot be signed as Photo Scene identity");
  }
  if (!isPhotoSceneTenantStoragePath(input.workspaceId, input.storagePath)) {
    throw new Error("Asset object is outside the authorized workspace storage prefix");
  }
  const objectKey = resolveExpectedPrivateAssetKey(input.storagePath, input.storagePath);
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(configuredBucket())
    .createSignedUrl(
      objectKey,
      ASSET_SIGNED_URL_TTL_SECONDS,
      input.download ? { download: input.download } : undefined
    );
  if (error || !data?.signedUrl) {
    throw new Error("Unable to authorize asset delivery");
  }
  return data.signedUrl;
}
