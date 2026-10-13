import { eq } from "drizzle-orm";
import { z } from "zod";
import { campaignCreativeDestinationPath, isUuid } from "@ceo-agent/shared";
import { CampaignCreativeHandoffService, getDb, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api";

const CreateSchema = z.object({
  iterationId: z.string().uuid(),
  approvedPlanId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(200),
});

async function context(campaignId: string, userId: string) {
  const db = getDb();
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
  if (!campaign) return null;
  const [workspace] = await db.select({ slug: schema.workspaces.slug }).from(schema.workspaces).where(eq(schema.workspaces.id, campaign.workspaceId)).limit(1);
  if (!workspace) return null;
  return { db, campaign, slug: workspace.slug, scope: { orgId: campaign.orgId, workspaceId: campaign.workspaceId, campaignId, actorUserId: userId } };
}

const present = (handoff: typeof schema.campaignCreativeHandoffs.$inferSelect, slug: string) => ({
  ...handoff,
  destinationPath: campaignCreativeDestinationPath(handoff.selectedModule as "VIDEO_STUDIO" | "PHOTO_SCENE" | "AI_STORY", slug, handoff.campaignId),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const ctx = await context(id, user.id);
    if (!ctx) return apiError("Campaign not found", "NOT_FOUND", 404);
    const iterationId = new URL(request.url).searchParams.get("iterationId") ?? undefined;
    if (iterationId && !isUuid(iterationId)) return apiError("Invalid Content Iteration", "VALIDATION_ERROR", 400);
    const handoffs = await new CampaignCreativeHandoffService(ctx.db).list(ctx.scope, iterationId);
    return apiSuccess({ handoffs: handoffs.map((handoff) => present(handoff, ctx.slug)) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const parsed = CreateSchema.safeParse(await request.json());
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid Creative Module handoff", "VALIDATION_ERROR", 400);
    const ctx = await context(id, user.id);
    if (!ctx) return apiError("Campaign not found", "NOT_FOUND", 404);
    const result = await new CampaignCreativeHandoffService(ctx.db).createOrResume(ctx.scope, parsed.data);
    return apiSuccess({ ...result, handoff: present(result.handoff, ctx.slug) }, result.reused ? 200 : 201);
  } catch (error) { return handleApiError(error); }
}
