import { randomUUID } from "node:crypto";
import {
  AiStoryCharacterVirtualizerError,
  CHARACTER_VIRTUALIZATION_MAX_RETRIES,
  CHARACTER_VIRTUALIZATION_OPENAI_MODEL,
  CHARACTER_VIRTUALIZATION_OPENAI_OPERATION,
  CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER,
  CHARACTER_VIRTUALIZATION_OUTPUT,
  CHARACTER_VIRTUALIZATION_SOURCE_REFERENCE_ROLE,
  characterVirtualizationUserSafeFailure,
  readCharacterVirtualizationProviderMode,
  type CharacterVirtualizationProvider,
  type CharacterVirtualizationProviderFailure,
  type CharacterVirtualizationProviderRequest,
  type CharacterVirtualizationProviderResult,
} from "@ceo-agent/shared";
import {
  compileCharacterVirtualizationPrompt,
  fingerprintCharacterVirtualizationPrompt,
  hashCharacterVirtualizationBytes,
  MockCharacterVirtualizationProvider,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import {
  CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
  CreativeImageAdapterError,
  CreativeImageExecutionService,
  createOpenAiCreativeImageGenerationAdapter,
  OpenAiCreativeImageGenerationAdapter,
  type CreativeImageExecutionAuthorization,
  type CreativeImageGenerationAdapter,
  type CreativeImageGenerationInput,
} from "../creative-image";

export const CHARACTER_VIRTUALIZATION_CREATIVE_IMAGE_PLAN = Object.freeze({
  provider: CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER,
  model: CHARACTER_VIRTUALIZATION_OPENAI_MODEL,
  operation: CHARACTER_VIRTUALIZATION_OPENAI_OPERATION,
  retries: CHARACTER_VIRTUALIZATION_MAX_RETRIES,
  references: 1,
  size: CHARACTER_VIRTUALIZATION_OUTPUT.sizeConstraint,
  quality: CHARACTER_VIRTUALIZATION_OUTPUT.quality,
  openaiQuality: "medium" as const,
  adapterClass: OpenAiCreativeImageGenerationAdapter.name,
});

export type CharacterVirtualizationCreativeImagePlan = Readonly<{
  provider: typeof CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER;
  model: typeof CHARACTER_VIRTUALIZATION_OPENAI_MODEL;
  operation: typeof CHARACTER_VIRTUALIZATION_OPENAI_OPERATION;
  retries: typeof CHARACTER_VIRTUALIZATION_MAX_RETRIES;
  references: 1;
  size: typeof CHARACTER_VIRTUALIZATION_OUTPUT.sizeConstraint;
  quality: typeof CHARACTER_VIRTUALIZATION_OUTPUT.quality;
  openaiQuality: "medium";
  adapterClass: string;
  promptFingerprint: string;
  requestFingerprint: string;
  sourceAssetId: string;
  sourceContentHash: string;
  sourceRole: typeof CHARACTER_VIRTUALIZATION_SOURCE_REFERENCE_ROLE;
}>;

function sourceBytes(request: CharacterVirtualizationProviderRequest): Buffer | null {
  if (!request.sourceImage.bytes || request.sourceImage.bytes.byteLength === 0) return null;
  return Buffer.from(request.sourceImage.bytes);
}

export function compileCharacterVirtualizationCreativeImageRequest(input: {
  request: CharacterVirtualizationProviderRequest;
  authorization: NonNullable<CharacterVirtualizationProviderRequest["authorization"]>;
}): CreativeImageGenerationInput {
  const bytes = sourceBytes(input.request);
  if (!bytes) {
    throw new AiStoryCharacterVirtualizerError(
      "SOURCE_PORTRAIT_BYTES_REQUIRED",
      "Character virtualization requires the authorized source portrait bytes."
    );
  }
  if (hashCharacterVirtualizationBytes(bytes) !== input.request.sourceImage.contentHash) {
    throw new AiStoryCharacterVirtualizerError(
      "SOURCE_PORTRAIT_INTEGRITY_INVALID",
      "Source portrait integrity does not match the Character Virtualizer lineage."
    );
  }
  if (!/^image\/(png|jpeg|webp)$/.test(input.request.sourceImage.mimeType)) {
    throw new AiStoryCharacterVirtualizerError(
      "SOURCE_PORTRAIT_INVALID",
      "Use a JPEG, PNG, or WebP portrait."
    );
  }
  return {
    contractVersion: CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
    scope: {
      tenantId: input.authorization.scope.tenantId,
      workspaceId: input.authorization.scope.workspaceId,
    },
    executionIdentity: input.authorization.executionIdentity,
    idempotencyKey: input.authorization.idempotencyKey,
    authorizationId: input.authorization.authorizationId,
    prompt: input.request.compiledPrompt,
    references: [
      {
        assetId: input.request.sourceImage.assetId,
        contentHash: input.request.sourceImage.contentHash,
        mimeType: input.request.sourceImage.mimeType as "image/png" | "image/jpeg" | "image/webp",
        bytes,
        role: CHARACTER_VIRTUALIZATION_SOURCE_REFERENCE_ROLE,
      },
    ],
    requestedOutput: {
      mimeType: CHARACTER_VIRTUALIZATION_OUTPUT.mimeType,
      width: CHARACTER_VIRTUALIZATION_OUTPUT.width,
      height: CHARACTER_VIRTUALIZATION_OUTPUT.height,
      sizeConstraint: CHARACTER_VIRTUALIZATION_OUTPUT.sizeConstraint,
      quality: CHARACTER_VIRTUALIZATION_OUTPUT.quality,
    },
    correlationMetadata: {
      style: input.request.style,
      operation: CHARACTER_VIRTUALIZATION_OPENAI_OPERATION,
      retries: CHARACTER_VIRTUALIZATION_MAX_RETRIES,
    },
  };
}

export function fingerprintCharacterVirtualizationCreativeImageRequest(
  request: CreativeImageGenerationInput
) {
  return sha256CanonicalIntegrityHash({
    contractVersion: request.contractVersion,
    provider: CHARACTER_VIRTUALIZATION_OPENAI_PROVIDER,
    model: CHARACTER_VIRTUALIZATION_OPENAI_MODEL,
    operation: CHARACTER_VIRTUALIZATION_OPENAI_OPERATION,
    retries: CHARACTER_VIRTUALIZATION_MAX_RETRIES,
    prompt: request.prompt,
    references: request.references.map((reference) => ({
      assetId: reference.assetId,
      contentHash: reference.contentHash,
      mimeType: reference.mimeType,
      role: reference.role,
    })),
    requestedOutput: request.requestedOutput,
    executionIdentity: request.executionIdentity,
  });
}

export function compileCharacterVirtualizationCreativeImagePlan(input: {
  request: CharacterVirtualizationProviderRequest;
  authorization: NonNullable<CharacterVirtualizationProviderRequest["authorization"]>;
}): CharacterVirtualizationCreativeImagePlan {
  const compiled = compileCharacterVirtualizationCreativeImageRequest(input);
  return {
    ...CHARACTER_VIRTUALIZATION_CREATIVE_IMAGE_PLAN,
    promptFingerprint: fingerprintCharacterVirtualizationPrompt(compiled.prompt),
    requestFingerprint: fingerprintCharacterVirtualizationCreativeImageRequest(compiled),
    sourceAssetId: input.request.sourceImage.assetId,
    sourceContentHash: input.request.sourceImage.contentHash,
    sourceRole: CHARACTER_VIRTUALIZATION_SOURCE_REFERENCE_ROLE,
  };
}

function authorizationFromRequest(
  request: CharacterVirtualizationProviderRequest,
  adapter: CreativeImageGenerationAdapter
): CreativeImageExecutionAuthorization | null {
  const authorization = request.authorization;
  if (!authorization) return null;
  return {
    contractVersion: CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION,
    authorizationId: authorization.authorizationId,
    executionIdentity: authorization.executionIdentity,
    idempotencyKey: authorization.idempotencyKey,
    scope: authorization.scope,
    providerId: adapter.providerId,
    modelId: adapter.modelId,
    maximumProviderCalls: 1,
    authorizedBy: authorization.authorizedBy,
    authorizedAt: authorization.authorizedAt,
  };
}

function boundedRealImageProviderCalls(used: number | undefined): 0 | 1 {
  if (!Number.isInteger(used) || (used ?? 0) <= 0) return 0;
  return 1;
}

function mapExecutionFailure(input: {
  code: CharacterVirtualizationProviderFailure["code"];
  adapter: CreativeImageGenerationAdapter;
  providerCallsUsed?: number;
  costUsd?: string | null;
}): CharacterVirtualizationProviderFailure {
  return {
    ok: false,
    code: input.code,
    userSafeMessage: characterVirtualizationUserSafeFailure(input.code),
    provider: input.adapter.providerId,
    providerModel: input.adapter.modelId,
    providerAttemptId: randomUUID(),
    realImageProviderCalls: boundedRealImageProviderCalls(input.providerCallsUsed),
    ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
  };
}

/**
 * Product-owned Character Virtualizer bridge. Reuses the shared Creative Image
 * adapter and execution service; it is not an OpenAI SDK wrapper.
 */
export class CreativeImageCharacterVirtualizationBridge implements CharacterVirtualizationProvider {
  readonly providerId: string;
  readonly providerModel: string;
  readonly externalPaidCall: boolean;

  constructor(
    private readonly adapter: CreativeImageGenerationAdapter,
    private readonly execution = new CreativeImageExecutionService({ adapter })
  ) {
    this.providerId = adapter.providerId;
    this.providerModel = adapter.modelId;
    this.externalPaidCall = adapter.externalPaidCall;
  }

  async virtualizeCharacter(
    request: CharacterVirtualizationProviderRequest
  ): Promise<CharacterVirtualizationProviderResult> {
    const productAuthorization = request.authorization;
    if (!productAuthorization) {
      return mapExecutionFailure({ code: "PROVIDER_UNAVAILABLE", adapter: this.adapter, providerCallsUsed: 0 });
    }
    const authorization = authorizationFromRequest(request, this.adapter);
    if (!authorization) {
      return mapExecutionFailure({ code: "PROVIDER_UNAVAILABLE", adapter: this.adapter, providerCallsUsed: 0 });
    }
    let compiled: CreativeImageGenerationInput;
    try {
      compiled = compileCharacterVirtualizationCreativeImageRequest({
        request,
        authorization: productAuthorization,
      });
    } catch (error) {
      if (error instanceof AiStoryCharacterVirtualizerError) {
        return mapExecutionFailure({ code: "PROVIDER_RESULT_INVALID", adapter: this.adapter, providerCallsUsed: 0 });
      }
      throw error;
    }

    const result = await this.execution.execute({ request: compiled, authorization });
    if (result.status !== "SUCCEEDED") {
      const code =
        result.failure.code === "PROVIDER_REJECTED" ||
        result.failure.code === "PROVIDER_UNAVAILABLE" ||
        result.failure.code === "PROVIDER_RESULT_INVALID"
          ? result.failure.code
          : "PROVIDER_UNAVAILABLE";
      return mapExecutionFailure({
        code,
        adapter: this.adapter,
        providerCallsUsed: result.providerCallsUsed,
      });
    }

    const reported = result.output.usage?.providerReportedCost;
    const costUsd =
      reported && reported.currency === "USD" && Number.isFinite(reported.amount)
        ? reported.amount.toFixed(4)
        : null;
    const bytes = new Uint8Array(result.output.bytes);
    return {
      ok: true,
      bytes,
      mimeType: "image/png",
      width: CHARACTER_VIRTUALIZATION_OUTPUT.width,
      height: CHARACTER_VIRTUALIZATION_OUTPUT.height,
      provider: result.output.providerId,
      providerModel: result.output.modelId,
      providerAttemptId: randomUUID(),
      contentHash: hashCharacterVirtualizationBytes(bytes),
      operation: CHARACTER_VIRTUALIZATION_OPENAI_OPERATION,
      retries: CHARACTER_VIRTUALIZATION_MAX_RETRIES,
      realImageProviderCalls: boundedRealImageProviderCalls(result.providerCallsUsed),
      costUsd,
    };
  }
}

export function resolveCharacterVirtualizationRuntime(
  env: NodeJS.ProcessEnv = process.env
): {
  mode: "mock" | "creative-image";
  provider: CharacterVirtualizationProvider;
  adapterClass: string | null;
} {
  const mode = readCharacterVirtualizationProviderMode(env);
  if (mode === "mock") {
    return {
      mode,
      provider: new MockCharacterVirtualizationProvider("succeed"),
      adapterClass: null,
    };
  }
  try {
    const adapter = createOpenAiCreativeImageGenerationAdapter(env);
    return {
      mode,
      provider: new CreativeImageCharacterVirtualizationBridge(adapter),
      adapterClass: adapter.constructor.name,
    };
  } catch (error) {
    if (error instanceof CreativeImageAdapterError) {
      throw new AiStoryCharacterVirtualizerError(
        "VIRTUALIZATION_PROVIDER_UNAVAILABLE",
        "Character virtualization is not available."
      );
    }
    throw new AiStoryCharacterVirtualizerError(
      "VIRTUALIZATION_PROVIDER_UNAVAILABLE",
      "Character virtualization is not available."
    );
  }
}

export function compilePremium3dDryCertificationRequest(input: {
  orgId: string;
  workspaceId: string;
  sourceAssetId: string;
  sourceContentHash: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
  createdBy: string;
  createdAt: string;
  authorizationId: string;
  creativeDirection?: string | null;
}) {
  const compiledPrompt = compileCharacterVirtualizationPrompt({
    style: "PREMIUM_3D",
    creativeDirection: input.creativeDirection ?? "friendly SME spokesperson",
  });
  const request: CharacterVirtualizationProviderRequest = {
    sourceImage: {
      assetId: input.sourceAssetId,
      contentHash: input.sourceContentHash,
      mimeType: input.mimeType,
      width: 800,
      height: 1200,
      bytes: input.bytes,
    },
    style: "PREMIUM_3D",
    creativeDirection: input.creativeDirection ?? "friendly SME spokesperson",
    compiledPrompt,
    outputRequirements: {
      mimeType: CHARACTER_VIRTUALIZATION_OUTPUT.mimeType,
      width: CHARACTER_VIRTUALIZATION_OUTPUT.width,
      height: CHARACTER_VIRTUALIZATION_OUTPUT.height,
    },
    authorization: {
      authorizationId: input.authorizationId,
      executionIdentity: input.authorizationId,
      idempotencyKey: input.authorizationId,
      scope: { tenantId: input.orgId, workspaceId: input.workspaceId },
      authorizedBy: input.createdBy,
      authorizedAt: input.createdAt,
      maximumProviderCalls: 1,
    },
  };
  const creativeImageRequest = compileCharacterVirtualizationCreativeImageRequest({
    request,
    authorization: request.authorization!,
  });
  return {
    request,
    creativeImageRequest,
    plan: compileCharacterVirtualizationCreativeImagePlan({
      request,
      authorization: request.authorization!,
    }),
  };
}
