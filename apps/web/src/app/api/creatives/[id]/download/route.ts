import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import {
  buildRenditionStates,
  canDownloadResolution,
  exportPaywallEnabled,
  parseClipDownloadResolution,
  pickCreativeVideoUrl,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueClipDownloadRender } from "@/lib/render-queue";

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

    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, creative.orgId))
      .limit(1);

    const renditions = buildRenditionStates({
      videoUrl: creative.videoUrl,
      videoExportUrl: creative.videoExportUrl,
      platformAdaptations: creative.platformAdaptations as Record<string, unknown> | null,
      renderStatus: creative.renderStatus,
      renderProgress: creative.renderProgress as {
        rendition?: string;
        percent?: number;
        error?: string;
        phase?: string;
      } | null,
    });

    return apiSuccess({
      renditions,
      exportPaywallEnabled: exportPaywallEnabled(),
      canDownload1080p: canDownloadResolution(org?.plan, "1080p"),
      canDownload2k: canDownloadResolution(org?.plan, "2k"),
      hasPreview: Boolean(creative.videoUrl),
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
    const body = (await request.json().catch(() => ({}))) as { resolution?: string };
    const resolution = parseClipDownloadResolution(body.resolution);
    if (!resolution) {
      return apiError("Invalid resolution (720p, 1080p, 2k)", "VALIDATION", 400);
    }

    const db = getDb();
    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);
    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "editor");

    if (!creative.videoUrl) {
      return apiError("Preview not ready yet", "INVALID_STATE", 409);
    }

    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, creative.orgId))
      .limit(1);

    if (!canDownloadResolution(org?.plan, resolution)) {
      return apiError("This resolution requires a paid plan", "UPGRADE_REQUIRED", 403);
    }

    const existingUrl = pickCreativeVideoUrl(
      {
        videoUrl: creative.videoUrl,
        videoExportUrl: creative.videoExportUrl,
        platformAdaptations: creative.platformAdaptations as Record<string, unknown> | null,
      },
      resolution
    );

    if (existingUrl) {
      return apiSuccess({ status: "ready", resolution, url: existingUrl });
    }

    if (resolution === "720p") {
      return apiSuccess({ status: "ready", resolution, url: creative.videoUrl });
    }

    try {
      const job = await enqueueClipDownloadRender(id, resolution);
      if (!job) {
        return apiError("Cannot start render for this clip", "INVALID_STATE", 409);
      }
    } catch (enqueueErr) {
      const message =
        enqueueErr instanceof Error ? enqueueErr.message : "Failed to enqueue render job";
      return apiError(message, "QUEUE_ERROR", 503);
    }

    return apiSuccess({ status: "rendering", resolution }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
