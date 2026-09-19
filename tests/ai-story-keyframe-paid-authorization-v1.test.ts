import { describe, expect, it } from "vitest";
import {
  AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
  AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON,
  type AiStoryKeyframePaidAuthorizationFact,
} from "../packages/shared/src/ai-story-keyframe-paid-authorization";
import { isKeyframePaidAuthorizationIntegrityValid, keyframePaidAuthorizationIntegrityHash } from "../packages/shared/src/ai-story-keyframe-paid-authorization.server";
import { mapKeyframePaidAuthorizationToCreativeImage } from "../packages/agents/src/ai-story/keyframe-paid-authorization";
import { AiStoryKeyframePaidAuthorizationService } from "../packages/agents/src/ai-story/keyframe-paid-authorization";
import { sha256CanonicalIntegrityHash } from "../packages/shared/src/canonical-integrity";
import type { AiStoryKeyframePaidAuthorizationRepository } from "../packages/db/src/queries/ai-story-keyframe-paid-authorization";

const core = {
  authorizationId: "11111111-1111-5111-8111-111111111111",
  contractVersion: AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
  orgId: "22222222-2222-5222-8222-222222222222",
  workspaceId: "33333333-3333-5333-8333-333333333333",
  storyId: "44444444-4444-5444-8444-444444444444",
  sceneId: "55555555-5555-5555-8555-555555555555",
  sceneVersionId: "66666666-6666-5666-8666-666666666666",
  preparationAuthorityId: "preparation-v1",
  preparationFingerprint: `sha256:${"a".repeat(64)}`,
  keyframeBriefFingerprint: `sha256:${"b".repeat(64)}`,
  authorizedProviderId: "openai",
  authorizedModelId: "gpt-image-2",
  maximumImageProviderCalls: 1 as const,
  authorizedBy: "77777777-7777-5777-8777-777777777777",
  authorizedAt: "2026-09-07T01:02:03.000Z",
  authorizationReason: AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON,
};

function fact(): AiStoryKeyframePaidAuthorizationFact {
  return { ...core, deterministicIntegrityHash: keyframePaidAuthorizationIntegrityHash(core) };
}

describe("ai-story-keyframe-paid-authorization.v1", () => {
  it("binds immutable human provenance, exact scope, provider/model, and one image call", () => {
    const authority = fact();
    expect(isKeyframePaidAuthorizationIntegrityValid(authority)).toBe(true);
    expect(authority.authorizedBy).toBe(core.authorizedBy);
    expect(authority.authorizedAt).toBe(core.authorizedAt);
    expect(authority.maximumImageProviderCalls).toBe(1);
    expect(isKeyframePaidAuthorizationIntegrityValid({ ...authority, sceneId: "88888888-8888-5888-8888-888888888888" })).toBe(false);
    expect(isKeyframePaidAuthorizationIntegrityValid({ ...authority, authorizedAt: new Date().toISOString() })).toBe(false);
  });

  it("projects provenance exactly without changing the Scene execution identity", () => {
    const mapped = mapKeyframePaidAuthorizationToCreativeImage({
      fact: fact(), executionIdentity: "sha256:legacy-creative-identity",
      adapter: { providerId: "openai", modelId: "gpt-image-2" },
    });
    expect(mapped).toMatchObject({
      authorizationId: core.authorizationId,
      authorizedBy: core.authorizedBy,
      authorizedAt: core.authorizedAt,
      executionIdentity: "sha256:legacy-creative-identity",
      idempotencyKey: "sha256:legacy-creative-identity",
      maximumProviderCalls: 1,
      scope: { tenantId: core.orgId, workspaceId: core.workspaceId },
    });
  });

  it("fails closed for a different Provider/model or a forged legacy marker", () => {
    expect(() => mapKeyframePaidAuthorizationToCreativeImage({
      fact: fact(), executionIdentity: "identity",
      adapter: { providerId: "another-provider", modelId: "gpt-image-2" },
    })).toThrow("AUTHORIZATION_PROVIDER_MISMATCH");
    expect(isKeyframePaidAuthorizationIntegrityValid({ authorized: true, authorizationId: core.authorizationId })).toBe(false);
  });

  it("records server provenance once and converges an equivalent explicit-confirmation replay", async () => {
    const scope = { tenantId: core.orgId, workspaceId: core.workspaceId, storyId: core.storyId, sceneId: core.sceneId, sceneVersionId: core.sceneVersionId };
    const preparationCore = {
      contractVersion: "ai-story-scene-input-preparation.v1", preparationAuthorityId: "preparation-v1", version: 1,
      sceneId: scope.sceneId, sceneVersionId: scope.sceneVersionId, retryAuthorityId: null, activeIntentAuthorityId: "intent-v1",
      narrativeWorldStateIdentity: `sha256:${"1".repeat(64)}`, sourceRawAssetId: "raw", sourceRawAssetContentHash: `sha256:${"2".repeat(64)}`,
      identityFactsToPreserve: [], environmentFactsNotToInherit: [], targetLocation: { id: "walkway", label: "Walkway" },
      targetCharactersPresent: [], targetPossessions: [], targetActions: [], incomingTransition: null,
      compatibility: { rawLocation: "CONFLICTING", subjectIdentity: "COMPATIBLE", composition: "CONFLICTING", sceneAction: "CONFLICTING", characterPresence: "COMPATIBLE", productPossession: "COMPATIBLE", providerMode: "COMPATIBLE" },
      decision: "SCENE_PREPARATION_REQUIRED", reasons: ["RAW_ENVIRONMENT_CONFLICTS_WITH_ACTIVE_SCENE"],
      provider: { providerId: "seedance", modelId: "dreamina-seedance-2-0-260128", mode: "FIRST_FRAME_IMAGE_TO_VIDEO", acceptsSceneFrame: true, stronglyAnchorsToSceneFrame: true, capabilityContractVersion: "v1" },
      supersedesPreparationAuthorityId: null, createdAt: "2026-09-07T00:00:00.000Z",
    } as const;
    const preparation = { ...preparationCore, fingerprint: sha256CanonicalIntegrityHash({ kind: preparationCore.contractVersion, authority: preparationCore }) };
    const briefCore = { contractVersion: "ai-story-scene-keyframe-brief.v1", SCENE_IDENTITY: scope,
      preparationAuthorityId: preparation.preparationAuthorityId, preparationFingerprint: preparation.fingerprint } as const;
    const brief = { ...briefCore, fingerprint: sha256CanonicalIntegrityHash({ kind: briefCore.contractVersion, brief: briefCore }) };
    const values = new Map<string, AiStoryKeyframePaidAuthorizationFact>();
    const repository: AiStoryKeyframePaidAuthorizationRepository = {
      async findById(id) { return values.get(id) ?? null; },
      async persist(value) { values.set(value.authorizationId, value); return value; },
    };
    let clockCalls = 0;
    const service = new AiStoryKeyframePaidAuthorizationService(repository, {
      async loadCurrent() { return { preparation, brief } as never; },
    }, () => { clockCalls += 1; return core.authorizedAt; });
    const command = { authorizationRequestId: "explicit-click-1", actorUserId: core.authorizedBy, orgId: core.orgId,
      scope, providerId: "openai", modelId: "gpt-image-2" };
    const first = await service.authorizeSceneKeyframePaidGeneration(command);
    const replay = await service.authorizeSceneKeyframePaidGeneration(command);
    expect(replay).toEqual(first);
    expect(values.size).toBe(1);
    expect(clockCalls).toBe(1);
    expect(first).toMatchObject({ authorizedBy: core.authorizedBy, authorizedAt: core.authorizedAt, maximumImageProviderCalls: 1 });
  });
});
