import { randomUUID } from "node:crypto";
import { z } from "zod";
import { callStructuredJsonModel, withControlledSelfUseProviderContext } from "@ceo-agent/agents";
import {
  ControlledSelfUseAuthorityService,
  ControlledSelfUseError,
  getBusinessProfileByWorkspace,
  getDb,
} from "@ceo-agent/db";
import {
  CampaignAudienceSuggestBodySchema,
  isUuid,
  normalizeBusinessProfileRecord,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireControlledSelfUseWorkspaceOperator } from "@/lib/controlled-self-use-workspace-access";

const SuggestionSchema = z.object({ text: z.string().trim().min(1).max(2000) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const limited = await enforceRateLimit(request, "campaignAssist", user.id);
    if (limited) return limited;
    const workspace = await requireControlledSelfUseWorkspaceOperator({
      request,
      userId: user.id,
      workspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
    });
    const parsed = CampaignAudienceSuggestBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid suggestion request", "VALIDATION_ERROR", 400);

    const rawProfile = await getBusinessProfileByWorkspace(workspaceId);
    const profile = normalizeBusinessProfileRecord((rawProfile ?? {}) as Record<string, unknown>);

    const db = getDb();
    const authority = new ControlledSelfUseAuthorityService(db);
    const executionIdentity = `audience-suggest:${workspaceId}:${randomUUID()}`;
    let reservation;
    try {
      reservation = (await authority.reserve({
        environment: "PRODUCTION",
        organizationId: workspace.orgId,
        workspaceId,
        capabilityKey: "campaign.generate",
        executionIdentity,
        providerKey: "openai",
        maximumCostUsd: "0.10",
        retryOrdinal: 0,
        actorUserId: user.id,
        reservedAt: new Date().toISOString(),
      })).reservation;
    } catch (error) {
      if (error instanceof ControlledSelfUseError) {
        return apiError("Audience suggestions require an active, budgeted Production authority", error.code, 403);
      }
      throw error;
    }

    let completion;
    try {
      completion = await withControlledSelfUseProviderContext({
        reservationId: reservation.reservationId,
        organizationId: workspace.orgId,
        workspaceId,
        executionIdentity,
        providerKey: "openai",
      }, () => callStructuredJsonModel({
        system:
          "Suggest one concise, concrete campaign target audience. Return JSON only. Do not persist or claim the suggestion was accepted.",
        user: JSON.stringify({
          objective: parsed.data.objective,
          platforms: parsed.data.platforms,
          campaignBrief: parsed.data.campaignBrief,
          currentAudience: parsed.data.currentAudience,
          language: parsed.data.workspaceLanguage,
          business: {
            name: profile.companyName,
            industry: profile.industryDisplayName || profile.industryCustomValue,
            description: profile.businessDescription,
            existingAudience: profile.targetAudience,
          },
        }),
        schema: SuggestionSchema,
        schemaName: "campaign_target_audience_suggestion",
        maxOutputTokens: 300,
      }));
      await authority.settle(
        reservation.reservationId,
        completion.usage.costUsd.toFixed(2),
        new Date().toISOString(),
        completion.providerRequestId
      );
    } catch (error) {
      const latest = await authority.getReservationById(reservation.reservationId);
      if (latest?.status === "RESERVED") {
        await authority.release(reservation.reservationId, new Date().toISOString());
      }
      throw error;
    }

    if (completion.decodeIssue) {
      return apiError("Audience suggestion is unavailable", "AI_UNAVAILABLE", 503);
    }
    const result = SuggestionSchema.safeParse(completion.result);
    if (!result.success) return apiError("Audience suggestion failed", "AI_OUTPUT_INVALID", 502);
    return apiSuccess({ text: result.data.text, proposal: true });
  } catch (error) {
    return handleApiError(error);
  }
}
