import { eq } from "drizzle-orm";
import { AiStoryCharacterAuthorityService, getDb, schema, withDbDeadline } from "@ceo-agent/db";
import { AiStoryCharacterMutationInputSchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

type Db = ReturnType<typeof getDb>;
type AuthUser = Awaited<ReturnType<typeof requireAuth>>;

async function authorityScope(
  campaignId: string,
  mutation: boolean,
  provided?: { user: AuthUser; db: Db }
) {
  const user = provided?.user ?? await requireAuth();
  const db = provided?.db ?? getDb();
  const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
  if (!campaign) return null;
  await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: mutation ? "operator" : "client_viewer" });
  return { db, scope: { orgId: campaign.orgId, workspaceId: campaign.workspaceId, campaignId, actorUserId: user.id } };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const user = await requireAuth();
    return await withDbDeadline(getDb(), async (db) => {
      const context = await authorityScope(id, false, { user, db });
      if (!context) return apiError("Campaign not found", "NOT_FOUND", 404);
      return apiSuccess({ characters: await new AiStoryCharacterAuthorityService(context.db).listForVerifiedScope(context.scope) });
    });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const parsed = AiStoryCharacterMutationInputSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Character facts are invalid", "VALIDATION_ERROR", 400);
    const context = await authorityScope(id, true);
    if (!context) return apiError("Campaign not found", "NOT_FOUND", 404);
    const character = await new AiStoryCharacterAuthorityService(context.db).add(context.scope, parsed.data);
    return apiSuccess({ character }, 201);
  } catch (error) { return handleApiError(error); }
}
