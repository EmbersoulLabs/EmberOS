/**
 * Provider create-response diagnostic evidence contract.
 *
 * Captured from the raw Provider create response BEFORE EmberOS normalization
 * discards diagnostic detail, so a terminal NOT_ACCEPTED outcome stays
 * classifiable after the fact.
 *
 * Secret-safe by construction:
 * - no Authorization headers, API keys, bearer tokens or cookies
 * - no signed URLs, signed query parameters or raw private asset URLs
 * - no raw response bodies; only a canonical hash of the response
 *
 * Append-only. Absent Provider evidence stays absent: this contract never
 * invents a category, code, type or message that the Provider did not send.
 */
import { z } from "zod";

export const AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION =
  "ai-story-provider-create-response-diagnostic.v1" as const;

/**
 * A Provider that returned a valid HTTP response is diagnosable.
 * A request that failed before any HTTP response is not, and must never be
 * collapsed into a Provider rejection.
 */
export const AI_STORY_PROVIDER_DIAGNOSTIC_OBSERVATION_KINDS = [
  "PROVIDER_RESPONSE",
  "TRANSPORT_FAILURE",
] as const;

export type AiStoryProviderDiagnosticObservationKind =
  (typeof AI_STORY_PROVIDER_DIAGNOSTIC_OBSERVATION_KINDS)[number];

/** UNKNOWN is the only honest answer when the Provider sent no usable evidence. */
export const AI_STORY_PROVIDER_NATIVE_ERROR_CATEGORIES = [
  "AUTHENTICATION",
  "AUTHORIZATION",
  "MODEL_OR_ENDPOINT",
  "REQUEST_SCHEMA",
  "MEDIA",
  "CONTENT_POLICY",
  "RATE_LIMIT",
  "PROVIDER_QUOTA",
  "PROVIDER_INTERNAL",
  "UNKNOWN",
] as const;

export type AiStoryProviderNativeErrorCategory =
  (typeof AI_STORY_PROVIDER_NATIVE_ERROR_CATEGORIES)[number];

export const AI_STORY_PROVIDER_DIAGNOSTIC_REDACTION_PLACEHOLDER =
  "[redacted]" as const;

export const AI_STORY_PROVIDER_DIAGNOSTIC_URL_PLACEHOLDER =
  "[redacted-url]" as const;

/** Upper bound on any persisted free-text diagnostic field. */
export const AI_STORY_PROVIDER_DIAGNOSTIC_MESSAGE_MAX_LENGTH = 500;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SanitizedTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(AI_STORY_PROVIDER_DIAGNOSTIC_MESSAGE_MAX_LENGTH);

/**
 * Patterns whose *values* must never reach persistence. Ordered: URL removal
 * runs first so signed query parameters are gone before token heuristics run.
 */
/**
 * Ordered deliberately: scheme-prefixed credentials and key/value pairs are
 * consumed *before* header-name patterns, otherwise a header pattern stops at
 * the scheme word ("Authorization: Bearer") and leaves the token behind.
 */
const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  // Scheme-prefixed credentials, including the token itself.
  /\bbearer\s+[A-Za-z0-9._\-+/=]+/gi,
  /\bbasic\s+[A-Za-z0-9+/=]{8,}/gi,
  // Credential field names followed by a value.
  /\b(api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|signature|x-amz-signature|credential)\b\s*[:=]\s*["']?[A-Za-z0-9._\-+/=%]+["']?/gi,
  // Recognisable standalone key shapes.
  /\bsk-[A-Za-z0-9-]{12,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9._-]{20,}/g,
  // Header names last, sweeping up whatever value remains.
  /\b(authorization|proxy-authorization)\b\s*[:=]\s*\S+/gi,
  /\b(cookie|set-cookie)\b\s*[:=]\s*\S+/gi,
];

/** Any URI-like run of characters, including postgres:// and s3:// forms. */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]},]+/gi;

/** Bare signed query fragments that appear without a scheme. */
const BARE_SIGNED_QUERY_PATTERN =
  /[?&](x-amz-[a-z-]+|signature|sig|token|expires|se|sp|sv|sr|st|skoid|sig64|awsaccesskeyid)=[^\s&"'<>)\]},]*/gi;

/**
 * Reduce Provider-supplied free text to something safe to store durably.
 *
 * Returns undefined when nothing diagnostic survives, so callers persist
 * absence rather than an empty string.
 */
export function sanitizeProviderDiagnosticText(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  let text = value;
  text = text.replace(URL_PATTERN, AI_STORY_PROVIDER_DIAGNOSTIC_URL_PLACEHOLDER);
  text = text.replace(
    BARE_SIGNED_QUERY_PATTERN,
    AI_STORY_PROVIDER_DIAGNOSTIC_REDACTION_PLACEHOLDER
  );
  for (const pattern of CREDENTIAL_PATTERNS) {
    text = text.replace(
      pattern,
      AI_STORY_PROVIDER_DIAGNOSTIC_REDACTION_PLACEHOLDER
    );
  }
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return undefined;
  }
  return collapsed.slice(0, AI_STORY_PROVIDER_DIAGNOSTIC_MESSAGE_MAX_LENGTH);
}

/**
 * Provider-native identifiers (error codes, task ids, trace ids) are expected
 * to be opaque tokens. Keep them only when they look like identifiers, never
 * when they look like a URL or a credential.
 */
export function sanitizeProviderDiagnosticIdentifier(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) {
    return undefined;
  }
  if (!/^[A-Za-z0-9._:\-]+$/.test(trimmed)) {
    return undefined;
  }
  if (/^sk-|^AKIA|^eyJ/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Classify a Provider-native rejection from evidence only.
 *
 * Returns UNKNOWN whenever the Provider gave no usable signal. Callers must not
 * substitute a guess: an unclassifiable rejection is a real, recordable state.
 */
export function classifyProviderNativeErrorCategory(input: {
  readonly httpStatus?: number;
  readonly nativeErrorCode?: string;
  readonly nativeErrorType?: string;
  readonly nativeErrorMessage?: string;
}): AiStoryProviderNativeErrorCategory {
  const haystack = [
    input.nativeErrorCode,
    input.nativeErrorType,
    input.nativeErrorMessage,
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();

  const hasNativeEvidence = haystack.length > 0;
  const status = input.httpStatus;

  if (hasNativeEvidence) {
    if (/moderation|content.?policy|sensitive|safety|prohibited|nsfw/.test(haystack)) {
      return "CONTENT_POLICY";
    }
    if (/quota|insufficient.?balance|billing|credit|arrears/.test(haystack)) {
      return "PROVIDER_QUOTA";
    }
    if (/rate.?limit|too.?many.?requests|throttl|qps|tps/.test(haystack)) {
      return "RATE_LIMIT";
    }
    if (/auth|unauthenticated|invalid.?(api.?)?key|signature|credential|token/.test(haystack)) {
      return "AUTHENTICATION";
    }
    if (/permission|forbidden|not.?allowed|access.?denied|unauthorized/.test(haystack)) {
      return "AUTHORIZATION";
    }
    if (/model|endpoint|not.?found|unsupported.?model|invalid.?model/.test(haystack)) {
      return "MODEL_OR_ENDPOINT";
    }
    // An explicitly absent or malformed field is a schema fault even when the
    // field happens to be named after media (e.g. "missing field image_url").
    if (/missing|required|not.?provided|absent|schema|malformed|serializ/.test(haystack)) {
      return "REQUEST_SCHEMA";
    }
    // Media faults need a media noun *and* a failure verb, so an incidental
    // mention of "image" in a parameter name does not mask the real cause.
    if (
      /(image|video|media|frame|resolution|aspect|ratio|duration|codec)[\s\S]{0,40}(decode|download|fetch|unreachable|unsupported|invalid|corrupt|mismatch|too\s+(large|small|long|short))/.test(
        haystack
      ) ||
      /(decode|download|fetch|unreachable|corrupt)[\s\S]{0,40}(image|video|media|frame|url)/.test(
        haystack
      )
    ) {
      return "MEDIA";
    }
    if (/invalid.?(parameter|argument|request|field)|validation/.test(haystack)) {
      return "REQUEST_SCHEMA";
    }
    if (/internal|server.?error|unavailable|timeout/.test(haystack)) {
      return "PROVIDER_INTERNAL";
    }
  }

  if (typeof status === "number") {
    if (status === 401) return "AUTHENTICATION";
    if (status === 403) return "AUTHORIZATION";
    if (status === 404) return "MODEL_OR_ENDPOINT";
    if (status === 422) return "CONTENT_POLICY";
    if (status === 429) return "RATE_LIMIT";
    if (status === 402) return "PROVIDER_QUOTA";
    if (status >= 500) return "PROVIDER_INTERNAL";
    if (status === 400) {
      // A bare 400 with no native evidence is not schema-diagnosable.
      return hasNativeEvidence ? "REQUEST_SCHEMA" : "UNKNOWN";
    }
  }

  return "UNKNOWN";
}

export const AiStoryProviderCreateResponseDiagnosticSchema = z
  .object({
    contractVersion: z.literal(
      AI_STORY_PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_VERSION
    ),

    // Durable binding.
    provider: NonEmptyTextSchema,
    model: NonEmptyTextSchema,
    endpointFamily: NonEmptyTextSchema,
    providerAttemptId: NonEmptyTextSchema,
    compiledRequestId: NonEmptyTextSchema,
    requestFingerprint: NonEmptyTextSchema,

    observedAt: z.string().datetime(),
    observationKind: z.enum(AI_STORY_PROVIDER_DIAGNOSTIC_OBSERVATION_KINDS),

    // Provider-native evidence. Absent stays absent.
    httpStatus: z.number().int().min(100).max(599).optional(),
    nativeErrorCode: SanitizedTextSchema.optional(),
    nativeErrorType: SanitizedTextSchema.optional(),
    nativeErrorMessage: SanitizedTextSchema.optional(),
    providerTraceId: SanitizedTextSchema.optional(),
    taskId: SanitizedTextSchema.optional(),
    errorCategory: z.enum(AI_STORY_PROVIDER_NATIVE_ERROR_CATEGORIES),

    // Transport-only evidence.
    transportErrorMessage: SanitizedTextSchema.optional(),

    // Durable classifications.
    accepted: z.boolean(),
    retryable: z.boolean(),
    reconciliationRequired: z.boolean(),

    // Canonical hash of the response; never the response itself.
    responseHash: IntegrityHashSchema,
    normalizationResult: NonEmptyTextSchema,

    diagnosticFingerprint: IntegrityHashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.observationKind === "TRANSPORT_FAILURE") {
      if (value.httpStatus !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Transport failure diagnostics must not carry an HTTP status",
        });
      }
      if (value.accepted) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Transport failure can never be an acceptance",
        });
      }
      return;
    }
    if (value.transportErrorMessage !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Provider response diagnostics must not carry a transport error message",
      });
    }
    if (value.httpStatus === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider response diagnostics require an HTTP status",
      });
    }
  });

export type AiStoryProviderCreateResponseDiagnostic = Readonly<
  z.infer<typeof AiStoryProviderCreateResponseDiagnosticSchema>
>;

/** Stable hash input. Excludes the fingerprint itself and the observation clock. */
export function aiStoryProviderCreateResponseDiagnosticFingerprintInput(
  diagnostic: Omit<
    AiStoryProviderCreateResponseDiagnostic,
    "diagnosticFingerprint" | "observedAt"
  >
): Readonly<Record<string, unknown>> {
  return {
    kind: "ai-story-provider-create-response-diagnostic",
    contractVersion: diagnostic.contractVersion,
    provider: diagnostic.provider,
    model: diagnostic.model,
    endpointFamily: diagnostic.endpointFamily,
    providerAttemptId: diagnostic.providerAttemptId,
    compiledRequestId: diagnostic.compiledRequestId,
    requestFingerprint: diagnostic.requestFingerprint,
    observationKind: diagnostic.observationKind,
    httpStatus: diagnostic.httpStatus ?? null,
    nativeErrorCode: diagnostic.nativeErrorCode ?? null,
    nativeErrorType: diagnostic.nativeErrorType ?? null,
    nativeErrorMessage: diagnostic.nativeErrorMessage ?? null,
    providerTraceId: diagnostic.providerTraceId ?? null,
    taskId: diagnostic.taskId ?? null,
    errorCategory: diagnostic.errorCategory,
    transportErrorMessage: diagnostic.transportErrorMessage ?? null,
    accepted: diagnostic.accepted,
    retryable: diagnostic.retryable,
    reconciliationRequired: diagnostic.reconciliationRequired,
    responseHash: diagnostic.responseHash,
    normalizationResult: diagnostic.normalizationResult,
  };
}

/**
 * Guard against credential or URL material reaching persistence, regardless of
 * how the envelope was assembled. Throws rather than silently storing a secret.
 */
export class AiStoryProviderDiagnosticRedactionError extends Error {
  readonly code = "PROVIDER_DIAGNOSTIC_REDACTION_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "AiStoryProviderDiagnosticRedactionError";
  }
}

export function assertAiStoryProviderDiagnosticIsSecretSafe(
  diagnostic: AiStoryProviderCreateResponseDiagnostic
): void {
  const freeText = [
    diagnostic.nativeErrorCode,
    diagnostic.nativeErrorType,
    diagnostic.nativeErrorMessage,
    diagnostic.providerTraceId,
    diagnostic.taskId,
    diagnostic.transportErrorMessage,
  ].filter((part): part is string => typeof part === "string");

  for (const part of freeText) {
    if (URL_PATTERN.test(part)) {
      URL_PATTERN.lastIndex = 0;
      throw new AiStoryProviderDiagnosticRedactionError(
        "Provider diagnostic evidence must not contain URLs"
      );
    }
    URL_PATTERN.lastIndex = 0;
    for (const pattern of CREDENTIAL_PATTERNS) {
      if (pattern.test(part)) {
        pattern.lastIndex = 0;
        throw new AiStoryProviderDiagnosticRedactionError(
          "Provider diagnostic evidence must not contain credential material"
        );
      }
      pattern.lastIndex = 0;
    }
  }
}
