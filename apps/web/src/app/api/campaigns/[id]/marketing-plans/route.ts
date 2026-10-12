import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { CampaignMarketingPlanContentSchema, CampaignCreativeModuleSchema, isUuid } from "@ceo-agent/shared";
import { CampaignContentIterationService, CampaignMarketingPlanService, getDb, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api";

const CommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createIteration"), idempotencyKey: z.string().min(8).max(200) }),
  z.object({ action: z.literal("saveRevision"), iterationId: z.string().uuid(), expectedIterationVersion: z.number().int().positive(), expectedLatestRevision: z.number().int().nonnegative(), idempotencyKey: z.string().min(8).max(200), content: CampaignMarketingPlanContentSchema }),
  z.object({ action: z.literal("approve"), iterationId: z.string().uuid(), planId: z.string().uuid(), expectedRevision: z.number().int().positive(), expectedIterationVersion: z.number().int().positive(), selectedModule: CampaignCreativeModuleSchema, idempotencyKey: z.string().min(8).max(200) }),
]);

async function context(campaignId: string, userId: string) {
  const db = getDb();
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
  if (!campaign) return null;
  return { db, campaign, scope: { orgId: campaign.orgId, workspaceId: campaign.workspaceId, campaignId, actorUserId: userId } };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const ctx = await context(id, user.id);
    if (!ctx) return apiError("Campaign not found", "NOT_FOUND", 404);
    const iterations = await ctx.db.select().from(schema.campaignContentIterations).where(and(eq(schema.campaignContentIterations.campaignId, id), eq(schema.campaignContentIterations.workspaceId, ctx.campaign.workspaceId))).orderBy(asc(schema.campaignContentIterations.sequenceNumber));
    const service = new CampaignMarketingPlanService(ctx.db);
    const result = await Promise.all(iterations.map(async (iteration) => ({ iteration, plans: await service.list(ctx.scope, iteration.id) })));
    return apiSuccess({ campaign: { id: ctx.campaign.id, name: ctx.campaign.name, objective: ctx.campaign.objective, targetAudience: ctx.campaign.targetAudience }, iterations: result });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const parsed = CommandSchema.safeParse(await request.json());
    if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "Invalid Marketing Plan command", "VALIDATION_ERROR", 400);
    const ctx = await context(id, user.id);
    if (!ctx) return apiError("Campaign not found", "NOT_FOUND", 404);
    if (parsed.data.action === "createIteration") return apiSuccess(await new CampaignContentIterationService(ctx.db).create(ctx.scope, { idempotencyKey: parsed.data.idempotencyKey }), 201);
    const service = new CampaignMarketingPlanService(ctx.db);
    if (parsed.data.action === "saveRevision") return apiSuccess(await service.createRevision(ctx.scope, parsed.data.iterationId, parsed.data), 201);
    return apiSuccess(await service.approve(ctx.scope, parsed.data.iterationId, parsed.data));
  } catch (error) { return handleApiError(error); }
}
