/**
 * Sprint 3 PR 3.4B — MiniMax Adapter unit/contract tests (mocked HTTP).
 */
import { describe, expect, it } from "vitest";
import { createExecutionEnvelope } from "@ceo-agent/shared";
import {
  MINIMAX_ADAPTER_VERSION,
  MINIMAX_CALLBACKS_SUPPORTED,
  MINIMAX_NATIVE_IDEMPOTENCY_SUPPORTED,
  MINIMAX_PROVIDER_ID,
  buildMinimaxCapabilityDeclaration,
  minimaxCapabilityDetails,
} from "../packages/agents/src/ai-story/minimax-capability";
import {
  MinimaxConfigError,
  loadMinimaxAdapterConfig,
  redactMinimaxAdapterConfig,
} from "../packages/agents/src/ai-story/minimax-config";
import {
  mapCanonicalEnvelopeToMinimaxRequest,
  mapToMinimaxResolution,
} from "../packages/agents/src/ai-story/minimax-request-mapping";
import {
  createMinimaxHttpClient,
  resolveMinimaxVideoV2ApiRoot,
  MINIMAX_CREATE_PATH,
  type MinimaxHttpClient,
} from "../packages/agents/src/ai-story/minimax-http-client";
import {
  MinimaxCanonicalAdapter,
  createMemoryMinimaxPayloadResolver,
} from "../packages/agents/src/ai-story/minimax-canonical-adapter";
import {
  createMinimaxCanonicalAdapterRegistry,
} from "../packages/agents/src/ai-story/minimax-canonical-registry";
import {
  isMinimaxControlledValidationEnabled,
  runMinimaxControlledValidation,
} from "../packages/agents/src/ai-story/minimax-controlled-validation";
import { minimaxErrorPolicy } from "../packages/agents/src/ai-story/minimax-error-classification";
import { SceneProviderWorkerRuntime } from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import {
  buildPr33ValidatedBundle,
  InMemoryWorkerRuntimeRepository,
  pr33RoutingDecision,
} from "./helpers/ai-story-pr33-worker";
import { resetAiProviderConfigCache } from "@ceo-agent/shared";

const PAYLOAD_URI = "memory://minimax-pr34b/scene-a";

function minimaxConfig() {
  return {
    providerId: "minimax" as const,
    adapterVersion: "1.0.0" as const,
    enabled: true as const,
    baseUrl: "https://api.minimax.test",
    apiKey: "test-key",
    defaultModel: "MiniMax-H3",
    timeoutMs: 60_000,
    maxRetries: 1,
  };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "Animate product on table, preserve identity",
    durationSec: 5,
    aspectRatio: "9:16",
    resolution: "768P",
    identityConstraints: ["preserve product silhouette"],
    assetReferences: [
      {
        assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        uri: "https://cdn.example.com/signed/product.png",
        role: "product",
        mediaType: "image/png",
      },
    ],
    shotMap: [{ shotId: "shot-1", sceneId: "scene-1", order: 0 }],
    ...overrides,
  };
}

async function envelopeFor(payload: unknown) {
  const resolver = createMemoryMinimaxPayloadResolver({ [PAYLOAD_URI]: payload });
  const envelope = await createExecutionEnvelope({
    version: "1",
    envelopeId: "envelope-minimax-pr34b",
    payloadReference: PAYLOAD_URI,
    tenantId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    executionContext: {
      executionId: "execution-minimax-pr34b",
      correlationId: "10000000-0000-5000-8000-000000000701",
      pipelineRunId: "10000000-0000-4000-8000-000000000101",
      idempotencyKey: "minimax-pr34b-idempotency",
      timeoutDeadline: "2026-08-05T12:30:00.000Z",
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
        executionId: "execution-minimax-pr34b",
        tenantId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        campaignId: "10000000-0000-4000-8000-000000000003",
        pipelineRunId: "10000000-0000-4000-8000-000000000101",
        capabilityId: "animation-video-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: "minimax-pr34b-idempotency",
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
        correlationId: "10000000-0000-5000-8000-000000000701",
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
    createdAt: "2026-08-05T12:00:00.000Z",
  });
  return { envelope, resolver };
}

function mockHttp(handlers: {
  create?: (body: unknown) => { status: number; body: unknown };
  get?: (id: string) => { status: number; body: unknown };
}): MinimaxHttpClient {
  return {
    async createGeneration(request) {
      const result = handlers.create?.(request) ?? {
        status: 200,
        body: { task_id: "424010985738629" },
      };
      return { status: result.status, ok: result.status >= 200 && result.status < 300, body: result.body };
    },
    async getGeneration(id) {
      const result = handlers.get?.(id) ?? {
        status: 200,
        body: { task: { id, status: "running" } },
      };
      return { status: result.status, ok: result.status >= 200 && result.status < 300, body: result.body };
    },
  };
}

function minimaxRouting() {
  return pr33RoutingDecision({
    selectedProviderId: "minimax",
    selectedAdapterVersion: "1.0.0",
    candidateSummary: [
      {
        providerId: "minimax",
        adapterVersion: "1.0.0",
        selected: true,
        scoreTotal: 1,
        exclusionCodes: [],
      },
    ],
  });
}

async function alignedMinimaxBundle(
  envelope: Awaited<ReturnType<typeof envelopeFor>>["envelope"],
  overrides: { routingDecision?: ReturnType<typeof minimaxRouting> } = {}
) {
  const routingDecision = overrides.routingDecision ?? minimaxRouting();
  const bundle = await buildPr33ValidatedBundle({
    envelope,
    providerExecutionId: envelope.executionContext.executionId,
    outboxJobId: "outbox-pr33-scene-a",
    routingDecision,
  });
  return {
    ...bundle,
    envelope,
    routingDecision,
    dispatch: {
      ...bundle.dispatch,
      envelopeId: envelope.envelopeId,
      executionId: envelope.executionContext.executionId,
      payloadReference: envelope.payloadReference,
      requestHash: envelope.requestHash,
      envelopeHash: envelope.envelopeHash,
      workerHandoff: {
        ...bundle.dispatch.workerHandoff,
        envelopeId: envelope.envelopeId,
        payloadReference: envelope.payloadReference,
      },
    },
    correlation: {
      ...bundle.correlation,
      envelopeId: envelope.envelopeId,
      providerExecutionId: envelope.executionContext.executionId,
      requestHash: envelope.requestHash,
      envelopeHash: envelope.envelopeHash,
      routingDecisionId: routingDecision.routingDecisionId,
    },
    providerExecutionId: envelope.executionContext.executionId,
  };
}

describe("Sprint 3 PR 3.4B MiniMax Adapter", () => {
  it("declares MiniMax capability without unsupported claims", () => {
    const declaration = buildMinimaxCapabilityDeclaration({
      defaultModel: "MiniMax-H3",
    });
    expect(declaration.providerId).toBe(MINIMAX_PROVIDER_ID);
    expect(declaration.adapterVersion).toBe(MINIMAX_ADAPTER_VERSION);
    expect(declaration.capabilityId).toBe("animation-video-generation");
    expect(declaration.lookup).toBe(true);
    expect(declaration.callbacks).toBe(false);
    expect(declaration.nativeIdempotency).toBe(false);
    expect(MINIMAX_NATIVE_IDEMPOTENCY_SUPPORTED).toBe(false);
    expect(declaration.requiredProviderFeatures).toEqual(["LOOKUP"]);
    expect(declaration.requiredProviderFeatures).not.toContain("NATIVE_IDEMPOTENCY");
    expect(MINIMAX_CALLBACKS_SUPPORTED).toBe(false);
    const details = minimaxCapabilityDetails();
    expect(details.nativeIdempotency).toBe(false);
    expect(details.audioSupport).toBe(false);
    expect(details.firstLastFrameSupport).toBe(true);
    expect(details.callbacks).toBe(false);
  });

  it("validates MiniMax config from typed AI provider env", () => {
    resetAiProviderConfigCache();
    expect(() =>
      loadMinimaxAdapterConfig({
        AI_PROVIDER_MINIMAX_ENABLED: "true",
        AI_PROVIDER_MINIMAX_BASE_URL: "https://api.minimax.example",
        AI_PROVIDER_MINIMAX_API_KEY: "secret",
        AI_PROVIDER_MINIMAX_DEFAULT_MODEL: "MiniMax-H3",
      })
    ).not.toThrow();
    expect(() =>
      loadMinimaxAdapterConfig({
        AI_PROVIDER_MINIMAX_ENABLED: "true",
        AI_PROVIDER_MINIMAX_BASE_URL: "https://api.minimax.example",
      })
    ).toThrow(MinimaxConfigError);
    const cfg = loadMinimaxAdapterConfig({
      AI_PROVIDER_MINIMAX_ENABLED: "true",
      AI_PROVIDER_MINIMAX_BASE_URL: "https://api.minimax.example",
      AI_PROVIDER_MINIMAX_API_KEY: "secret",
      AI_PROVIDER_MINIMAX_DEFAULT_MODEL: "MiniMax-H3",
    });
    expect(redactMinimaxAdapterConfig(cfg).apiKey).toBe("[REDACTED]");
  });

  it("maps canonical payload to MiniMax V2 create body and rejects private storage paths", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const mapped = await mapCanonicalEnvelopeToMinimaxRequest({
      envelope,
      idempotencyKey: "idem-1",
      model: "MiniMax-H3",
      payloadResolver: resolver,
    });
    expect(mapped.duration).toBe(5);
    expect(mapped.ratio).toBe("9:16");
    expect(mapped.resolution).toBe("768P");
    expect(mapped.content[0]).toMatchObject({ type: "text" });
    expect(mapped.content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: expect.stringMatching(/^https:/) },
      role: "reference_image",
    });
    expect(mapped).not.toHaveProperty("callback_url");
    expect(mapped).not.toHaveProperty("idempotency_key");
    expect(mapped).not.toHaveProperty("idempotencyKey");
    expect(JSON.stringify(mapped)).not.toMatch(/idempotency/i);
    expect(mapToMinimaxResolution("1080p")).toBe("2K");
    expect(mapToMinimaxResolution("480p")).toBe("768P");

    const bad = await envelopeFor(
      basePayload({
        assetReferences: [
          {
            assetId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            storagePath: "10000000-0000-4000-8000-000000000002/library/a.png",
            role: "product",
          },
        ],
      })
    );
    await expect(
      mapCanonicalEnvelopeToMinimaxRequest({
        envelope: bad.envelope,
        idempotencyKey: "idem-2",
        model: "MiniMax-H3",
        payloadResolver: bad.resolver,
      })
    ).rejects.toMatchObject({ code: "BUSINESS_VALIDATION_FAILED" });
  });

  it("submits accepted async generation and looks up terminal success (MiniMax V2 shape)", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const adapter = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({ status: 200, body: { task_id: "424010985738629" } }),
        get: () => ({
          status: 200,
          body: {
            task: {
              id: "424010985738629",
              status: "succeeded",
              content: {
                url: "https://cdn.example.com/out.mp4",
              },
              duration: 5,
              usage: { total_seconds: 5 },
            },
          },
        }),
      }),
    });
    const submitted = await adapter.submit({
      envelope,
      providerAttemptId: "attempt-1",
      dispatchId: "dispatch-1",
      idempotencyKey: "minimax-pr34b-idempotency",
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });
    expect(submitted.acceptanceClassification).toBe("ACCEPTED");
    expect(submitted.providerRequestId).toBe("424010985738629");

    const lookup = await adapter.lookup({
      providerRequestId: "424010985738629",
      envelope,
      providerAttemptId: "attempt-1",
      dispatchId: "dispatch-1",
    });
    expect(lookup.canonicalProviderState).toBe("SUCCEEDED");
    expect(lookup.terminalMedia?.uriReference).toContain("out.mp4");
  });

  it("HTTP 200 without task_id is ACCEPTANCE_UNKNOWN, never ACCEPTED", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const adapter = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({ status: 200, body: {} }),
      }),
    });
    const submitted = await adapter.submit({
      envelope,
      providerAttemptId: "a",
      dispatchId: "d",
      idempotencyKey: "k",
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });
    expect(submitted.acceptanceClassification).toBe("ACCEPTANCE_UNKNOWN");
    expect(submitted.reconciliationRequired).toBe(true);
    expect(submitted.providerRequestId).toBeUndefined();
  });

  it("classifies not accepted, moderation, acceptance unknown, and infrastructure errors", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const notAccepted = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({ status: 400, body: { error: { message: "invalid params" } } }),
      }),
    });
    await expect(
      notAccepted.submit({
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
        idempotencyKey: "k",
        timeoutDeadline: envelope.executionContext.timeoutDeadline,
      })
    ).resolves.toMatchObject({ acceptanceClassification: "NOT_ACCEPTED" });

    const moderation = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({
          status: 422,
          body: { error: { message: "sensitive content (1026)" } },
        }),
      }),
    });
    const mod = await moderation.submit({
      envelope,
      providerAttemptId: "a",
      dispatchId: "d",
      idempotencyKey: "k",
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });
    expect(mod.failureClassification?.code).toBe("PROVIDER_MODERATION_REJECTED");

    const unknown = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({ status: 200, body: { status: "queued" } }),
      }),
    });
    await expect(
      unknown.submit({
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
        idempotencyKey: "k",
        timeoutDeadline: envelope.executionContext.timeoutDeadline,
      })
    ).resolves.toMatchObject({ acceptanceClassification: "ACCEPTANCE_UNKNOWN" });

    for (const errorClass of [
      "INFRASTRUCTURE_TRANSIENT",
      "PROVIDER_NOT_ACCEPTED",
      "PROVIDER_ACCEPTANCE_UNKNOWN",
      "PROVIDER_FAILED",
    ] as const) {
      expect(minimaxErrorPolicy(errorClass).fallbackAllowed).toBe(false);
    }
  });

  it("resolves MiniMax binding through registry and Worker without Finalizer writes", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const http = mockHttp({
      create: () => ({ status: 200, body: { task_id: "task_worker" } }),
    });
    const adapters = createMinimaxCanonicalAdapterRegistry({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http,
    });
    const aligned = await alignedMinimaxBundle(envelope);
    const repository = new InMemoryWorkerRuntimeRepository(aligned);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const outcome = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
    });
    expect(outcome.result.providerId).toBe("minimax");
    expect(outcome.result.adapterVersion).toBe("1.0.0");
    expect(outcome.finalizerInvoked).toBe(false);
    expect(outcome.usageWritten).toBe(false);
    expect(outcome.costWritten).toBe(false);
    expect(outcome.sceneResultWritten).toBe(false);
    expect(outcome.automaticFallbackEnabled).toBe(false);
  });

  it("does not support callbacks and keeps controlled validation opt-in", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const adapter = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({}),
    });
    await expect(
      adapter.normalizeCallback({
        providerId: "minimax",
        rawEventReference: "memory://event",
        receivedAt: "2026-08-05T12:00:00.000Z",
      })
    ).rejects.toThrow(/not supported/i);

    expect(isMinimaxControlledValidationEnabled({})).toBe(false);
    const skipped = await runMinimaxControlledValidation({});
    expect(skipped.ran).toBe(false);
    expect(skipped.skippedReason).toMatch(/EMBEROS_MINIMAX_CONTROLLED_VALIDATION/);
  });

  it("HTTP client never embeds credentials in thrown messages", async () => {
    const client = createMinimaxHttpClient({
      config: minimaxConfig(),
      fetchImpl: async () => {
        throw new Error("boom Authorization: Bearer test-key");
      },
    });
    await expect(client.getGeneration("x")).rejects.toThrow(/transport failed/i);
  });

  it("normalizes lookup rejection, moderation, failure, processing, and timeout", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());

    const failed = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({
          status: 200,
          body: {
            task: {
              id: "task-fail",
              status: "failed",
              error: { message: "internal" },
            },
          },
        }),
      }),
    });
    await expect(
      failed.lookup({
        providerRequestId: "task-fail",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({
      canonicalProviderState: "FAILED",
      failureClassification: { code: "PROVIDER_FAILED" },
    });

    const moderation = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({
          status: 200,
          body: {
            task: {
              id: "task-mod",
              status: "failed",
              error: { code: "1026", message: "video description contains sensitive content" },
            },
          },
        }),
      }),
    });
    await expect(
      moderation.lookup({
        providerRequestId: "task-mod",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({
      canonicalProviderState: "REJECTED",
      failureClassification: { code: "PROVIDER_MODERATION_REJECTED" },
    });

    const processing = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({
          status: 200,
          body: { task: { id: "task-run", status: "running" } },
        }),
      }),
    });
    await expect(
      processing.lookup({
        providerRequestId: "task-run",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({ canonicalProviderState: "PROCESSING" });

    const queued = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({
          status: 200,
          body: { task: { id: "task-q", status: "queued" } },
        }),
      }),
    });
    await expect(
      queued.lookup({
        providerRequestId: "task-q",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({ canonicalProviderState: "PROCESSING" });

    const timeout = new MinimaxCanonicalAdapter({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({ status: 504, body: { error: { message: "gateway timeout" } } }),
      }),
    });
    const timed = await timeout.lookup({
      providerRequestId: "task-to",
      envelope,
      providerAttemptId: "a",
      dispatchId: "d",
    });
    expect(timed.reconciliationRequired).toBe(true);
    expect(timed.canonicalProviderState).toBe("PROCESSING");
  });

  it("resolves MiniMax Video V2 API root and create path", () => {
    expect(resolveMinimaxVideoV2ApiRoot("https://api.minimax.io")).toBe(
      "https://api.minimax.io/v2"
    );
    expect(resolveMinimaxVideoV2ApiRoot("https://api.minimax.io/v2")).toBe(
      "https://api.minimax.io/v2"
    );
    expect(MINIMAX_CREATE_PATH).toBe("/video_generation");
  });

  it("duplicate Worker delivery converges without second Provider submit", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    let createCalls = 0;
    const http = mockHttp({
      create: () => {
        createCalls += 1;
        return { status: 200, body: { task_id: "task_dup" } };
      },
    });
    const adapters = createMinimaxCanonicalAdapterRegistry({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http,
    });
    const aligned = await alignedMinimaxBundle(envelope);
    const repository = new InMemoryWorkerRuntimeRepository(aligned);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const first = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
    });
    const second = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
    });
    expect(first.result.providerRequestId).toBe("task_dup");
    expect(second.replayed).toBe(true);
    expect(second.adapterInvoked).toBe(false);
    expect(createCalls).toBe(1);
  });

  it("accepted request resumes via lookup without resubmit or fallback", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    let createCalls = 0;
    let getCalls = 0;
    const http = mockHttp({
      create: () => {
        createCalls += 1;
        return { status: 200, body: { task_id: "task_resume" } };
      },
      get: () => {
        getCalls += 1;
        return {
          status: 200,
          body: {
            task: {
              id: "task_resume",
              status: "succeeded",
              content: { url: "https://cdn.example.com/resume.mp4" },
            },
          },
        };
      },
    });
    const adapters = createMinimaxCanonicalAdapterRegistry({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http,
    });
    const aligned = await alignedMinimaxBundle(envelope);
    const repository = new InMemoryWorkerRuntimeRepository(aligned);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const resumed = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
      mode: "lookup",
      providerRequestId: "task_resume",
    });
    expect(createCalls).toBe(0);
    expect(getCalls).toBe(1);
    expect(resumed.result.canonicalProviderState).toBe("SUCCEEDED");
    expect(resumed.result.providerId).toBe("minimax");
    expect(resumed.automaticFallbackEnabled).toBe(false);
  });

  it("adapter version mismatch fails closed before HTTP", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    let createCalls = 0;
    const adapters = createMinimaxCanonicalAdapterRegistry({
      config: minimaxConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => {
          createCalls += 1;
          return { status: 200, body: { task_id: "x" } };
        },
      }),
    });
    const aligned = await alignedMinimaxBundle(envelope, {
      routingDecision: minimaxRouting(),
    });
    const mismatched = {
      ...aligned,
      routingDecision: pr33RoutingDecision({
        selectedProviderId: "minimax",
        selectedAdapterVersion: "9.9.9",
        candidateSummary: [
          {
            providerId: "minimax",
            adapterVersion: "9.9.9",
            selected: true,
            scoreTotal: 1,
            exclusionCodes: [],
          },
        ],
      }),
    };
    mismatched.correlation = {
      ...mismatched.correlation,
      routingDecisionId: mismatched.routingDecision.routingDecisionId,
    };
    const repository = new InMemoryWorkerRuntimeRepository(mismatched);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    await expect(
      worker.processDispatch({ dispatchId: mismatched.dispatch.dispatchId })
    ).rejects.toMatchObject({ code: "ADAPTER_NOT_REGISTERED" });
    expect(createCalls).toBe(0);
  });
});
