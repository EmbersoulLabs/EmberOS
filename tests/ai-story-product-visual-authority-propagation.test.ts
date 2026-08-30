import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createCompilationBackedCanonicalPayloadResolver,
  mapCompiledInstructionsToCanonicalScenePayload,
  type CanonicalScenePayloadForAdapter,
} from "../packages/agents/src/ai-story/canonical-scene-payload-resolver";
import {
  evaluateProductGroundingPreDispatch,
} from "../packages/agents/src/ai-story/product-grounding-contract";
import {
  buildPreDispatchRecoveryPreview,
} from "../packages/agents/src/ai-story/pre-dispatch-recovery";
import {
  createWorkerProductVisualAuthorityCertifier,
} from "../apps/worker/src/ai-story-provider-asset-access";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";
import { deriveGeneratedSceneRuntimeState } from "../packages/agents/src/ai-story/derive-product-runtime-projection";
import { shouldPollRuntimeProjection } from "../apps/web/src/lib/ai-story-runtime-ui";

const PRODUCT = "c0e04afc-01fc-4578-8697-ec76fb6d0a82";
const PLAN = "a98ac267-71a5-51aa-a276-de3c4b36b387";
const SCENE = "20dd4ca9-4920-5fa2-8487-4981bf16976f";

function certification(assetId = PRODUCT) {
  return {
    contractVersion: "1" as const,
    certificationSource: "SERVER_AUTHORITY" as const,
    status: "CERTIFIED" as const,
    productAssetId: assetId,
    orgId: "10000000-0000-4000-8000-000000000002",
    workspaceId: "10000000-0000-4000-8000-000000000003",
    campaignId: "10000000-0000-4000-8000-000000000004",
    executionPlanId: PLAN,
    sceneExecutionId: SCENE,
    assetExists: true as const,
    ownershipBound: true as const,
    campaignProductBinding: true as const,
    providerAccessibleFirstFrame: true as const,
    authorityConflictAbsent: true as const,
    previousSceneVisualAuthorityUsed: false as const,
  };
}

describe("product visual authority certification propagation", () => {
  it("carries server certification through the resolver and allows request construction", async () => {
    const compilation = makePhase2aCompilation();
    const intent = {
      ...compilation.intents[1]!,
      identity: {
        ...compilation.intents[1]!.identity,
        sceneExecutionId: SCENE,
      },
      referencedAssetIds: [PRODUCT],
    };
    const instructions = {
      ...compilation.instructionsBySceneExecutionId[
        compilation.intents[1]!.identity.sceneExecutionId
      ]!,
      referencedAssetIds: [PRODUCT],
    };
    const resolver = createCompilationBackedCanonicalPayloadResolver({
      getEnvelopeByPayloadReference: async () => ({
        executionContext: { trace: { executionPlanId: PLAN, sceneExecutionId: SCENE } },
      }) as never,
      getCompilationByExecutionPlanId: async () => ({
        intents: [
          { ...compilation.intents[0]!, referencedAssetIds: [PRODUCT] },
          intent,
        ],
        instructionsBySceneExecutionId: { [SCENE]: instructions },
      }),
      certifyProductVisualAuthority: vi.fn(async () => certification()),
      productGroundedProviderMode: "FIRST_FRAME_I2V",
      productGroundedProviderModeCertified: true,
    });

    const canonical = await resolver.resolve({
      uri: "snapshot://r4-scene-2",
      contentHash: "hash",
    }) as CanonicalScenePayloadForAdapter;
    expect(canonical.visualAuthorityCertification).toMatchObject({
      status: "CERTIFIED",
      productAssetId: PRODUCT,
    });
    expect(evaluateProductGroundingPreDispatch({
      grounding: canonical.productGrounding!,
      visualAuthorityCertification: canonical.visualAuthorityCertification,
      prompt: canonical.prompt,
      assetReferences: canonical.assetReferences,
    })).toEqual({ status: "ALLOWED", blockers: [] });
  });

  it("fails closed when certification proof is absent", () => {
    const compilation = makePhase2aCompilation();
    const scene = compilation.intents[0]!;
    const payload = mapCompiledInstructionsToCanonicalScenePayload({
        intent: scene,
        instructions: compilation.instructionsBySceneExecutionId[scene.identity.sceneExecutionId]!,
        productAuthorityAssessment: { status: "RESOLVED" },
        productGroundedProviderMode: "FIRST_FRAME_I2V",
        productGroundedProviderModeCertified: true,
      });
    expect(evaluateProductGroundingPreDispatch({
      grounding: payload.productGrounding,
      prompt: payload.prompt,
      assetReferences: payload.assetReferences,
    })).toMatchObject({
      status: "BLOCKED_PRE_DISPATCH",
      blockers: expect.arrayContaining(["PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED"]),
    });
  });

  it("denies missing/cross-scope asset authority", async () => {
    const certify = createWorkerProductVisualAuthorityCertifier({
      load: vi.fn(async () => null),
    });
    await expect(certify({
      productAssetId: PRODUCT,
      orgId: certification().orgId,
      workspaceId: certification().workspaceId,
      campaignId: certification().campaignId,
      executionPlanId: PLAN,
      sceneExecutionId: SCENE,
    })).rejects.toThrow(/not certifiable/i);
  });

  it("classifies existing failed dispatch read-only and idempotently", () => {
    const input = {
      executionPlanId: PLAN,
      sceneExecutionId: SCENE,
      providerExecutionId: "b81b5cae-3b6f-5f74-a036-1b0efcb9566b",
      outboxJobId: "91003d2a-b792-5066-8a9a-2b16235afc10",
      dispatchId: "dispatch:0f7df294dd9433060cad605f6b579b7aaa262510b63248c84331c0240440a091",
      workerState: "NOT_ACCEPTED",
      providerRequestId: null,
      providerAttemptCount: 0,
      resultCount: 0,
      generatedReviewCount: 0,
    };
    const first = buildPreDispatchRecoveryPreview(input);
    const replay = buildPreDispatchRecoveryPreview(input);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      recoveryMode: "HUMAN_RETRY_FROM_PRE_PROVIDER_FAILURE",
      secondReleaseRequired: false,
      duplicateOutboxRequired: false,
      duplicateDispatchRequired: false,
      providerCallExecuted: false,
    });
  });

  it("guards review actions and renders truthful blocked state", async () => {
    const source = await readFile(
      "apps/web/src/components/ai-story/GeneratedSceneReviewPanel.tsx",
      "utf8"
    );
    expect(source).toContain('scene.runtimeState === "PRE_DISPATCH_BLOCKED"');
    expect(source).toContain("scene.reviewAvailable");
    expect(source).toContain("scene.generatedMedia");
    expect(source).toContain("generated-scene-pre-dispatch-recovery");
    expect(source).toContain("postPreDispatchRecovery");
    expect(source).toContain('scene.recoveryMode === "HUMAN_RETRY_FROM_PRE_PROVIDER_FAILURE"');
    expect(source).not.toContain('aria-disabled="true"');
  });

  it("certifies the truthful Runtime UI state matrix", () => {
    expect(deriveGeneratedSceneRuntimeState({ released: false, approved: false, running: false, reviewAvailable: false, preDispatchBlocked: false })).toBe("AUTHORIZED_NOT_RELEASED");
    expect(deriveGeneratedSceneRuntimeState({ released: true, approved: false, running: false, reviewAvailable: false, preDispatchBlocked: false })).toBe("QUEUED");
    expect(deriveGeneratedSceneRuntimeState({ released: true, approved: false, running: false, reviewAvailable: false, preDispatchBlocked: true })).toBe("PRE_DISPATCH_BLOCKED");
    expect(deriveGeneratedSceneRuntimeState({ released: true, approved: false, running: true, reviewAvailable: false, preDispatchBlocked: false })).toBe("RUNNING");
    expect(deriveGeneratedSceneRuntimeState({ released: true, approved: false, running: false, reviewAvailable: true, preDispatchBlocked: false })).toBe("PENDING_REVIEW");
    expect(deriveGeneratedSceneRuntimeState({ released: true, approved: true, running: false, reviewAvailable: true, preDispatchBlocked: false })).toBe("APPROVED");
  });

  it("stops automatic polling while pre-dispatch recovery needs an operator", () => {
    expect(shouldPollRuntimeProjection({
      status: "SCENES_RUNNING",
      pendingReviewSceneCount: 0,
      generatedSceneReviews: [
        {
          runtimeState: "PRE_DISPATCH_BLOCKED",
          running: false,
        },
      ],
    } as never)).toBe(false);
  });
});
