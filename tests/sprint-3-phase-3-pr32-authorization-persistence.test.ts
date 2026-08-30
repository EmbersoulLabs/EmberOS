/**
 * Sprint 3 PR 3.2 — authorization / scheduling identity persistence unit tests.
 * Pure hash + conflict classification (no DB).
 */
import { describe, expect, it } from "vitest";
import {
  SCENE_SCHEDULING_ERROR_CODES,
  type SceneSchedulingErrorCode,
} from "@ceo-agent/shared";
import {
  SceneSchedulingError,
  buildSceneSchedulingIntegrityPayload,
  classifySceneSchedulingConflict,
  computeSceneSchedulingIdentityHash,
} from "../packages/agents/src/ai-story/scene-scheduling-coordinator";

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
  "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function integrityInput() {
  return {
    ownership: OWNERSHIP,
    sceneExecutionId: "10000000-0000-4000-8000-000000000201",
    runtimeAuthorizationId: "10000000-0000-5000-8000-000000000401",
    authorizationHash: HASH,
    routingDecisionHash: HASH,
    requestHash: HASH,
    envelopeHash: HASH,
    providerExecutionId: "execution:scene-a",
    envelopeId: "envelope:scene-a",
    outboxJobId: "outbox:scene-a",
  };
}

describe("Sprint 3 PR 3.2 authorization persistence identity", () => {
  it("keeps scheduling identity hash stable for equivalent inputs", () => {
    const a = computeSceneSchedulingIdentityHash(integrityInput());
    const b = computeSceneSchedulingIdentityHash(integrityInput());
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[a-f0-9]{64}$/);

    const payload = buildSceneSchedulingIntegrityPayload(integrityInput());
    expect(payload).toMatchObject({
      kind: "scene-scheduling-correlation",
      automaticFallbackEnabled: false,
      executionAllowed: false,
      sceneExecutionId: integrityInput().sceneExecutionId,
    });
    expect(payload).not.toHaveProperty("credentials");
    expect(payload).not.toHaveProperty("providerRawPayload");
  });

  it("changes identity hash when scene or authorization identity changes", () => {
    const base = computeSceneSchedulingIdentityHash(integrityInput());
    const differentScene = computeSceneSchedulingIdentityHash({
      ...integrityInput(),
      sceneExecutionId: "10000000-0000-4000-8000-000000000202",
    });
    const differentAuth = computeSceneSchedulingIdentityHash({
      ...integrityInput(),
      runtimeAuthorizationId: "10000000-0000-5000-8000-000000000402",
    });
    expect(differentScene).not.toBe(base);
    expect(differentAuth).not.toBe(base);
  });

  it("exposes SceneSchedulingError conflict classification codes", () => {
    const conflictCodes: SceneSchedulingErrorCode[] = [
      "RUNTIME_AUTHORIZATION_CONFLICT",
      "ROUTING_DECISION_CONFLICT",
      "PROVIDER_BINDING_CONFLICT",
      "PROVIDER_EXECUTION_CONFLICT",
      "EXECUTION_ENVELOPE_CONFLICT",
      "OUTBOX_SCHEDULING_CONFLICT",
      "IDENTITY_CONFLICT",
    ];
    for (const code of conflictCodes) {
      expect(SCENE_SCHEDULING_ERROR_CODES).toContain(code);
      const error = classifySceneSchedulingConflict(code);
      expect(error).toBeInstanceOf(SceneSchedulingError);
      expect(error.code).toBe(code);
      expect(error.status).toBe(409);
    }
    expect(SCENE_SCHEDULING_ERROR_CODES).toContain("PHASE1_EXECUTION_LOCKED");
    expect(SCENE_SCHEDULING_ERROR_CODES).toContain("NO_ELIGIBLE_PROVIDER");
    expect(SCENE_SCHEDULING_ERROR_CODES).toContain("NO_EXECUTABLE_PROVIDER");
  });
});
