import { MAX_UPLOAD_SIZE_BYTES, resolveLibraryAssetType } from "@ceo-agent/shared";

export type LibraryUploadPhase = "uploading" | "finalizing" | "completed";

export async function uploadLibraryFile(
  workspaceId: string,
  file: File,
  onPhase?: (phase: LibraryUploadPhase) => void
) {
  const type = resolveLibraryAssetType({ filename: file.name, mimeType: file.type || "application/octet-stream" });
  if (!type.ok) throw new Error(type.error);
  if (file.size <= 0 || file.size > MAX_UPLOAD_SIZE_BYTES) throw new Error("File exceeds the upload limit");
  onPhase?.("uploading");
  const prepare = await fetch(`/api/workspaces/${workspaceId}/library`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type || "application/octet-stream", type: type.type, fileSizeBytes: file.size }),
  });
  const prepared = await prepare.json();
  if (!prepare.ok || !prepared.uploadUrl || !prepared.assetId) throw new Error(prepared.error ?? "Upload preparation failed");
  const uploaded = await fetch(prepared.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploaded.ok) throw new Error("Private object upload failed");
  onPhase?.("finalizing");
  const confirm = await fetch(`/api/workspaces/${workspaceId}/library/${prepared.assetId}/confirm`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileSizeBytes: file.size }),
  });
  const finalized = await confirm.json();
  if (!confirm.ok) throw new Error(finalized.error ?? "Upload finalization failed");
  onPhase?.("completed");
  return finalized.asset;
}
