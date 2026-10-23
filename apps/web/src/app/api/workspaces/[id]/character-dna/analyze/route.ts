import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withControlledSelfUseProviderContext } from "@ceo-agent/agents";
import {
  AiStoryCharacterDnaError,
  ControlledSelfUseAuthorityService,
  ControlledSelfUseError,
  schema,
} from "@ceo-agent/db";
import { characterDnaAnalysisCostEstimate, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { analyzeCharacterDnaBytes, characterDnaContext } from "@/lib/character-dna-access";
import { requireControlledSelfUseWorkspaceOperator } from "@/lib/controlled-self-use-workspace-access";

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
    const user = await requireAuth();
    const workspace = await requireControlledSelfUseWorkspaceOperator({
      request,
      userId: user.id,
      workspaceId: id,
      capabilityKey: "ai_story.plan",
      providerKey: "openai",
    });
    const ctx = await characterDnaContext(id, true);
    if (!ctx) return apiError("Workspace not found", "NOT_FOUND", 404);
    const [asset] = await ctx.db.select({ storagePath: schema.assets.storagePath }).from(schema.assets)
      .where(eq(schema.assets.id, parsed.data.sourceAssetId)).limit(1);
    const analyzeFn = await analyzeCharacterDnaBytes(id, asset?.storagePath);

    const authority = new ControlledSelfUseAuthorityService(ctx.db);
    const executionIdentity = `character-dna-analyze:${id}:${randomUUID()}`;
    let reservation;
    try {
      reservation = (await authority.reserve({
        environment: "PRODUCTION",
        organizationId: workspace.orgId,
        workspaceId: id,
        capabilityKey: "ai_story.plan",
        executionIdentity,
        providerKey: "openai",
        maximumCostUsd: "0.10",
        retryOrdinal: 0,
        actorUserId: user.id,
        reservedAt: new Date().toISOString(),
      })).reservation;
    } catch (error) {
      if (error instanceof ControlledSelfUseError) {
        return apiError("Character DNA analysis requires an active, budgeted Production authority", error.code, 403);
      }
      throw error;
    }

    let job;
    try {
      job = await withControlledSelfUseProviderContext({
        reservationId: reservation.reservationId,
        organizationId: workspace.orgId,
        workspaceId: id,
        executionIdentity,
        providerKey: "openai",
      }, () => ctx.service.analyze(ctx.scope, {
        sourceAssetId: parsed.data.sourceAssetId,
        permissionConfirmed: true,
        analyze: analyzeFn,
      }));
      if (job.costUsd) {
        await authority.settle(reservation.reservationId, job.costUsd, new Date().toISOString());
      } else {
        await authority.release(reservation.reservationId, new Date().toISOString());
      }
    } catch (error) {
      const latest = await authority.getReservationById(reservation.reservationId);
      if (latest?.status === "RESERVED") {
        await authority.release(reservation.reservationId, new Date().toISOString());
      }
      throw error;
    }

    return apiSuccess({ job }, job.status === "FAILED" ? 409 : 201);
  } catch (error) {
    if (error instanceof AiStoryCharacterDnaError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
