import { eq, asc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import {
  buildTaskCopyDoc,
  buildTaskCopyText,
  copyExportContentType,
  copyExportFilename,
  encodeCopyExportBody,
  parseCopyExportFormat,
  type CopyVariant,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiError } from "@/lib/api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const format = parseCopyExportFormat(searchParams.get("format"));
    if (!format) {
      return apiError("Invalid format (txt, doc)", "VALIDATION", 400);
    }

    const db = getDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return apiError("Task not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(task.workspaceId, user.id, "client_viewer");

    const [campaign] = await db
      .select({ name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, task.campaignId))
      .limit(1);

    const creatives = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.taskId, id))
      .orderBy(asc(schema.creatives.createdAt));

    const clips = creatives.map((creative, index) => ({
      label: `Clip ${index + 1}`,
      variants: (creative.copyVariants ?? []) as CopyVariant[],
    }));

    const input = { clips, campaignName: campaign?.name };
    const text = buildTaskCopyText(input);
    if (!text.trim()) {
      return apiError("No copy available for this task", "NOT_FOUND", 404);
    }

    const content = format === "doc" ? buildTaskCopyDoc(input) : text;
    const filename = copyExportFilename(campaign?.name ? `${campaign.name}_all_copy` : "all_clips_copy", format);
    const body = encodeCopyExportBody(content, format);

    return new Response(Buffer.from(body), {
      headers: {
        "Content-Type": copyExportContentType(format),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
