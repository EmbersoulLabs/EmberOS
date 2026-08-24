import { describe, expect, it, vi } from "vitest";
import { createExecutionEnvelope } from "@ceo-agent/shared";
import {
  assertCrossSceneProductAssetContinuity,
  CANONICAL_PRODUCT_REFERENCE_ROLE,
  mapCompiledInstructionsToCanonicalScenePayload,
} from "../packages/agents/src/ai-story/canonical-scene-payload-resolver";
import { mapCanonicalEnvelopeToSeedanceRequest } from "../packages/agents/src/ai-story/seedance-request-mapping";
import { createWorkerProviderAssetAccessResolver } from "../apps/worker/src/ai-story-provider-asset-access";
import { makePhase2aCompilation, PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";

const PAYLOAD_URI = "memory://cross-scene-continuity/scene-b";

async function makeEnvelope() {
  return createExecutionEnvelope({
    version: "1",
    envelopeId: "envelope-cross-scene-continuity",
    payloadReference: PAYLOAD_URI,
    tenantId: PHASE_2A_IDS.orgId,
    workspaceId: PHASE_2A_IDS.workspaceId,
    executionContext: {
      executionId: "execution-cross-scene-continuity",
      correlationId: "10000000-0000-5000-8000-000000000601",
      pipelineRunId: "10000000-0000-4000-8000-000000000101",
      idempotencyKey: "cross-scene-continuity-preview",
      timeoutDeadline: "2026-08-24T12:30:00.000Z",
      dataHandling: {
        sensitiveData: false,
        externalProcessingAllowed: true,
        providerTrainingAllowed: false,
      },
      trace: {},
    },
    capabilityId: "animation-video-generation",
    capabilityVersion: "1.0.0",
    providerPolicySnapshot: { automaticFallbackEnabled: false },
    canonicalRequest: {
      contractVersion: "1",
      executionIdentity: {
        executionId: "execution-cross-scene-continuity",
        tenantId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
        campaignId: PHASE_2A_IDS.campaignId,
        pipelineRunId: "10000000-0000-4000-8000-000000000101",
        capabilityId: "animation-video-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: "cross-scene-continuity-preview",
        deterministicFingerprint:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      normalizedPayloadReference: {
        uri: PAYLOAD_URI,
        contentHash:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        mediaType: "application/json",
      },
      outputSchema: {
        schemaId: "AnimationVideoResult",
        schemaVersion: "1.0.0",
      },
      contextVersions: {
        "ai-story-scene-instructions": "1.0.0",
        "ai-story-runtime-authorization": "1.0.0",
        "ai-story-scene-routing": "1.0.0",
      },
      correlation: {
        correlationId: "10000000-0000-5000-8000-000000000601",
        pipelineRunId: "10000000-0000-4000-8000-000000000101",
      },
      timeoutPolicy: { timeoutMs: 600_000, reconciliationDelayMs: 5_000 },
      retryPolicy: {
        maxAttempts: 1,
        initialDelayMs: 500,
        maximumDelayMs: 500,
        backoffMultiplier: 1,
      },
      providerConstraints: { executionLookupRequired: true },
    },
    createdAt: "2026-08-24T12:00:00.000Z",
  });
}

describe("AI Story cross-Scene product continuity", () => {
  it("propagates one Campaign Asset into every canonical Scene payload", () => {
    const compilation = makePhase2aCompilation();
    assertCrossSceneProductAssetContinuity(compilation.intents);
    const [scene1, scene2] = compilation.intents;
    const payload1 = mapCompiledInstructionsToCanonicalScenePayload({
      intent: scene1,
      instructions: compilation.instructionsBySceneExecutionId[
        scene1!.identity.sceneExecutionId
      ]!,
    });
    const payload2 = mapCompiledInstructionsToCanonicalScenePayload({
      intent: scene2,
      instructions: compilation.instructionsBySceneExecutionId[
        scene2!.identity.sceneExecutionId
      ]!,
      continuityFromSceneId: scene1!.identity.sceneId,
    });

    expect(payload1.assetReferences).toEqual([
      {
        assetId: PHASE_2A_IDS.assetId,
        role: CANONICAL_PRODUCT_REFERENCE_ROLE,
        continuityScope: "STORY",
      },
    ]);
    expect(payload2.assetReferences).toEqual(payload1.assetReferences);
    expect(payload2.productIdentityCapsule).toMatchObject({
      productAssetId: PHASE_2A_IDS.assetId,
      productReferencePresent: true,
      continuityFromSceneId: scene1!.identity.sceneId,
      referenceRoles: [CANONICAL_PRODUCT_REFERENCE_ROLE],
    });
    expect(payload2.productIdentityCapsule).not.toHaveProperty("url");
  });

  it("creates no fake reference when the frozen Scene has no product asset", () => {
    const compilation = makePhase2aCompilation();
    const intent = {
      ...compilation.intents[0]!,
      referencedAssetIds: [],
    };
    const instructions = {
      ...compilation.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!,
      referencedAssetIds: [],
    };
    const payload = mapCompiledInstructionsToCanonicalScenePayload({ intent, instructions });
    expect(payload.assetReferences).toEqual([]);
    expect(payload.productIdentityCapsule.productReferencePresent).toBe(false);
    expect(payload.productIdentityCapsule.productAssetId).toBeUndefined();
  });

  it("rejects a cross-Scene product asset mismatch", () => {
    const compilation = makePhase2aCompilation();
    const mismatched = [
      compilation.intents[0]!,
      {
        ...compilation.intents[1]!,
        referencedAssetIds: ["30000000-0000-4000-8000-000000000007"],
      },
    ];
    expect(() => assertCrossSceneProductAssetContinuity(mismatched)).toThrow(
      /product asset mismatch/i
    );
  });

  it("maps the stable product ID to one Seedance reference image without a paid call", async () => {
    const compilation = makePhase2aCompilation();
    const [scene1, scene2] = compilation.intents;
    const payload = mapCompiledInstructionsToCanonicalScenePayload({
      intent: scene2,
      instructions: compilation.instructionsBySceneExecutionId[
        scene2!.identity.sceneExecutionId
      ]!,
      continuityFromSceneId: scene1!.identity.sceneId,
    });
    const resolveProviderAccessibleUri = vi.fn(async () =>
      "https://storage.invalid/signed/product.png"
    );
    const request = await mapCanonicalEnvelopeToSeedanceRequest({
      envelope: await makeEnvelope(),
      idempotencyKey: "preview-only",
      model: "dreamina-seedance-2-0-260128",
      payloadResolver: { resolve: async () => payload },
      assetAccessResolver: { resolveProviderAccessibleUri },
    });

    expect(resolveProviderAccessibleUri).toHaveBeenCalledWith({
      assetId: PHASE_2A_IDS.assetId,
      orgId: PHASE_2A_IDS.orgId,
      workspaceId: PHASE_2A_IDS.workspaceId,
      campaignId: PHASE_2A_IDS.campaignId,
    });
    expect(request.content).toContainEqual({
      type: "image_url",
      image_url: { url: "https://storage.invalid/signed/product.png" },
      role: "reference_image",
    });
    expect(request.content[0]).toMatchObject({
      type: "text",
      text: expect.stringMatching(/Preserve continuity/),
    });
  });

  it("authorizes private asset delivery by the full server-owned tenant chain", async () => {
    const loadAuthorizedAsset = vi.fn(async (input: {
      assetId: string;
      orgId: string;
      workspaceId: string;
      campaignId: string;
    }) =>
      input.assetId === PHASE_2A_IDS.assetId &&
      input.orgId === PHASE_2A_IDS.orgId &&
      input.workspaceId === PHASE_2A_IDS.workspaceId &&
      input.campaignId === PHASE_2A_IDS.campaignId
        ? { storagePath: `${PHASE_2A_IDS.workspaceId}/library/product.png`, mimeType: "image/png" }
        : null
    );
    const mintSignedUrl = vi.fn(async () => "https://storage.invalid/signed/product.png");
    const resolver = createWorkerProviderAssetAccessResolver({
      loadAuthorizedAsset,
      mintSignedUrl,
    });
    const valid = {
      assetId: PHASE_2A_IDS.assetId,
      orgId: PHASE_2A_IDS.orgId,
      workspaceId: PHASE_2A_IDS.workspaceId,
      campaignId: PHASE_2A_IDS.campaignId,
    };

    await expect(resolver.resolveProviderAccessibleUri(valid)).resolves.toMatch(/^https:/);
    await expect(
      resolver.resolveProviderAccessibleUri({
        ...valid,
        workspaceId: "30000000-0000-4000-8000-000000000002",
      })
    ).rejects.toThrow(/not authorized/i);
    await expect(
      resolver.resolveProviderAccessibleUri({
        ...valid,
        orgId: "30000000-0000-4000-8000-000000000001",
      })
    ).rejects.toThrow(/not authorized/i);
    await expect(
      resolver.resolveProviderAccessibleUri({
        ...valid,
        campaignId: "30000000-0000-4000-8000-000000000003",
      })
    ).rejects.toThrow(/not authorized/i);
    expect(mintSignedUrl).toHaveBeenCalledTimes(1);
  });
});
