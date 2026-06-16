import { eq, and } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueExport, enqueueRender } from "@ceo-agent/queue";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "client_viewer");

    const [job] = await db
      .select()
      .from(schema.publishJobs)
      .where(eq(schema.publishJobs.creativeId, id))
      .limit(1);

    return apiSuccess({
      status: job?.status ?? "none",
      exportPackUrl: job?.exportPackUrl,
    });
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
    const { id } = await params;
    const body = await request.json();
    const { platforms, resolution = "1080p" } = body as {
      platforms?: string[];
      resolution?: string;
    };

    const db = getDb();
    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "publisher");

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, creative.campaignId))
      .limit(1);

    if (creative.taskId && resolution === "1080p" && !creative.videoExportUrl) {
      await enqueueRender({
        taskId: creative.taskId,
        creativeId: id,
        workspaceId: creative.workspaceId,
        orgId: creative.orgId,
        campaignId: creative.campaignId,
        resolution: "export",
      });
    }

    const job = await enqueueExport({
      creativeId: id,
      workspaceId: creative.workspaceId,
      orgId: creative.orgId,
      campaignId: creative.campaignId,
      platforms: platforms ?? campaign?.platforms ?? ["tiktok"],
    });

    return apiSuccess({ jobId: job.id, status: "export_pending" }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
