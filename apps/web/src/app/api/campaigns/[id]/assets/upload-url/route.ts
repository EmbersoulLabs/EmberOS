import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORAGE_PATHS, MAX_UPLOAD_SIZE_BYTES, assessFinishedAdRisk } from "@ceo-agent/shared";
import { validateNewAssetUpload } from "@/lib/campaign-assets";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    const body = await request.json();
    const { filename, mimeType, type, fileSizeBytes } = body as {
      filename: string;
      mimeType: string;
      type: "video" | "image";
      fileSizeBytes?: number;
    };

    if (!filename || !mimeType || !type) {
      return apiError("filename, mimeType, and type are required", "VALIDATION_ERROR", 400);
    }

    const size = fileSizeBytes ?? 0;
    if (size <= 0 || size > MAX_UPLOAD_SIZE_BYTES) {
      return apiError(
        `File size must be between 1 byte and ${MAX_UPLOAD_SIZE_BYTES} bytes`,
        "VALIDATION_ERROR",
        400
      );
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const assetCheck = await validateNewAssetUpload(db, campaignId, campaign.workspaceId, type);
    if (!assetCheck.ok) return apiError(assetCheck.error, "VALIDATION_ERROR", 400);

    const assetId = randomUUID();
    const ext = filename.split(".").pop() ?? "mp4";
    const storagePath = STORAGE_PATHS.source(campaign.workspaceId, campaignId, assetId, ext);
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";

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
      campaignId,
      type,
      storagePath,
      mimeType,
      fileSizeBytes: size,
      metadata: {
        originalFilename: filename,
        finishedAdRisk: filenameRisk,
      },
    });

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
