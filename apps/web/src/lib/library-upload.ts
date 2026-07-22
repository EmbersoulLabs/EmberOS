import { MAX_UPLOAD_SIZE_BYTES, resolveLibraryAssetType } from "@ceo-agent/shared";

export async function uploadLibraryFile(
  workspaceId: string,
  file: File,
  onProgress?: (label: string) => void
): Promise<{ assetId: string }> {
  const typeCheck = resolveLibraryAssetType({
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
  });
  if (!typeCheck.ok) throw new Error(typeCheck.error);
  if (file.size <= 0 || file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error("File too large");
  }

  onProgress?.(file.name);
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

  const uploadRes = await fetch(urlData.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadRes.ok) {
    throw new Error(`Upload failed for ${file.name} (${uploadRes.status})`);
  }

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

  return { assetId: urlData.assetId as string };
}
