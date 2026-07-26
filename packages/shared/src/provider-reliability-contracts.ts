import { z } from "zod";

export const PROVIDER_RELIABILITY_CONTRACT_VERSION = "1" as const;

const NonEmptyStringSchema = z.string().trim().min(1);
const VersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "Version must use major.minor.patch");
const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export type CapabilityId = string;
export type CapabilityVersion = string;
export type RequestSchemaVersion = string;
export type ResultSchemaVersion = string;

export const CompatibilityRangeSchema = z
  .object({
    minInclusive: VersionSchema,
    maxExclusive: VersionSchema.optional(),
  })
  .strict();
export type CompatibilityRange = Readonly<
  z.infer<typeof CompatibilityRangeSchema>
>;

export const DeprecationStatusSchema = z.enum([
  "ACTIVE",
  "DEPRECATED",
  "RETIRED",
]);
export type DeprecationStatus = z.infer<typeof DeprecationStatusSchema>;

export const ValidationRuleSchema = z
  .object({
    ruleId: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    severity: z.enum(["ERROR", "WARNING"]),
  })
  .strict();
export type ValidationRule = Readonly<z.infer<typeof ValidationRuleSchema>>;

export const ProviderRequirementsSchema = z
  .object({
    capabilities: z.array(NonEmptyStringSchema).min(1),
    structuredOutput: z.boolean(),
    streaming: z.boolean().optional(),
    nativeIdempotency: z.boolean().optional(),
    executionLookup: z.boolean().optional(),
    callbackSupport: z.boolean().optional(),
    minimumContextTokens: z.number().int().positive().optional(),
    dataResidency: z.array(NonEmptyStringSchema).optional(),
  })
  .strict();
export type ProviderRequirements = Readonly<
  z.infer<typeof ProviderRequirementsSchema>
>;

export const CapabilityMetadataSchema = z
  .object({
    displayName: NonEmptyStringSchema,
    description: NonEmptyStringSchema,
    owner: NonEmptyStringSchema,
    tags: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();
export type CapabilityMetadata = Readonly<
  z.infer<typeof CapabilityMetadataSchema>
>;

export const CapabilityContractSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    capabilityId: NonEmptyStringSchema,
    capabilityVersion: VersionSchema,
    requestSchemaVersion: VersionSchema,
    resultSchemaVersion: VersionSchema,
    compatibleContextVersions: z.array(CompatibilityRangeSchema).min(1),
    deprecationStatus: DeprecationStatusSchema,
    validationRules: z.array(ValidationRuleSchema),
    providerRequirements: ProviderRequirementsSchema,
    metadata: CapabilityMetadataSchema,
  })
  .strict();
export type CapabilityContract = Readonly<
  z.infer<typeof CapabilityContractSchema>
>;

export const ExecutionStatusSchema = z.enum([
  "PENDING",
  "DISPATCHABLE",
  "EXECUTING",
  "RECONCILING",
  "SUCCEEDED",
  "RETRYABLE_FAILURE",
  "TERMINAL_FAILURE",
  "CANCELLED",
  "SUPERSEDED",
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const AttemptStatusSchema = z.enum([
  "CREATED",
  "CLAIMED",
  "EXECUTING",
  "TIMEOUT_UNKNOWN",
  "SUCCEEDED",
  "RETRYABLE_FAILURE",
  "TERMINAL_FAILURE",
  "CANCELLED",
]);
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;

export const DeliveryStatusSchema = z.enum([
  "PENDING",
  "CLAIMED",
  "DELIVERED",
  "RETRYABLE_FAILURE",
  "DEAD_LETTER",
  "CANCELLED",
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const CallbackStatusSchema = z.enum([
  "RECEIVED",
  "AUTHENTICATED",
  "DUPLICATE",
  "ACCEPTED",
  "REJECTED",
]);
export type CallbackStatus = z.infer<typeof CallbackStatusSchema>;

export const ExecutionIdentitySchema = z
  .object({
    executionId: NonEmptyStringSchema,
    tenantId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    campaignId: NonEmptyStringSchema.optional(),
    pipelineRunId: NonEmptyStringSchema,
    capabilityId: NonEmptyStringSchema,
    capabilityVersion: VersionSchema,
    idempotencyKey: NonEmptyStringSchema,
    deterministicFingerprint: HashSchema,
  })
  .strict();
export type ExecutionIdentity = Readonly<
  z.infer<typeof ExecutionIdentitySchema>
>;

export const ExecutionMetadataSchema = z
  .object({
    skillId: NonEmptyStringSchema,
    skillVersion: VersionSchema,
    promptId: NonEmptyStringSchema.optional(),
    promptVersion: VersionSchema.optional(),
    contextVersions: z.record(VersionSchema),
    outputSchemaId: NonEmptyStringSchema,
    outputSchemaVersion: VersionSchema,
    correlationId: NonEmptyStringSchema,
    queueJobId: NonEmptyStringSchema.optional(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ExecutionMetadata = Readonly<
  z.infer<typeof ExecutionMetadataSchema>
>;

export const ProviderExecutionSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    identity: ExecutionIdentitySchema,
    metadata: ExecutionMetadataSchema,
    status: ExecutionStatusSchema,
    acceptedAttemptId: NonEmptyStringSchema.optional(),
    resultReference: NonEmptyStringSchema.optional(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();
export type ProviderExecution = Readonly<
  z.infer<typeof ProviderExecutionSchema>
>;

export const ProviderAttemptSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    attemptId: NonEmptyStringSchema,
    executionId: NonEmptyStringSchema,
    attemptNumber: z.number().int().nonnegative(),
    providerId: NonEmptyStringSchema,
    providerVersion: NonEmptyStringSchema,
    modelVersion: NonEmptyStringSchema,
    providerRequestId: NonEmptyStringSchema.optional(),
    requestHash: HashSchema,
    responseHash: HashSchema.optional(),
    status: AttemptStatusSchema,
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();
export type ProviderAttempt = Readonly<
  z.infer<typeof ProviderAttemptSchema>
>;

export const DeliveryAttemptSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    deliveryAttemptId: NonEmptyStringSchema,
    executionId: NonEmptyStringSchema,
    providerAttemptId: NonEmptyStringSchema,
    deliveryNumber: z.number().int().nonnegative(),
    status: DeliveryStatusSchema,
    leaseOwner: NonEmptyStringSchema.optional(),
    leaseExpiresAt: z.string().datetime().optional(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();
export type DeliveryAttempt = Readonly<
  z.infer<typeof DeliveryAttemptSchema>
>;

export const CallbackEventSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    callbackEventId: NonEmptyStringSchema,
    executionId: NonEmptyStringSchema,
    providerAttemptId: NonEmptyStringSchema,
    providerId: NonEmptyStringSchema,
    providerRequestId: NonEmptyStringSchema.optional(),
    eventType: NonEmptyStringSchema,
    payloadHash: HashSchema,
    status: CallbackStatusSchema,
    receivedAt: z.string().datetime(),
  })
  .strict();
export type CallbackEvent = Readonly<z.infer<typeof CallbackEventSchema>>;

export const TimeoutPolicySchema = z
  .object({
    timeoutMs: z.number().int().positive(),
    reconciliationDelayMs: z.number().int().nonnegative(),
  })
  .strict();

export const RetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().positive(),
    initialDelayMs: z.number().int().nonnegative(),
    maximumDelayMs: z.number().int().nonnegative(),
    backoffMultiplier: z.number().positive(),
  })
  .strict()
  .refine(
    (value) => value.maximumDelayMs >= value.initialDelayMs,
    "maximumDelayMs must be greater than or equal to initialDelayMs"
  );

export const ProviderConstraintsSchema = z
  .object({
    allowedProviderIds: z.array(NonEmptyStringSchema).optional(),
    deniedProviderIds: z.array(NonEmptyStringSchema).optional(),
    requiredRegions: z.array(NonEmptyStringSchema).optional(),
    maximumEstimatedCostUsd: z.number().nonnegative().optional(),
    nativeIdempotencyRequired: z.boolean().optional(),
    executionLookupRequired: z.boolean().optional(),
  })
  .strict();

export const CanonicalProviderRequestSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    executionIdentity: ExecutionIdentitySchema,
    requestSchemaVersion: VersionSchema,
    resultSchemaVersion: VersionSchema,
    normalizedPayloadReference: z
      .object({
        uri: NonEmptyStringSchema,
        contentHash: HashSchema,
        mediaType: NonEmptyStringSchema,
      })
      .strict(),
    outputSchema: z
      .object({
        schemaId: NonEmptyStringSchema,
        schemaVersion: VersionSchema,
      })
      .strict(),
    contextVersions: z.record(VersionSchema),
    correlation: z
      .object({
        correlationId: NonEmptyStringSchema,
        pipelineRunId: NonEmptyStringSchema,
        queueJobId: NonEmptyStringSchema.optional(),
      })
      .strict(),
    timeoutPolicy: TimeoutPolicySchema,
    retryPolicy: RetryPolicySchema,
    providerConstraints: ProviderConstraintsSchema,
  })
  .strict();
export type CanonicalProviderRequest = Readonly<
  z.infer<typeof CanonicalProviderRequestSchema>
>;

export const ProviderWarningSchema = z
  .object({
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    retryable: z.boolean(),
  })
  .strict();

export const ProviderUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    providerUsageId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ProviderCostSchema = z
  .object({
    amount: z.number().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    estimated: z.boolean(),
  })
  .strict();

export const CanonicalProviderResultSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    executionId: NonEmptyStringSchema,
    providerAttemptId: NonEmptyStringSchema,
    normalizedOutput: z.unknown(),
    resultReference: NonEmptyStringSchema,
    warnings: z.array(ProviderWarningSchema),
    providerMetadata: z
      .object({
        providerId: NonEmptyStringSchema,
        providerVersion: NonEmptyStringSchema,
        providerRequestId: NonEmptyStringSchema.optional(),
      })
      .strict(),
    usage: ProviderUsageSchema,
    cost: ProviderCostSchema,
    modelVersion: NonEmptyStringSchema,
    requestHash: HashSchema,
    responseHash: HashSchema,
    retryable: z.boolean(),
    validationStatus: z.enum(["VALID", "VALID_WITH_WARNINGS", "INVALID"]),
  })
  .strict();
export type CanonicalProviderResult = Readonly<
  z.infer<typeof CanonicalProviderResultSchema>
>;

export const ProviderErrorKindSchema = z.enum([
  "RETRYABLE",
  "TIMEOUT_UNKNOWN",
  "RATE_LIMITED",
  "VALIDATION_FAILURE",
  "AUTHENTICATION_FAILURE",
  "POLICY_REJECTION",
  "PROVIDER_UNAVAILABLE",
  "CONFLICT",
  "DUPLICATE",
  "CANCELLED",
  "TERMINAL_FAILURE",
]);
export type ProviderErrorKind = z.infer<typeof ProviderErrorKindSchema>;

export const ProviderErrorSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_RELIABILITY_CONTRACT_VERSION),
    kind: ProviderErrorKindSchema,
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    retryable: z.boolean(),
    terminal: z.boolean(),
    needsReconciliation: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    safeDetails: z.record(z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = providerErrorPolicy(value.kind);
    if (
      value.retryable !== expected.retryable ||
      value.terminal !== expected.terminal ||
      value.needsReconciliation !== expected.needsReconciliation
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Error flags do not match ${value.kind} policy`,
      });
    }
  });
export type ProviderError = Readonly<z.infer<typeof ProviderErrorSchema>>;

const ERROR_POLICIES: Readonly<
  Record<
    ProviderErrorKind,
    Readonly<{
      retryable: boolean;
      terminal: boolean;
      needsReconciliation: boolean;
    }>
  >
> = Object.freeze({
  RETRYABLE: { retryable: true, terminal: false, needsReconciliation: false },
  TIMEOUT_UNKNOWN: {
    retryable: false,
    terminal: false,
    needsReconciliation: true,
  },
  RATE_LIMITED: { retryable: true, terminal: false, needsReconciliation: false },
  VALIDATION_FAILURE: {
    retryable: false,
    terminal: true,
    needsReconciliation: false,
  },
  AUTHENTICATION_FAILURE: {
    retryable: false,
    terminal: true,
    needsReconciliation: false,
  },
  POLICY_REJECTION: {
    retryable: false,
    terminal: true,
    needsReconciliation: false,
  },
  PROVIDER_UNAVAILABLE: {
    retryable: true,
    terminal: false,
    needsReconciliation: false,
  },
  CONFLICT: { retryable: false, terminal: true, needsReconciliation: false },
  DUPLICATE: { retryable: false, terminal: false, needsReconciliation: false },
  CANCELLED: { retryable: false, terminal: true, needsReconciliation: false },
  TERMINAL_FAILURE: {
    retryable: false,
    terminal: true,
    needsReconciliation: false,
  },
});

export function providerErrorPolicy(kind: ProviderErrorKind) {
  return ERROR_POLICIES[kind];
}

export function createProviderError(
  kind: ProviderErrorKind,
  input: Omit<
    ProviderError,
    | "contractVersion"
    | "kind"
    | "retryable"
    | "terminal"
    | "needsReconciliation"
  >
): ProviderError {
  return validateProviderError({
    contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
    kind,
    ...providerErrorPolicy(kind),
    ...input,
  });
}

function parseVersion(value: string): readonly [number, number, number] {
  const parsed = VersionSchema.parse(value).split(".").map(Number);
  return [parsed[0]!, parsed[1]!, parsed[2]!] as const;
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

export function isVersionCompatible(
  version: string,
  range: CompatibilityRange
): boolean {
  const validRange = CompatibilityRangeSchema.parse(range);
  return (
    compareVersions(version, validRange.minInclusive) >= 0 &&
    (!validRange.maxExclusive ||
      compareVersions(version, validRange.maxExclusive) < 0)
  );
}

export function isAnyVersionCompatible(
  version: string,
  ranges: readonly CompatibilityRange[]
): boolean {
  return ranges.some((range) => isVersionCompatible(version, range));
}

export interface ProviderCapabilitySupport {
  readonly capabilityId: CapabilityId;
  readonly capabilityVersions: readonly CompatibilityRange[];
  readonly requestSchemaVersions: readonly CompatibilityRange[];
  readonly resultSchemaVersions: readonly CompatibilityRange[];
  readonly contextVersions: Readonly<Record<string, readonly CompatibilityRange[]>>;
}

export function isCapabilityCompatible(
  contract: CapabilityContract,
  support: ProviderCapabilitySupport
): boolean {
  return (
    contract.deprecationStatus !== "RETIRED" &&
    contract.capabilityId === support.capabilityId &&
    isAnyVersionCompatible(
      contract.capabilityVersion,
      support.capabilityVersions
    ) &&
    isAnyVersionCompatible(
      contract.requestSchemaVersion,
      support.requestSchemaVersions
    ) &&
    isAnyVersionCompatible(
      contract.resultSchemaVersion,
      support.resultSchemaVersions
    )
  );
}

export function areContextVersionsCompatible(
  required: Readonly<Record<string, string>>,
  supported: Readonly<Record<string, readonly CompatibilityRange[]>>
): boolean {
  return Object.entries(required).every(([contextId, version]) => {
    const ranges = supported[contextId];
    return Boolean(ranges && isAnyVersionCompatible(version, ranges));
  });
}

export function isOutputCompatible(
  requiredVersion: string,
  supportedRanges: readonly CompatibilityRange[]
): boolean {
  return isAnyVersionCompatible(requiredVersion, supportedRanges);
}

const FORBIDDEN_DETERMINISTIC_KEYS = new Set([
  "timestamp",
  "createdAt",
  "updatedAt",
  "startedAt",
  "completedAt",
  "workerId",
  "leaseOwner",
  "deliveryAttemptId",
  "callbackEventId",
  "random",
  "nonce",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeValue(
  value: unknown,
  path: string,
  strictDeterministic: boolean
): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (strictDeterministic && typeof value === "string" && UUID_PATTERN.test(value)) {
      throw new Error(`Random UUID is not allowed in deterministic input at ${path}`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number is not canonical at ${path}`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      normalizeValue(item, `${path}[${index}]`, strictDeterministic)
    );
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of entries) {
      if (strictDeterministic && FORBIDDEN_DETERMINISTIC_KEYS.has(key)) {
        throw new Error(`Volatile field ${key} is not allowed at ${path}`);
      }
      normalized[key] = normalizeValue(
        item,
        path === "$" ? `$.${key}` : `${path}.${key}`,
        strictDeterministic
      );
    }
    return normalized;
  }
  throw new Error(`Unsupported canonical value at ${path}`);
}

export function normalizeCanonicalValue(value: unknown): unknown {
  return normalizeValue(value, "$", false);
}

export function normalizeDeterministicInput(value: unknown): unknown {
  return normalizeValue(value, "$", true);
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function stableSerializeDeterministicInput(value: unknown): string {
  return JSON.stringify(normalizeDeterministicInput(value));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function deterministicFingerprint(value: unknown): Promise<string> {
  return sha256(stableSerializeDeterministicInput(value));
}

export function requestHash(value: unknown): Promise<string> {
  return sha256(stableSerialize(value));
}

export function responseHash(value: unknown): Promise<string> {
  return sha256(stableSerialize(value));
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function validate<T>(schema: z.ZodType<T>, value: unknown): Readonly<T> {
  return deepFreeze(schema.parse(value));
}

export const validateCapabilityContract = (value: unknown) =>
  validate(CapabilityContractSchema, value) as CapabilityContract;
export const validateProviderExecution = (value: unknown) =>
  validate(ProviderExecutionSchema, value) as ProviderExecution;
export const validateProviderAttempt = (value: unknown) =>
  validate(ProviderAttemptSchema, value) as ProviderAttempt;
export const validateDeliveryAttempt = (value: unknown) =>
  validate(DeliveryAttemptSchema, value) as DeliveryAttempt;
export const validateCallbackEvent = (value: unknown) =>
  validate(CallbackEventSchema, value) as CallbackEvent;
export const validateCanonicalProviderRequest = (value: unknown) =>
  validate(CanonicalProviderRequestSchema, value) as CanonicalProviderRequest;
export const validateCanonicalProviderResult = (value: unknown) =>
  validate(CanonicalProviderResultSchema, value) as CanonicalProviderResult;
export const validateProviderError = (value: unknown) =>
  validate(ProviderErrorSchema, value) as ProviderError;

function serializeValidated<T>(
  value: unknown,
  validator: (input: unknown) => T
): string {
  return stableSerialize(validator(value));
}

export const serializeCapabilityContract = (value: unknown) =>
  serializeValidated(value, validateCapabilityContract);
export const deserializeCapabilityContract = (value: string) =>
  validateCapabilityContract(JSON.parse(value));
export const serializeProviderExecution = (value: unknown) =>
  serializeValidated(value, validateProviderExecution);
export const deserializeProviderExecution = (value: string) =>
  validateProviderExecution(JSON.parse(value));
export const serializeProviderAttempt = (value: unknown) =>
  serializeValidated(value, validateProviderAttempt);
export const deserializeProviderAttempt = (value: string) =>
  validateProviderAttempt(JSON.parse(value));
export const serializeDeliveryAttempt = (value: unknown) =>
  serializeValidated(value, validateDeliveryAttempt);
export const deserializeDeliveryAttempt = (value: string) =>
  validateDeliveryAttempt(JSON.parse(value));
export const serializeCallbackEvent = (value: unknown) =>
  serializeValidated(value, validateCallbackEvent);
export const deserializeCallbackEvent = (value: string) =>
  validateCallbackEvent(JSON.parse(value));
export const serializeCanonicalProviderRequest = (value: unknown) =>
  serializeValidated(value, validateCanonicalProviderRequest);
export const deserializeCanonicalProviderRequest = (value: string) =>
  validateCanonicalProviderRequest(JSON.parse(value));
export const serializeCanonicalProviderResult = (value: unknown) =>
  serializeValidated(value, validateCanonicalProviderResult);
export const deserializeCanonicalProviderResult = (value: string) =>
  validateCanonicalProviderResult(JSON.parse(value));
export const serializeProviderError = (value: unknown) =>
  serializeValidated(value, validateProviderError);
export const deserializeProviderError = (value: string) =>
  validateProviderError(JSON.parse(value));
