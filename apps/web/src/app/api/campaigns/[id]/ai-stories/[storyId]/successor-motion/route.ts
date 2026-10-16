import { eq } from "drizzle-orm";
import { AiStorySuccessorMotionError, AiStorySuccessorMotionService, getDb, schema } from "@ceo-agent/db";
import { AiStorySuccessorMotionReviewSchema, isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { apiError, apiSuccess } from "@/lib/api";

async function context(id: string, storyId: string, user: Awaited<ReturnType<typeof requireAuth>>, minRole: "reviewer" | "operator") {
  if (!isUuid(id) || !isUuid(storyId)) throw new AiStorySuccessorMotionError("VALIDATION_ERROR", "Invalid Campaign or Story id");
  const db = getDb();
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).limit(1);
  const [story] = await db.select().from(schema.aiStories).where(eq(schema.aiStories.id, storyId)).limit(1);
  if (!campaign || !story || story.campaignId !== campaign.id || !story.currentVersionId) throw new AiStorySuccessorMotionError("NOT_FOUND", "Campaign Story authority was not found");
  await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole });
  return {
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    storyId,
    storyVersionId: story.currentVersionId,
    actorUserId: user.id,
  };
}

function responseError(error: unknown) {
  if (error instanceof AiStorySuccessorMotionError) {
    const status = error.code === "SUCCESSOR_MOTION_SCOPE_DENIED" ? 403 : error.code === "NOT_FOUND" ? 404 : 409;
    return apiError(error.message, error.code, status);
  }
  return handleApiError(error);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const user = await requireAuth();
    const { id, storyId } = await params;
    const scope = await context(id, storyId, user, "reviewer");
    return apiSuccess(await new AiStorySuccessorMotionService().read(scope));
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const user = await requireAuth();
    const { id, storyId } = await params;
    const body = await request.json() as { action?: string; motionPlanId?: string; review?: unknown; approvalAttestation?: string };
    const minRole = body.action === "APPROVE" || body.action === "ACTIVATE" ? "reviewer" : "operator";
    const scope = await context(id, storyId, user, minRole);
    const service = new AiStorySuccessorMotionService();
    if (body.action === "PROPOSE") {
      return apiSuccess(await service.propose(scope, AiStorySuccessorMotionReviewSchema.parse(body.review)));
    }
    if (!body.motionPlanId || !isUuid(body.motionPlanId)) return apiError("motionPlanId is required", "VALIDATION_ERROR", 400);
    if (body.action === "VALIDATE") return apiSuccess(await service.transition(scope, body.motionPlanId, "VALIDATED"));
    if (body.action === "APPROVE") {
      if (body.approvalAttestation !== "AUTHORIZED_CREATIVE_OWNER_APPROVAL") return apiError("Explicit authorized creative-owner attestation is required", "SUCCESSOR_MOTION_APPROVAL_ATTESTATION_REQUIRED", 409);
      return apiSuccess(await service.transition(scope, body.motionPlanId, "APPROVED"));
    }
    if (body.action === "ACTIVATE") return apiSuccess(await service.transition(scope, body.motionPlanId, "FROZEN"));
    return apiError("Unknown Successor Motion action", "VALIDATION_ERROR", 400);
  } catch (error) {
    return responseError(error);
  }
}
