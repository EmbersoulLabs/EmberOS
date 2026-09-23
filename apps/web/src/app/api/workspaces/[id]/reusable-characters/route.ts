import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { AiStoryReusableCharacterError, AiStoryReusableCharacterService, AiStoryCharacterVirtualizerService, getDb, schema } from "@ceo-agent/db";
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

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  identityCore: AiStoryCharacterIdentityCoreSchema,
  defaultLook: AiStoryCharacterDefaultLookSchema,
  mutableLookPolicy: AiStoryCharacterMutableLookPolicySchema,
  canonicalAssets: z.array(z.object({
    assetId: z.string().uuid(),
    role: z.enum(["IDENTITY_MASTER", "FRONT_PORTRAIT", "THREE_QUARTER", "PROFILE", "FULL_BODY", "EXPRESSION_REFERENCE", "STYLE_REFERENCE", "CHARACTER_SOURCE_PORTRAIT"]),
  }).strict()),
}).strict();

async function workspaceContext(workspaceId: string, mutation: boolean) {
  const user = await requireAuth();
  const db = getDb();
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  await authorizeAiStoryAccess({ user, orgId: workspace.orgId, workspaceId, minRole: mutation ? "operator" : "client_viewer" });
  return { user, db, scope: { orgId: workspace.orgId, workspaceId, actorUserId: user.id } };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const ctx = await workspaceContext(id, false);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const versions = await new AiStoryReusableCharacterService(ctx.db).list(ctx.scope);
    const virtualizer = new AiStoryCharacterVirtualizerService(ctx.db);
    const characters = await Promise.all(versions.map(async (version) => {
      const rows = await ctx.db.select({ storyId: schema.aiStoryEpisodeCharacterBindings.storyId })
        .from(schema.aiStoryEpisodeCharacterBindings)
        .where(and(
          eq(schema.aiStoryEpisodeCharacterBindings.reusableCharacterId, version.reusableCharacterId),
          eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, id),
        ));
      const virtual = await virtualizer.latestAcceptedForCharacter(ctx.scope, version.reusableCharacterId);
      return {
        ...publicReusableCharacterCard(version, new Set(rows.map((row) => row.storyId)).size),
        visualClass: virtual?.visualClass,
        virtualStyle: virtual?.style,
        identityLocked: true as const,
        identityMode: version.identityMode,
        characterDnaCertified: version.identityMode === "CHARACTER_DNA",
        portraitLabel: version.identityMode === "CHARACTER_DNA" ? "Source photo" as const : "Identity Master" as const,
      };
    }));
    return apiSuccess({ characters });
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const parsed = CreateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Reusable Character facts are invalid", "VALIDATION_ERROR", 400);
    const ctx = await workspaceContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const character = await new AiStoryReusableCharacterService(ctx.db).create(ctx.scope, parsed.data);
    return apiSuccess({ character: publicReusableCharacterCard(character, 0) }, 201);
  } catch (error) {
    if (error instanceof AiStoryReusableCharacterError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
