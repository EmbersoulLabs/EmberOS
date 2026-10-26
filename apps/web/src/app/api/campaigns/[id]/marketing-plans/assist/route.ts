import { randomUUID } from "node:crypto";
import { and, asc, eq, getTableColumns, isNull } from "drizzle-orm";
import { z } from "zod";
import { callStructuredJsonModel, withControlledSelfUseProviderContext } from "@ceo-agent/agents";
import {
  ControlledSelfUseAuthorityService,
  ControlledSelfUseError,
  getBusinessProfileByWorkspace,
  getDb,
  schema,
} from "@ceo-agent/db";
import { CampaignCreativeModuleSchema, isUuid, normalizeBusinessProfileRecord } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireControlledSelfUseWorkspaceOperator } from "@/lib/controlled-self-use-workspace-access";

/** Business Profile fields a drafted Plan may cite as its factual authority.
 * Matches CampaignMarketingPlanService.createRevision's validation exactly,
 * so the AI can never cite a fact that fact-check would then reject. */
const CITABLE_BUSINESS_FACTS = [
  "companyName",
  "industryDisplayName",
  "businessDescription",
  "services",
] as const;

const PlanAssistResultSchema = z.object({
  objective: z.string().trim().min(1).max(1000),
  targetAudience: z.string().trim().min(1).max(2000),
  keyMessage: z.string().trim().min(1).max(500),
  marketingApproach: z.string().trim().min(1).max(4000),
  creativeDirection: z.string().trim().min(1).max(4000),
  recommendedModule: CampaignCreativeModuleSchema,
  rationale: z.string().trim().min(1).max(4000),
  expectedOutcome: z.string().trim().min(1).max(2000),
  businessFactRefs: z.array(z.enum(CITABLE_BUSINESS_FACTS)).min(1).max(CITABLE_BUSINESS_FACTS.length),
});

async function loadAttachedProductAssets(db: ReturnType<typeof getDb>, campaignId: string, workspaceId: string) {
  const legacy = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.campaignId, campaignId), eq(schema.assets.workspaceId, workspaceId), isNull(schema.assets.deletedAt)));
  const referenced = await db
    .select(getTableColumns(schema.assets))
    .from(schema.campaignAssetRefs)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.campaignAssetRefs.assetId))
    .where(and(eq(schema.campaignAssetRefs.campaignId, campaignId), eq(schema.assets.workspaceId, workspaceId), isNull(schema.assets.deletedAt)))
    .orderBy(asc(schema.campaignAssetRefs.sortOrder));
  const byId = new Map<string, typeof legacy[number]>();
  for (const asset of [...referenced, ...legacy]) byId.set(asset.id, asset);
  return [...byId.values()];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const limited = await enforceRateLimit(request, "campaignAssist", user.id);
    if (limited) return limited;

    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);

    const workspace = await requireControlledSelfUseWorkspaceOperator({
      request,
      userId: user.id,
      workspaceId: campaign.workspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
    });

    const rawProfile = await getBusinessProfileByWorkspace(campaign.workspaceId);
    const profile = rawProfile ? normalizeBusinessProfileRecord(rawProfile as unknown as Record<string, unknown>) : null;
    const productAssets = await loadAttachedProductAssets(db, campaignId, campaign.workspaceId);
    const hasAssets = productAssets.length > 0;

    // Fail-informative: tell the user exactly what to go fill in, before
    // spending any AI budget on a draft that would just cite missing facts.
    // Only Business Profile and Target Audience are hard requirements — you
    // can't write a sensible plan without knowing who the business is and
    // who it's for. Platform Strategy and Product material are tactical,
    // not identity-level: zero product assets is a normal, legitimate path
    // (the plan just recommends AI_STORY, which generates from scratch),
    // and missing platforms just means the AI proposes some.
    const missing: string[] = [];
    if (!profile || !profile.businessDescription) missing.push("business_profile");
    const targetAudience = campaign.targetAudience?.summary || profile?.targetAudience || null;
    if (!targetAudience) missing.push("target_audience");
    if (missing.length) {
      return apiSuccess({ ready: false, missing }, 409);
    }

    const authority = new ControlledSelfUseAuthorityService(db);
    const executionIdentity = `marketing-plan-assist:${campaignId}:${randomUUID()}`;
    let reservation;
    try {
      reservation = (await authority.reserve({
        environment: "PRODUCTION",
        organizationId: workspace.orgId,
        workspaceId: campaign.workspaceId,
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
        return apiError("Marketing Plan assistance requires an active, budgeted Production authority", error.code, 403);
      }
      throw error;
    }

    let completion;
    try {
      completion = await withControlledSelfUseProviderContext({
        reservationId: reservation.reservationId,
        organizationId: workspace.orgId,
        workspaceId: campaign.workspaceId,
        executionIdentity,
        providerKey: "openai",
      }, () => callStructuredJsonModel({
        system: [
          "Draft a Campaign Marketing Plan from the supplied business material only.",
          `businessFactRefs must be a non-empty subset of exactly these keys: ${CITABLE_BUSINESS_FACTS.join(", ")}.`,
          "Only cite a fact you actually used to reach your conclusions. keyMessage is the single core message this Campaign should communicate — a conclusion you draw from the business, audience, and product material, not a fact you were given.",
          hasAssets
            ? "productAssetCount is greater than zero: recommend whichever of AI_STORY, VIDEO_STUDIO, or PHOTO_SCENE best fits the product material and objective."
            : "productAssetCount is zero: there is no existing photo or video to build from. recommendedModule must be AI_STORY — it generates everything from scratch and is the only module that works with zero assets. Do not recommend VIDEO_STUDIO or PHOTO_SCENE here.",
          campaign.platforms?.length
            ? "Respect the given platforms in marketingApproach."
            : "No platforms were specified yet — propose the platforms that best fit the target audience and objective as part of marketingApproach.",
          "Return JSON only. This is a proposal requiring human review and approval before it takes effect.",
        ].join(" "),
        user: JSON.stringify({
          campaignName: campaign.name,
          campaignGoal: campaign.goal,
          business: {
            companyName: profile!.companyName,
            industryDisplayName: profile!.industryDisplayName || profile!.industryCustomValue,
            businessDescription: profile!.businessDescription,
            services: profile!.services,
          },
          targetAudience,
          platforms: campaign.platforms?.length ? campaign.platforms : "none specified",
          productAssetCount: productAssets.length,
          productAssetNames: productAssets.map((asset) => asset.displayName ?? asset.originalFilename ?? asset.id),
        }),
        schema: PlanAssistResultSchema,
        schemaName: "campaign_marketing_plan_assist_proposal",
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

    if (completion.decodeIssue) return apiError("Marketing Plan assistance is unavailable", "AI_UNAVAILABLE", 503);
    const result = PlanAssistResultSchema.safeParse(completion.result);
    if (!result.success) return apiError("Marketing Plan assistance failed", "AI_OUTPUT_INVALID", 502);

    return apiSuccess({
      ready: true,
      proposal: {
        ...result.data,
        // Structural, not a judgment call: zero assets can only ever be a
        // ZERO_ASSET plan, and only AI_STORY works with zero assets. Enforced
        // here regardless of what the model answered, same as assetMode/
        // assetIds already were — the prompt instruction above is belt, this
        // is suspenders.
        recommendedModule: hasAssets ? result.data.recommendedModule : "AI_STORY",
        assetMode: hasAssets ? ("ASSET_BASED" as const) : ("ZERO_ASSET" as const),
        assetIds: productAssets.map((asset) => asset.id),
        missingAssets: [],
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
