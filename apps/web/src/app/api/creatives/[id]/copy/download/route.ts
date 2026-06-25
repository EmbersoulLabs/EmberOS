import { eq, asc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import {
  buildCreativeCopyDoc,
  buildCreativeCopyText,
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

    const variantId = searchParams.get("variantId") ?? undefined;

    const db = getDb();
    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);
    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "client_viewer");

    const [campaign] = await db
      .select({ name: schema.campaigns.name })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, creative.campaignId))
      .limit(1);

    const variants = (creative.copyVariants ?? []) as CopyVariant[];

    const siblings = creative.taskId
      ? await db
          .select({ id: schema.creatives.id })
          .from(schema.creatives)
          .where(eq(schema.creatives.taskId, creative.taskId))
          .orderBy(asc(schema.creatives.createdAt))
      : [];
    const clipIndex = siblings.findIndex((c) => c.id === id);
    const clipLabel = clipIndex >= 0 ? `Clip ${clipIndex + 1}` : "Clip";

    const input = {
      variants,
      variantId,
      campaignName: campaign?.name,
      clipLabel,
    };

    const text = buildCreativeCopyText(input);
    if (!text.trim()) {
      return apiError("No copy available for this clip", "NOT_FOUND", 404);
    }

    const content = format === "doc" ? buildCreativeCopyDoc(input) : text;
    const filename = copyExportFilename(
      campaign?.name ? `${campaign.name}_${clipLabel.replace(/\s+/g, "_")}_copy` : `${clipLabel}_copy`,
      format
    );
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
