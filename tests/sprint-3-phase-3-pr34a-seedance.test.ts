/**
 * Sprint 3 PR 3.4A — Seedance Adapter unit/contract tests (mocked HTTP).
 */
import { describe, expect, it } from "vitest";
import { createExecutionEnvelope } from "@ceo-agent/shared";
import {
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_CALLBACKS_SUPPORTED,
  SEEDANCE_NATIVE_IDEMPOTENCY_SUPPORTED,
  SEEDANCE_PROVIDER_ID,
  buildSeedanceCapabilityDeclaration,
  seedanceCapabilityDetails,
} from "../packages/agents/src/ai-story/seedance-capability";
import {
  SeedanceConfigError,
  loadSeedanceAdapterConfig,
  redactSeedanceAdapterConfig,
} from "../packages/agents/src/ai-story/seedance-config";
import {
  mapCanonicalEnvelopeToSeedanceRequest,
} from "../packages/agents/src/ai-story/seedance-request-mapping";
import {
  createSeedanceHttpClient,
  resolveSeedanceModelArkApiRoot,
  SEEDANCE_CREATE_PATH,
  type SeedanceHttpClient,
} from "../packages/agents/src/ai-story/seedance-http-client";
import {
  SeedanceCanonicalAdapter,
  createMemorySeedancePayloadResolver,
} from "../packages/agents/src/ai-story/seedance-canonical-adapter";
import {
  createSeedanceCanonicalAdapterRegistry,
} from "../packages/agents/src/ai-story/seedance-canonical-registry";
import {
  isSeedanceControlledValidationEnabled,
  runSeedanceControlledValidation,
} from "../packages/agents/src/ai-story/seedance-controlled-validation";
import { seedanceErrorPolicy } from "../packages/agents/src/ai-story/seedance-error-classification";
import { SceneProviderWorkerRuntime } from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import {
  buildPr33ValidatedBundle,
  InMemoryWorkerRuntimeRepository,
} from "./helpers/ai-story-pr33-worker";
import { resetAiProviderConfigCache } from "@ceo-agent/shared";

const PAYLOAD_URI = "memory://seedance-pr34a/scene-a";

function seedanceConfig() {
  return {
    providerId: "seedance" as const,
    adapterVersion: "1.0.0" as const,
    enabled: true as const,
    baseUrl: "https://seedance.test",
    apiKey: "test-key",
    defaultModel: "dreamina-seedance-2-0-260128",
    timeoutMs: 60_000,
    maxRetries: 1,
  };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "Animate product on table, preserve identity",
    durationSec: 5,
    aspectRatio: "9:16",
    resolution: "1080p",
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
  const resolver = createMemorySeedancePayloadResolver({ [PAYLOAD_URI]: payload });
  const envelope = await createExecutionEnvelope({
    version: "1",
    envelopeId: "envelope-seedance-pr34a",
    payloadReference: PAYLOAD_URI,
    tenantId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    executionContext: {
      executionId: "execution-seedance-pr34a",
      correlationId: "10000000-0000-5000-8000-000000000601",
      pipelineRunId: "10000000-0000-4000-8000-000000000101",
      idempotencyKey: "seedance-pr34a-idempotency",
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
        executionId: "execution-seedance-pr34a",
        tenantId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        campaignId: "10000000-0000-4000-8000-000000000003",
        pipelineRunId: "10000000-0000-4000-8000-000000000101",
        capabilityId: "animation-video-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: "seedance-pr34a-idempotency",
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
    createdAt: "2026-08-05T12:00:00.000Z",
  });
  return { envelope, resolver };
}

function mockHttp(handlers: {
  create?: (body: unknown) => { status: number; body: unknown };
  get?: (id: string) => { status: number; body: unknown };
}): SeedanceHttpClient {
  return {
    async createGeneration(request) {
      const result = handlers.create?.(request) ?? {
        status: 200,
        body: { id: "gen_1", status: "queued" },
      };
      return { status: result.status, ok: result.status >= 200 && result.status < 300, body: result.body };
    },
    async getGeneration(id) {
      const result = handlers.get?.(id) ?? {
        status: 200,
        body: { status: "running" },
      };
      return { status: result.status, ok: result.status >= 200 && result.status < 300, body: result.body };
    },
  };
}

describe("Sprint 3 PR 3.4A Seedance Adapter", () => {
  it("declares Seedance capability without unsupported claims", () => {
    const declaration = buildSeedanceCapabilityDeclaration({
      defaultModel: "dreamina-seedance-2-0-260128",
    });
    expect(declaration.providerId).toBe(SEEDANCE_PROVIDER_ID);
    expect(declaration.adapterVersion).toBe(SEEDANCE_ADAPTER_VERSION);
    expect(declaration.capabilityId).toBe("animation-video-generation");
    expect(declaration.lookup).toBe(true);
    expect(declaration.callbacks).toBe(false);
    expect(declaration.nativeIdempotency).toBe(false);
    expect(SEEDANCE_NATIVE_IDEMPOTENCY_SUPPORTED).toBe(false);
    expect(declaration.requiredProviderFeatures).toEqual(["LOOKUP"]);
    expect(declaration.requiredProviderFeatures).not.toContain("NATIVE_IDEMPOTENCY");
    expect(SEEDANCE_CALLBACKS_SUPPORTED).toBe(false);
    const details = seedanceCapabilityDetails();
    expect(details.nativeIdempotency).toBe(false);
    expect(details.audioSupport).toBe(false);
    expect(details.firstLastFrameSupport).toBe(false);
    expect(details.callbacks).toBe(false);
  });

  it("validates Seedance config from typed AI provider env", () => {
    resetAiProviderConfigCache();
    expect(() =>
      loadSeedanceAdapterConfig({
        AI_PROVIDER_SEEDANCE_ENABLED: "true",
        AI_PROVIDER_SEEDANCE_BASE_URL: "https://ark.example.com",
        AI_PROVIDER_SEEDANCE_API_KEY: "secret",
        AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: "dreamina-seedance-2-0-260128",
      })
    ).not.toThrow();
    expect(() =>
      loadSeedanceAdapterConfig({
        AI_PROVIDER_SEEDANCE_ENABLED: "true",
        AI_PROVIDER_SEEDANCE_BASE_URL: "https://ark.example.com",
      })
    ).toThrow(SeedanceConfigError);
    const cfg = loadSeedanceAdapterConfig({
      AI_PROVIDER_SEEDANCE_ENABLED: "true",
      AI_PROVIDER_SEEDANCE_BASE_URL: "https://ark.example.com",
      AI_PROVIDER_SEEDANCE_API_KEY: "secret",
      AI_PROVIDER_SEEDANCE_DEFAULT_MODEL: "dreamina-seedance-2-0-260128",
    });
    expect(redactSeedanceAdapterConfig(cfg).apiKey).toBe("[REDACTED]");
  });

  it("maps canonical payload to ModelArk create body and rejects private storage paths", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const mapped = await mapCanonicalEnvelopeToSeedanceRequest({
      envelope,
      idempotencyKey: "idem-1",
      model: "dreamina-seedance-2-0-260128",
      payloadResolver: resolver,
    });
    expect(mapped.duration).toBe(5);
    expect(mapped.ratio).toBe("9:16");
    expect(mapped.resolution).toBe("1080p");
    expect(mapped.generate_audio).toBe(false);
    expect(mapped.watermark).toBe(false);
    expect(mapped.content[0]).toMatchObject({ type: "text" });
    expect(mapped.content[1]).toMatchObject({
      type: "image_url",
      image_url: { url: expect.stringMatching(/^https:/) },
      role: "reference_image",
    });
    expect(mapped).not.toHaveProperty("aspect_ratio");
    expect(mapped).not.toHaveProperty("reference_assets");
    expect(mapped).not.toHaveProperty("idempotency_key");
    expect(mapped).not.toHaveProperty("idempotencyKey");
    expect(JSON.stringify(mapped)).not.toMatch(/idempotency/i);

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
      mapCanonicalEnvelopeToSeedanceRequest({
        envelope: bad.envelope,
        idempotencyKey: "idem-2",
        model: "dreamina-seedance-2-0-260128",
        payloadResolver: bad.resolver,
      })
    ).rejects.toMatchObject({ code: "BUSINESS_VALIDATION_FAILED" });
  });

  it("submits accepted async generation and looks up terminal success (ModelArk shape)", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({ status: 200, body: { id: "cgt-20260805-abcd" } }),
        get: () => ({
          status: 200,
          body: {
            id: "cgt-20260805-abcd",
            status: "succeeded",
            content: {
              video_url: "https://cdn.example.com/out.mp4",
            },
            duration: 5,
            usage: { completion_tokens: 1200 },
          },
        }),
      }),
    });
    const submitted = await adapter.submit({
      envelope,
      providerAttemptId: "attempt-1",
      dispatchId: "dispatch-1",
      idempotencyKey: "seedance-pr34a-idempotency",
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });
    expect(submitted.acceptanceClassification).toBe("ACCEPTED");
    expect(submitted.providerRequestId).toBe("cgt-20260805-abcd");

    const lookup = await adapter.lookup({
      providerRequestId: "cgt-20260805-abcd",
      envelope,
      providerAttemptId: "attempt-1",
      dispatchId: "dispatch-1",
    });
    expect(lookup.canonicalProviderState).toBe("SUCCEEDED");
    expect(lookup.terminalMedia?.uriReference).toContain("out.mp4");
  });

  it("HTTP 200 without task id is ACCEPTANCE_UNKNOWN, never ACCEPTED", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
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
    const notAccepted = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({ status: 400, body: { error: "invalid" } }),
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

    const moderation = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => ({ status: 422, body: { error: "moderation" } }),
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

    const unknown = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
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
      expect(seedanceErrorPolicy(errorClass).fallbackAllowed).toBe(false);
    }
  });

  it("resolves Seedance binding through registry and Worker without Finalizer writes", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const http = mockHttp({
      create: () => ({ status: 200, body: { id: "gen_worker", status: "queued" } }),
    });
    const adapters = createSeedanceCanonicalAdapterRegistry({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http,
    });
    const bundle = await buildPr33ValidatedBundle({
      envelope,
      providerExecutionId: envelope.executionContext.executionId,
      outboxJobId: "outbox-pr33-scene-a",
    });
    // Keep dispatch/envelope hashes aligned with replaced envelope.
    const aligned = {
      ...bundle,
      envelope,
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
      },
      providerExecutionId: envelope.executionContext.executionId,
    };
    const repository = new InMemoryWorkerRuntimeRepository(aligned);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const outcome = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
    });
    expect(outcome.result.providerId).toBe("seedance");
    expect(outcome.result.adapterVersion).toBe("1.0.0");
    expect(outcome.finalizerInvoked).toBe(false);
    expect(outcome.usageWritten).toBe(false);
    expect(outcome.costWritten).toBe(false);
    expect(outcome.sceneResultWritten).toBe(false);
    expect(outcome.automaticFallbackEnabled).toBe(false);
  });

  it("does not support callbacks and keeps controlled validation opt-in", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({}),
    });
    await expect(
      adapter.normalizeCallback({
        providerId: "seedance",
        rawEventReference: "memory://event",
        receivedAt: "2026-08-05T12:00:00.000Z",
      })
    ).rejects.toThrow(/not supported/i);

    expect(isSeedanceControlledValidationEnabled({})).toBe(false);
    const skipped = await runSeedanceControlledValidation({});
    expect(skipped.ran).toBe(false);
    expect(skipped.skippedReason).toMatch(/EMBEROS_SEEDANCE_CONTROLLED_VALIDATION/);
  });

  it("HTTP client never embeds credentials in thrown messages", async () => {
    const client = createSeedanceHttpClient({
      config: seedanceConfig(),
      fetchImpl: async () => {
        throw new Error("boom Authorization: Bearer test-key");
      },
    });
    await expect(client.getGeneration("x")).rejects.toThrow(/transport failed/i);
  });

  it("normalizes lookup rejection, moderation, failure, processing, and timeout", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());

    const failed = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({
          status: 200,
          body: { id: "cgt-fail", status: "failed", error: { message: "internal" } },
        }),
      }),
    });
    await expect(
      failed.lookup({
        providerRequestId: "cgt-fail",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({
      canonicalProviderState: "FAILED",
      failureClassification: { code: "PROVIDER_FAILED" },
    });

    const moderation = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({
          status: 200,
          body: {
            id: "cgt-mod",
            status: "failed",
            error: { message: "sensitive content policy" },
          },
        }),
      }),
    });
    await expect(
      moderation.lookup({
        providerRequestId: "cgt-mod",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({
      canonicalProviderState: "REJECTED",
      failureClassification: { code: "PROVIDER_MODERATION_REJECTED" },
    });

    const processing = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({ status: 200, body: { id: "cgt-run", status: "running" } }),
      }),
    });
    await expect(
      processing.lookup({
        providerRequestId: "cgt-run",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({ canonicalProviderState: "PROCESSING" });

    const queued = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({ status: 200, body: { id: "cgt-q", status: "queued" } }),
      }),
    });
    await expect(
      queued.lookup({
        providerRequestId: "cgt-q",
        envelope,
        providerAttemptId: "a",
        dispatchId: "d",
      })
    ).resolves.toMatchObject({ canonicalProviderState: "PROCESSING" });

    const timeout = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        get: () => ({ status: 504, body: { error: "gateway timeout" } }),
      }),
    });
    const timed = await timeout.lookup({
      providerRequestId: "cgt-to",
      envelope,
      providerAttemptId: "a",
      dispatchId: "d",
    });
    expect(timed.reconciliationRequired).toBe(true);
    expect(timed.canonicalProviderState).toBe("PROCESSING");
  });

  it("resolves ModelArk API root and create path", () => {
    expect(resolveSeedanceModelArkApiRoot("https://ark.ap-southeast.bytepluses.com")).toBe(
      "https://ark.ap-southeast.bytepluses.com/api/v3"
    );
    expect(
      resolveSeedanceModelArkApiRoot("https://ark.ap-southeast.bytepluses.com/api/v3")
    ).toBe("https://ark.ap-southeast.bytepluses.com/api/v3");
    expect(SEEDANCE_CREATE_PATH).toBe("/contents/generations/tasks");
  });

  it("duplicate Worker delivery converges without second Provider submit", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    let createCalls = 0;
    const http = mockHttp({
      create: () => {
        createCalls += 1;
        return { status: 200, body: { id: "gen_dup", status: "queued" } };
      },
    });
    const adapters = createSeedanceCanonicalAdapterRegistry({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http,
    });
    const bundle = await buildPr33ValidatedBundle({
      envelope,
      providerExecutionId: envelope.executionContext.executionId,
      outboxJobId: "outbox-pr33-scene-a",
    });
    const aligned = {
      ...bundle,
      envelope,
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
      },
      providerExecutionId: envelope.executionContext.executionId,
    };
    const repository = new InMemoryWorkerRuntimeRepository(aligned);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const first = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
    });
    const second = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
    });
    expect(first.result.providerRequestId).toBe("gen_dup");
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
        return { status: 200, body: { id: "gen_resume", status: "queued" } };
      },
        get: () => {
          getCalls += 1;
          return {
            status: 200,
            body: {
              id: "gen_resume",
              status: "succeeded",
              content: { video_url: "https://cdn.example.com/resume.mp4" },
            },
          };
        },
    });
    const adapters = createSeedanceCanonicalAdapterRegistry({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http,
    });
    const bundle = await buildPr33ValidatedBundle({
      envelope,
      providerExecutionId: envelope.executionContext.executionId,
      outboxJobId: "outbox-pr33-scene-a",
    });
    const aligned = {
      ...bundle,
      envelope,
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
      },
      providerExecutionId: envelope.executionContext.executionId,
    };
    const repository = new InMemoryWorkerRuntimeRepository(aligned);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const resumed = await worker.processDispatch({
      dispatchId: aligned.dispatch.dispatchId,
      mode: "lookup",
      providerRequestId: "gen_resume",
    });
    expect(createCalls).toBe(0);
    expect(getCalls).toBe(1);
    expect(resumed.result.canonicalProviderState).toBe("SUCCEEDED");
    expect(resumed.result.providerId).toBe("seedance");
    expect(resumed.automaticFallbackEnabled).toBe(false);
  });

  it("adapter version mismatch fails closed before HTTP", async () => {
    const { envelope, resolver } = await envelopeFor(basePayload());
    let createCalls = 0;
    const adapters = createSeedanceCanonicalAdapterRegistry({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        create: () => {
          createCalls += 1;
          return { status: 200, body: { id: "x", status: "queued" } };
        },
      }),
    });
    const bundle = await buildPr33ValidatedBundle({
      envelope,
      providerExecutionId: envelope.executionContext.executionId,
      outboxJobId: "outbox-pr33-scene-a",
      routingDecision: {
        ...(await buildPr33ValidatedBundle()).routingDecision,
        selectedAdapterVersion: "9.9.9",
      },
    });
    const aligned = {
      ...bundle,
      envelope,
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
        routingDecisionId: bundle.routingDecision.routingDecisionId,
      },
      providerExecutionId: envelope.executionContext.executionId,
    };
    const repository = new InMemoryWorkerRuntimeRepository(aligned);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    await expect(
      worker.processDispatch({ dispatchId: aligned.dispatch.dispatchId })
    ).rejects.toMatchObject({ code: "ADAPTER_NOT_REGISTERED" });
    expect(createCalls).toBe(0);
  });
});
