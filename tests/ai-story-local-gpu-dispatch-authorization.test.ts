import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalGpuContractError } from "@ceo-agent/shared/server";
import {
  LocalGpuAuthorizationError,
  localGpuDispatchIdempotencyKey,
  localGpuOutputStoragePath,
  toLocalGpuAuthorizationError,
} from "../packages/agents/src/ai-story/local-gpu-dispatch-authorization";

const read = (path: string) => readFileSync(path, "utf8");

describe("LOCAL_GPU dispatch authorization contract", () => {
  it("maps every known failure to an accurate 403/409/503 instead of HTTP 500", () => {
    const cases: Array<[unknown, string, number]> = [
      [new LocalGpuContractError("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS"), "LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS", 409],
      [new Error("LOCAL_GPU_SUPERADMIN_AUTHORITY_REQUIRED"), "LOCAL_GPU_SUPERADMIN_AUTHORITY_REQUIRED", 403],
      [new Error("LOCAL_GPU_SCENE_RELEASE_NOT_ELIGIBLE"), "LOCAL_GPU_SCENE_RELEASE_NOT_ELIGIBLE", 409],
      [new Error("LOCAL_GPU_IDEMPOTENCY_CONFLICT"), "LOCAL_GPU_IDEMPOTENCY_CONFLICT", 409],
      [new Error("LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED"), "LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED", 409],
      [new Error("LOCAL_GPU_SIGNING_SECRET_REQUIRED"), "LOCAL_GPU_CONFIG_UNAVAILABLE", 503],
      [new Error("LOCAL_GPU_CONFIG_INVALID:LOCAL_GPU_PROVIDER_ENABLED"), "LOCAL_GPU_CONFIG_UNAVAILABLE", 503],
    ];
    for (const [error, code, status] of cases) {
      expect(toLocalGpuAuthorizationError(error)).toMatchObject({ code, httpStatus: status });
    }
    const typed = new LocalGpuAuthorizationError("LOCAL_GPU_PRODUCTION_DENIED", 503, "disabled");
    expect(toLocalGpuAuthorizationError(typed)).toBe(typed);
  });

  it("does not disguise unknown failures as typed authorization errors", () => {
    expect(toLocalGpuAuthorizationError(new Error("connection reset"))).toBeNull();
    expect(toLocalGpuAuthorizationError("boom")).toBeNull();
  });

  it("keeps the workspace-prefixed upload path accepted by canonical VALIDATE_OUTPUT and the UI idempotency key", () => {
    expect(localGpuOutputStoragePath({ workspaceId: "w", packageId: "p", assetId: "a" })).toBe("w/ai-story/local-generation/p/a.mp4");
    expect(localGpuDispatchIdempotencyKey({ packageId: "p", runtimeAuthorizationId: "r" })).toBe("local-gpu:p:r");
    expect(read("apps/web/src/components/ai-story/LocalGenerationPanel.tsx")).toContain("local-gpu:${");
    expect(read("apps/worker/src/ai-story-local-media-worker-cycle.ts")).toContain("/ai-story/local-generation/${pkg.packageId}/");
  });

  it("derives authority automatically after every release path without a second manual click", () => {
    for (const path of [
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/release-next-scene/route.ts",
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/result/route.ts",
    ]) {
      expect(read(path)).toContain("autoAuthorizeLocalGpuAfterRelease");
    }
    expect(read("apps/worker/src/ai-story-local-media-worker-cycle.ts")).toContain("autoAuthorizeReleasedLocalGpuPackages");
  });

  it("rejects Desktop-incompatible scene durations at Planning approval instead of at dispatch", () => {
    const capability = read("apps/web/src/lib/ai-story-execution-capability.ts");
    expect(capability).toContain("PLANNING_EXECUTION_DURATION_UNSUPPORTED");
    expect(capability).toContain("LOCAL_GPU_DURATION_MIN_SEC");
    expect(capability).toContain("LOCAL_GPU_DURATION_MAX_SEC");
  });

  it("never resubmits: dispatch stays observable only through the persisted job gate and stops once output is bound", () => {
    const query = read("packages/db/src/queries/ai-story-local-gpu-dispatch-authority.ts");
    expect(query).toContain("isNotNull(schema.aiStorySceneReleaseStates.gateProviderAttemptId)");
    expect(query).toContain("'VALIDATE_OUTPUT'");
    expect(query).toContain("db.transaction");
    const worker = read("apps/worker/src/ai-story-local-gpu-worker-dispatch.ts");
    expect(worker).toContain("claimExplicitLocalGpuReleaseGate");
    expect(worker).toContain("kind: \"VALIDATE_OUTPUT\"");
  });
});
