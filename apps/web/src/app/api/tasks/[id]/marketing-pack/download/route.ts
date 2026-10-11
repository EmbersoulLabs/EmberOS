import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { buildMarketingPackText, normalizeMarketingContentPackage, type StepProgress } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiError } from "@/lib/api";

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

    const progress = (task.stepProgress as StepProgress) ?? {};
    const step = progress.content_generate;
    if (step?.status !== "completed" || !step.output) {
      return apiError("Marketing pack not ready", "NOT_READY", 400);
    }
    const pack = normalizeMarketingContentPackage(step.output);
    if (!pack) return apiError("Invalid marketing pack", "INVALID", 400);

    const [campaign] = await db
      .select({ name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, task.campaignId))
      .limit(1);

    const text = buildMarketingPackText(pack, campaign?.name);
    const filename = `${(campaign?.name || "marketing-package").replace(/[^\w.-]+/g, "_")}.txt`;
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
