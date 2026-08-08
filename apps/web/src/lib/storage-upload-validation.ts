import { MAX_UPLOAD_SIZE_BYTES } from "@ceo-agent/shared";
import { createAdminClient } from "@/lib/supabase/admin";

export type UploadValidationFailure = {
  ok: false;
  code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "MIME_NOT_ALLOWED";
  error: string;
};

export type UploadValidationResult =
  | { ok: true; configuredMaxBytes: number }
  | UploadValidationFailure;

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${Math.floor(mb)} MB`;
}

function mimeAllowed(mimeType: string, allowed: string[]): boolean {
  return allowed.some((entry) => {
    if (entry.endsWith("/*")) return mimeType.startsWith(entry.slice(0, -1));
    return entry.toLowerCase() === mimeType.toLowerCase();
  });
}

/** Match application validation to the actual configured Supabase bucket. */
export async function validateStorageUpload(input: {
  sizeBytes: number;
  mimeType: string;
  bucket: string;
}): Promise<UploadValidationResult> {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, code: "EMPTY_FILE", error: "The selected file is empty." };
  }

  let bucketLimit = MAX_UPLOAD_SIZE_BYTES;
  let allowedMimeTypes: string[] = [];
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage.getBucket(input.bucket);
  if (!error && data) {
    if (typeof data.file_size_limit === "number" && data.file_size_limit > 0) {
      bucketLimit = Math.min(bucketLimit, data.file_size_limit);
    }
    if (Array.isArray(data.allowed_mime_types)) {
      allowedMimeTypes = data.allowed_mime_types.filter(
        (item): item is string => typeof item === "string" && item.length > 0
      );
    }
  }

  if (input.sizeBytes > bucketLimit) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      error: `File is too large. This storage environment accepts files up to ${formatBytes(bucketLimit)}.`,
    };
  }
  if (allowedMimeTypes.length > 0 && !mimeAllowed(input.mimeType, allowedMimeTypes)) {
    return {
      ok: false,
      code: "MIME_NOT_ALLOWED",
      error: `File type ${input.mimeType} is not allowed by storage.`,
    };
  }
  return { ok: true, configuredMaxBytes: bucketLimit };
}
