import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  acceptAiStoryCompiledRequest,
  AiStorySceneExecutionPersistenceRepository,
  BillingAccountRepositoryImpl,
  CertificationCommercialAuthorityService,
  closeDb,
  getDb,
} from "@ceo-agent/db";
import {
  CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
  PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
  PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON,
  ProviderUsdPricingRuleSchema,
  buildBillingAccount,
  estimateProviderCostUsd,
  settleProviderCostUsdFromCompletionTokens,
  withIntegrity,
} from "@ceo-agent/shared/server";
import { compileImmutableSeedanceRequestFromSceneCompilation } from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import { makePhase2aCompilation, type Phase2aIdSet } from "./helpers/ai-story-phase-2a";
import { cleanupPr32Tenant, seedPr32Tenant } from "./helpers/ai-story-pr32-scheduling";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const SCENE2 = {
  sceneExecutionId: "44920cf6-de0d-59e5-bc7f-a015fbc97f90",
  compiledRequestId: "ae71dc3b-884d-54ad-8c64-d03e21b7f9ad",
  requestFingerprint: "sha256:020516d014a2ae34aef4ec795a04e38b37098e2d6af2eeb9287b0c2573ccae84",
} as const;
const SCENE3 = {
  sceneExecutionId: "08cff091-95c8-5dab-bc56-e11549096bbc",
  compiledRequestId: "c39d973a-abc0-5332-8e1a-483778cf681a",
  requestFingerprint: "sha256:7532d8e708ac4177a9c1cf798a3e31d1f9b47c88e0fc47da2065695e599c5f21",
} as const;

function officialT2vRule(input: { ruleId: string; createdBy: string; createdAt: string }) {
  return ProviderUsdPricingRuleSchema.parse(withIntegrity({
    contractVersion: "1" as const,
    providerUsdPricingRuleId: input.ruleId,
    providerKey: "BYTEPLUS_MODELARK" as const,
    modelId: CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID,
    generationMode: "TEXT_TO_VIDEO" as const,
    durationSeconds: 4,
    aspectRatio: "9:16" as const,
    resolution: "480p" as const,
    inputVideoIncluded: false as const,
    outputWidthPixels: 480,
    outputHeightPixels: 854,
    outputFrameRate: 24,
    currency: "USD" as const,
    usdPerMillionTokens: CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION,
    costBasis: "OFFICIAL_TOKEN_RATE_ESTIMATE" as const,
    sourceUrl: CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL,
    version: CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  }));
}

function rekeyScene(
  compilation: ReturnType<typeof makePhase2aCompilation>,
  index: number,
  sceneExecutionId: string,
) {
  const current = compilation.intents[index]!;
  const previousId = current.identity.sceneExecutionId;
  current.identity.sceneExecutionId = sceneExecutionId;
  compilation.instructionsBySceneExecutionId[sceneExecutionId] =
    compilation.instructionsBySceneExecutionId[previousId]!;
  delete compilation.instructionsBySceneExecutionId[previousId];
  compilation.plan.sceneExecutions[index] = current.identity;
  compilation.validationResults[index] = {
    ...compilation.validationResults[index]!,
    intentId: sceneExecutionId,
  };
}

describeIntegration("certified I2V pricing and multi-Scene Production commercial capacity", () => {
  const commercial = new CertificationCommercialAuthorityService();
  let sql: Sql;

  beforeAll(() => {
    sql = createIntegrationSql();
  });

  afterAll(async () => {
    await closeDb();
    if (sql) await sql.end();
  });

  it("provisions the I2V sibling, previews Scene 2/3, reserves both, and recovers actual overage after quota=4", async () => {
    const ids: Phase2aIdSet = {
      orgId: randomUUID(),
      workspaceId: randomUUID(),
      campaignId: randomUUID(),
      storyId: randomUUID(),
      storyVersionId: randomUUID(),
      animationPackageId: randomUUID(),
      assetId: randomUUID(),
    };
    const actorUserId = randomUUID();
    const createdAt = "2026-09-20T12:00:00.000Z";
    await seedPr32Tenant(sql, ids, actorUserId, "i2v-capacity");
    const t2v = officialT2vRule({
      ruleId: randomUUID(),
      createdBy: actorUserId,
      createdAt,
    });
    await commercial.provisionPrice(t2v);
    await new BillingAccountRepositoryImpl().createOrConverge(buildBillingAccount({
      orgId: ids.orgId,
      createdAt,
      identitySeed: `i2v-capacity-billing:${ids.orgId}`,
    }));
    const scope = await commercial.provisionScope({
      environment: "PRODUCTION",
      orgId: ids.orgId,
      workspaceId: ids.workspaceId,
      actorUserId,
      createdAt,
      maxProviderCostUsd: "0.58",
      maxProviderSubmissions: 2,
    });
    try {
      expect(estimateProviderCostUsd(t2v)).toBe("0.27");
      const first = await commercial.reserve({
        environment: "PRODUCTION",
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        executionIdentity: "scene-1-original",
        pricingRule: t2v,
        createdAt,
        claimSubmission: true,
      });
      const firstSettled = await commercial.settleFromProviderUsage({
        reservationId: first.reservation.certificationReservationId,
        completionTokens: 40_594,
        settledAt: "2026-09-20T12:10:00.000Z",
      });
      expect(firstSettled.reservation.settledCostUsd).toBe("0.29");
      const second = await commercial.reserve({
        environment: "PRODUCTION",
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        executionIdentity: "scene-1-retry",
        pricingRule: t2v,
        createdAt: "2026-09-20T12:11:00.000Z",
        claimSubmission: true,
      });
      const secondSettled = await commercial.settleFromProviderUsage({
        reservationId: second.reservation.certificationReservationId,
        completionTokens: 40_594,
        settledAt: "2026-09-20T12:12:00.000Z",
      });
      expect(secondSettled.reservation.settledCostUsd).toBe("0.29");
      const spent = await commercial.getActiveScope("PRODUCTION", ids.orgId, ids.workspaceId);
      expect(spent).toMatchObject({
        maxProviderSubmissions: 2,
        consumedProviderSubmissions: 2,
        spentProviderCostUsd: "0.58",
        maxProviderCostUsd: "0.58",
      });

      const derived = await commercial.provisionCertifiedSeedanceFirstFrameI2vSiblingFromMatchingT2v({
        durationSeconds: 4,
        aspectRatio: "9:16",
        resolution: "480p",
        at: "2026-09-20T12:13:00.000Z",
      });
      expect(derived.replayed).toBe(false);
      expect(derived.rule.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
      expect(derived.rule.usdPerMillionTokens).toBe(t2v.usdPerMillionTokens);
      expect(derived.rule.version).toBe(CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION);
      expect(estimateProviderCostUsd(derived.rule)).toBe("0.27");
      const replayPrice = await commercial.provisionCertifiedSeedanceFirstFrameI2vSiblingFromMatchingT2v({
        durationSeconds: 4,
        aspectRatio: "9:16",
        resolution: "480p",
        at: "2026-09-20T12:13:30.000Z",
      });
      expect(replayPrice.replayed).toBe(true);
      expect(replayPrice.rule.providerUsdPricingRuleId).toBe(derived.rule.providerUsdPricingRuleId);

      const compilation = makePhase2aCompilation({
        ids,
        sceneOrder: [0, 1, 2],
        referenceFreeT2vOrders: [0],
        firstFrameI2vOrders: [1, 2],
      });
      rekeyScene(compilation, 1, SCENE2.sceneExecutionId);
      rekeyScene(compilation, 2, SCENE3.sceneExecutionId);
      await new AiStorySceneExecutionPersistenceRepository(getDb()).persistCompilation(compilation);

      const compiled = [SCENE2, SCENE3].map((scene, index) => {
        const intent = compilation.intents[index + 1]!;
        const compiledRequest = compileImmutableSeedanceRequestFromSceneCompilation({
          intent,
          instructions: compilation.instructionsBySceneExecutionId[scene.sceneExecutionId]!,
          authority: {
            qcEvaluationId: randomUUID(),
            qcFingerprint: `sha256:${"a".repeat(64)}`,
            qcCapabilityVersion: "seedance-modelark-test.v1",
            directorFingerprint: `sha256:${"b".repeat(64)}`,
            motionFingerprint: `sha256:${"c".repeat(64)}`,
          },
          adapterVersion: "1.0.0",
          compiledAt: "2026-09-20T12:14:00.000Z",
          resolution: "480p",
          referenceAssets: [{
            assetId: ids.assetId,
            mediaType: "image/jpeg",
            storagePath: `${ids.workspaceId}/library/${ids.assetId}.jpg`,
          }],
        });
        return {
          ...compiledRequest,
          compiledRequestId: scene.compiledRequestId,
          sceneExecutionId: scene.sceneExecutionId,
          requestFingerprint: scene.requestFingerprint,
          structuredRequest: {
            ...compiledRequest.structuredRequest,
            duration: 4,
            ratio: "9:16",
            resolution: "480p",
          },
          ...(index === 1
            ? {
                generationAuthority: {
                  strategy: "PRODUCT_GROUNDED_VIDEO" as const,
                  referenceSource: "SCENE_EXPLICIT" as const,
                  effectiveReferenceIds: [ids.assetId],
                  firstFrameAssetId: ids.assetId,
                  productVisualIdentityRequirement: "REQUIRED" as const,
                },
              }
            : {}),
        };
      });
      expect(compiled[0]?.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
      expect(compiled[1]?.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
      expect(compiled[0]?.generationAuthority?.strategy).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
      expect(compiled[1]?.generationAuthority?.strategy).toBe("PRODUCT_GROUNDED_VIDEO");
      expect(compiled[0]?.structuredRequest).toMatchObject({
        duration: 4, ratio: "9:16", resolution: "480p",
      });
      await acceptAiStoryCompiledRequest(getDb(), compiled[0]!);
      await acceptAiStoryCompiledRequest(getDb(), compiled[1]!);

      const preview2 = await commercial.previewForSceneExecution({
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        sceneExecutionId: SCENE2.sceneExecutionId,
        compiledRequestId: SCENE2.compiledRequestId,
        requestFingerprint: SCENE2.requestFingerprint,
        executionIdentity: SCENE2.compiledRequestId,
        reservedAt: "2026-09-20T12:15:00.000Z",
      });
      const preview3 = await commercial.previewForSceneExecution({
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        sceneExecutionId: SCENE3.sceneExecutionId,
        compiledRequestId: SCENE3.compiledRequestId,
        requestFingerprint: SCENE3.requestFingerprint,
        executionIdentity: SCENE3.compiledRequestId,
        reservedAt: "2026-09-20T12:15:00.000Z",
      });
      expect(preview2.pricingRule.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
      expect(preview3.pricingRule.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
      const scene2Estimate = estimateProviderCostUsd(preview2.pricingRule);
      const scene3Estimate = estimateProviderCostUsd(preview3.pricingRule);
      expect(scene2Estimate).toBe("0.27");
      expect(scene3Estimate).toBe("0.27");

      const ceilingBeforeQuota = await commercial.amendActiveProductionScopeCeiling({
        environment: "PRODUCTION",
        certificationScopeId: scope.scope.certificationScopeId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        actorUserId,
        amendedAt: "2026-09-20T12:16:00.000Z",
        maxProviderCostUsd: (
          Number(spent!.spentProviderCostUsd) + Number(scene2Estimate) + Number(scene3Estimate)
        ).toFixed(2),
      });
      expect(ceilingBeforeQuota.scope.maxProviderCostUsd).toBe("1.12");
      expect(ceilingBeforeQuota.scope.maxProviderSubmissions).toBe(2);
      expect(ceilingBeforeQuota.scope.spentProviderCostUsd).toBe("0.58");
      expect(ceilingBeforeQuota.scope.consumedProviderSubmissions).toBe(2);

      const quota3 = await commercial.amendActiveProductionSubmissionQuota({
        environment: "PRODUCTION",
        certificationScopeId: scope.scope.certificationScopeId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        actorUserId,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-20T12:17:00.000Z",
        maxProviderSubmissions: 3,
      });
      expect(quota3.scope.maxProviderCostUsd).toBe("1.12");
      const quota4 = await commercial.amendActiveProductionSubmissionQuota({
        environment: "PRODUCTION",
        certificationScopeId: scope.scope.certificationScopeId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        actorUserId,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-20T12:18:00.000Z",
        maxProviderSubmissions: 4,
      });
      expect(quota4.scope.maxProviderSubmissions).toBe(4);
      expect(quota4.scope.maxProviderCostUsd).toBe("1.12");
      expect(quota4.scope.spentProviderCostUsd).toBe("0.58");

      const reserved2 = await commercial.reserveForSceneExecution({
        environment: "PRODUCTION",
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        sceneExecutionId: SCENE2.sceneExecutionId,
        compiledRequestId: SCENE2.compiledRequestId,
        requestFingerprint: SCENE2.requestFingerprint,
        executionIdentity: SCENE2.compiledRequestId,
        reservedAt: "2026-09-20T12:19:00.000Z",
      });
      const reserved3 = await commercial.reserveForSceneExecution({
        environment: "PRODUCTION",
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        sceneExecutionId: SCENE3.sceneExecutionId,
        compiledRequestId: SCENE3.compiledRequestId,
        requestFingerprint: SCENE3.requestFingerprint,
        executionIdentity: SCENE3.compiledRequestId,
        reservedAt: "2026-09-20T12:19:30.000Z",
      });
      expect(reserved2.reservation.reservedCostUsd).toBe("0.27");
      expect(reserved3.reservation.reservedCostUsd).toBe("0.27");
      expect(reserved3.scope.maxProviderSubmissions).toBe(4);
      expect(
        reserved3.scope.consumedProviderSubmissions + reserved3.scope.reservedProviderSubmissions
      ).toBeLessThanOrEqual(4);
      expect(
        Number(reserved3.scope.spentProviderCostUsd) + Number(reserved3.scope.reservedProviderCostUsd)
      ).toBeLessThanOrEqual(1.12);

      const overage = settleProviderCostUsdFromCompletionTokens(40_594, derived.rule.usdPerMillionTokens);
      expect(overage).toBe("0.29");
      await expect(commercial.settleFromProviderUsage({
        reservationId: reserved2.reservation.certificationReservationId,
        completionTokens: 40_594,
        settledAt: "2026-09-20T12:20:00.000Z",
      })).rejects.toMatchObject({
        name: "CertificationCommercialError",
        code: "CERTIFICATION_BUDGET_EXCEEDED",
      });

      const recovered = await commercial.amendActiveProductionScopeCeiling({
        environment: "PRODUCTION",
        certificationScopeId: scope.scope.certificationScopeId,
        orgId: ids.orgId,
        workspaceId: ids.workspaceId,
        actorUserId,
        amendedAt: "2026-09-20T12:21:00.000Z",
        maxProviderCostUsd: "1.16",
        maxProviderSubmissions: 4,
      });
      expect(recovered.replayed).toBe(false);
      expect(recovered.scope.maxProviderSubmissions).toBe(4);
      expect(recovered.scope.maxProviderCostUsd).toBe("1.16");
      const events = await sql<{ event_type: string; reason: string }[]>`
        SELECT event_type, reason
          FROM certification_commercial_events
         WHERE certification_scope_id = ${scope.scope.certificationScopeId}
           AND event_type = 'CEILING_AMENDED'
         ORDER BY occurred_at
      `;
      expect(events.map((row) => row.reason)).toEqual([
        PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON,
        PRODUCTION_SETTLEMENT_CEILING_AMENDMENT_REASON,
      ]);

      const settled2 = await commercial.settleFromProviderUsage({
        reservationId: reserved2.reservation.certificationReservationId,
        completionTokens: 40_594,
        settledAt: "2026-09-20T12:22:00.000Z",
      });
      expect(settled2.replayed).toBe(false);
      expect(settled2.reservation.settledCostUsd).toBe("0.29");
      const settled3 = await commercial.settleFromProviderUsage({
        reservationId: reserved3.reservation.certificationReservationId,
        completionTokens: 40_594,
        settledAt: "2026-09-20T12:23:00.000Z",
      });
      expect(settled3.reservation.settledCostUsd).toBe("0.29");
      const finalScope = await commercial.getActiveScope("PRODUCTION", ids.orgId, ids.workspaceId);
      expect(finalScope).toMatchObject({
        maxProviderSubmissions: 4,
        consumedProviderSubmissions: 4,
        reservedProviderSubmissions: 0,
        spentProviderCostUsd: "1.16",
        reservedProviderCostUsd: "0.00",
        maxProviderCostUsd: "1.16",
      });
      const reservationCount = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
          FROM certification_commercial_reservations
         WHERE certification_scope_id = ${scope.scope.certificationScopeId}
      `;
      expect(reservationCount[0]?.count).toBe("4");
    } finally {
      await cleanupPr32Tenant(sql, ids);
      await sql`DELETE FROM provider_usd_pricing_rules WHERE created_by = ${actorUserId}`;
    }
  });
});
