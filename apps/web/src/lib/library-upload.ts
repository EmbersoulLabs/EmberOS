import {
  MAX_UPLOAD_SIZE_BYTES,
  resolveLibraryAssetType,
  resolveAssetDisplayLabel,
} from "@ceo-agent/shared";
import { putWithProgress } from "@/lib/upload-with-progress";

export type LibraryUploadPhase = "uploading" | "processing" | "completed";

export type LibraryUploadResult = {
  assetId: string;
  displayName: string;
  originalFilename: string;
  type: string;
  mimeType: string;
  status: string;
};

/**
 * Upload to Asset Library with explicit phases (QA-001 / QA-002 / QA-004).
 * Uploading → Processing → Completed; caller must return UI to idle after completed.
 */
export async function uploadLibraryFile(
  workspaceId: string,
  file: File,
  onPhase?: (phase: LibraryUploadPhase, detail?: string) => void
): Promise<LibraryUploadResult> {
  const typeCheck = resolveLibraryAssetType({
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
  });
  if (!typeCheck.ok) throw new Error(typeCheck.error);
  if (file.size <= 0 || file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error("File too large");
  }

  onPhase?.("uploading", file.name);
  const urlRes = await fetch(`/api/workspaces/${workspaceId}/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      type: typeCheck.type,
      fileSizeBytes: file.size,
    }),
  });
  const urlData = await urlRes.json();
  if (!urlRes.ok || !urlData.assetId || !urlData.uploadUrl) {
    throw new Error(urlData.error ?? `Failed to prepare upload for ${file.name}`);
  }

  await putWithProgress(
    urlData.uploadUrl as string,
    file,
    file.type || "application/octet-stream"
  );

  onPhase?.("processing", file.name);
  const confirmRes = await fetch(
    `/api/workspaces/${workspaceId}/library/${urlData.assetId}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileSizeBytes: file.size }),
    }
  );
  const confirmData = await confirmRes.json();
  if (!confirmRes.ok) {
    throw new Error(confirmData.error ?? `Failed to confirm upload for ${file.name}`);
  }

  const asset = confirmData.asset as
    | {
        id?: string;
        displayName?: string | null;
        originalFilename?: string | null;
        type?: string;
        mimeType?: string | null;
        status?: string;
      }
    | undefined;

  const displayName = resolveAssetDisplayLabel({
    displayName: asset?.displayName,
    originalFilename: asset?.originalFilename ?? file.name,
    id: (asset?.id || urlData.assetId) as string,
  });

  onPhase?.("completed", displayName);

  return {
    assetId: (asset?.id || urlData.assetId) as string,
    displayName,
    originalFilename: asset?.originalFilename ?? file.name,
    type: asset?.type ?? typeCheck.type,
    mimeType: asset?.mimeType ?? file.type ?? "application/octet-stream",
    status: asset?.status ?? "ready",
  };
}
