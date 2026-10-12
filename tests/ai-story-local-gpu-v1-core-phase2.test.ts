import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_CERTIFIED_LOCAL_WORKFLOWS,
  AI_STORY_VIDEO_EXECUTION_MODES,
  LOCAL_GPU_DISPATCH_DISABLED_WORKFLOWS,
  LOCAL_GPU_RESULT_AUTHORITY_DENIED_WORKFLOWS,
  LOCAL_GPU_WORKER_WORKFLOW,
  assertLocalGpuDispatchWorkflow,
  assertLocalGpuSubmitAllowed,
  assertLocalGpuUploadBinding,
  buildLocalGpuDesktopSubmit,
  localGpuReconcileBackoffMs,
  localGpuResultStoragePath,
} from "@ceo-agent/shared/server";
import { InMemoryLocalGpuReleaseLedger, claimPreparedLocalGpuRelease, selectNextLocalGpuRelease } from "@ceo-agent/db";
import { materializeLocalGenerationResult } from "../packages/agents/src/ai-story/generation-result-service";
import { runWorkerLocalGpuDispatchCycle } from "../apps/worker/src/ai-story-local-gpu-worker-dispatch";
import { AiStoryLocalGenerationPackageSchema } from "@ceo-agent/shared";
import {
  LocalGpuCloudAdapter,
  LocalGpuSubmitAmbiguousError,
  LocalGpuSubmitRejectedError,
} from "../packages/agents/src/ai-story/local-gpu-adapter";
import { assertLocalGpuAccess, resolveExplicitLocalGpuProviderAuthority } from "../packages/agents/src/ai-story/local-gpu-access";
import { loadLocalGpuConfigFromEnv, redactLocalGpuConfig } from "../packages/agents/src/ai-story/local-gpu-config";
import { advanceLocalGpuRelease } from "../packages/agents/src/ai-story/local-gpu-release-cycle";
import { signLocalGpuRequest, verifyLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = `sha256:${"b".repeat(64)}`;
const secret = "phase2-test-signing-secret";
const now = new Date("2026-10-11T00:00:00.000Z");
const actor = {
  userId: id(16),
  workspaceId: id(3),
  organizationPlan: null,
  platformAdminStatus: "ACTIVE_GRANT" as const,
};

function config() {
  return loadLocalGpuConfigFromEnv({
    LOCAL_GPU_PROVIDER_ENABLED: "true",
    LOCAL_GPU_ENVIRONMENT: "staging",
    LOCAL_GPU_SIGNING_SECRET: secret,
    LOCAL_GPU_BASE_URL: "https://local-gpu.embersoullabs.com",
  });
}

function upload() {
  return {
    environment: "staging" as const,
    method: "PUT",
    url: "https://storage.example.test/upload/object",
    assetId: id(15),
  };
}

function pkg(workflow = LOCAL_GPU_WORKER_WORKFLOW) {
  return {
    workspaceId: id(3),
    sceneExecutionId: id(9),
    packageId: id(1),
    storyId: id(5),
    storyVersionId: id(6),
    prompt: "A synthetic scene",
    recommendedWorkflow: workflow,
    generateAudio: true,
    audioBlocked: false,
    aspectRatio: "9:16",
    references: [{
      approval: "APPROVED",
      role: "PRODUCT",
      assetUrl: "https://storage.example.test/ref.png",
      contentHash: hash,
    }],
  };
}

function adapter(http: ConstructorParameters<typeof LocalGpuCloudAdapter>[1]) {
  return new LocalGpuCloudAdapter(config(), http, { now: () => now, nonce: () => "nonce-1" });
}

describe("LOCAL_GPU V1 core phase 2", () => {
  it("signs a Desktop submit for MINIMAX_H3_R2V and rejects a bad signature, expiry, workspace, and upload binding", () => {
    const cloud = adapter(async () => ({ status: 200, body: JSON.stringify({ state: "QUEUED" }) }));
    const jobId = cloud.jobIdFor(pkg());
    const desktop = buildLocalGpuDesktopSubmit({
      environment: "staging",
      jobId,
      sceneExecutionId: id(9),
      workspaceId: id(3),
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      prompt: "A synthetic scene",
      plannedDurationMs: 6000,
      references: pkg().references,
      audioPolicy: "PRESERVE",
      upload: upload(),
    });
    const signed = signLocalGpuRequest(secret, {
      environment: "staging",
      action: "submit",
      jobId,
      workspaceId: id(3),
      actorId: actor.userId,
      authority: "SUPERADMIN",
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      sceneExecutionId: id(9),
      expiresAt: now.getTime() + 60_000,
      nonce: "nonce-1",
      uploadBinding: desktop.uploadBinding,
    });
    expect(verifyLocalGpuRequest({
      secret, token: signed.token, now, workspaceId: id(3), environment: "staging",
    }).workflow).toBe("MINIMAX_H3_R2V");
    expect(() => verifyLocalGpuRequest({
      secret: "other-secret", token: signed.token, now, workspaceId: id(3), environment: "staging",
    })).toThrow("LOCAL_GPU_SIGNATURE_INVALID");
    expect(() => verifyLocalGpuRequest({
      secret, token: signed.token, now: new Date(now.getTime() + 60_001), workspaceId: id(3), environment: "staging",
    })).toThrow("LOCAL_GPU_REQUEST_EXPIRED");
    expect(() => verifyLocalGpuRequest({
      secret, token: signed.token, now, workspaceId: id(99), environment: "staging",
    })).toThrow("LOCAL_GPU_WORKSPACE_MISMATCH");
    expect(() => assertLocalGpuUploadBinding({ ...upload(), url: `${upload().url}?changed=1` }, desktop.uploadBinding)).toThrow("LOCAL_GPU_UPLOAD_BINDING_MISMATCH");
    const seen = new Set<string>();
    verifyLocalGpuRequest({ secret, token: signed.token, now, workspaceId: id(3), environment: "staging", seenNonces: seen });
    expect(() => verifyLocalGpuRequest({
      secret, token: signed.token, now, workspaceId: id(3), environment: "staging", seenNonces: seen,
    })).toThrow("LOCAL_GPU_TOKEN_REPLAYED");
    expect(redactLocalGpuConfig(config()).signingSecret).toBe("[REDACTED]");
  });

  it("keeps one job id, posts once, and recovers that job after a lost acceptance", async () => {
    const calls: { method: string; url: string }[] = [];
    let posts = 0;
    const cloud = adapter(async (request) => {
      calls.push({ method: request.method, url: request.url });
      if (request.method === "POST") {
        posts += 1;
        if (posts === 1) throw new Error("timeout");
        return { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
      }
      return { status: 200, body: JSON.stringify({ state: "GENERATING" }) };
    });
    const jobId = cloud.jobIdFor(pkg());
    expect(cloud.jobIdFor(pkg())).toBe(jobId);
    await expect(cloud.submit({ actor, package: pkg(), plannedDurationMs: 6000, upload: upload() })).rejects.toBeInstanceOf(LocalGpuSubmitAmbiguousError);
    assertLocalGpuSubmitAllowed(null);
    expect(() => assertLocalGpuSubmitAllowed(jobId)).toThrow("LOCAL_GPU_DUPLICATE_SUBMIT");
    let runtime = advanceLocalGpuRelease({ gate: jobId, notFoundCount: 0, uncertainCount: 0 }, { type: "submit_ambiguous" });
    expect(runtime.jobId).toBe(jobId);
    expect(runtime.submit).toBe(false);
    const status = await cloud.status(jobId, { actor, workspaceId: id(3), sceneExecutionId: id(9) });
    expect(status).toMatchObject({ found: true, state: "GENERATING" });
    runtime = advanceLocalGpuRelease(runtime, { type: "status", state: "GENERATING" });
    expect(runtime.action).toBe("track");
    expect(runtime.jobId).toBe(jobId);
    expect(posts).toBe(1);
    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/v1/jobs"))).toBe(true);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("recognizes completion of the original job and does not submit again", () => {
    const jobId = id(31);
    const tracked = advanceLocalGpuRelease({ gate: jobId, notFoundCount: 0, uncertainCount: 0 }, { type: "submit_accepted" });
    const done = advanceLocalGpuRelease(tracked, { type: "status", state: "COMPLETED" });
    expect(done.action).toBe("recognize_completion");
    expect(done.gate).toBe(`result:${jobId}`);
    expect(done.submit).toBe(false);
    expect(advanceLocalGpuRelease(done, { type: "status_not_found" }).action).toBe("stop");
  });

  it("turns a definite rejection into a terminal gate and never posts after an ambiguous or missing job", () => {
    const jobId = id(31);
    const rejected = advanceLocalGpuRelease({ gate: jobId, notFoundCount: 0, uncertainCount: 0 }, { type: "submit_rejected" });
    expect(rejected.action).toBe("terminal");
    expect(rejected.gate).toBe(`failed:${jobId}`);
    let runtime = advanceLocalGpuRelease({ gate: jobId, notFoundCount: 0, uncertainCount: 0 }, { type: "submit_ambiguous" });
    runtime = advanceLocalGpuRelease(runtime, { type: "status_not_found" });
    runtime = advanceLocalGpuRelease(runtime, { type: "status_not_found" });
    expect(runtime.submit).toBe(false);
    expect(runtime.action).toBe("poll");
    runtime = advanceLocalGpuRelease(runtime, { type: "status_not_found" });
    expect(runtime.action).toBe("reconciliation_blocker");
    expect(runtime.gate).toBe(`blocked:${jobId}`);
    expect(runtime.submit).toBe(false);
    expect(localGpuReconcileBackoffMs(1)).toBeLessThan(localGpuReconcileBackoffMs(2));
    expect(localGpuReconcileBackoffMs(20)).toBe(30_000);
  });

  it("claims one release deterministically and lets only one concurrent worker win", () => {
    const earlier = new Date("2026-10-01T00:00:00.000Z");
    const later = new Date("2026-10-02T00:00:00.000Z");
    const rows = [
      { sceneExecutionId: id(2), releasedAt: later, gateProviderAttemptId: null, executionMode: "LOCAL_GPU", releaseState: "RELEASED" },
      { sceneExecutionId: id(1), releasedAt: earlier, gateProviderAttemptId: null, executionMode: "LOCAL_GPU", releaseState: "RELEASED" },
      { sceneExecutionId: id(3), releasedAt: earlier, gateProviderAttemptId: "job", executionMode: "LOCAL_GPU", releaseState: "RELEASED" },
      { sceneExecutionId: id(4), releasedAt: earlier, gateProviderAttemptId: null, executionMode: "MANUAL_LOCAL", releaseState: "RELEASED" },
    ];
    expect(selectNextLocalGpuRelease(rows)?.sceneExecutionId).toBe(id(1));
    const sameTime = [
      { sceneExecutionId: id(9), releasedAt: earlier, gateProviderAttemptId: null, executionMode: "LOCAL_GPU", releaseState: "RELEASED" },
      { sceneExecutionId: id(8), releasedAt: earlier, gateProviderAttemptId: null, executionMode: "LOCAL_GPU", releaseState: "RELEASED" },
    ];
    expect(selectNextLocalGpuRelease(sameTime)?.sceneExecutionId).toBe(id(8));
    const ledger = new InMemoryLocalGpuReleaseLedger(rows.map((row) => ({ ...row })));
    const selected = ledger.selectNext();
    expect(selected?.sceneExecutionId).toBe(id(1));
    const shared = rows.map((row) => ({ ...row }));
    const workerA = new InMemoryLocalGpuReleaseLedger(shared);
    const workerB = new InMemoryLocalGpuReleaseLedger(shared);
    const selectedA = workerA.selectNext();
    const selectedB = workerB.selectNext();
    expect(selectedA?.sceneExecutionId).toBe(id(1));
    expect(selectedB?.sceneExecutionId).toBe(id(1));
    expect(claimPreparedLocalGpuRelease(workerA, selectedA, "job-a")?.sceneExecutionId).toBe(id(1));
    expect(claimPreparedLocalGpuRelease(workerB, selectedB, "job-b")).toBeNull();
    expect(shared.find((row) => row.sceneExecutionId === id(2))?.gateProviderAttemptId).toBeNull();
    expect(ledger.claim(id(4), "job-c")).toBe(false);
    const claimSource = readFileSync(join(root, "packages/db/src/queries/ai-story-local-gpu-release-claim.ts"), "utf8");
    expect(claimSource).toContain("isNull(schema.aiStorySceneReleaseStates.gateProviderAttemptId)");
    expect(claimSource).toContain("releasedAt} asc nulls last");
    expect(claimSource).toContain("sceneExecutionId");
  });

  it("keeps execution, Native Dialogue, the candidate, and normal users disabled", async () => {
    expect(loadLocalGpuConfigFromEnv({}).enabled).toBe(false);
    expect(loadLocalGpuConfigFromEnv({}).agencyEnabled).toBe(false);
    expect(() => loadLocalGpuConfigFromEnv({ AGENCY_LOCAL_GPU_ENABLED: "true" })).toThrow("LOCAL_GPU_AGENCY_DISABLED");
    expect(resolveExplicitLocalGpuProviderAuthority({ requestedProvider: "seedance" })).toEqual({ kind: "EXISTING" });
    expect(() => resolveExplicitLocalGpuProviderAuthority({ requestedProvider: "LOCAL_GPU" })).toThrow("LOCAL_GPU_PROVIDER_DISABLED");
    expect(() => assertLocalGpuAccess({ ...actor, platformAdminStatus: "DENIED" }, { workspaceId: id(3) })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => assertLocalGpuAccess({ ...actor, organizationPlan: "agency", platformAdminStatus: "DENIED" }, { workspaceId: id(3) })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => assertLocalGpuAccess({ ...actor, isSuperadmin: true } as never, { workspaceId: id(3) })).toThrow("LOCAL_GPU_CLIENT_AUTHORITY_REJECTED");
    expect(() => assertLocalGpuDispatchWorkflow("MINIMAX_H3_NATIVE_DIALOGUE")).toThrow("LOCAL_GPU_DISPATCH_DISABLED");
    expect(() => assertLocalGpuDispatchWorkflow("MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1")).toThrow("LOCAL_GPU_DISPATCH_DISABLED");
    expect([...AI_STORY_CERTIFIED_LOCAL_WORKFLOWS]).toEqual(["MINIMAX_H3_NATIVE_DIALOGUE"]);
    expect([...AI_STORY_VIDEO_EXECUTION_MODES]).toEqual(["MANUAL_LOCAL", "REMOTE_PROVIDER"]);
    expect([...LOCAL_GPU_DISPATCH_DISABLED_WORKFLOWS]).toEqual([...LOCAL_GPU_RESULT_AUTHORITY_DENIED_WORKFLOWS]);
    const execute = readFileSync(join(root, "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"), "utf8");
    const processors = readFileSync(join(root, "apps/worker/src/processors/index.ts"), "utf8");
    expect(execute).not.toContain("LOCAL_GPU");
    expect(processors).toContain("runWorkerLocalGpuDispatchCycle(process.env)");
    const closed = {
      load: async () => { throw new Error("LOCAL_GPU_UNEXPECTED_CLAIM"); },
      claim: () => { throw new Error("LOCAL_GPU_UNEXPECTED_CLAIM"); },
      adapter: {} as never,
      actor,
      request: {} as never,
      capabilities: null,
      existingResultId: null,
    };
    expect(await runWorkerLocalGpuDispatchCycle({}, closed)).toMatchObject({ code: "DISABLED", posts: 0, gets: 0, submit: false });
    expect(await runWorkerLocalGpuDispatchCycle({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
      LOCAL_GPU_ENVIRONMENT: "production",
    }, closed)).toMatchObject({ code: "LOCAL_GPU_PRODUCTION_DENIED", posts: 0, gets: 0, submit: false });
    expect(adapter(async () => ({ status: 200, body: "{}" })).remoteProviderFallback).toBe(0);
  });

  it("rejects Native Dialogue and candidate submits before any network call, and a 422 stays terminal", async () => {
    let calls = 0;
    const cloud = adapter(async () => {
      calls += 1;
      return { status: 422, body: JSON.stringify({ code: "REJECTED" }) };
    });
    await expect(cloud.submit({
      actor, package: pkg("MINIMAX_H3_NATIVE_DIALOGUE"), plannedDurationMs: 6000, upload: upload(),
    })).rejects.toThrow("LOCAL_GPU_DISPATCH_DISABLED");
    await expect(cloud.submit({
      actor, package: pkg("MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1"), plannedDurationMs: 6000, upload: upload(),
    })).rejects.toThrow("LOCAL_GPU_DISPATCH_DISABLED");
    expect(calls).toBe(0);
    await expect(cloud.submit({ actor, package: pkg(), plannedDurationMs: 6000, upload: upload() })).rejects.toBeInstanceOf(LocalGpuSubmitRejectedError);
    expect(calls).toBe(1);
  });

  it("still materializes Manual Local output without a Desktop workflow", () => {
    const item = AiStoryLocalGenerationPackageSchema.parse({
      version: "local-generation-package.v1", packageId: id(1), packageFingerprint: hash, executionMode: "MANUAL_LOCAL",
      organizationId: id(2), workspaceId: id(3), campaignId: id(4), storyId: id(5), storyVersionId: id(6), executionPlanId: id(7), runtimeAuthorizationId: id(8),
      unitId: id(9), sceneExecutionId: id(9), sceneId: "scene-1", order: 1, durationSec: 4, aspectRatio: "9:16", resolutionIntent: "720p", recommendedWorkflow: "WAN_T2V",
      generationMode: "TEXT_TO_VIDEO", prompt: "A deterministic synthetic Scene.", negativePrompt: "", dialogue: [], generateAudio: false, audioBlocked: true,
      characterAuthority: null, productAuthority: null, worldDescription: "Synthetic room", mustKeep: [], mustAvoid: [], qcRequirements: [], continuityRequirements: [], previousUnitEndState: [], currentUnitStartState: [], expectedEndState: [], references: [],
      sourceAuthority: { schedulingAuthorityId: id(10), schedulingAuthorityFingerprint: hash, plannerSnapshotId: id(11), compiledRequestId: id(12), compiledRequestFingerprint: hash, sceneFingerprint: hash, semanticPlanFingerprint: hash, preGenerationQcEvaluationId: id(13), preGenerationQcFingerprint: hash, directorFingerprint: hash, motionFingerprint: hash, castSnapshotFingerprint: hash, locationSnapshotFingerprint: hash, productSnapshotFingerprint: hash },
      planningAuthority: { planningLineageSource: "LEGACY_COMPILED_V1", sceneVersion: 1, scriptVersionId: null, handoffId: null, handoffFingerprint: null },
      instructions: "Render locally", state: "AWAITING_LOCAL_OUTPUT", retryOfPackageId: null, retryNumber: 0, createdAt: "2026-10-01T00:00:00.000Z",
    });
    const result = materializeLocalGenerationResult({
      package: item,
      output: { outputId: id(14), packageId: item.packageId, unitId: item.unitId, sceneExecutionId: item.sceneExecutionId, assetId: id(15), contentHash: hash, mediaType: "video/mp4", durationSec: 4, width: 720, height: 1280, uploadedBy: id(16), uploadedAt: "2026-10-01T00:00:00.000Z", qcState: "PENDING", continuityFrameAssetId: null },
      animationPackageId: id(17), sceneId: "scene-1", sceneOrder: 0, storagePath: `${item.workspaceId}/ai-story/local/output.mp4`, byteSize: 2000, decodable: true,
    });
    expect(result.source.sourceKind).toBe("MANUAL_LOCAL");
    expect(localGpuResultStoragePath(id(3), hash)).toContain("/ai-story/local-gpu/");
  });
});
