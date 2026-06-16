import { eq, and } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { retryPipelineStep } from "@ceo-agent/agents";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return apiError("Task not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(task.workspaceId, user.id, "client_viewer");

    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.taskId, id))
      .limit(1);

    return apiSuccess({
      task,
      stepProgress: task.stepProgress,
      creative: creative ?? null,
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
    const { step } = body as { step: "copy" | "edit" | "full" };

    const db = getDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return apiError("Task not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(task.workspaceId, user.id, "operator");

    await retryPipelineStep(id, step ?? "full");

    return apiSuccess({ taskId: id, status: "running" });
  } catch (error) {
    return handleApiError(error);
  }
}
