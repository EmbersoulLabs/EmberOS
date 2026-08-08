import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { attachAssetsToCampaign, getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  STORAGE_PATHS,
  assessFinishedAdRisk,
  resolveLibraryAssetType,
} from "@ceo-agent/shared";
import { validateNewAssetUpload } from "@/lib/campaign-assets";
import { enforceRateLimit } from "@/lib/rate-limit";
import { validateStorageUpload } from "@/lib/storage-upload-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const limited = await enforceRateLimit(request, "uploadUrl", user.id);
    if (limited) return limited;
    const { id: campaignId } = await params;
    const body = await request.json();
    const { filename, mimeType, type, fileSizeBytes, durationSec } = body as {
      filename: string;
      mimeType: string;
      type: "video" | "image";
      fileSizeBytes?: number;
      durationSec?: number;
    };

    if (!filename || !mimeType || !type) {
      return apiError("filename, mimeType, and type are required", "VALIDATION_ERROR", 400);
    }

    const typeCheck = resolveLibraryAssetType({ filename, mimeType, type });
    if (!typeCheck.ok || typeCheck.type !== type) {
      return apiError(
        typeCheck.ok ? "Declared asset type does not match the file MIME type." : typeCheck.error,
        "MIME_NOT_ALLOWED",
        400
      );
    }

    const size = fileSizeBytes ?? 0;

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const assetCheck = await validateNewAssetUpload(
      db,
      campaignId,
      campaign.workspaceId,
      type,
      type === "video" ? durationSec : undefined
    );
    if (!assetCheck.ok) return apiError(assetCheck.error, assetCheck.code, 400);

    const assetId = randomUUID();
    const ext = filename.split(".").pop() ?? "mp4";
    // PD-036: file lives in Workspace library; campaign only receives a reference.
    const storagePath = STORAGE_PATHS.library(campaign.workspaceId, assetId, ext);
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";

    const storageCheck = await validateStorageUpload({
      sizeBytes: size,
      mimeType,
      bucket,
    });
    if (!storageCheck.ok) {
      return apiError(storageCheck.error, storageCheck.code, 400);
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      return apiError(
        error?.message ?? "Failed to create signed upload URL",
        "STORAGE_ERROR",
        502
      );
    }

    const filenameRisk = assessFinishedAdRisk({ type, filename });

    await db.insert(schema.assets).values({
      id: assetId,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      type,
      displayName: filename,
      originalFilename: filename,
      storagePath,
      mimeType,
      fileSizeBytes: size,
      status: "uploading",
      source: "campaign_upload",
      uploadedBy: user.id,
      metadata: {
        originalFilename: filename,
        finishedAdRisk: filenameRisk,
        uploadContextCampaignId: campaignId,
      },
    });

    await attachAssetsToCampaign(db, campaignId, [assetId]);

    return apiSuccess(
      {
        uploadUrl: data.signedUrl,
        assetId,
        storagePath,
      },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
