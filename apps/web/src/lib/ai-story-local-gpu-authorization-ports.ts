import { autoAuthorizeReleasedLocalGpuPackages, type LocalGpuAuthorizationPorts, type LocalGpuAutoAuthorization } from "@ceo-agent/agents";
import { createAdminClient } from "@/lib/supabase/admin";

/** Runs after a committed release; the result is reported, never thrown. */
export function autoAuthorizeLocalGpuAfterRelease(input: {
  orgId: string; workspaceId: string; campaignId: string; executionPlanId: string; actorUserId: string;
}): Promise<LocalGpuAutoAuthorization> {
  return autoAuthorizeReleasedLocalGpuPackages({ ...input, env: process.env, ports: createWebLocalGpuAuthorizationPorts() });
}

/** Supabase storage and Desktop capability I/O for server-side LOCAL_GPU authorization. */
export function createWebLocalGpuAuthorizationPorts(): LocalGpuAuthorizationPorts {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  const storage = () => createAdminClient().storage.from(bucket);
  return {
    async fetchCapabilities({ url, token }) {
      const response = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = response.status === 200 ? await response.json() : null;
      return { status: response.status, body };
    },
    async createSignedUploadUrl(storagePath) {
      const { data, error } = await storage().createSignedUploadUrl(storagePath);
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
    async createSignedReadUrl(storagePath, expiresInSec) {
      const { data, error } = await storage().createSignedUrl(storagePath, expiresInSec);
      return error || !data?.signedUrl ? null : data.signedUrl;
    },
  };
}
