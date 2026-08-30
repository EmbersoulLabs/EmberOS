import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { enqueueRender } from "@ceo-agent/queue";
import { emitVideoStudioOpsEvent } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function POST(
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
    await requireWorkspaceRole(creative.workspaceId, user.id, "editor");

    emitVideoStudioOpsEvent({
      event: "retry_render.requested",
      stage: "retry-render",
      outcome: "started",
      orgId: creative.orgId,
      workspaceId: creative.workspaceId,
      campaignId: creative.campaignId,
      taskId: creative.taskId ?? undefined,
      creativeId: creative.id,
      recoveryKind: "retry_render",
    });

    if (!creative.taskId) {
      emitVideoStudioOpsEvent({
        event: "retry_render.denied",
        stage: "retry-render",
        outcome: "denied",
        orgId: creative.orgId,
        workspaceId: creative.workspaceId,
        campaignId: creative.campaignId,
        creativeId: creative.id,
        recoveryKind: "retry_render",
        failureClass: "AUTHORIZATION_DENIAL",
        message: "Creative has no associated task",
      });
      return apiError("Creative has no associated task", "INVALID_STATE", 400);
    }

    const progress = creative.renderProgress as { error?: string } | null;
    const canRetry =
      creative.status === "failed" ||
      Boolean(progress?.error) ||
      creative.renderStatus === "none";

    if (!canRetry && creative.renderStatus === "preview_ready") {
      emitVideoStudioOpsEvent({
        event: "retry_render.denied",
        stage: "retry-render",
        outcome: "denied",
        orgId: creative.orgId,
        workspaceId: creative.workspaceId,
        campaignId: creative.campaignId,
        taskId: creative.taskId,
        creativeId: creative.id,
        recoveryKind: "retry_render",
        failureClass: "AUTHORIZATION_DENIAL",
        message: "Clip already rendered",
      });
      return apiError("Clip already rendered", "INVALID_STATE", 400);
    }

    await db
      .update(schema.creatives)
      .set({
        status: "processing",
        renderStatus: "preview_rendering",
        renderProgress: {
          percent: 0,
          phase: "queued",
          mode: "preview",
          updatedAt: new Date().toISOString(),
        },
        videoUrl: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.creatives.id, id));

    await enqueueRender({
      taskId: creative.taskId,
      creativeId: creative.id,
      workspaceId: creative.workspaceId,
      orgId: creative.orgId,
      campaignId: creative.campaignId,
      mode: "preview",
    });

    emitVideoStudioOpsEvent({
      event: "retry_render.accepted",
      stage: "retry-render",
      outcome: "enqueued",
      orgId: creative.orgId,
      workspaceId: creative.workspaceId,
      campaignId: creative.campaignId,
      taskId: creative.taskId,
      creativeId: creative.id,
      recoveryKind: "retry_render",
    });

    return apiSuccess({ creativeId: id, status: "preview_rendering" });
  } catch (error) {
    return handleApiError(error);
  }
}
