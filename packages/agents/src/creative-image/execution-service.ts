import { createHash } from "node:crypto";
import {
  CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
  CreativeImageAdapterError,
  type CreativeImageBoundedProviderEvidence,
  type CreativeImageExecutionAuthorization,
  type CreativeImageExecutionFailure,
  type CreativeImageExecutionResult,
  type CreativeImageGenerationAdapter,
  type CreativeImageGenerationInput,
  type CreativeImageGenerationOutput,
} from "./contracts";

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const FORBIDDEN_METADATA_KEY = /authorization|api.?key|credential|password|secret|token|signed.?url/i;

type Claim =
  | { status: "CLAIMED"; providerCallsUsed: number }
  | { status: "REPLAY"; result: CreativeImageExecutionResult }
  | { status: "IN_PROGRESS"; providerCallsUsed: number }
  | { status: "IDENTITY_CONFLICT"; providerCallsUsed: number }
  | { status: "EXHAUSTED"; providerCallsUsed: number };

type ExecutionRecord = Readonly<{
  authorizationId: string;
  idempotencyKey: string;
  result: CreativeImageExecutionResult | "IN_PROGRESS";
}>;

export interface CreativeImageExecutionStateStore {
  claim(input: Readonly<{
    authorizationId: string;
    executionIdentity: string;
    idempotencyKey: string;
    maximumProviderCalls: number;
  }>): Promise<Claim>;
  complete(executionIdentity: string, result: CreativeImageExecutionResult): Promise<void>;
}

/**
 * Process-local idempotency aid only. It is NOT durable cross-process
 * exactly-once authority and must not be described or certified as such.
 */
export class InMemoryCreativeImageExecutionStateStore
implements CreativeImageExecutionStateStore {
  private readonly executions = new Map<string, ExecutionRecord>();
  private readonly callsByAuthorization = new Map<string, number>();

  async claim(input: {
    authorizationId: string;
    executionIdentity: string;
    idempotencyKey: string;
    maximumProviderCalls: number;
  }): Promise<Claim> {
    const existing = this.executions.get(input.executionIdentity);
    const used = this.callsByAuthorization.get(input.authorizationId) ?? 0;
    if (existing && (existing.authorizationId !== input.authorizationId || existing.idempotencyKey !== input.idempotencyKey)) {
      return { status: "IDENTITY_CONFLICT", providerCallsUsed: used };
    }
    if (existing?.result === "IN_PROGRESS") return { status: "IN_PROGRESS", providerCallsUsed: used };
    if (existing) return { status: "REPLAY", result: existing.result };
    if (used >= input.maximumProviderCalls) return { status: "EXHAUSTED", providerCallsUsed: used };
    this.callsByAuthorization.set(input.authorizationId, used + 1);
    this.executions.set(input.executionIdentity, {
      authorizationId: input.authorizationId,
      idempotencyKey: input.idempotencyKey,
      result: "IN_PROGRESS",
    });
    return { status: "CLAIMED", providerCallsUsed: used + 1 };
  }

  async complete(executionIdentity: string, result: CreativeImageExecutionResult): Promise<void> {
    const existing = this.executions.get(executionIdentity);
    if (!existing) throw new Error("Creative Image execution was not claimed");
    this.executions.set(executionIdentity, { ...existing, result });
  }
}

function failure(
  input: CreativeImageGenerationInput,
  code: CreativeImageExecutionFailure["code"],
  message: string,
  providerCallsUsed = 0,
  providerEvidence?: CreativeImageBoundedProviderEvidence
): CreativeImageExecutionResult {
  return {
    status: "FAILED",
    executionIdentity: input.executionIdentity,
    idempotencyKey: input.idempotencyKey,
    providerCallsUsed,
    replayed: false,
    failure: {
      code,
      message: message.slice(0, 500),
      ...(providerEvidence ? { providerEvidence } : {}),
    },
  };
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validText(value: string, max: number): boolean {
  return value.trim().length > 0 && value.length <= max;
}

function sanitizeText(value: string, max: number): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/([?&](?:token|signature|sig|key|credential)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, max);
}

function validateInput(input: CreativeImageGenerationInput): string | null {
  if (input.contractVersion !== CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION) return "Unsupported Creative Image contract";
  if (!validText(input.scope.tenantId, 256) || !validText(input.scope.workspaceId, 256)) return "Execution scope is required";
  if (!validText(input.executionIdentity, 512) || !validText(input.idempotencyKey, 512) || !validText(input.authorizationId, 256)) return "Execution identity is invalid";
  if (!validText(input.prompt, 32_000)) return "Prompt is invalid";
  if (input.references.length > 16) return "Reference count exceeds the shared execution bound";
  for (const reference of input.references) {
    if (!validText(reference.assetId, 256) || !HASH_PATTERN.test(reference.contentHash)) return "Reference identity is invalid";
    if (!MIME_TYPES.has(reference.mimeType) || reference.bytes.length === 0 || sha256(reference.bytes) !== reference.contentHash) return "Reference payload integrity is invalid";
  }
  const output = input.requestedOutput;
  if (!MIME_TYPES.has(output.mimeType)) return "Requested output MIME is invalid";
  if ((output.width !== undefined && (!Number.isInteger(output.width) || output.width < 1 || output.width > 16_384))
    || (output.height !== undefined && (!Number.isInteger(output.height) || output.height < 1 || output.height > 16_384))) {
    return "Requested output dimensions are invalid";
  }
  if (input.correlationMetadata && Object.keys(input.correlationMetadata).length > 16) return "Correlation metadata exceeds the shared execution bound";
  return null;
}

function scopeMatches(
  left: CreativeImageGenerationInput["scope"],
  right: CreativeImageExecutionAuthorization["scope"]
): boolean {
  return left.tenantId === right.tenantId && left.workspaceId === right.workspaceId;
}

function validateAuthorization(input: {
  request: CreativeImageGenerationInput;
  authorization?: CreativeImageExecutionAuthorization | null;
  adapter: CreativeImageGenerationAdapter;
}): CreativeImageExecutionFailure | null {
  const authorization = input.authorization;
  if (!authorization) return { code: "AUTHORIZATION_REQUIRED", message: "Creative Image execution authorization is required" };
  if (
    authorization.contractVersion !== CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION
    || authorization.authorizationId !== input.request.authorizationId
    || authorization.executionIdentity !== input.request.executionIdentity
    || authorization.idempotencyKey !== input.request.idempotencyKey
    || !scopeMatches(input.request.scope, authorization.scope)
    || authorization.providerId !== input.adapter.providerId
    || authorization.modelId !== input.adapter.modelId
    || !validText(authorization.authorizedBy, 256)
    || Number.isNaN(Date.parse(authorization.authorizedAt))
  ) return { code: "AUTHORIZATION_REQUIRED", message: "Creative Image execution authorization does not bind this request" };
  if (!Number.isInteger(authorization.maximumProviderCalls) || authorization.maximumProviderCalls < 0 || authorization.maximumProviderCalls > 16) {
    return { code: "INVALID_INPUT", message: "Authorized Provider call count is invalid" };
  }
  if (authorization.maximumProviderCalls === 0) return { code: "AUTHORIZATION_EXHAUSTED", message: "Creative Image Provider call authorization is exhausted" };
  return null;
}

function boundedMetadata(
  metadata: CreativeImageGenerationOutput["metadata"]
): CreativeImageGenerationOutput["metadata"] {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).slice(0, 16);
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (!validText(key, 64) || FORBIDDEN_METADATA_KEY.test(key)) continue;
    safe[key] = typeof value === "string" ? sanitizeText(value, 500) : value;
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function boundedEvidence(
  evidence: CreativeImageBoundedProviderEvidence | undefined
): CreativeImageBoundedProviderEvidence | undefined {
  if (!evidence) return undefined;
  return {
    ...(typeof evidence.status === "number" ? { status: evidence.status } : {}),
    ...(evidence.code ? { code: sanitizeText(evidence.code, 120) } : {}),
    ...(evidence.type ? { type: sanitizeText(evidence.type, 120) } : {}),
    ...(evidence.message ? { message: sanitizeText(evidence.message, 500) } : {}),
    ...(evidence.requestId ? { requestId: sanitizeText(evidence.requestId, 200) } : {}),
  };
}

function normalizeOutput(
  output: CreativeImageGenerationOutput,
  adapter: CreativeImageGenerationAdapter
): CreativeImageGenerationOutput | null {
  if (
    !Buffer.isBuffer(output.bytes)
    || output.bytes.length === 0
    || !MIME_TYPES.has(output.mimeType)
    || output.providerId !== adapter.providerId
    || output.modelId !== adapter.modelId
    || output.adapterVersion !== adapter.adapterVersion
    || !validText(output.providerRequestId, 512)
  ) return null;
  const metadata = boundedMetadata(output.metadata);
  return {
    bytes: output.bytes,
    mimeType: output.mimeType,
    providerId: adapter.providerId,
    modelId: adapter.modelId,
    adapterVersion: adapter.adapterVersion,
    providerRequestId: output.providerRequestId.slice(0, 512),
    ...(output.revisedPrompt ? { revisedPrompt: sanitizeText(output.revisedPrompt, 4_000) } : {}),
    ...(output.usage ? { usage: output.usage } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export class CreativeImageExecutionService {
  private readonly state: CreativeImageExecutionStateStore;

  constructor(private readonly dependencies: {
    adapter: CreativeImageGenerationAdapter;
    state?: CreativeImageExecutionStateStore;
  }) {
    this.state = dependencies.state ?? new InMemoryCreativeImageExecutionStateStore();
  }

  async execute(input: {
    request: CreativeImageGenerationInput;
    authorization?: CreativeImageExecutionAuthorization | null;
  }): Promise<CreativeImageExecutionResult> {
    const invalid = validateInput(input.request);
    if (invalid) return failure(input.request, "INVALID_INPUT", invalid);
    const authorizationFailure = validateAuthorization({
      request: input.request,
      authorization: input.authorization,
      adapter: this.dependencies.adapter,
    });
    if (authorizationFailure) return failure(input.request, authorizationFailure.code, authorizationFailure.message);

    const authorization = input.authorization!;
    const claim = await this.state.claim({
      authorizationId: authorization.authorizationId,
      executionIdentity: input.request.executionIdentity,
      idempotencyKey: input.request.idempotencyKey,
      maximumProviderCalls: authorization.maximumProviderCalls,
    });
    if (claim.status === "REPLAY") return { ...claim.result, replayed: true };
    if (claim.status === "IN_PROGRESS") return failure(input.request, "EXECUTION_FAILED", "Creative Image execution is already in progress", claim.providerCallsUsed);
    if (claim.status === "IDENTITY_CONFLICT") return failure(input.request, "INVALID_INPUT", "Creative Image execution identity is already bound to another authorization", claim.providerCallsUsed);
    if (claim.status === "EXHAUSTED") return failure(input.request, "AUTHORIZATION_EXHAUSTED", "Creative Image Provider call authorization is exhausted", claim.providerCallsUsed);

    let result: CreativeImageExecutionResult;
    try {
      const normalized = normalizeOutput(
        await this.dependencies.adapter.generate(input.request),
        this.dependencies.adapter
      );
      result = normalized
        ? {
            status: "SUCCEEDED",
            executionIdentity: input.request.executionIdentity,
            idempotencyKey: input.request.idempotencyKey,
            providerCallsUsed: claim.providerCallsUsed,
            replayed: false,
            output: normalized,
          }
        : failure(input.request, "PROVIDER_RESULT_INVALID", "Creative Image Provider result is invalid", claim.providerCallsUsed);
    } catch (error) {
      result = error instanceof CreativeImageAdapterError
        ? failure(
            input.request,
            error.code,
            `Creative Image Provider ${error.code === "PROVIDER_REJECTED" ? "rejected the request" : error.code === "PROVIDER_UNAVAILABLE" ? "is unavailable" : "returned an invalid result"}`,
            claim.providerCallsUsed,
            boundedEvidence(error.providerEvidence)
          )
        : failure(input.request, "EXECUTION_FAILED", "Creative Image execution failed", claim.providerCallsUsed);
    }
    await this.state.complete(input.request.executionIdentity, result);
    return result;
  }
}
