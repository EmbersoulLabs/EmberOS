import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@ceo-agent/db";
import { AiStoryCharacterMutationInputSchema, isUuid } from "@ceo-agent/shared";
import { AiStoryPlanningCharacterAuthorityError } from "@ceo-agent/agents";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import {
  AiStoryCharacterProposalAcceptanceError,
  acceptOriginalCharacterBeforeOutlineFreeze,
} from "@/lib/ai-story-character-proposal-acceptance";

const BodySchema = z.object({
  proposalKey: z.string().trim().min(1).max(200),
  character: AiStoryCharacterMutationInputSchema.optional(),
  characterId: z.string().uuid().optional(),
}).strict().refine(
  (value) => Number(Boolean(value.character)) + Number(Boolean(value.characterId)) === 1,
  "Provide either new Character facts or an existing Character ID",
);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> },
) {
  try {
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) return apiError("Invalid Episode", "VALIDATION_ERROR", 400);
    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Character acceptance is invalid", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({
      user,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      minRole: "operator",
      request,
    });
    const accepted = await acceptOriginalCharacterBeforeOutlineFreeze({
      db,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      actorUserId: user.id,
      proposalKey: parsed.data.proposalKey,
      ...(parsed.data.character ? { character: parsed.data.character } : {}),
      ...(parsed.data.characterId ? { characterId: parsed.data.characterId } : {}),
    });
    return apiSuccess({
      characterId: accepted.characterId,
      proposalKeyDiscarded: parsed.data.proposalKey,
    }, 201);
  } catch (error) {
    if (error instanceof AiStoryCharacterProposalAcceptanceError || error instanceof AiStoryPlanningCharacterAuthorityError) {
      return apiError(error.message, error.code, 409);
    }
    return handleApiError(error);
  }
}
