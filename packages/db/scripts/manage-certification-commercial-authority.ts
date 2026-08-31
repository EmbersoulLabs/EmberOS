import "dotenv/config";
import {
  CERTIFICATION_COMMERCIAL_CONTRACT_VERSION,
  CERTIFICATION_COMMERCIAL_REASON,
  ProviderUsdPricingRuleSchema,
  buildBillingAccount,
  withIntegrity,
} from "@ceo-agent/shared/server";
import {
  BillingAccountRepositoryImpl,
  CertificationCommercialAuthorityService,
} from "../src";
import { deterministicPersistenceUuid } from "../src/queries/ai-story-scene-execution-persistence";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") {
  throw new Error("STAGING_ENVIRONMENT_REQUIRED");
}

const action = (process.argv[2] ?? "DRY_RUN").toUpperCase();
const orgId = process.env.CERTIFICATION_ORG_ID;
const workspaceId = process.env.CERTIFICATION_WORKSPACE_ID;
const actorUserId = process.env.CERTIFICATION_ACTOR_USER_ID;
if (!orgId || !workspaceId || !actorUserId) throw new Error("CERTIFICATION_SCOPE_IDENTITY_REQUIRED");
if (!new Set(["DRY_RUN", "APPLY", "REVOKE"]).has(action)) throw new Error("INVALID_ACTION");

const authority = new CertificationCommercialAuthorityService();
const billing = new BillingAccountRepositoryImpl();
const now = new Date().toISOString();

if (action === "DRY_RUN") {
  const existingBilling = await billing.getByOrgId(orgId);
  const existingScope = await authority.getActiveScope(orgId, workspaceId);
  console.log(JSON.stringify({
    environment: "STAGING",
    organizationId: orgId,
    workspaceId,
    capability: "ai_story.execute",
    billingAccountPresent: Boolean(existingBilling),
    activeScopePresent: Boolean(existingScope),
    maximumProviderCostUsd: "5.00",
    maximumProviderSubmissions: 4,
    automaticPaidRetry: false,
    mutationPerformed: false,
  }));
} else if (action === "REVOKE") {
  const scope = await authority.getActiveScope(orgId, workspaceId);
  if (!scope) throw new Error("ACTIVE_CERTIFICATION_SCOPE_NOT_FOUND");
  const result = await authority.revokeScope({
    scopeId: scope.certificationScopeId,
    actorUserId,
    reason: "AI Story V1 STAGING certification authority closure",
    revokedAt: now,
  });
  console.log(JSON.stringify({ action, scopeId: result.scope.certificationScopeId, status: result.scope.status, replayed: result.replayed }));
} else {
  const existingBilling = await billing.getByOrgId(orgId);
  const account = existingBilling ?? buildBillingAccount({
    orgId,
    createdAt: now,
    identitySeed: `staging-certification:${orgId}`,
  });
  const acceptedBilling = await billing.createOrConverge(account);
  const acceptedScope = await authority.provisionScope({
    orgId,
    workspaceId,
    actorUserId,
    createdAt: now,
  });

  const modes = ["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"] as const;
  const durations = [4, 5, 6, 8, 10, 12] as const;
  // Only dimensions directly covered by the official 16:9 examples (and the
  // pixel-equivalent portrait orientation) are provisioned. 1:1 fails closed
  // until a provider-authoritative frame-size mapping is certified.
  const ratios = ["9:16", "16:9"] as const;
  const resolutions = ["480p", "720p", "1080p"] as const;
  const landscapeDimensions = {
    "480p": [864, 480],
    "720p": [1280, 720],
    "1080p": [1920, 1080],
  } as const;
  let rulesCreated = 0;
  for (const generationMode of modes) for (const durationSeconds of durations) {
    for (const aspectRatio of ratios) for (const resolution of resolutions) {
      const [longSide, shortSide] = landscapeDimensions[resolution];
      const [outputWidthPixels, outputHeightPixels] =
        aspectRatio === "9:16"
            ? [shortSide, longSide]
            : [longSide, shortSide];
      const body = withIntegrity({
        contractVersion: CERTIFICATION_COMMERCIAL_CONTRACT_VERSION,
        providerUsdPricingRuleId: deterministicPersistenceUuid("provider-usd-pricing-rule", {
          provider: "BYTEPLUS_MODELARK", model: "dreamina-seedance-2-0-260128",
          generationMode, durationSeconds, aspectRatio, resolution, version: "byteplus-2026-08-01.v1",
        }),
        providerKey: "BYTEPLUS_MODELARK" as const,
        modelId: "dreamina-seedance-2-0-260128" as const,
        generationMode,
        durationSeconds,
        aspectRatio,
        resolution,
        inputVideoIncluded: false as const,
        outputWidthPixels,
        outputHeightPixels,
        outputFrameRate: 24,
        currency: "USD" as const,
        usdPerMillionTokens: resolution === "1080p" ? "7.7000" : "7.0000",
        costBasis: "OFFICIAL_TOKEN_RATE_ESTIMATE" as const,
        sourceUrl: "https://docs.byteplus.com/docs/ModelArk/1099320" as const,
        version: "byteplus-2026-08-01.v1",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        effectiveTo: null,
        createdBy: actorUserId,
        createdAt: now,
      });
      const parsed = ProviderUsdPricingRuleSchema.parse(body);
      const accepted = await authority.provisionPrice(parsed);
      if (!accepted.replayed) rulesCreated += 1;
    }
  }
  console.log(JSON.stringify({
    action,
    reason: CERTIFICATION_COMMERCIAL_REASON,
    billingAccountId: acceptedBilling.value.billingAccountId,
    billingReplayed: acceptedBilling.replayed,
    scopeId: acceptedScope.scope.certificationScopeId,
    scopeReplayed: acceptedScope.replayed,
    rulesCreated,
    maximumProviderCostUsd: acceptedScope.scope.maxProviderCostUsd,
    maximumProviderSubmissions: acceptedScope.scope.maxProviderSubmissions,
    automaticPaidRetry: false,
  }));
}
