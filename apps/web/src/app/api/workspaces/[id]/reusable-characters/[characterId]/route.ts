import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  AiStoryCharacterVirtualizerService,
  AiStoryReusableCharacterError,
  AiStoryReusableCharacterService,
  getDb,
  schema,
} from "@ceo-agent/db";
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

async function context(workspaceId: string, mutation: boolean) {
  const user = await requireAuth();
  const db = getDb();
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  await authorizeAiStoryAccess({ user, orgId: workspace.orgId, workspaceId, minRole: mutation ? "operator" : "client_viewer" });
  return { db, scope: { orgId: workspace.orgId, workspaceId, actorUserId: user.id } };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character", "VALIDATION_ERROR", 400);
    const ctx = await context(id, false);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const service = new AiStoryReusableCharacterService(ctx.db);
    const character = await service.readCurrent(ctx.scope, characterId, true);
    const history = await service.history(ctx.scope, characterId);
    const virtual = await new AiStoryCharacterVirtualizerService(ctx.db).latestAcceptedForCharacter(ctx.scope, characterId);
    return apiSuccess({
      character,
      card: publicReusableCharacterCard(character, 0),
      history,
      visualClass: virtual?.visualClass ?? null,
      virtualStyle: virtual?.style ?? null,
    });
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; characterId: string }> }) {
  try {
    const { id, characterId } = await params;
    if (!isUuid(id) || !isUuid(characterId)) return apiError("Invalid Character", "VALIDATION_ERROR", 400);
    const parsed = EditSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Reusable Character edit is invalid", "VALIDATION_ERROR", 400);
    const ctx = await context(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const { expectedVersion, ...input } = parsed.data;
    const current = await new AiStoryReusableCharacterService(ctx.db).readCurrent(ctx.scope, characterId, true);
    const currentMaster = current.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER");
    const nextMaster = input.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER");
    const extras = input.canonicalAssets.filter((asset) => asset.role !== "IDENTITY_MASTER");
    const preservedMaster = currentMaster && nextMaster && extras.length && extras.every((asset) => asset.assetId !== currentMaster.assetId)
      ? currentMaster
      : nextMaster;
    const canonicalAssets = [
      ...(preservedMaster ? [{ assetId: preservedMaster.assetId, role: "IDENTITY_MASTER" as const }] : input.canonicalAssets.filter((asset) => asset.role === "IDENTITY_MASTER")),
      ...extras,
    ];
    const character = await new AiStoryReusableCharacterService(ctx.db).edit(
      ctx.scope,
      characterId,
      { ...input, canonicalAssets },
      expectedVersion
    );
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
    const ctx = await context(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const character = await new AiStoryReusableCharacterService(ctx.db).archive(ctx.scope, characterId, body.data.expectedVersion);
    return apiSuccess({ character: publicReusableCharacterCard(character, 0) });
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
