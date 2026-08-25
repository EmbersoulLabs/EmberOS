import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { assetSearchCondition, getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid, LibraryUploadBodySchema, MAX_UPLOAD_SIZE_BYTES, resolveLibraryAssetType, STORAGE_PATHS } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "client_viewer");
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const type = url.searchParams.get("type")?.trim() ?? "";
    const sort = url.searchParams.get("sort")?.trim() ?? "newest";
    const conditions = [
      eq(schema.assets.orgId, member.orgId),
      eq(schema.assets.workspaceId, workspaceId),
      isNull(schema.assets.deletedAt),
    ];
    if (["image", "video", "audio", "pdf"].includes(type)) conditions.push(eq(schema.assets.type, type));
    const search = query ? assetSearchCondition(query) : null;
    if (search) conditions.push(search);
    const order = sort === "name"
      ? asc(sql`lower(coalesce(${schema.assets.displayName}, ${schema.assets.originalFilename}, ''))`)
      : sort === "size" ? desc(schema.assets.fileSizeBytes) : desc(schema.assets.createdAt);
    const assets = await getDb().select().from(schema.assets).where(and(...conditions)).orderBy(order).limit(500);
    return apiSuccess({ assets });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const limited = await enforceRateLimit(request, "uploadUrl", user.id);
    if (limited) return limited;
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const parsed = LibraryUploadBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid upload request", "VALIDATION_ERROR", 400);
    const type = resolveLibraryAssetType(parsed.data);
    if (!type.ok) return apiError(type.error, "VALIDATION_ERROR", 400);
    if (parsed.data.fileSizeBytes > MAX_UPLOAD_SIZE_BYTES) {
      return apiError("File exceeds the configured upload limit", "VALIDATION_ERROR", 400);
    }
    const assetId = randomUUID();
    const extension = parsed.data.filename.split(".").pop()?.toLowerCase() || type.type;
    const storagePath = STORAGE_PATHS.library(workspaceId, assetId, extension);
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    const { data, error } = await createAdminClient().storage.from(bucket).createSignedUploadUrl(storagePath);
    if (error || !data?.signedUrl) return apiError("Unable to authorize private upload", "STORAGE_ERROR", 502);
    await getDb().insert(schema.assets).values({
      id: assetId,
      orgId: member.orgId,
      workspaceId,
      campaignId: null,
      type: type.type,
      storagePath,
      displayName: parsed.data.filename,
      originalFilename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      fileSizeBytes: parsed.data.fileSizeBytes,
      status: "uploading",
      source: "library_upload",
      uploadedBy: user.id,
      metadata: { originalFilename: parsed.data.filename },
    });
    return apiSuccess({ assetId, uploadUrl: data.signedUrl, type: type.type }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

