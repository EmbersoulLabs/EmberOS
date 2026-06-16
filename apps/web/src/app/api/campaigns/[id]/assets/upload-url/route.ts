import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueProbe } from "@ceo-agent/queue";
import { STORAGE_PATHS, MAX_UPLOAD_SIZE_BYTES } from "@ceo-agent/shared";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    const body = await request.json();
    const { filename, mimeType, type } = body as {
      filename: string;
      mimeType: string;
      type: "video" | "image";
    };

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const assetId = randomUUID();
    const ext = filename.split(".").pop() ?? "mp4";
    const storagePath = STORAGE_PATHS.source(campaign.workspaceId, campaignId, assetId, ext);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";

    const signRes = await fetch(
      `${supabaseUrl}/storage/v1/object/upload/sign/${bucket}/${storagePath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      }
    );

    let uploadUrl: string;
    if (signRes.ok) {
      const data = (await signRes.json()) as { url: string };
      uploadUrl = data.url;
    } else {
      uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`;
    }

    await db.insert(schema.assets).values({
      id: assetId,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      type,
      storagePath,
      mimeType,
      fileSizeBytes: MAX_UPLOAD_SIZE_BYTES,
    });

    return apiSuccess({ uploadUrl, assetId, storagePath }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
