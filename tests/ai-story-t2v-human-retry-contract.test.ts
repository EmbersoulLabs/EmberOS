import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  SceneAttemptInputRevisionFactSchema,
  assertRetryProviderModeMatchesFrozenScene,
  deriveAiStoryRetryProviderModeFromFrozenScene,
} from "@ceo-agent/shared";
import {
  createCompilationBackedCanonicalPayloadResolver,
  mapCompiledInstructionsToCanonicalScenePayload,
  type CanonicalScenePayloadForAdapter,
} from "../packages/agents/src/ai-story/canonical-scene-payload-resolver";
import { CREATIVE_T2V_MODE } from "../packages/agents/src/ai-story/product-grounding-contract";
import { applyRetryInputRevision } from "../packages/agents/src/ai-story/differentiated-retry-service";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const ID = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const HASH = `sha256:${"a".repeat(64)}`;

function t2vRevision(overrides: Record<string, unknown> = {}) {
  return SceneAttemptInputRevisionFactSchema.parse({
    retryInputRevisionId: ID("911"),
    orgId: ID("1"),
    workspaceId: ID("2"),
    campaignId: ID("3"),
    storyId: ID("4"),
    executionPlanId: ID("101"),
    sceneExecutionId: ID("201"),
    revisionNumber: 2,
    parentRevisionId: ID("910"),
    sourceAttemptId: "attempt-1",
    sourceReviewId: ID("801"),
    retryReason: "COMPOSITION_UNACCEPTABLE",
    creativeDirection: {
      visualRole: "closed lily bud poetic opening for next Product reveal",
      cameraInstruction: "fast elegant time-lapse bloom",
      focusProgression: ["closed lily bud", "elegant time-lapse bloom"],
      shotEmphasis: "poetic opening for next Product reveal",
    },
    productAssetId: null,
    productAuthorityHash: null,
    visualAuthorityCertificationHash: null,
    providerModeRequirement: "REFERENCE_FREE_T2V",
    canonicalFingerprint: HASH,
    createdBy: ID("9"),
    createdAt: "2026-09-19T00:00:00.000Z",
    contractVersion: "1",
    ...overrides,
  });
}

describe("T2V human retry contract", () => {
  it("does not hardcode FIRST_FRAME_I2V as the only retry mode", () => {
    const coordinator = readFileSync(
      "packages/agents/src/ai-story/scene-scheduling-coordinator.ts",
      "utf8"
    );
    const resolver = readFileSync(
      "packages/agents/src/ai-story/canonical-scene-payload-resolver.ts",
      "utf8"
    );
    const route = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/scenes/[sceneExecutionId]/retry-input-revisions/route.ts",
      "utf8"
    );
    expect(coordinator).not.toContain(
      'providerModeRequirement !== "FIRST_FRAME_I2V"'
    );
    expect(resolver).not.toContain(
      'providerModeRequirement !== "FIRST_FRAME_I2V"'
    );
    expect(route).toContain("deriveAiStoryRetryProviderModeFromFrozenScene");
    expect(route).toContain('retryMode === "REFERENCE_FREE_T2V"');
    expect(route).toContain("certifyVisualAuthority");
    const t2vReturn = route.indexOf('if (retryMode === "REFERENCE_FREE_T2V")');
    const certifyAt = route.indexOf("certifyVisualAuthority({");
    expect(t2vReturn).toBeGreaterThan(-1);
    expect(certifyAt).toBeGreaterThan(t2vReturn);
  });

  it("compiles a reference-free retry without Product certification or first-frame mapping", async () => {
    const compilation = makePhase2aCompilation({
      sceneOrder: [0],
      referenceFreeT2vOrders: [0],
    });
    const intent = compilation.intents[0]!;
    const revision = t2vRevision({
      orgId: intent.identity.tenantId,
      workspaceId: intent.identity.workspaceId,
      campaignId: intent.identity.campaignId,
      storyId: intent.identity.storyId,
      executionPlanId: compilation.plan.storyExecutionId,
      sceneExecutionId: intent.identity.sceneExecutionId,
    });
    const certify = vi.fn();
    const resolver = createCompilationBackedCanonicalPayloadResolver({
      getEnvelopeByPayloadReference: async () => ({
        workspaceId: intent.identity.workspaceId,
        executionContext: {
          trace: {
            executionPlanId: compilation.plan.storyExecutionId,
            sceneExecutionId: intent.identity.sceneExecutionId,
            retryInputRevisionId: revision.retryInputRevisionId,
          },
        },
      }) as never,
      getCompilationByExecutionPlanId: async () => compilation,
      getRetryInputRevisionById: async () => revision,
      certifyProductVisualAuthority: certify,
    });

    const payload = await resolver.resolve({
      uri: "snapshot://t2v-retry",
      contentHash: "hash",
    }) as CanonicalScenePayloadForAdapter;

    expect(certify).not.toHaveBeenCalled();
    expect(payload.generationMode).toBe(CREATIVE_T2V_MODE);
    expect(payload.assetReferences).toEqual([]);
    expect(payload.productGrounding).toBeUndefined();
    expect(payload.visualAuthorityCertification).toBeUndefined();
    expect(payload.productIdentityCapsule.productReferencePresent).toBe(false);
    expect(payload.prompt).toContain("closed lily bud");
    expect(intent.generationAuthority).toEqual({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      effectiveReferenceIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    });
  });

  it("denies compiling a T2V retry that escalates to FIRST_FRAME_I2V", () => {
    const compilation = makePhase2aCompilation({
      sceneOrder: [0],
      referenceFreeT2vOrders: [0],
    });
    const instructions = compilation.instructionsBySceneExecutionId[
      compilation.intents[0]!.identity.sceneExecutionId
    ]!;
    expect(() => applyRetryInputRevision(instructions, {
      ...t2vRevision(),
      providerModeRequirement: "FIRST_FRAME_I2V",
      productAssetId: ID("301"),
      productAuthorityHash: HASH,
      visualAuthorityCertificationHash: HASH,
    } as never)).toThrow(/frozen Scene generation authority/);
    expect(() => mapCompiledInstructionsToCanonicalScenePayload({
      instructions: {
        ...instructions,
        referencedAssetIds: [ID("301")],
      },
      intent: compilation.intents[0],
    })).toThrow(/cannot carry image references|product assets do not match/);
  });

  it("does not infer I2V retry merely because Product assets exist elsewhere", () => {
    expect(deriveAiStoryRetryProviderModeFromFrozenScene({
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
      },
    })).toBe("REFERENCE_FREE_T2V");
    expect(() => assertRetryProviderModeMatchesFrozenScene({
      retryProviderMode: "FIRST_FRAME_I2V",
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
      },
    })).toThrow(/RETRY_MODE_ESCALATION_DENIED|frozen Scene generation authority/);
  });

  it("keeps the ceiling amendment path from changing submission quota", () => {
    const source = readFileSync(
      "packages/db/src/queries/certification-commercial-authority.ts",
      "utf8"
    );
    expect(source).toContain("This bounded path may not change maxProviderSubmissions");
    expect(source).toContain("amendActiveProductionSubmissionQuota");
    expect(source).toContain("SUBMISSION_QUOTA_AMENDED");
  });
});
