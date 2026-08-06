/**
 * Sprint 3 PR 3.2 — Canonical Scene Provider Request unit tests.
 */
import { describe, expect, it } from "vitest";
import { buildCanonicalSceneProviderRequest } from "../packages/agents/src/ai-story/canonical-scene-provider-request";

const OWNERSHIP = {
  orgId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "10000000-0000-4000-8000-000000000002",
  campaignId: "10000000-0000-4000-8000-000000000003",
  storyId: "10000000-0000-4000-8000-000000000004",
  storyVersionId: "10000000-0000-4000-8000-000000000005",
  animationPackageId: "10000000-0000-4000-8000-000000000006",
  executionPlanId: "10000000-0000-4000-8000-000000000101",
} as const;

const HASH =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function baseInput() {
  return {
    ownership: OWNERSHIP,
    sceneExecutionId: "10000000-0000-4000-8000-000000000201",
    sceneId: "scene-a",
    sceneOrder: 0,
    runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
    payloadReference: {
      uri: "snapshot://scene-a",
      contentHash: HASH,
      mediaType: "application/json",
    },
    correlationId: "10000000-0000-5000-8000-000000000701",
    pipelineRunId: OWNERSHIP.executionPlanId,
  };
}

describe("Sprint 3 PR 3.2 canonical scene provider request", () => {
  it("excludes seedance/minimax/credentials/fallback/providerId client selection", () => {
    const request = buildCanonicalSceneProviderRequest({
      ...baseInput(),
      providerId: "seedance",
      preferredProviders: ["seedance", "minimax"],
      credentials: { apiKey: "should-not-appear", token: "x" },
      automaticFallbackEnabled: true,
      seedance: { model: "pro" },
      minimax: { model: "video" },
      apiKey: "sk-test",
      fallbackProviderId: "minimax",
    });

    const serialized = JSON.stringify(request);
    expect(serialized).not.toMatch(/seedance/i);
    expect(serialized).not.toMatch(/minimax/i);
    expect(serialized).not.toMatch(/credentials|apiKey|sk-test/i);
    expect(serialized).not.toMatch(/fallback/i);
    expect(request.providerConstraints.allowedProviderIds).toBeUndefined();
    expect(request).not.toHaveProperty("providerId");
    expect(request).not.toHaveProperty("preferredProviders");
    expect(request).not.toHaveProperty("credentials");
    expect(request).not.toHaveProperty("automaticFallbackEnabled");
  });

  it("sets capability to animation-video-generation", () => {
    const request = buildCanonicalSceneProviderRequest(baseInput());
    expect(request.executionIdentity.capabilityId).toBe(
      "animation-video-generation"
    );
  });

  it("is deterministic for the same inputs", () => {
    const a = buildCanonicalSceneProviderRequest(baseInput());
    const b = buildCanonicalSceneProviderRequest(baseInput());
    expect(a).toEqual(b);
    expect(a.executionIdentity.deterministicFingerprint).toBe(
      b.executionIdentity.deterministicFingerprint
    );
    expect(a.executionIdentity.executionId).toBe(b.executionIdentity.executionId);
    expect(a.executionIdentity.idempotencyKey).toBe(
      b.executionIdentity.idempotencyKey
    );
  });
});
