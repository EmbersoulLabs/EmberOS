import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  RenderPersistence,
  RenderPersistenceConflictError,
  buildRenderCallbackIdentity,
  buildRenderIdempotencyKey,
  type RenderAttemptIdentity,
  type RenderPersistenceEnvelope,
  type RenderPersistenceMutation,
  type RenderResumeDecisionCode,
  type RenderPersistenceStore,
} from "../apps/worker/src/render-persistence";
import type {
  RenderRequest,
  RenderResult,
} from "../apps/worker/src/render-providers/contracts";

const correlation = {
  taskId: "task-1",
  creativeId: "creative-1",
  campaignId: "campaign-1",
  workspaceId: "workspace-1",
  orgId: "org-1",
  correlationId: "correlation-1",
};

function emptyEnvelope(): RenderPersistenceEnvelope {
  return {
    contractVersion: "1",
    checkpoints: {},
    resultsByRequestFingerprint: {},
    fingerprintIndex: {},
    artifactsById: {},
    idempotencyRecords: {},
  };
}

function atomicMemoryStore(initial = emptyEnvelope()) {
  let value = structuredClone(initial);
  let transactionQueue: Promise<unknown> = Promise.resolve();
  const store: RenderPersistenceStore = {
    load: vi.fn(async () => structuredClone(value)),
    transact<T>(
      operation: (
        envelope: RenderPersistenceEnvelope
      ) => RenderPersistenceMutation<T>
    ): Promise<T> {
      const transaction = transactionQueue.then(() => {
        const mutation = operation(structuredClone(value));
        value = structuredClone(mutation.envelope);
        return mutation.value;
      });
      transactionQueue = transaction.then(
        () => undefined,
        () => undefined
      );
      return transaction;
    },
  };
  return {
    store,
    read: () => structuredClone(value),
    replace: (next: RenderPersistenceEnvelope) => {
      value = structuredClone(next);
    },
  };
}

function request(
  overrides: Partial<RenderRequest> = {}
): RenderRequest {
  return {
    contractVersion: "1",
    renderSpecification: {
      contractVersion: "1",
      assets: [],
      tracks: { video: [], subtitle: [], voiceover: [], bgm: [] },
      effects: [],
      transitions: [],
      timing: { timeBase: "seconds", durationSec: 10 },
      output: {
        format: "mp4",
        previewResolution: "720x1280",
        exportResolution: "1080x1920",
        aspectRatio: "9:16",
        frameRate: 30,
        videoBitrateTargetsKbps: { preview: 2500, export: 8000 },
        audio: {
          codec: "aac",
          sampleRateHz: 48000,
          channels: 2,
          bitrateKbps: 192,
        },
      },
      deterministicKey: "render-spec-key",
    },
    creativeDraftReferences: [
      { creativeId: "creative-1", stableKey: "draft-key" },
    ],
    sourceAssets: [
      { assetId: "asset-1", uri: "temporary.mp4", mediaType: "video" },
    ],
    outputProfile: { mode: "preview", profileKey: "preview" },
    qualityProfile: {
      width: 720,
      height: 1280,
      frameRate: 30,
      videoBitrateKbps: 2500,
      audioBitrateKbps: 192,
    },
    retry: { attempt: 1, deterministicKey: "request-fingerprint" },
    correlation,
    destinations: {
      outputUri: "output.mp4",
      coverOutputUri: "cover.jpg",
    },
    ...overrides,
  };
}

function identity(
  providerId = "provider-a",
  input = request()
): RenderAttemptIdentity {
  return {
    idempotencyKey: buildRenderIdempotencyKey(input, providerId),
    providerId,
    requestFingerprint: input.retry.deterministicKey,
    correlationId: input.correlation.correlationId,
    outputProfileIdentity: "preview",
  };
}

function result(
  overrides: Partial<RenderResult> = {}
): RenderResult {
  return {
    contractVersion: "1",
    status: "COMPLETED",
    outputReferences: [
      { uri: "output.mp4", mediaType: "video", role: "output" },
    ],
    previewReferences: [
      { uri: "preview.mp4", mediaType: "video", role: "preview" },
    ],
    coverReferences: [
      { uri: "cover.jpg", mediaType: "image", role: "cover" },
    ],
    durationSec: 10,
    resolution: { width: 720, height: 1280 },
    fileSizeBytes: 2048,
    fingerprint: "result-fingerprint",
    providerMetadata: {
      providerId: "provider-a",
      providerVersion: "1",
      executionId: "provider-job-1",
    },
    correlation,
    warnings: [],
    provenance: [
      {
        providerId: "provider-a",
        sourceAssetIds: ["asset-1"],
        renderSpecificationKey: "render-spec-key",
        correlationId: "correlation-1",
        timestamp: "2026-07-25T00:00:00.000Z",
      },
    ],
    usedCache: false,
    ...overrides,
  };
}

async function claimedPersistence() {
  const memory = atomicMemoryStore();
  const persistence = new RenderPersistence(memory.store, correlation);
  const attempt = identity();
  const claim = await persistence.claimAttempt(attempt);
  return { memory, persistence, attempt, claim };
}

describe("PR-3A.4B-3 Render idempotency", () => {
  it("builds deterministic keys from stable canonical inputs", () => {
    const first = request();
    const retry = request({
      sourceAssets: [
        {
          assetId: "asset-1",
          uri: "different-temporary-path.mp4",
          mediaType: "video",
        },
        ],
        retry: { attempt: 3, deterministicKey: "request-fingerprint" },
      });
    expect(buildRenderIdempotencyKey(first, "provider-a")).toBe(
      buildRenderIdempotencyKey(retry, "provider-a")
    );
    expect(
      buildRenderIdempotencyKey(
        request({
          retry: { attempt: 1, deterministicKey: "changed-request" },
        }),
        "provider-a"
      )
    ).not.toBe(buildRenderIdempotencyKey(first, "provider-a"));
    expect(buildRenderIdempotencyKey(first, "provider-b")).not.toBe(
      buildRenderIdempotencyKey(first, "provider-a")
    );
  });

  it("normalizes callback identity without provider-private payloads", () => {
    const input = {
      ...identity(),
      providerJobId: "job-1",
      stage: "RENDERING" as const,
      sequence: 4,
    };
    const first = buildRenderCallbackIdentity(input);
    const second = buildRenderCallbackIdentity(input);
    expect(first).toEqual(second);
    expect(first.callbackId).toHaveLength(64);
    expect(first).not.toHaveProperty("rawPayload");
  });

  it("serializes every canonical resume and duplicate decision code", () => {
    const codes: RenderResumeDecisionCode[] = [
      "NOT_FOUND",
      "FOUND_PENDING",
      "FOUND_RENDERING",
      "FOUND_VALID_RESULT",
      "FOUND_CORRUPTED_RESULT",
      "FOUND_STALE_RESULT",
      "FOUND_PROVIDER_MISMATCH",
      "FOUND_FINGERPRINT_MISMATCH",
      "DUPLICATE_PROGRESS",
      "DUPLICATE_COMPLETION",
      "CONFLICTING_COMPLETION",
      "CALLBACK_REGRESSION",
      "RENDER_REQUIRED",
    ];
    expect(JSON.parse(JSON.stringify(codes))).toEqual(codes);
  });

  it("treats repeated progress as a harmless duplicate", async () => {
    const { persistence, attempt, claim } = await claimedPersistence();
    const callback = buildRenderCallbackIdentity({
      ...attempt,
      stage: "ACCEPTED",
      sequence: 1,
    });
    await persistence.acceptCallback(callback, claim.leaseToken);
    const duplicate = await persistence.acceptCallback(
      callback,
      claim.leaseToken
    );
    expect(duplicate.code).toBe("DUPLICATE_PROGRESS");
  });

  it("records late earlier callbacks without regressing state", async () => {
    const { memory, persistence, attempt, claim } =
      await claimedPersistence();
    await persistence.acceptCallback(
      buildRenderCallbackIdentity({
        ...attempt,
        stage: "RENDERING",
        sequence: 2,
      }),
      claim.leaseToken
    );
    const regression = await persistence.acceptCallback(
      buildRenderCallbackIdentity({
        ...attempt,
        stage: "PREPARING",
        sequence: 3,
      }),
      claim.leaseToken
    );
    expect(regression.code).toBe("CALLBACK_REGRESSION");
    expect(
      memory.read().idempotencyRecords[attempt.idempotencyKey]!.acceptedStage
    ).toBe("RENDERING");
  });

  it("accepts one logical completion and keeps its timestamp stable", async () => {
    const { memory, persistence, attempt, claim } =
      await claimedPersistence();
    const first = await persistence.acceptCompletion(
      attempt,
      result(),
      claim.leaseToken
    );
    const timestamp =
      memory.read().idempotencyRecords[attempt.idempotencyKey]!
        .completionTimestamp;
    const restarted = new RenderPersistence(memory.store, correlation);
    const duplicate = await restarted.acceptCompletion(attempt, result());

    expect(first.accepted).toBe(true);
    expect(duplicate).toMatchObject({ accepted: false, duplicate: true });
    expect(
      memory.read().idempotencyRecords[attempt.idempotencyKey]!
        .completionTimestamp
    ).toBe(timestamp);
    expect(Object.keys(memory.read().artifactsById)).toHaveLength(3);
  });

  it("rejects conflicting result fingerprints and output references", async () => {
    const { persistence, attempt, claim } = await claimedPersistence();
    await persistence.acceptCompletion(attempt, result(), claim.leaseToken);

    await expect(
      persistence.acceptCompletion(
        attempt,
        result({
          fingerprint: "different",
          outputReferences: [
            { uri: "other.mp4", mediaType: "video", role: "output" },
          ],
        })
      )
    ).rejects.toMatchObject({
      code: "CONFLICTING_COMPLETION",
    });
  });

  it("rejects completed followed by a conflicting failure callback", async () => {
    const { persistence, attempt, claim } = await claimedPersistence();
    await persistence.acceptCompletion(attempt, result(), claim.leaseToken);

    await expect(
      persistence.acceptCallback(
        buildRenderCallbackIdentity({
          ...attempt,
          stage: "FAILED",
          sequence: 9,
        })
      )
    ).rejects.toMatchObject({ code: "CONFLICTING_COMPLETION" });
  });

  it("allows provider job identity to change without changing the attempt", async () => {
    const { memory, persistence, attempt, claim } =
      await claimedPersistence();
    await persistence.acceptCallback(
      buildRenderCallbackIdentity({
        ...attempt,
        providerJobId: "job-1",
        stage: "ACCEPTED",
      }),
      claim.leaseToken
    );
    await persistence.acceptCallback(
      buildRenderCallbackIdentity({
        ...attempt,
        providerJobId: "job-2",
        stage: "PREPARING",
      }),
      claim.leaseToken
    );
    expect(
      memory.read().idempotencyRecords[attempt.idempotencyKey]!.providerJobIds
    ).toEqual(["job-1", "job-2"]);
  });

  it("releases the persisted lease after retryable provider failure", async () => {
    const { persistence, attempt, claim } = await claimedPersistence();
    await persistence.acceptCallback(
      buildRenderCallbackIdentity({
        ...attempt,
        stage: "FAILED",
      }),
      claim.leaseToken
    );
    const retry = await persistence.claimAttempt(attempt);
    expect(retry.decision.code).toBe("RENDER_REQUIRED");
    expect(retry.leaseToken).toBeTruthy();
    expect(retry.leaseToken).not.toBe(claim.leaseToken);
  });

  it("prevents a second concurrent claim using persisted lease state", async () => {
    const memory = atomicMemoryStore();
    const first = new RenderPersistence(memory.store, correlation);
    const second = new RenderPersistence(memory.store, correlation);
    const attempt = identity();
    const [left, right] = await Promise.all([
      first.claimAttempt(attempt),
      second.claimAttempt(attempt),
    ]);
    expect([left.decision.code, right.decision.code].sort()).toEqual([
      "FOUND_RENDERING",
      "RENDER_REQUIRED",
    ]);
  });

  it("concurrent equivalent completions converge on one stored result", async () => {
    const { memory, persistence, attempt, claim } =
      await claimedPersistence();
    const completions = await Promise.all([
      persistence.acceptCompletion(attempt, result(), claim.leaseToken),
      persistence.acceptCompletion(attempt, result(), claim.leaseToken),
    ]);
    expect(completions.filter((item) => item.accepted)).toHaveLength(1);
    expect(completions.filter((item) => item.duplicate)).toHaveLength(1);
    expect(Object.keys(memory.read().resultsByRequestFingerprint)).toHaveLength(
      1
    );
    expect(Object.keys(memory.read().artifactsById)).toHaveLength(3);
  });

  it("concurrent conflicting completions accept only one", async () => {
    const { memory, persistence, attempt, claim } =
      await claimedPersistence();
    const completions = await Promise.allSettled([
      persistence.acceptCompletion(attempt, result(), claim.leaseToken),
      persistence.acceptCompletion(
        attempt,
        result({
          fingerprint: "conflicting",
          outputReferences: [
            { uri: "conflict.mp4", mediaType: "video", role: "output" },
          ],
        }),
        claim.leaseToken
      ),
    ]);
    expect(completions.filter((item) => item.status === "fulfilled")).toHaveLength(
      1
    );
    expect(completions.filter((item) => item.status === "rejected")).toHaveLength(
      1
    );
    expect(Object.keys(memory.read().resultsByRequestFingerprint)).toHaveLength(
      1
    );
  });

  it("rejects provider and request identity conflicts", async () => {
    const { persistence, attempt } = await claimedPersistence();
    await expect(
      persistence.claimAttempt({ ...attempt, providerId: "provider-b" })
    ).rejects.toBeInstanceOf(RenderPersistenceConflictError);
    await expect(
      persistence.claimAttempt({
        ...attempt,
        requestFingerprint: "different-request",
      })
    ).rejects.toBeInstanceOf(RenderPersistenceConflictError);
  });

  it("returns typed resume decisions for missing, pending, rendering, and valid", async () => {
    const memory = atomicMemoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);
    const attempt = identity();
    expect((await persistence.resolveResumeDecision(attempt)).code).toBe(
      "NOT_FOUND"
    );
    const claim = await persistence.claimAttempt(attempt);
    expect((await persistence.resolveResumeDecision(attempt)).code).toBe(
      "FOUND_PENDING"
    );
    await persistence.acceptCallback(
      buildRenderCallbackIdentity({
        ...attempt,
        stage: "ACCEPTED",
      }),
      claim.leaseToken
    );
    expect((await persistence.resolveResumeDecision(attempt)).code).toBe(
      "FOUND_RENDERING"
    );
    await persistence.acceptCompletion(attempt, result(), claim.leaseToken);
    expect((await persistence.resolveResumeDecision(attempt)).code).toBe(
      "FOUND_VALID_RESULT"
    );
  });

  it("returns FOUND_CORRUPTED_RESULT for incomplete completed persistence", async () => {
    const { memory, persistence, attempt, claim } =
      await claimedPersistence();
    await persistence.acceptCompletion(attempt, result(), claim.leaseToken);
    const corrupted = memory.read();
    delete (
      corrupted.resultsByRequestFingerprint as Record<string, unknown>
    )[attempt.requestFingerprint];
    memory.replace(corrupted);
    expect((await persistence.resolveResumeDecision(attempt)).code).toBe(
      "FOUND_CORRUPTED_RESULT"
    );
  });

  it("uses database-backed transactions and stays inside Render ownership", () => {
    const persistenceSource = readFileSync(
      "apps/worker/src/render-persistence.ts",
      "utf8"
    );
    const orchestratorSource = readFileSync(
      "apps/worker/src/render-orchestrator.ts",
      "utf8"
    );
    expect(persistenceSource).toContain("db.transaction");
    expect(persistenceSource).toContain('.for("update")');
    expect(orchestratorSource).toContain("claimAttempt(identity)");
    expect(orchestratorSource).toContain("acceptCompletion(");
    for (const forbidden of [
      "createReview",
      "runCompliance",
      "MarketingScore",
      "VIDEO_GATES_COMPLETE",
      "VIDEO_COMPLETE",
      "PRODUCT_IMAGE",
    ]) {
      expect(persistenceSource).not.toContain(forbidden);
      expect(orchestratorSource).not.toContain(forbidden);
    }
  });
});
