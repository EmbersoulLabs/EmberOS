/**
 * Sprint 3 PR 3.4B — Canonical MiniMax Adapter.
 * Translates immutable Envelope requests into MiniMax Video V2 HTTP and normalizes results.
 * No Finalizer, no Usage/Cost ledger writes, no alternate Provider Adapter, no fallback, no public unlock.
 *
 * Raw MiniMax request/response payloads:
 * - must not enter Scene Result / Final Story contracts
 * - must not be logged or returned as canonical results
 * - must not contain credentials when retained
 * - may be retained only via approved restricted operational storage if required
 * Prefer not storing raw payloads unless needed for reconciliation/support.
 */
import type {
  CanonicalProviderState,
  ProviderCallbackNormalizationInput,
  ProviderCallbackReceipt,
  WorkerFailureClassification,
} from "@ceo-agent/shared";
import { WORKER_RUNTIME_CONTRACT_VERSION, configuredEstimateForProvider } from "@ceo-agent/shared";
import { canonicalPersistenceHash } from "@ceo-agent/db";
import type { ProviderCapabilityDeclaration } from "../provider-adapters/contracts";
import {
  failureFromCode,
  type CanonicalAdapterErrorInput,
  type CanonicalAdapterLookupInput,
  type CanonicalAdapterLookupResult,
  type CanonicalAdapterSubmitInput,
  type CanonicalAdapterSubmitResult,
  type CanonicalProviderAdapter,
} from "./canonical-provider-adapter";
import {
  MINIMAX_ADAPTER_VERSION,
  MINIMAX_CALLBACKS_SUPPORTED,
  MINIMAX_PROVIDER_ID,
  buildMinimaxCapabilityDeclaration,
  minimaxCapabilityDetails,
} from "./minimax-capability";
import {
  loadMinimaxAdapterConfig,
  type MinimaxAdapterConfig,
} from "./minimax-config";
import {
  assertMinimaxFallbackDisabled,
  classifyMinimaxError,
} from "./minimax-error-classification";
import {
  createMinimaxHttpClient,
  type MinimaxHttpClient,
  type MinimaxFetch,
} from "./minimax-http-client";
import {
  mapCanonicalEnvelopeToMinimaxRequest,
  type MinimaxAssetAccessResolver,
  type MinimaxPayloadResolver,
} from "./minimax-request-mapping";

export type MinimaxCanonicalAdapterOptions = {
  readonly config?: MinimaxAdapterConfig;
  readonly http?: MinimaxHttpClient;
  readonly fetchImpl?: MinimaxFetch;
  readonly payloadResolver: MinimaxPayloadResolver;
  readonly assetAccessResolver?: MinimaxAssetAccessResolver;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * MiniMax create returns `task_id` at the top level.
 * Lookup wraps the task under `task.id`.
 * HTTP 200 alone is never ACCEPTED without a valid task id.
 */
export function extractMinimaxProviderRequestId(body: unknown): string | undefined {
  const record = asRecord(body);
  const task = asRecord(record.task);
  return (
    readString(record.task_id) ??
    readString(record.id) ??
    readString(task.id) ??
    readString(task.task_id) ??
    readString(asRecord(record.data).task_id) ??
    readString(asRecord(record.data).id)
  );
}

function readMinimaxErrorText(record: Record<string, unknown>): string {
  const error = record.error;
  if (typeof error === "string") return error;
  const nested = asRecord(error);
  const oai = asRecord(record);
  const oaiError = asRecord(oai.error);
  return (
    readString(nested.message) ??
    readString(nested.code) ??
    readString(oaiError.message) ??
    readString(record.message) ??
    ""
  );
}

function unwrapLookupTask(body: unknown): Record<string, unknown> {
  const record = asRecord(body);
  const task = asRecord(record.task);
  return Object.keys(task).length > 0 ? task : record;
}

function normalizeCreateStatus(body: unknown, httpStatus: number): {
  readonly acceptanceClassification: CanonicalAdapterSubmitResult["acceptanceClassification"];
  readonly canonicalProviderState: CanonicalProviderState;
  readonly providerRequestId?: string;
  readonly reconciliationRequired: boolean;
  readonly failureClassification?: WorkerFailureClassification;
} {
  const record = asRecord(body);
  const providerRequestId = extractMinimaxProviderRequestId(body);
  const errorText = readMinimaxErrorText(record);

  if (httpStatus === 400 || httpStatus === 401 || httpStatus === 403 || httpStatus === 422) {
    const moderation =
      httpStatus === 422 ||
      /moderation|safety|sensitive|content.?policy|\(1026\)|\(1027\)/i.test(errorText);
    return {
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        moderation ? "PROVIDER_MODERATION_REJECTED" : "PROVIDER_NOT_ACCEPTED",
        moderation
          ? "Provider moderation rejected the submission"
          : "Provider rejected the submission"
      ),
    };
  }

  if (httpStatus >= 500 || httpStatus === 429) {
    return {
      acceptanceClassification: "NOT_SUBMITTED",
      canonicalProviderState: "NOT_SUBMITTED",
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_TIMEOUT",
        "Temporary provider infrastructure error",
        { retryable: true, terminal: false }
      ),
    };
  }

  if (!providerRequestId) {
    // HTTP 200 without task id must never be treated as ACCEPTED.
    if (httpStatus >= 200 && httpStatus < 300) {
      return {
        acceptanceClassification: "ACCEPTANCE_UNKNOWN",
        canonicalProviderState: "ACCEPTANCE_UNKNOWN",
        reconciliationRequired: true,
        failureClassification: failureFromCode(
          "PROVIDER_ACCEPTANCE_UNKNOWN",
          "Provider acceptance is unknown; reconciliation required",
          { terminal: false, reconciliationRequired: true }
        ),
      };
    }
    return {
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_NOT_ACCEPTED",
        "Provider rejected the submission"
      ),
    };
  }

  // Create acceptance freezes when a valid task_id is present.
  return {
    acceptanceClassification: "ACCEPTED",
    canonicalProviderState: "ACCEPTED",
    providerRequestId,
    reconciliationRequired: false,
  };
}

function normalizeLookupBody(
  providerRequestId: string,
  body: unknown,
  httpStatus: number
): CanonicalAdapterLookupResult {
  if (httpStatus === 404) {
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "FAILED",
      providerRequestId,
      reconciliationRequired: true,
      failureClassification: failureFromCode(
        "PROVIDER_ACCEPTANCE_UNKNOWN",
        "Accepted request was not found during lookup",
        { terminal: false, reconciliationRequired: true }
      ),
    };
  }
  if (httpStatus >= 500 || httpStatus === 429) {
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "PROCESSING",
      providerRequestId,
      reconciliationRequired: true,
      failureClassification: failureFromCode(
        "PROVIDER_TIMEOUT",
        "Temporary lookup infrastructure error",
        { retryable: true, terminal: false, reconciliationRequired: true }
      ),
    };
  }

  const task = unwrapLookupTask(body);
  const status = (readString(task.status) ?? "").toLowerCase();
  const content = asRecord(task.content);
  const errorText = readMinimaxErrorText(task);
  const videoUrl =
    readString(content.url) ??
    readString(content.video_url) ??
    readString(task.video_url) ??
    readString(task.output_url);
  const contentHash = readString(task.content_hash) ?? readString(task.hash);
  const durationSec =
    typeof task.duration === "number" ? task.duration : undefined;
  const durationMs =
    typeof task.duration_ms === "number"
      ? task.duration_ms
      : durationSec !== undefined
        ? Math.round(durationSec * 1000)
        : undefined;
  const width = typeof task.width === "number" ? task.width : undefined;
  const height = typeof task.height === "number" ? task.height : undefined;
  const usage = asRecord(task.usage);
  const totalSeconds =
    typeof usage.total_seconds === "number" ? usage.total_seconds : undefined;
  const completionTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : undefined;

  if (
    /moderation|safety|content_policy|sensitive/i.test(status) ||
    /moderation|safety|sensitive|content.?policy|\(1026\)|\(1027\)/i.test(errorText) ||
    httpStatus === 422
  ) {
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "REJECTED",
      providerRequestId,
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_MODERATION_REJECTED",
        "Provider moderation rejected the request"
      ),
    };
  }
  if (
    status === "failed" ||
    status === "cancelled" ||
    /reject|failed|error|cancelled/.test(status)
  ) {
    const moderation =
      /moderation|safety|sensitive|content.?policy|\(1026\)|\(1027\)/i.test(errorText);
    if (moderation) {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "REJECTED",
        providerRequestId,
        reconciliationRequired: false,
        failureClassification: failureFromCode(
          "PROVIDER_MODERATION_REJECTED",
          "Provider moderation rejected the request"
        ),
      };
    }
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "FAILED",
      providerRequestId,
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_FAILED",
        "Provider failed the accepted request"
      ),
    };
  }
  if (status === "succeeded" || status === "completed" || status === "done" || status === "success") {
    if (!videoUrl) {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "FAILED",
        providerRequestId,
        reconciliationRequired: false,
        failureClassification: failureFromCode(
          "PROVIDER_FAILED",
          "Provider reported success without media reference"
        ),
      };
    }
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "SUCCEEDED",
      providerRequestId,
      normalizedResultReference: videoUrl,
      terminalMedia: {
        mediaType: "video/mp4",
        uriReference: videoUrl,
        ...(contentHash ? { contentHash } : {}),
        ...(durationMs ? { durationMs } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      },
      normalizedUsageFacts:
        durationMs !== undefined
          ? {
              durationMs,
              units: completionTokens ?? totalSeconds ?? 1,
              unitKind: completionTokens !== undefined ? "tokens" : "video",
            }
          : {
              units: completionTokens ?? totalSeconds ?? 1,
              unitKind: completionTokens !== undefined ? "tokens" : "video",
            },
      normalizedCostMetadata: {
        ...configuredEstimateForProvider("minimax")!,
        modelKey: readString(task.model) ?? "minimax",
      },
      reconciliationRequired: false,
      operationalMetadata: {
        model: readString(task.model) ?? "minimax",
        providerStatus: status || "succeeded",
      },
    };
  }

  // queued | running | unknown non-terminal
  return {
    acceptanceClassification: "ACCEPTED",
    canonicalProviderState: "PROCESSING",
    providerRequestId,
    reconciliationRequired: false,
    operationalMetadata: {
      providerStatus: status || "processing",
    },
  };
}

export class MinimaxCanonicalAdapter implements CanonicalProviderAdapter {
  readonly providerId = MINIMAX_PROVIDER_ID;
  readonly adapterVersion = MINIMAX_ADAPTER_VERSION;

  private readonly config: MinimaxAdapterConfig;
  private readonly http: MinimaxHttpClient;
  private readonly payloadResolver: MinimaxPayloadResolver;
  private readonly assetAccessResolver?: MinimaxAssetAccessResolver;

  constructor(options: MinimaxCanonicalAdapterOptions) {
    this.config = options.config ?? loadMinimaxAdapterConfig();
    this.http =
      options.http ??
      createMinimaxHttpClient({
        config: this.config,
        fetchImpl: options.fetchImpl,
      });
    this.payloadResolver = options.payloadResolver;
    this.assetAccessResolver = options.assetAccessResolver;
  }

  describeCapabilities(): ReadonlyArray<ProviderCapabilityDeclaration> {
    return [
      buildMinimaxCapabilityDeclaration({
        defaultModel: this.config.defaultModel,
      }),
    ];
  }

  capabilityDetails() {
    return minimaxCapabilityDetails({ defaultModel: this.config.defaultModel });
  }

  async submit(input: CanonicalAdapterSubmitInput): Promise<CanonicalAdapterSubmitResult> {
    try {
      const mapped = await mapCanonicalEnvelopeToMinimaxRequest({
        envelope: input.envelope,
        idempotencyKey: input.idempotencyKey,
        model: this.config.defaultModel,
        payloadResolver: this.payloadResolver,
        assetAccessResolver: this.assetAccessResolver,
      });
      const response = await this.http.createGeneration(mapped);
      const normalized = normalizeCreateStatus(response.body, response.status);
      return {
        acceptanceClassification: normalized.acceptanceClassification,
        canonicalProviderState: normalized.canonicalProviderState,
        ...(normalized.providerRequestId
          ? { providerRequestId: normalized.providerRequestId }
          : {}),
        reconciliationRequired: normalized.reconciliationRequired,
        ...(normalized.failureClassification
          ? { failureClassification: normalized.failureClassification }
          : {}),
        operationalMetadata: {
          adapterVersion: this.adapterVersion,
          model: this.config.defaultModel,
          httpStatus: response.status,
        },
      };
    } catch (error) {
      return this.toSubmitFailure(error);
    }
  }

  async lookup(input: CanonicalAdapterLookupInput): Promise<CanonicalAdapterLookupResult> {
    try {
      if (!input.providerRequestId.trim()) {
        return {
          acceptanceClassification: "ACCEPTANCE_UNKNOWN",
          canonicalProviderState: "ACCEPTANCE_UNKNOWN",
          providerRequestId: input.providerRequestId,
          reconciliationRequired: true,
          failureClassification: failureFromCode(
            "PROVIDER_ACCEPTANCE_UNKNOWN",
            "Lookup requires a persisted providerRequestId",
            { terminal: false, reconciliationRequired: true }
          ),
        };
      }
      const response = await this.http.getGeneration(input.providerRequestId);
      return normalizeLookupBody(input.providerRequestId, response.body, response.status);
    } catch (error) {
      const classified = this.classifyError({ error, phase: "lookup" });
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: classified.reconciliationRequired
          ? "ACCEPTANCE_UNKNOWN"
          : "FAILED",
        providerRequestId: input.providerRequestId,
        reconciliationRequired: classified.reconciliationRequired,
        failureClassification: classified,
      };
    }
  }

  async normalizeCallback(
    _input: ProviderCallbackNormalizationInput
  ): Promise<ProviderCallbackReceipt> {
    if (!MINIMAX_CALLBACKS_SUPPORTED) {
      throw Object.assign(new Error("MiniMax callbacks are not supported"), {
        code: "MINIMAX_CALLBACKS_UNSUPPORTED",
      });
    }
    // Unreachable while callbacks remain unsupported.
    throw new Error("MiniMax callbacks are not supported");
  }

  classifyError(input: CanonicalAdapterErrorInput): WorkerFailureClassification {
    const { policy, failure } = classifyMinimaxError(input.error, input.phase);
    assertMinimaxFallbackDisabled(policy);
    return failure;
  }

  private toSubmitFailure(error: unknown): CanonicalAdapterSubmitResult {
    const classified = this.classifyError({ error, phase: "submit" });
    if (classified.reconciliationRequired) {
      return {
        acceptanceClassification: "ACCEPTANCE_UNKNOWN",
        canonicalProviderState: "ACCEPTANCE_UNKNOWN",
        reconciliationRequired: true,
        failureClassification: classified,
      };
    }
    if (classified.retryable) {
      return {
        acceptanceClassification: "NOT_SUBMITTED",
        canonicalProviderState: "NOT_SUBMITTED",
        reconciliationRequired: false,
        failureClassification: classified,
      };
    }
    return {
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      reconciliationRequired: false,
      failureClassification: classified,
    };
  }
}

/** Deterministic memory payload resolver for tests / harnesses. */
export function createMemoryMinimaxPayloadResolver(
  payloads: ReadonlyMap<string, unknown> | Record<string, unknown>
): MinimaxPayloadResolver {
  const map =
    payloads instanceof Map ? payloads : new Map(Object.entries(payloads));
  return {
    async resolve(reference) {
      const value = map.get(reference.uri) ?? map.get(reference.contentHash);
      if (value === undefined) {
        throw new Error(`MiniMax payload not found for ${reference.uri}`);
      }
      return value;
    },
  };
}

export function minimaxResultIntegrityToken(input: {
  readonly providerRequestId: string;
  readonly dispatchId: string;
}): string {
  return canonicalPersistenceHash({
    kind: "minimax-canonical-result-token",
    providerRequestId: input.providerRequestId,
    dispatchId: input.dispatchId,
    contractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
  });
}
