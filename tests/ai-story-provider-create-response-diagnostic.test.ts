/**
 * ai-story-provider-create-response-diagnostic.v1
 *
 * Proves Provider-native create-response evidence survives EmberOS
 * normalization, stays secret-safe, and keeps transport uncertainty distinct
 * from a Provider rejection. No real Provider is ever contacted.
 */
import { describe, expect, it } from "vitest";
import {
  AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION,
  AiStoryProviderCreateResponseDiagnosticSchema,
  AiStoryProviderDiagnosticRedactionError,
  assertAiStoryProviderDiagnosticIsSecretSafe,
  classifyProviderNativeErrorCategory,
  createExecutionEnvelope,
  sanitizeProviderDiagnosticIdentifier,
  sanitizeProviderDiagnosticText,
  type AiStoryProviderCreateResponseDiagnostic,
} from "@ceo-agent/shared";
import {
  SeedanceCanonicalAdapter,
  createMemorySeedancePayloadResolver,
} from "../packages/agents/src/ai-story/seedance-canonical-adapter";
import {
  SeedanceHttpTransportError,
  seedanceResponseBodyHash,
  type SeedanceHttpClient,
} from "../packages/agents/src/ai-story/seedance-http-client";
import {
  extractModelArkNativeError,
  extractModelArkTraceId,
  type AiStoryProviderCreateResponseDiagnosticSink,
} from "../packages/agents/src/ai-story/provider-create-response-diagnostic";

const PAYLOAD_URI = "memory://provider-create-diagnostic/scene-2";
const ATTEMPT_ID = "22222222-2222-5222-9222-222222222222";
const OBSERVED_AT = "2026-09-05T10:00:00.000Z";

function seedanceConfig() {
  return {
    providerId: "seedance" as const,
    adapterVersion: "1.0.0" as const,
    enabled: true as const,
    baseUrl: "https://seedance.test",
    apiKey: "super-secret-api-key",
    defaultModel: "dreamina-seedance-2-0-260128",
    timeoutMs: 60_000,
    maxRetries: 1,
  };
}

function basePayload() {
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
    shotMap: [{ shotId: "shot-1", sceneId: "scene-2", order: 0 }],
  };
}

async function envelopeFor() {
  const resolver = createMemorySeedancePayloadResolver({
    [PAYLOAD_URI]: basePayload(),
  });
  const envelope = await createExecutionEnvelope({
    version: "1",
    envelopeId: "envelope-create-diagnostic-01",
    payloadReference: PAYLOAD_URI,
    tenantId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    executionContext: {
      executionId: "execution-create-diagnostic-01",
      correlationId: "10000000-0000-5000-8000-000000000601",
      pipelineRunId: "10000000-0000-4000-8000-000000000101",
      idempotencyKey: "create-diagnostic-idempotency",
      timeoutDeadline: "2026-09-05T12:30:00.000Z",
      dataHandling: {
        sensitiveData: false,
        externalProcessingAllowed: true,
        providerTrainingAllowed: false,
      },
      trace: {
        executionPlanId: "10000000-0000-4000-8000-000000000101",
        sceneExecutionId: "10000000-0000-4000-8000-000000000201",
      },
    },
    capabilityId: "animation-video-generation",
    capabilityVersion: "1.0.0",
    providerPolicySnapshot: { automaticFallbackEnabled: false },
    canonicalRequest: {
      contractVersion: "1",
      executionIdentity: {
        executionId: "execution-create-diagnostic-01",
        tenantId: "10000000-0000-4000-8000-000000000001",
        workspaceId: "10000000-0000-4000-8000-000000000002",
        campaignId: "10000000-0000-4000-8000-000000000003",
        pipelineRunId: "10000000-0000-4000-8000-000000000101",
        capabilityId: "animation-video-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: "create-diagnostic-idempotency",
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
    createdAt: "2026-09-05T09:00:00.000Z",
  });
  return { envelope, resolver };
}

type SinkRow = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly diagnostic: AiStoryProviderCreateResponseDiagnostic;
};

function memorySink(options: { failOnAppend?: boolean } = {}) {
  const rows: SinkRow[] = [];
  const sink: AiStoryProviderCreateResponseDiagnosticSink = {
    async appendProviderCreateResponseDiagnostic(input) {
      if (options.failOnAppend) {
        throw new Error("durable sink unavailable");
      }
      // Append-only and idempotent on the diagnostic fingerprint.
      const exists = rows.some(
        (row) =>
          row.diagnostic.diagnosticFingerprint ===
          input.diagnostic.diagnosticFingerprint
      );
      if (!exists) {
        rows.push(input as SinkRow);
      }
    },
  };
  return { sink, rows };
}

/** Mock ModelArk transport. Never touches the network. */
function mockHttp(create: {
  status: number;
  body: unknown;
  traceId?: string;
  throwTransport?: SeedanceHttpTransportError;
}): SeedanceHttpClient {
  return {
    async createGeneration() {
      if (create.throwTransport) {
        throw create.throwTransport;
      }
      const text = JSON.stringify(create.body ?? null);
      return {
        status: create.status,
        ok: create.status >= 200 && create.status < 300,
        body: create.body,
        bodyHash: seedanceResponseBodyHash(text),
        ...(create.traceId ? { traceId: create.traceId } : {}),
      };
    },
    async getGeneration() {
      return {
        status: 200,
        ok: true,
        body: { status: "running" },
        bodyHash: seedanceResponseBodyHash('{"status":"running"}'),
      };
    },
  };
}

async function submitWith(create: Parameters<typeof mockHttp>[0], sinkOptions: { failOnAppend?: boolean } = {}) {
  const { envelope, resolver } = await envelopeFor();
  const { sink, rows } = memorySink(sinkOptions);
  const adapter = new SeedanceCanonicalAdapter({
    config: seedanceConfig(),
    payloadResolver: resolver,
    http: mockHttp(create),
    diagnostics: sink,
    now: () => new Date(OBSERVED_AT),
  });
  const result = await adapter.submit({
    envelope,
    providerAttemptId: ATTEMPT_ID,
    dispatchId: "dispatch-create-diagnostic-01",
    idempotencyKey: envelope.executionContext.idempotencyKey,
    timeoutDeadline: envelope.executionContext.timeoutDeadline,
  });
  return { result, rows, envelope, adapter };
}

describe("ai-story-provider-create-response-diagnostic.v1 — redaction", () => {
  it("strips signed URLs entirely rather than storing query parameters", () => {
    const sanitized = sanitizeProviderDiagnosticText(
      "failed to download https://bucket.s3.amazonaws.com/private/frame.png?X-Amz-Signature=deadbeefcafe&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE"
    );
    expect(sanitized).toBeDefined();
    expect(sanitized).not.toContain("X-Amz-Signature");
    expect(sanitized).not.toContain("deadbeefcafe");
    expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(sanitized).not.toContain("bucket.s3.amazonaws.com");
    expect(sanitized).toContain("[redacted-url]");
  });

  it("removes bearer tokens, api keys, cookies and database credentials", () => {
    const cases = [
      "Authorization: Bearer sk-live-abcdef1234567890",
      "api_key=super-secret-api-key rejected",
      "Cookie: session=abc123def456",
      "connect failed for postgres://user:hunter2@db.internal:5432/app",
      "token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payload",
    ];
    for (const raw of cases) {
      const sanitized = sanitizeProviderDiagnosticText(raw) ?? "";
      expect(sanitized).not.toContain("sk-live-abcdef1234567890");
      expect(sanitized).not.toContain("super-secret-api-key");
      expect(sanitized).not.toContain("abc123def456");
      expect(sanitized).not.toContain("hunter2");
      expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    }
  });

  it("keeps opaque provider identifiers but rejects credential-shaped ones", () => {
    expect(sanitizeProviderDiagnosticIdentifier("cgt-20260905-abc123")).toBe(
      "cgt-20260905-abc123"
    );
    expect(
      sanitizeProviderDiagnosticIdentifier("sk-live-abcdef1234567890")
    ).toBeUndefined();
    expect(
      sanitizeProviderDiagnosticIdentifier("https://ark.example.com/task/1")
    ).toBeUndefined();
  });

  it("refuses to persist an envelope carrying URL or credential material", () => {
    const base: AiStoryProviderCreateResponseDiagnostic = {
      contractVersion: AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION,
      provider: "seedance",
      model: "dreamina-seedance-2-0-260128",
      endpointFamily: "modelark.contents.generations.tasks.create",
      providerAttemptId: ATTEMPT_ID,
      compiledRequestId: "envelope-create-diagnostic-01",
      requestFingerprint: "sha256:" + "a".repeat(64),
      observedAt: OBSERVED_AT,
      observationKind: "PROVIDER_RESPONSE",
      httpStatus: 400,
      errorCategory: "REQUEST_SCHEMA",
      accepted: false,
      retryable: false,
      reconciliationRequired: false,
      responseHash: "sha256:" + "b".repeat(64),
      normalizationResult: "NOT_ACCEPTED",
      diagnosticFingerprint: "sha256:" + "c".repeat(64),
    };
    expect(() =>
      assertAiStoryProviderDiagnosticIsSecretSafe({
        ...base,
        nativeErrorMessage: "see https://bucket.s3.amazonaws.com/x?sig=1",
      })
    ).toThrow(AiStoryProviderDiagnosticRedactionError);
    expect(() =>
      assertAiStoryProviderDiagnosticIsSecretSafe({
        ...base,
        nativeErrorMessage: "Authorization: Bearer abc.def.ghi",
      })
    ).toThrow(AiStoryProviderDiagnosticRedactionError);
    expect(() =>
      assertAiStoryProviderDiagnosticIsSecretSafe(base)
    ).not.toThrow();
  });
});

describe("ai-story-provider-create-response-diagnostic.v1 — classification", () => {
  it("classifies from provider evidence and never invents one without it", () => {
    expect(
      classifyProviderNativeErrorCategory({
        httpStatus: 400,
        nativeErrorCode: "InvalidParameter",
        nativeErrorMessage: "missing required field image_url",
      })
    ).toBe("REQUEST_SCHEMA");
    expect(classifyProviderNativeErrorCategory({ httpStatus: 401 })).toBe(
      "AUTHENTICATION"
    );
    expect(classifyProviderNativeErrorCategory({ httpStatus: 403 })).toBe(
      "AUTHORIZATION"
    );
    expect(classifyProviderNativeErrorCategory({ httpStatus: 429 })).toBe(
      "RATE_LIMIT"
    );
    expect(classifyProviderNativeErrorCategory({ httpStatus: 503 })).toBe(
      "PROVIDER_INTERNAL"
    );
    expect(
      classifyProviderNativeErrorCategory({
        httpStatus: 400,
        nativeErrorCode: "InsufficientBalance",
      })
    ).toBe("PROVIDER_QUOTA");
    expect(
      classifyProviderNativeErrorCategory({
        httpStatus: 400,
        nativeErrorType: "ContentPolicyViolation",
      })
    ).toBe("CONTENT_POLICY");

    // No status, no native evidence: UNKNOWN is the only honest answer.
    expect(classifyProviderNativeErrorCategory({})).toBe("UNKNOWN");
    // A bare 400 with nothing else is not schema-diagnosable.
    expect(classifyProviderNativeErrorCategory({ httpStatus: 400 })).toBe(
      "UNKNOWN"
    );
  });

  it("reads ModelArk nested and flattened error shapes", () => {
    expect(
      extractModelArkNativeError({
        error: {
          code: "InvalidParameter",
          type: "BadRequest",
          message: "image_url unreachable",
        },
      })
    ).toEqual({
      nativeErrorCode: "InvalidParameter",
      nativeErrorType: "BadRequest",
      nativeErrorMessage: "image_url unreachable",
    });
    expect(
      extractModelArkNativeError({ code: "QuotaExceeded", message: "no credit" })
    ).toEqual({
      nativeErrorCode: "QuotaExceeded",
      nativeErrorMessage: "no credit",
    });
    // Absent evidence stays absent.
    expect(extractModelArkNativeError({ id: "cgt-1" })).toEqual({});
  });

  it("prefers the response header trace id over the body", () => {
    expect(
      extractModelArkTraceId({
        headerTraceId: "hdr-trace-1",
        body: { request_id: "body-trace-1" },
      })
    ).toBe("hdr-trace-1");
    expect(extractModelArkTraceId({ body: { request_id: "body-trace-1" } })).toBe(
      "body-trace-1"
    );
    expect(extractModelArkTraceId({ body: {} })).toBeUndefined();
  });
});

describe("ai-story-provider-create-response-diagnostic.v1 — contract shape", () => {
  const valid: AiStoryProviderCreateResponseDiagnostic = {
    contractVersion: AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION,
    provider: "seedance",
    model: "dreamina-seedance-2-0-260128",
    endpointFamily: "modelark.contents.generations.tasks.create",
    providerAttemptId: ATTEMPT_ID,
    compiledRequestId: "envelope-create-diagnostic-01",
    requestFingerprint: "sha256:" + "a".repeat(64),
    observedAt: OBSERVED_AT,
    observationKind: "TRANSPORT_FAILURE",
    errorCategory: "UNKNOWN",
    transportErrorMessage: "Seedance transport failed",
    accepted: false,
    retryable: true,
    reconciliationRequired: true,
    responseHash: "sha256:" + "b".repeat(64),
    normalizationResult: "ACCEPTANCE_UNKNOWN",
    diagnosticFingerprint: "sha256:" + "c".repeat(64),
  };

  it("forbids an HTTP status on a transport failure", () => {
    expect(() =>
      AiStoryProviderCreateResponseDiagnosticSchema.parse({
        ...valid,
        httpStatus: 500,
      })
    ).toThrow();
  });

  it("forbids a transport failure from being an acceptance", () => {
    expect(() =>
      AiStoryProviderCreateResponseDiagnosticSchema.parse({
        ...valid,
        accepted: true,
      })
    ).toThrow();
  });

  it("requires an HTTP status on a provider response", () => {
    expect(() =>
      AiStoryProviderCreateResponseDiagnosticSchema.parse({
        ...valid,
        observationKind: "PROVIDER_RESPONSE",
        transportErrorMessage: undefined,
      })
    ).toThrow();
  });
});

describe("ai-story-provider-create-response-diagnostic.v1 — adapter capture", () => {
  it("awaits durable persistence before normalizing the Provider outcome", async () => {
    const stages: string[] = [];
    let signalPersistStarted!: () => void;
    let releasePersistence!: () => void;
    const persistStarted = new Promise<void>((resolve) => {
      signalPersistStarted = resolve;
    });
    const persistenceBarrier = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const { envelope, resolver } = await envelopeFor();
    const http = mockHttp({
      status: 400,
      traceId: "req-order-400",
      body: {
        error: {
          code: "InvalidParameter",
          type: "BadRequest",
          message: "first_frame could not be decoded",
        },
      },
    });
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: {
        ...http,
        async createGeneration(request) {
          stages.push("createGeneration");
          return http.createGeneration(request);
        },
      },
      diagnostics: {
        async appendProviderCreateResponseDiagnostic() {
          signalPersistStarted();
          await persistenceBarrier;
        },
      },
      createResponseOrderObserver: (stage) => stages.push(stage),
      now: () => new Date(OBSERVED_AT),
    });

    const outcomePromise = adapter.submit({
      envelope,
      providerAttemptId: ATTEMPT_ID,
      dispatchId: "dispatch-create-diagnostic-order",
      idempotencyKey: envelope.executionContext.idempotencyKey,
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });

    await persistStarted;
    expect(stages).toEqual([
      "createGeneration",
      "extract",
      "persist:start",
    ]);
    expect(stages).not.toContain("normalize");

    releasePersistence();
    const outcome = await outcomePromise;
    expect(stages).toEqual([
      "createGeneration",
      "extract",
      "persist:start",
      "persist:complete",
      "normalize",
      "outcome",
    ]);
    expect(outcome.acceptanceClassification).toBe("NOT_ACCEPTED");
  });

  it("retains HTTP status, native code/type/message, trace id on a 400 rejection", async () => {
    const { result, rows } = await submitWith({
      status: 400,
      traceId: "req-400-abc",
      body: {
        error: {
          code: "InvalidParameter",
          type: "BadRequest",
          message: "first_frame image_url could not be decoded",
        },
      },
    });

    expect(result.acceptanceClassification).toBe("NOT_ACCEPTED");
    expect(rows).toHaveLength(1);
    const evidence = rows[0]!.diagnostic;
    expect(evidence.contractVersion).toBe(
      AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION
    );
    expect(evidence.observationKind).toBe("PROVIDER_RESPONSE");
    expect(evidence.httpStatus).toBe(400);
    expect(evidence.nativeErrorCode).toBe("InvalidParameter");
    expect(evidence.nativeErrorType).toBe("BadRequest");
    expect(evidence.nativeErrorMessage).toContain("could not be decoded");
    expect(evidence.providerTraceId).toBe("req-400-abc");
    expect(evidence.errorCategory).toBe("MEDIA");
    expect(evidence.accepted).toBe(false);
    expect(evidence.normalizationResult).toBe("NOT_ACCEPTED");
    expect(evidence.responseHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("binds evidence immutably to attempt, compiled request and fingerprint", async () => {
    const { rows, envelope } = await submitWith({
      status: 400,
      body: { error: { code: "InvalidParameter", message: "bad field" } },
    });
    const evidence = rows[0]!.diagnostic;
    expect(evidence.providerAttemptId).toBe(ATTEMPT_ID);
    expect(evidence.compiledRequestId).toBe(envelope.envelopeId);
    expect(evidence.requestFingerprint).toBe(envelope.requestHash);
    expect(rows[0]!.orgId).toBe(envelope.tenantId);
    expect(rows[0]!.workspaceId).toBe(envelope.workspaceId);
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("distinguishes 401 authentication from 403 authorization", async () => {
    const unauthenticated = await submitWith({
      status: 401,
      body: { error: { code: "AuthenticationError", message: "invalid api key" } },
    });
    expect(unauthenticated.rows[0]!.diagnostic.httpStatus).toBe(401);
    expect(unauthenticated.rows[0]!.diagnostic.errorCategory).toBe(
      "AUTHENTICATION"
    );

    const forbidden = await submitWith({
      status: 403,
      body: { error: { code: "AccessDenied", message: "permission denied" } },
    });
    expect(forbidden.rows[0]!.diagnostic.httpStatus).toBe(403);
    expect(forbidden.rows[0]!.diagnostic.errorCategory).toBe("AUTHORIZATION");
  });

  it("retains 429 rate limit evidence and its retryable classification", async () => {
    const { result, rows } = await submitWith({
      status: 429,
      body: { error: { code: "RateLimitExceeded", message: "too many requests" } },
    });
    const evidence = rows[0]!.diagnostic;
    expect(evidence.httpStatus).toBe(429);
    expect(evidence.errorCategory).toBe("RATE_LIMIT");
    expect(evidence.retryable).toBe(true);
    expect(evidence.accepted).toBe(false);
    expect(result.acceptanceClassification).toBe("NOT_SUBMITTED");
    expect(evidence.normalizationResult).toBe("NOT_SUBMITTED");
  });

  it("retains 5xx provider responses as provider evidence, not transport failure", async () => {
    const { rows } = await submitWith({
      status: 503,
      body: { error: { code: "ServiceUnavailable", message: "upstream busy" } },
    });
    const evidence = rows[0]!.diagnostic;
    expect(evidence.observationKind).toBe("PROVIDER_RESPONSE");
    expect(evidence.httpStatus).toBe(503);
    expect(evidence.errorCategory).toBe("PROVIDER_INTERNAL");
    expect(evidence.transportErrorMessage).toBeUndefined();
  });

  it("persists accepted response evidence before its normalized outcome", async () => {
    const stages: string[] = [];
    const { envelope, resolver } = await envelopeFor();
    const { sink, rows } = memorySink();
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        status: 200,
        traceId: "req-200-ok",
        body: { id: "cgt-20260905-scene2", status: "queued" },
      }),
      diagnostics: sink,
      createResponseOrderObserver: (stage) => stages.push(stage),
      now: () => new Date(OBSERVED_AT),
    });
    const result = await adapter.submit({
      envelope,
      providerAttemptId: ATTEMPT_ID,
      dispatchId: "dispatch-create-diagnostic-accepted-order",
      idempotencyKey: envelope.executionContext.idempotencyKey,
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });
    expect(result.acceptanceClassification).toBe("ACCEPTED");
    expect(stages).toEqual([
      "extract",
      "persist:start",
      "persist:complete",
      "normalize",
      "outcome",
    ]);
    const evidence = rows[0]!.diagnostic;
    expect(evidence.httpStatus).toBe(200);
    expect(evidence.taskId).toBe("cgt-20260905-scene2");
    expect(evidence.providerTraceId).toBe("req-200-ok");
    expect(evidence.accepted).toBe(true);
    expect(evidence.errorCategory).toBe("UNKNOWN");
    expect(evidence.normalizationResult).toBe("ACCEPTED");
    // No provider payload beyond the hash.
    expect(JSON.stringify(evidence)).not.toContain("queued");
  });

  it("keeps transport failure distinct and never a provider rejection", async () => {
    const { result, rows } = await submitWith({
      status: 0,
      body: null,
      throwTransport: new SeedanceHttpTransportError(
        "Seedance transport failed: getaddrinfo ENOTFOUND ark.example.com"
      ),
    });

    expect(rows).toHaveLength(1);
    const evidence = rows[0]!.diagnostic;
    expect(evidence.observationKind).toBe("TRANSPORT_FAILURE");
    expect(evidence.httpStatus).toBeUndefined();
    expect(evidence.accepted).toBe(false);
    expect(evidence.errorCategory).toBe("UNKNOWN");
    expect(evidence.normalizationResult).toBe("ACCEPTANCE_UNKNOWN");
    expect(evidence.transportErrorMessage).toContain("transport failed");
    expect(evidence.responseHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Network uncertainty must not be normalized into NOT_ACCEPTED.
    expect(result.acceptanceClassification).not.toBe("NOT_ACCEPTED");
    expect(result.reconciliationRequired).toBe(true);
  });

  it("redacts signed URLs arriving inside provider error messages", async () => {
    const { rows } = await submitWith({
      status: 400,
      body: {
        error: {
          code: "InvalidParameter",
          message:
            "cannot fetch https://bucket.s3.amazonaws.com/private/frame.png?X-Amz-Signature=deadbeefcafe",
        },
      },
    });
    const serialized = JSON.stringify(rows[0]!.diagnostic);
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("deadbeefcafe");
    expect(serialized).not.toContain("bucket.s3.amazonaws.com");
    expect(rows[0]!.diagnostic.nativeErrorMessage).toContain("[redacted-url]");
  });

  it("never persists credentials or authorization headers", async () => {
    const { rows } = await submitWith({
      status: 401,
      body: {
        error: {
          code: "AuthenticationError",
          message:
            "rejected Authorization: Bearer super-secret-api-key for api_key=super-secret-api-key",
        },
      },
    });
    const serialized = JSON.stringify(rows[0]!.diagnostic);
    expect(serialized).not.toContain("super-secret-api-key");
    expect(serialized).not.toContain("Bearer super-secret");
  });

  it("produces a deterministic response hash and diagnostic fingerprint", async () => {
    const create = {
      status: 400,
      traceId: "req-det-1",
      body: { error: { code: "InvalidParameter", message: "bad field" } },
    };
    const first = await submitWith(create);
    const second = await submitWith(create);
    expect(first.rows[0]!.diagnostic.responseHash).toBe(
      second.rows[0]!.diagnostic.responseHash
    );
    expect(first.rows[0]!.diagnostic.diagnosticFingerprint).toBe(
      second.rows[0]!.diagnostic.diagnosticFingerprint
    );

    // A different response body must change the hash.
    const different = await submitWith({
      ...create,
      body: { error: { code: "InvalidParameter", message: "other field" } },
    });
    expect(different.rows[0]!.diagnostic.responseHash).not.toBe(
      first.rows[0]!.diagnostic.responseHash
    );
    expect(different.rows[0]!.diagnostic.diagnosticFingerprint).not.toBe(
      first.rows[0]!.diagnostic.diagnosticFingerprint
    );
  });

  it("converges instead of writing conflicting evidence when reprocessed", async () => {
    const { envelope, resolver } = await envelopeFor();
    const { sink, rows } = memorySink();
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        status: 400,
        body: { error: { code: "InvalidParameter", message: "bad field" } },
      }),
      diagnostics: sink,
      now: () => new Date(OBSERVED_AT),
    });
    const submitInput = {
      envelope,
      providerAttemptId: ATTEMPT_ID,
      dispatchId: "dispatch-create-diagnostic-01",
      idempotencyKey: envelope.executionContext.idempotencyKey,
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    };
    await adapter.submit(submitInput);
    await adapter.submit(submitInput);
    await adapter.submit(submitInput);
    expect(rows).toHaveLength(1);
  });

  it("fails closed without normalization when diagnostic persistence fails", async () => {
    const stages: string[] = [];
    const { envelope, resolver } = await envelopeFor();
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        status: 400,
        body: { error: { code: "InvalidParameter", message: "bad field" } },
      }),
      diagnostics: {
        async appendProviderCreateResponseDiagnostic() {
          throw new Error("durable sink unavailable");
        },
      },
      createResponseOrderObserver: (stage) => stages.push(stage),
      now: () => new Date(OBSERVED_AT),
    });
    const result = await adapter.submit({
      envelope,
      providerAttemptId: ATTEMPT_ID,
      dispatchId: "dispatch-create-diagnostic-persistence-failure",
      idempotencyKey: envelope.executionContext.idempotencyKey,
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });
    expect(result.acceptanceClassification).toBe("ACCEPTANCE_UNKNOWN");
    expect(result.reconciliationRequired).toBe(true);
    expect(stages).toEqual(["extract", "persist:start"]);
    expect(stages).not.toContain("normalize");
    expect(stages).not.toContain("outcome");
  });

  it("remains legacy compatible when no diagnostic sink is configured", async () => {
    const { envelope, resolver } = await envelopeFor();
    const adapter = new SeedanceCanonicalAdapter({
      config: seedanceConfig(),
      payloadResolver: resolver,
      http: mockHttp({
        status: 400,
        body: { error: { code: "InvalidParameter", message: "bad field" } },
      }),
    });
    const result = await adapter.submit({
      envelope,
      providerAttemptId: ATTEMPT_ID,
      dispatchId: "dispatch-create-diagnostic-01",
      idempotencyKey: envelope.executionContext.idempotencyKey,
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });
    // Historical behaviour preserved; evidence is simply NOT PERSISTED.
    expect(result.acceptanceClassification).toBe("NOT_ACCEPTED");
  });
});

describe("ai-story-provider-create-response-diagnostic.v1 — regression", () => {
  it("a rejection carrying native evidence cannot collapse to only the generic message", async () => {
    const { result, rows } = await submitWith({
      status: 400,
      traceId: "req-regression-1",
      body: {
        error: {
          code: "InvalidParameter",
          type: "BadRequest",
          message: "first_frame aspect ratio is unsupported",
        },
      },
    });

    // The normalized surface is still deliberately generic and secret-safe.
    expect(result.failureClassification?.sanitizedMessage).toBe(
      "Provider rejected the submission"
    );

    // But the underlying reason is now recoverable from durable evidence.
    const evidence = rows[0]!.diagnostic;
    expect(evidence.httpStatus).toBe(400);
    expect(evidence.nativeErrorCode).toBe("InvalidParameter");
    expect(evidence.nativeErrorType).toBe("BadRequest");
    expect(evidence.nativeErrorMessage).toContain("aspect ratio is unsupported");
    expect(evidence.providerTraceId).toBe("req-regression-1");
    expect(evidence.errorCategory).not.toBe("UNKNOWN");

    // The evidence must not be reducible to the generic normalized message.
    expect(evidence.nativeErrorMessage).not.toBe(
      result.failureClassification?.sanitizedMessage
    );
  });

  it("classifies as UNKNOWN when the provider genuinely sent no evidence", async () => {
    const { rows } = await submitWith({ status: 400, body: {} });
    const evidence = rows[0]!.diagnostic;
    expect(evidence.httpStatus).toBe(400);
    expect(evidence.nativeErrorCode).toBeUndefined();
    expect(evidence.nativeErrorType).toBeUndefined();
    expect(evidence.nativeErrorMessage).toBeUndefined();
    // No invented classification.
    expect(evidence.errorCategory).toBe("UNKNOWN");
  });
});
