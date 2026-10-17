import { describe, expect, it } from "vitest";
import {
  LocalGpuCloudAdapter,
  readLocalGpuDesktopRejection,
  redactLocalGpuDiagnosticText,
} from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import {
  LOCAL_GPU_STATUS_NOT_FOUND_RECONCILIATION_MS,
  type LocalGpuSubmitLedger,
} from "../packages/agents/src/ai-story/local-gpu-execution";
import { deriveLocalGpuSubmitLedgerState } from "../packages/db/src/queries/ai-story-local-gpu-submit-outcomes";
import { runWorkerLocalGpuDispatchCycle } from "../apps/worker/src/ai-story-local-gpu-worker-dispatch";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const scope = { workspaceId: id(3), storyId: id(5), sceneExecutionId: id(40) };
const t0 = new Date("2026-10-18T00:00:00.000Z");
const actor = { userId: id(16), workspaceId: scope.workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" as const };
const capabilities = {
  contractVersion: 3,
  acceptedContracts: [1, 2, 3],
  contracts: { v3: { workflows: { MINIMAX_H3_T2V: {
    execution: "enabled", textToVideo: true, placeholderImage: false, missingModels: [], e2eCertified: false,
  } } } },
};
const request = {
  storyId: scope.storyId,
  storyVersionId: id(6),
  prompt: "A quiet product story with room tone.",
  plannedDurationMs: 6000,
  aspectRatio: "9:16" as const,
  seed: 11,
  megapixels: 0.5,
  audioPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO" as const,
  upload: { environment: "staging" as const, method: "PUT", url: "https://uploads.example.test/scene.mp4" },
  assetRecommendationStatus: "CONFIRMED_NO_ASSETS" as const,
  confirmationStoryId: scope.storyId,
  confirmationStoryVersionId: id(6),
  confirmationWorkspaceId: scope.workspaceId,
  planningFrozen: true,
  preGenerationQcEvaluationId: id(80),
  runtimeAuthorizationId: id(70),
  director: { camera: "slow push in", motion: "hold the ending" },
};
const env = {
  LOCAL_GPU_PROVIDER_ENABLED: "true",
  LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
  LOCAL_GPU_ENVIRONMENT: "staging",
  LOCAL_GPU_SCOPE_WORKSPACE_ID: scope.workspaceId,
  LOCAL_GPU_SCOPE_STORY_ID: scope.storyId,
  LOCAL_GPU_SCOPE_SCENE_EXECUTION_ID: scope.sceneExecutionId,
};

type Row = { jobId: string; attemptNumber: number; kind: string; createdAt: Date; evidence: Record<string, unknown> };

/** Mirrors the table contract: (job, attempt, kind) is unique and rows are append-only. */
function memoryLedger(rows: Row[], clock: () => Date, legacyClaimAt: Date | null = null): LocalGpuSubmitLedger {
  const insert = (jobId: string, attemptNumber: number, kind: string, evidence: Record<string, unknown>) => {
    if (rows.some((row) => row.jobId === jobId && row.attemptNumber === attemptNumber && row.kind === kind)) return false;
    rows.push({ jobId, attemptNumber, kind, createdAt: clock(), evidence });
    return true;
  };
  return {
    read: async (jobId) => deriveLocalGpuSubmitLedgerState(rows.filter((row) => row.jobId === jobId), legacyClaimAt),
    start: async (jobId, attempt) => insert(jobId, attempt, "SUBMIT_STARTED", {}),
    record: async (jobId, attempt, { kind, ...evidence }) => { insert(jobId, attempt, kind, evidence); },
  };
}

function harness(respond: (attempt: { method: string; url: string }) => { status: number; body: string } | Promise<never>) {
  const calls: string[] = [];
  let clock = t0;
  const adapter = new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv({
    LOCAL_GPU_PROVIDER_ENABLED: "true",
    LOCAL_GPU_ENVIRONMENT: "staging",
    LOCAL_GPU_SIGNING_SECRET: "submit-recovery-test-secret",
    LOCAL_GPU_BASE_URL: "https://local-gpu.example.test",
  }), async (attempt) => {
    calls.push(`${attempt.method} ${attempt.url}`);
    return respond(attempt);
  }, { now: () => clock, nonce: () => "nonce-recovery" });
  const jobId = adapter.jobIdFor({ workspaceId: scope.workspaceId, sceneExecutionId: scope.sceneExecutionId, packageId: id(30) });
  const rows: Row[] = [];
  let gate: string | null = null;
  let claims = 0;
  const deps = (overrides: Record<string, unknown> = {}) => ({
    load: async () => ({
      ...scope,
      packageId: id(30),
      runtimeAuthorizationId: id(70),
      existingGate: gate,
      route: {
        assetMode: "WITHOUT_ASSET" as const,
        assetRecommendationStatus: "CONFIRMED_NO_ASSETS" as const,
        referenceCount: 0,
        preQc: "DISPATCH_ELIGIBLE" as const,
        runtimeAuthorizationId: id(70),
        capabilities,
        generateAudio: true,
        audioBlocked: false,
        qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO" as const,
      },
    }),
    claim: (claim: { jobId: string }) => {
      if (gate !== null) return false;
      claims += 1;
      gate = claim.jobId;
      return true;
    },
    adapter,
    actor,
    request,
    capabilities,
    existingResultId: null,
    ledger: memoryLedger(rows, () => clock, t0),
    now: () => clock,
    ...overrides,
  });
  return {
    calls, rows, jobId, deps,
    posts: () => calls.filter((call) => call.startsWith("POST")).length,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    claims: () => claims,
  };
}

describe("LOCAL_GPU Desktop rejection preservation", () => {
  it("extracts a structured code, redacted message and field paths without copying secrets", () => {
    const rejection = readLocalGpuDesktopRejection({
      error: {
        code: "CONTRACT_V2_UPLOAD_BINDING_MISMATCH",
        message: "upload https://x.supabase.co/storage/v1/object/upload/sign/a.mp4?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc mismatched Bearer sk-live-123",
        issues: [{ path: ["request", "upload", "binding"] }, { path: "firstFrame.sha256" }, { path: ["bad path with spaces"] }],
      },
    });
    expect(rejection.desktopErrorCode).toBe("CONTRACT_V2_UPLOAD_BINDING_MISMATCH");
    expect(rejection.desktopErrorMessage).not.toMatch(/supabase|eyJ|sk-live|token=/);
    expect(rejection.desktopErrorMessage).toContain("<url>");
    expect(rejection.issuePaths).toEqual(["request.upload.binding", "firstFrame.sha256"]);
    expect(readLocalGpuDesktopRejection({ code: "bad code with spaces", message: "x" }).desktopErrorCode).toBeNull();
    expect(readLocalGpuDesktopRejection(null)).toEqual({ desktopErrorCode: null, desktopErrorMessage: null, issuePaths: [] });
    expect(redactLocalGpuDiagnosticText("x".repeat(500))).toHaveLength(300);
    expect(redactLocalGpuDiagnosticText(`hash ${"f".repeat(64)} signature=abc`)).toBe("hash <hex> signature=<redacted>");
  });
});

describe("LOCAL_GPU submit state machine", () => {
  it.each([400, 401, 403, 422])("persists definite %i rejection before stopping, then never polls or re-posts", async (status) => {
    const h = harness((attempt) => attempt.method === "POST"
      ? { status, body: JSON.stringify({ code: `DESKTOP_${status}`, message: "rejected at https://signed.example/x?sig=1" }) }
      : { status: 404, body: "{}" });
    const first = await runWorkerLocalGpuDispatchCycle(env, h.deps());
    expect(first).toMatchObject({ code: `LOCAL_GPU_SUBMIT_REJECTED:${status}:DESKTOP_${status}`, posts: 1, gets: 0 });
    const rejected = h.rows.find((row) => row.kind === "SUBMIT_REJECTED");
    expect(rejected).toMatchObject({ attemptNumber: 1, evidence: { httpStatus: status, desktopErrorCode: `DESKTOP_${status}` } });
    expect(String(rejected?.evidence.desktopErrorMessage)).not.toContain("signed.example");
    const again = await runWorkerLocalGpuDispatchCycle(env, h.deps());
    expect(again).toMatchObject({ code: "LOCAL_GPU_SUBMIT_TERMINAL_SUBMIT_REJECTED", posts: 0, gets: 0 });
    expect(h.calls).toHaveLength(1);
  });

  it("treats a malformed (non-JSON) 422 body as a definite rejection without a Desktop code", async () => {
    const h = harness(() => ({ status: 422, body: "<html>Unprocessable</html>" }));
    expect(await runWorkerLocalGpuDispatchCycle(env, h.deps())).toMatchObject({ code: "LOCAL_GPU_SUBMIT_REJECTED:422:NO_DESKTOP_CODE" });
    expect(h.rows.map((row) => row.kind)).toEqual(["SUBMIT_STARTED", "SUBMIT_REJECTED"]);
  });

  it.each([
    ["409 conflict", () => ({ status: 409, body: "{}" }), "conflict"],
    ["404 on POST", () => ({ status: 404, body: "{}" }), "not_found"],
    ["503", () => ({ status: 503, body: "{}" }), "unavailable"],
    ["timeout", () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })), null],
    ["lost response", () => Promise.reject(new TypeError("fetch failed")), null],
  ] as const)("records %s as uncertain and keeps status-only reconciliation", async (_label, post, reason) => {
    const h = harness((attempt) => attempt.method === "POST" ? post() : { status: 200, body: JSON.stringify({ job: { state: "GENERATING" } }) });
    expect(await runWorkerLocalGpuDispatchCycle(env, h.deps())).toMatchObject({ code: "LOCAL_GPU_SUBMIT_UNCERTAIN", posts: 1 });
    const uncertain = h.rows.find((row) => row.kind === "SUBMIT_UNCERTAIN");
    expect(uncertain).toBeDefined();
    if (reason) expect(uncertain?.evidence.uncertainReason).toBe(reason);
    expect(h.rows.some((row) => row.kind === "SUBMIT_REJECTED")).toBe(false);
    const polled = await runWorkerLocalGpuDispatchCycle(env, h.deps());
    expect(polled).toMatchObject({ code: "poll", posts: 0, gets: 1 });
    expect(h.rows.filter((row) => row.kind === "SUBMIT_ACCEPTED")).toHaveLength(1);
    await runWorkerLocalGpuDispatchCycle(env, h.deps());
    expect(h.rows.filter((row) => row.kind === "SUBMIT_ACCEPTED")).toHaveLength(1);
    expect(h.posts()).toBe(1);
  });

  it("never treats a standalone 404 as non-acceptance; only a sustained window stops polling, and it is terminal", async () => {
    const h = harness((attempt) => attempt.method === "POST" ? { status: 409, body: "{}" } : { status: 404, body: "{}" });
    await runWorkerLocalGpuDispatchCycle(env, h.deps());
    h.advance(LOCAL_GPU_STATUS_NOT_FOUND_RECONCILIATION_MS - 1000);
    expect(await runWorkerLocalGpuDispatchCycle(env, h.deps())).toMatchObject({ code: "not_found", gets: 1 });
    expect(h.rows.some((row) => row.kind === "STATUS_NOT_FOUND_EXHAUSTED")).toBe(false);
    h.advance(2000);
    expect(await runWorkerLocalGpuDispatchCycle(env, h.deps())).toMatchObject({
      code: "LOCAL_GPU_SUBMIT_TERMINAL_STATUS_NOT_FOUND_EXHAUSTED", gets: 1,
    });
    const calls = h.calls.length;
    expect(await runWorkerLocalGpuDispatchCycle(env, h.deps())).toMatchObject({ code: "LOCAL_GPU_SUBMIT_TERMINAL_STATUS_NOT_FOUND_EXHAUSTED", gets: 0 });
    expect(h.calls).toHaveLength(calls);
    expect(h.posts()).toBe(1);
  });

  it("bounds a legacy claim with no ledger rows from the release claim time", async () => {
    const h = harness(() => ({ status: 404, body: "{}" }));
    const rows: Row[] = [];
    const legacy = { ledger: memoryLedger(rows, () => new Date(t0.getTime() + LOCAL_GPU_STATUS_NOT_FOUND_RECONCILIATION_MS), t0) };
    const step = await runWorkerLocalGpuDispatchCycle(env, {
      ...h.deps(legacy),
      load: async () => ({ ...(await h.deps().load()), existingGate: h.jobId }),
      now: () => new Date(t0.getTime() + LOCAL_GPU_STATUS_NOT_FOUND_RECONCILIATION_MS),
    });
    expect(step).toMatchObject({ code: "LOCAL_GPU_SUBMIT_TERMINAL_STATUS_NOT_FOUND_EXHAUSTED", posts: 0 });
    expect(rows.map((row) => row.kind)).toEqual(["STATUS_NOT_FOUND_EXHAUSTED"]);
    expect(h.posts()).toBe(0);
  });

  it("submits a human-authorized retry exactly once across restarts and concurrent consumers", async () => {
    let posts = 0;
    const h = harness((attempt) => {
      if (attempt.method !== "POST") return { status: 200, body: JSON.stringify({ job: { state: "QUEUED" } }) };
      posts += 1;
      return posts === 1 ? { status: 422, body: JSON.stringify({ code: "PAYLOAD_INVALID" }) } : { status: 200, body: JSON.stringify({ state: "QUEUED" }) };
    });
    await runWorkerLocalGpuDispatchCycle(env, h.deps());
    expect(await runWorkerLocalGpuDispatchCycle(env, h.deps())).toMatchObject({ code: "LOCAL_GPU_SUBMIT_TERMINAL_SUBMIT_REJECTED" });
    h.rows.push({ jobId: h.jobId, attemptNumber: 2, kind: "HUMAN_RETRY_AUTHORIZED", createdAt: new Date(), evidence: {} });

    expect(await runWorkerLocalGpuDispatchCycle(env, h.deps({ authorityLive: false }))).toMatchObject({
      code: "LOCAL_GPU_RETRY_AWAITING_AUTHORITY_RENEWAL", posts: 0,
    });
    const concurrent = await Promise.all([
      runWorkerLocalGpuDispatchCycle(env, h.deps({ authorityLive: true })),
      runWorkerLocalGpuDispatchCycle(env, h.deps({ authorityLive: true })),
    ]);
    expect(concurrent.map((step) => step.code).sort()).toEqual(["LOCAL_GPU_CLAIM_LOST", "accepted"]);
    // a restarted Worker with a fresh ledger handle over the same rows does not post again
    const restarted = await runWorkerLocalGpuDispatchCycle(env, h.deps({ authorityLive: true }));
    expect(restarted).toMatchObject({ code: "poll", posts: 0 });
    expect(posts).toBe(2);
    expect(h.claims()).toBe(1);
    expect(h.rows.filter((row) => row.attemptNumber === 2).map((row) => row.kind)).toEqual([
      "HUMAN_RETRY_AUTHORIZED", "SUBMIT_STARTED", "SUBMIT_ACCEPTED",
    ]);
  });
});
