import { eq, desc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueExport } from "@ceo-agent/queue";
import { enqueueFinalRenderForCreative } from "@/lib/render-queue";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isCampaignExportable } from "@ceo-agent/shared";

const EXPORTABLE_CREATIVE_STATUSES = new Set([
  "approved",
  "export_ready",
  "exported",
]);

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
      .orderBy(desc(schema.publishJobs.createdAt))
      .limit(1);

    const renderStatus = creative.renderStatus ?? "none";
    const hasPreview = Boolean(creative.videoUrl);
    const hasFinal = Boolean(creative.videoExportUrl);
    const canExportPack =
      hasFinal &&
      (creative.status === "approved" ||
        creative.renderStatus === "final_ready" ||
        EXPORTABLE_CREATIVE_STATUSES.has(creative.status));

    let blockReason: string | null = null;
    if (!hasPreview) {
      blockReason = "preview_not_ready";
    } else if (renderStatus === "final_rendering") {
      blockReason = "final_rendering";
    } else if (!hasFinal) {
      blockReason = "final_not_ready";
    } else if (!canExportPack) {
      blockReason = "not_approved";
    }

    return apiSuccess({
      status: job?.status ?? (renderStatus === "final_rendering" ? "final_rendering" : "none"),
      exportPackUrl: job?.exportPackUrl ?? null,
      exportError:
        job?.status === "export_failed"
          ? "Export job failed. Check worker logs and retry."
          : null,
      creativeStatus: creative.status,
      renderStatus,
      hasPreview,
      hasFinal,
      canExportPack,
      blockReason,
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
    const limited = await enforceRateLimit(request, "export", user.id);
    if (limited) return limited;
    const { id } = await params;
    const body = await request.json();
    const { platforms } = body as { platforms?: string[] };

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

    if (campaign && !isCampaignExportable(campaign.status)) {
      return apiError("Creative must pass review before export", "APPROVAL_REQUIRED", 403);
    }

    if (!creative.videoUrl && !creative.videoExportUrl) {
      return apiError(
        "Preview video is not ready yet. Wait for the pipeline render to finish.",
        "VALIDATION_ERROR",
        409
      );
    }

    if (creative.renderStatus === "final_rendering") {
      return apiSuccess({ status: "final_rendering" }, 202);
    }

    if (!creative.videoExportUrl) {
      if (creative.renderStatus === "preview_ready" && creative.videoUrl && creative.status === "approved") {
        // V1 Auto Clip: export preview 720p without final render
      } else if (creative.renderStatus === "preview_ready" || creative.videoUrl) {
        await enqueueFinalRenderForCreative(id);
        return apiSuccess(
          {
            status: "final_rendering",
            message: "1080p final render started. Retry export in a few minutes.",
          },
          202
        );
      } else {
        return apiError(
          "Final 1080p render is not ready yet. Wait for final_rendering to complete.",
          "VALIDATION_ERROR",
          409
        );
      }
    }

    const exportAllowed =
      creative.status === "approved" ||
      creative.renderStatus === "final_ready" ||
      EXPORTABLE_CREATIVE_STATUSES.has(creative.status);

    if (!exportAllowed) {
      return apiError("Creative must pass review before export", "VALIDATION_ERROR", 400);
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
    const message = error instanceof Error ? error.message : "Export enqueue failed";
    if (/ECONNREFUSED|Redis|redis/i.test(message)) {
      return apiError(
        "Redis is not running. Start Redis, then run pnpm worker:dev.",
        "REDIS_UNAVAILABLE",
        503
      );
    }
    return handleApiError(error);
  }
}
