import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  assetSearchCondition,
  getDb,
  requireWorkspaceRole,
  schema,
} from "@ceo-agent/db";
import {
  isUuid,
  LibraryUploadBodySchema,
  resolveLibraryAssetType,
  STORAGE_PATHS,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isDatabaseSchemaError } from "@/lib/database-errors";
import { validateStorageUpload } from "@/lib/storage-upload-validation";

async function loadWorkspace(workspaceId: string) {
  const db = getDb();
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  return workspace ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const type = url.searchParams.get("type")?.trim() ?? "";
    const sort = url.searchParams.get("sort")?.trim() ?? "newest";

    const db = getDb();
    const conditions = [
      eq(schema.assets.workspaceId, workspaceId),
      isNull(schema.assets.deletedAt),
    ];
    if (type && ["image", "video", "audio", "pdf"].includes(type)) {
      conditions.push(eq(schema.assets.type, type));
    }

    let storyMatchedAssetIds: string[] = [];
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      const storyHits = await db
        .select({ assetId: schema.storyAssets.assetId })
        .from(schema.stories)
        .innerJoin(schema.storyAssets, eq(schema.storyAssets.storyId, schema.stories.id))
        .where(
          and(
            eq(schema.stories.workspaceId, workspaceId),
            isNull(schema.stories.deletedAt),
            sql`lower(${schema.stories.name}) like ${like}`
          )
        );
      storyMatchedAssetIds = [...new Set(storyHits.map((h) => h.assetId))];

      const nameSearch = assetSearchCondition(q);
      if (storyMatchedAssetIds.length > 0) {
        conditions.push(
          or(nameSearch!, inArray(schema.assets.id, storyMatchedAssetIds))!
        );
      } else if (nameSearch) {
        conditions.push(nameSearch);
      }
    }

    const order =
      sort === "name"
        ? asc(sql`lower(coalesce(${schema.assets.displayName}, ${schema.assets.originalFilename}, ''))`)
        : sort === "size"
          ? desc(schema.assets.fileSizeBytes)
          : desc(schema.assets.createdAt);

    const assets = await db
      .select()
      .from(schema.assets)
      .where(and(...conditions))
      .orderBy(order)
      .limit(500);

    return apiSuccess({ assets });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const limited = await enforceRateLimit(request, "uploadUrl", user.id);
    if (limited) return limited;

    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }

    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const workspace = await loadWorkspace(workspaceId);
    if (!workspace) return apiError("Workspace not found", "NOT_FOUND", 404);

    const parsed = LibraryUploadBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("filename and mimeType are required", "VALIDATION_ERROR", 400);
    }

    const { filename, mimeType, type: bodyType, fileSizeBytes } = parsed.data;
    const typeCheck = resolveLibraryAssetType({
      filename,
      mimeType,
      type: bodyType,
    });
    if (!typeCheck.ok) return apiError(typeCheck.error, "VALIDATION_ERROR", 400);

    const size = fileSizeBytes ?? 0;

    const assetId = randomUUID();
    const ext = filename.split(".").pop()?.toLowerCase() || typeCheck.type;
    const storagePath = STORAGE_PATHS.library(workspaceId, assetId, ext);
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

    const db = getDb();
    try {
      await db.insert(schema.assets).values({
        id: assetId,
        orgId: workspace.orgId,
        workspaceId,
        type: typeCheck.type,
        displayName: filename,
        originalFilename: filename,
        storagePath,
        mimeType,
        fileSizeBytes: size,
        status: "uploading",
        source: "library_upload",
        uploadedBy: user.id,
        metadata: { originalFilename: filename },
      });
    } catch (error) {
      console.error("Asset Library upload record creation failed", {
        workspaceId,
        assetId,
        schemaMismatch: isDatabaseSchemaError(error),
        error,
      });
      return apiError("Upload failed. Please try again.", "ASSET_UPLOAD_FAILED", 500);
    }

    return apiSuccess(
      {
        uploadUrl: data.signedUrl,
        assetId,
        storagePath,
        type: typeCheck.type,
        orgId: member.orgId,
      },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
