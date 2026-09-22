import { eq } from "drizzle-orm";
import { z } from "zod";
import { AiStoryReusableCharacterError, AiStoryReusableCharacterService, getDb, schema } from "@ceo-agent/db";
import {
  AiStoryCharacterDefaultLookSchema,
  AiStoryCharacterIdentityCoreSchema,
  AiStoryCharacterMutableLookPolicySchema,
  isUuid,
  publicReusableCharacterCard,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

const EditSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  identityCore: AiStoryCharacterIdentityCoreSchema,
  defaultLook: AiStoryCharacterDefaultLookSchema,
  mutableLookPolicy: AiStoryCharacterMutableLookPolicySchema,
  canonicalAssets: z.array(z.object({
    assetId: z.string().uuid(),
    role: z.enum(["IDENTITY_MASTER", "FRONT_PORTRAIT", "THREE_QUARTER", "PROFILE", "FULL_BODY", "EXPRESSION_REFERENCE", "STYLE_REFERENCE"]),
  }).strict()).min(1),
}).strict();

async function context(workspaceId: string) {
  const user = await requireAuth();
  const db = getDb();
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  await authorizeAiStoryAccess({ user, orgId: workspace.orgId, workspaceId, minRole: "operator" });
  return { db, scope: { orgId: workspace.orgId, workspaceId, actorUserId: user.id } };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character", "VALIDATION_ERROR", 400);
    const parsed = EditSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Reusable Character edit is invalid", "VALIDATION_ERROR", 400);
    const ctx = await context(id);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const { expectedVersion, ...input } = parsed.data;
    const character = await new AiStoryReusableCharacterService(ctx.db).edit(ctx.scope, characterId, input, expectedVersion);
    return apiSuccess({ character: publicReusableCharacterCard(character, 0) });
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character", "VALIDATION_ERROR", 400);
    const body = z.object({ expectedVersion: z.number().int().positive() }).safeParse(await request.json().catch(() => ({})));
    if (!body.success) return apiError("Reusable Character archive is invalid", "VALIDATION_ERROR", 400);
    const ctx = await context(id);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const character = await new AiStoryReusableCharacterService(ctx.db).archive(ctx.scope, characterId, body.data.expectedVersion);
    return apiSuccess({ character: publicReusableCharacterCard(character, 0) });
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
