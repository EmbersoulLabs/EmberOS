import { eq } from "drizzle-orm";
import { z } from "zod";
import { AiStoryCharacterDnaError, schema } from "@ceo-agent/db";
import { characterDnaAnalysisCostEstimate, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { analyzeCharacterDnaBytes, characterDnaContext } from "@/lib/character-dna-access";

const Body = z.object({
  sourceAssetId: z.string().uuid(),
  permissionConfirmed: z.literal(true),
}).strict();

export async function GET() {
  return apiSuccess({ estimate: characterDnaAnalysisCostEstimate() });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return apiError("Character analysis request is invalid", "VALIDATION_ERROR", 400);
    const ctx = await characterDnaContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const [asset] = await ctx.db.select({ storagePath: schema.assets.storagePath }).from(schema.assets)
      .where(eq(schema.assets.id, parsed.data.sourceAssetId)).limit(1);
    const job = await ctx.service.analyze(ctx.scope, {
      sourceAssetId: parsed.data.sourceAssetId,
      permissionConfirmed: true,
      analyze: await analyzeCharacterDnaBytes(id, asset?.storagePath),
    });
    return apiSuccess({ job }, job.status === "FAILED" ? 409 : 201);
  } catch (error) {
    if (error instanceof AiStoryCharacterDnaError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
