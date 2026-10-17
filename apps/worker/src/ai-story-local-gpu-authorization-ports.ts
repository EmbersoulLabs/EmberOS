import type { LocalGpuAuthorizationPorts } from "@ceo-agent/agents";
import { createSignedStorageReadUrl, createSignedStorageUploadUrl } from "./storage";

/** Worker-side storage and Desktop capability I/O for server-derived LOCAL_GPU authority. */
export function createWorkerLocalGpuAuthorizationPorts(): LocalGpuAuthorizationPorts {
  return {
    async fetchCapabilities({ url, token }) {
      const response = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}` } });
      const body = response.status === 200 ? await response.json() : null;
      return { status: response.status, body };
    },
    createSignedUploadUrl: createSignedStorageUploadUrl,
    async createSignedReadUrl(storagePath, expiresInSec) {
      try {
        return await createSignedStorageReadUrl(storagePath, expiresInSec);
      } catch {
        return null;
      }
    },
  };
}
