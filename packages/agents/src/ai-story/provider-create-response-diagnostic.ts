/**
 * ModelArk create-response diagnostic evidence extraction.
 *
 * Ordering contract: Provider-native detail is extracted here, from the raw
 * response, and the resulting envelope is persisted and committed before the
 * Worker result lifecycle continues. EmberOS normalization runs against the
 * same raw response afterwards, so no diagnostic field is lost to it.
 *
 * Only the response hash is retained. The raw body never becomes durable.
 */
import {
  AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION,
  AiStoryProviderCreateResponseDiagnosticSchema,
  aiStoryProviderCreateResponseDiagnosticFingerprintInput,
  assertAiStoryProviderDiagnosticIsSecretSafe,
  classifyProviderNativeErrorCategory,
  sanitizeProviderDiagnosticIdentifier,
  sanitizeProviderDiagnosticText,
  type AiStoryProviderCreateResponseDiagnostic,
} from "@ceo-agent/shared";
import { canonicalPersistenceHash } from "@ceo-agent/db";

export const SEEDANCE_CREATE_ENDPOINT_FAMILY =
  "modelark.contents.generations.tasks.create" as const;

/**
 * Durable sink for diagnostic evidence. Append-only: repeated processing of the
 * same Provider response must converge rather than write conflicting rows.
 */
export type AiStoryProviderCreateResponseDiagnosticSink = {
  /**
   * Returns `unknown` so implementations may report convergence details
   * without the adapter depending on them.
   */
  appendProviderCreateResponseDiagnostic(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly diagnostic: AiStoryProviderCreateResponseDiagnostic;
  }): Promise<unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export type ModelArkNativeError = {
  readonly nativeErrorCode?: string;
  readonly nativeErrorType?: string;
  readonly nativeErrorMessage?: string;
};

/**
 * ModelArk reports errors as `{ error: { code, type, message } }` and
 * occasionally flattens them onto the response root. Read both shapes without
 * inventing values that were not sent.
 */
export function extractModelArkNativeError(body: unknown): ModelArkNativeError {
  const record = asRecord(body);
  const errorValue = record.error;

  if (typeof errorValue === "string") {
    const message = sanitizeProviderDiagnosticText(errorValue);
    return message ? { nativeErrorMessage: message } : {};
  }

  const nested = asRecord(errorValue);
  const code =
    sanitizeProviderDiagnosticText(nested.code) ??
    sanitizeProviderDiagnosticText(record.code) ??
    sanitizeProviderDiagnosticText(record.error_code);
  const type =
    sanitizeProviderDiagnosticText(nested.type) ??
    sanitizeProviderDiagnosticText(nested.category) ??
    sanitizeProviderDiagnosticText(record.type);
  const message =
    sanitizeProviderDiagnosticText(nested.message) ??
    sanitizeProviderDiagnosticText(record.message) ??
    sanitizeProviderDiagnosticText(nested.param);

  return {
    ...(code ? { nativeErrorCode: code } : {}),
    ...(type ? { nativeErrorType: type } : {}),
    ...(message ? { nativeErrorMessage: message } : {}),
  };
}

/** Provider trace id, preferring the response header over the body. */
export function extractModelArkTraceId(input: {
  readonly headerTraceId?: string;
  readonly body: unknown;
}): string | undefined {
  const record = asRecord(input.body);
  return (
    sanitizeProviderDiagnosticIdentifier(input.headerTraceId) ??
    sanitizeProviderDiagnosticIdentifier(record.request_id) ??
    sanitizeProviderDiagnosticIdentifier(record.requestId) ??
    sanitizeProviderDiagnosticIdentifier(record.log_id) ??
    sanitizeProviderDiagnosticIdentifier(asRecord(record.error).request_id)
  );
}

export type ProviderCreateResponseDiagnosticBinding = {
  readonly provider: string;
  readonly model: string;
  readonly providerAttemptId: string;
  readonly compiledRequestId: string;
  readonly requestFingerprint: string;
  readonly endpointFamily?: string;
  readonly observedAt: string;
};

export type ProviderCreateResponseDiagnosticClassification = {
  readonly accepted: boolean;
  readonly retryable: boolean;
  readonly reconciliationRequired: boolean;
  readonly normalizationResult: string;
};

/** Build the envelope for a Provider that returned a real HTTP response. */
export function buildProviderCreateResponseDiagnostic(input: {
  readonly binding: ProviderCreateResponseDiagnosticBinding;
  readonly httpStatus: number;
  readonly body: unknown;
  readonly responseHash: string;
  readonly headerTraceId?: string;
  readonly taskId?: string;
  readonly classification: ProviderCreateResponseDiagnosticClassification;
}): AiStoryProviderCreateResponseDiagnostic {
  const native = extractModelArkNativeError(input.body);
  const providerTraceId = extractModelArkTraceId({
    ...(input.headerTraceId ? { headerTraceId: input.headerTraceId } : {}),
    body: input.body,
  });
  const taskId = sanitizeProviderDiagnosticIdentifier(input.taskId);

  const errorCategory = input.classification.accepted
    ? "UNKNOWN"
    : classifyProviderNativeErrorCategory({
        httpStatus: input.httpStatus,
        ...native,
      });

  return finalizeDiagnostic({
    contractVersion: AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION,
    provider: input.binding.provider,
    model: input.binding.model,
    endpointFamily:
      input.binding.endpointFamily ?? SEEDANCE_CREATE_ENDPOINT_FAMILY,
    providerAttemptId: input.binding.providerAttemptId,
    compiledRequestId: input.binding.compiledRequestId,
    requestFingerprint: input.binding.requestFingerprint,
    observedAt: input.binding.observedAt,
    observationKind: "PROVIDER_RESPONSE",
    httpStatus: input.httpStatus,
    ...native,
    ...(providerTraceId ? { providerTraceId } : {}),
    ...(taskId ? { taskId } : {}),
    errorCategory,
    accepted: input.classification.accepted,
    retryable: input.classification.retryable,
    reconciliationRequired: input.classification.reconciliationRequired,
    responseHash: input.responseHash,
    normalizationResult: input.classification.normalizationResult,
  });
}

/**
 * Build the envelope for a request that failed before any HTTP response.
 *
 * Transport uncertainty is a distinct observation kind and never carries an
 * HTTP status, so it can never be read back as a Provider rejection.
 */
export function buildProviderTransportFailureDiagnostic(input: {
  readonly binding: ProviderCreateResponseDiagnosticBinding;
  readonly transportError: unknown;
  readonly classification: Omit<
    ProviderCreateResponseDiagnosticClassification,
    "accepted"
  >;
}): AiStoryProviderCreateResponseDiagnostic {
  const rawMessage =
    input.transportError instanceof Error
      ? input.transportError.message
      : typeof input.transportError === "string"
        ? input.transportError
        : undefined;
  const transportErrorMessage =
    sanitizeProviderDiagnosticText(rawMessage) ?? "transport failure";

  // No response body exists; hash the transport-safe descriptor instead.
  const responseHash = canonicalPersistenceHash({
    kind: "ai-story-provider-create-response-transport-failure",
    providerAttemptId: input.binding.providerAttemptId,
    requestFingerprint: input.binding.requestFingerprint,
    transportErrorMessage,
  });

  return finalizeDiagnostic({
    contractVersion: AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION,
    provider: input.binding.provider,
    model: input.binding.model,
    endpointFamily:
      input.binding.endpointFamily ?? SEEDANCE_CREATE_ENDPOINT_FAMILY,
    providerAttemptId: input.binding.providerAttemptId,
    compiledRequestId: input.binding.compiledRequestId,
    requestFingerprint: input.binding.requestFingerprint,
    observedAt: input.binding.observedAt,
    observationKind: "TRANSPORT_FAILURE",
    errorCategory: "UNKNOWN",
    transportErrorMessage,
    accepted: false,
    retryable: input.classification.retryable,
    reconciliationRequired: input.classification.reconciliationRequired,
    responseHash,
    normalizationResult: input.classification.normalizationResult,
  });
}

function finalizeDiagnostic(
  draft: Omit<AiStoryProviderCreateResponseDiagnostic, "diagnosticFingerprint">
): AiStoryProviderCreateResponseDiagnostic {
  const diagnosticFingerprint = canonicalPersistenceHash(
    aiStoryProviderCreateResponseDiagnosticFingerprintInput(draft)
  );
  const diagnostic = AiStoryProviderCreateResponseDiagnosticSchema.parse({
    ...draft,
    diagnosticFingerprint,
  }) as AiStoryProviderCreateResponseDiagnostic;
  assertAiStoryProviderDiagnosticIsSecretSafe(diagnostic);
  return Object.freeze(diagnostic);
}
