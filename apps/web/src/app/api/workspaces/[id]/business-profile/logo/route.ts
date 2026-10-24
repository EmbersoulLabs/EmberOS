import {
  getBusinessProfileByWorkspace,
  requireWorkspaceRole,
  updateBusinessProfile,
} from "@ceo-agent/db";
import { isUuid, normalizeBusinessProfileRecord } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getBusinessLogoBucket,
  businessLogoStorageFromPersistedValue,
  createBusinessLogoStoragePath,
  detectAllowedBusinessLogoImageType,
  isBusinessLogoMimeType,
  publicBusinessLogoUrl,
} from "@/lib/business-logo-storage";

async function deleteStoredBusinessLogo(
  value: string | null | undefined,
  workspaceId: string
) {
  const resolved = businessLogoStorageFromPersistedValue(value, workspaceId);
  if (!resolved) return;

  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(resolved.bucket).remove([resolved.objectKey]);
  if (error) {
    console.warn(`[business-profile-logo] old logo cleanup failed: ${error.message}`);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }

    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return apiError("Invalid upload body", "VALIDATION_ERROR", 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return apiError("Logo file is required", "VALIDATION_ERROR", 400);
    }

    if (!isBusinessLogoMimeType(file.type)) {
      return apiError("Logo must be an image file", "VALIDATION_ERROR", 400);
    }

    // `file.type` is a client-supplied form field and can't be trusted on its
    // own — confirm the actual bytes are one of the raster formats we accept
    // before this ever reaches the public bucket.
    const bytes = await file.arrayBuffer();
    const detectedMimeType = detectAllowedBusinessLogoImageType(new Uint8Array(bytes));
    if (!detectedMimeType) {
      return apiError("Logo file content does not match a supported image format", "VALIDATION_ERROR", 400);
    }

    const current = await getBusinessProfileByWorkspace(workspaceId);
    const storagePath = createBusinessLogoStoragePath(workspaceId, file.name, detectedMimeType);
    const bucket = getBusinessLogoBucket();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      return apiError("Storage is not configured", "STORAGE_ERROR", 502);
    }

    const supabase = createAdminClient();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(storagePath, Buffer.from(bytes), {
        contentType: detectedMimeType,
        upsert: false,
      });

    if (error) {
      return apiError(error.message, "STORAGE_ERROR", 502);
    }

    const logoUrl = publicBusinessLogoUrl(supabaseUrl, bucket, storagePath);
    let row: unknown;
    try {
      row = await updateBusinessProfile(member.orgId, workspaceId, user.id, {
        logo: logoUrl,
      });
    } catch (error) {
      const { error: cleanupError } = await supabase.storage.from(bucket).remove([storagePath]);
      if (cleanupError) {
        console.warn(`[business-profile-logo] upload rollback cleanup failed: ${cleanupError.message}`);
      }
      throw error;
    }

    await deleteStoredBusinessLogo(
      (current?.logo as string | null | undefined) ?? null,
      workspaceId
    );

    return apiSuccess({
      profile: normalizeBusinessProfileRecord(row as Record<string, unknown>),
      logo: logoUrl,
      storagePath,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }

    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const current = await getBusinessProfileByWorkspace(workspaceId);
    const row = await updateBusinessProfile(member.orgId, workspaceId, user.id, {
      logo: null,
    });

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl) {
      await deleteStoredBusinessLogo(
        (current?.logo as string | null | undefined) ?? null,
        workspaceId
      );
    }

    return apiSuccess({
      profile: normalizeBusinessProfileRecord(row as Record<string, unknown>),
      logo: null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
