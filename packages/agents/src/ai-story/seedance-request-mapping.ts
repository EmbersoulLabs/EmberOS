/**
 * Sprint 3 PR 3.4A — Canonical Envelope → BytePlus ModelArk Seedance request.
 * Seedance-specific fields remain Adapter-owned. Does not mutate Story/Scene identity.
 *
 * ModelArk create body (Video Generation API):
 * {
 *   model, content[{type:text|image_url,...}],
 *   duration, ratio, resolution, generate_audio, watermark
 * }
 */
import { z } from "zod";
import {
  AiStoryCompiledProviderRequestSchema,
  AiStoryProviderWireModeContractError,
  AiStorySceneExecutionPackageSchema,
  assertAiStoryCompiledProviderWireModeCompatibility,
  type ExecutionEnvelope,
} from "@ceo-agent/shared";
import {
  SEEDANCE_MAX_REFERENCE_IMAGES,
  SEEDANCE_SELECTED_PRODUCT_GROUNDED_MODE,
  SEEDANCE_SUPPORTED_ASPECT_RATIOS,
  SEEDANCE_SUPPORTED_DURATIONS_SEC,
  SEEDANCE_SUPPORTED_RESOLUTIONS,
  seedanceSupportsFirstFrameI2v,
} from "./seedance-capability";
import {
  assertProductGroundingPreDispatch,
  PRODUCT_GROUNDED_VIDEO_MODE,
  ProductGroundingContractSchema,
  ProductVisualAuthorityCertificationSchema,
} from "./product-grounding-contract";
import { compileSceneExecutionPackageForSeedance } from "./seedance-director-adapter";
import { validateAiStoryCompiledRequestFingerprint } from "./provider-runtime-dispatch-integration";

const CanonicalScenePayloadSchema = z
  .object({
    prompt: z.string().min(1).optional(),
    negativePrompt: z.string().optional(),
    durationSec: z.number().positive().optional(),
    durationMs: z.number().positive().optional(),
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    assetReferences: z
      .array(
        z.object({
          assetId: z.string().uuid(),
          /** Provider-accessible URI only (https signed URL). Never raw private path. */
          uri: z.string().url().optional(),
          storagePath: z.string().optional(),
          role: z.string().default("product"),
          mediaType: z.string().optional(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
        })
      )
      .optional(),
    identityConstraints: z.array(z.string()).optional(),
    shotMap: z
      .array(
        z.object({
          shotId: z.string(),
          sceneId: z.string().optional(),
          order: z.number().int().nonnegative().optional(),
          sectionIndex: z.number().int().nonnegative().optional(),
          durationMs: z.number().positive().optional(),
        })
      )
      .optional(),
    kind: z.string().optional(),
    generationMode: z
      .enum(["PRODUCT_GROUNDED_VIDEO", "CREATIVE_T2V", "TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"])
      .optional(),
    watermark: z.boolean().optional(),
    productGrounding: ProductGroundingContractSchema.optional(),
    visualAuthorityCertification:
      ProductVisualAuthorityCertificationSchema.optional(),
  })
  .passthrough();

export type SeedanceModelArkTextContent = {
  readonly type: "text";
  readonly text: string;
};

export type SeedanceModelArkImageContent = {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
  readonly role: "reference_image" | "first_frame";
};

export type SeedanceModelArkContentItem =
  | SeedanceModelArkTextContent
  | SeedanceModelArkImageContent;

/**
 * Wire request body for POST /api/v3/contents/generations/tasks
 */
export type SeedanceModelArkCreateRequest = {
  readonly model: string;
  readonly content: readonly SeedanceModelArkContentItem[];
  readonly duration: number;
  readonly ratio: string;
  readonly resolution: string;
  readonly generate_audio: false;
  readonly watermark: boolean;
};

/** @deprecated Prefer SeedanceModelArkCreateRequest — kept for type alias clarity in tests. */
export type SeedanceGenerationRequest = SeedanceModelArkCreateRequest;

export class SeedanceMappingError extends Error {
  readonly status = 400;

  constructor(
    message: string,
    readonly code:
      | "BUSINESS_VALIDATION_FAILED"
      | "SEEDANCE_FIRST_FRAME_I2V_WIRE_MODE_INVALID" = "BUSINESS_VALIDATION_FAILED"
  ) {
    super(message);
    this.name = "SeedanceMappingError";
  }
}

export type SeedancePayloadResolver = {
  resolve(reference: {
    readonly uri: string;
    readonly contentHash: string;
    readonly mediaType?: string;
  }): Promise<unknown>;
};

export type SeedanceAssetAccessResolver = {
  /**
   * Turn an authorized Campaign Asset into a provider-accessible HTTPS URI.
   * Must not return raw private storage paths.
   */
  resolveProviderAccessibleUri(input: {
    readonly assetId: string;
    readonly workspaceId: string;
    readonly orgId: string;
    readonly campaignId: string;
    readonly storagePath?: string;
    readonly existingUri?: string;
  }): Promise<string>;
};

function nearestSupportedDuration(seconds: number): number {
  const supported: readonly number[] = SEEDANCE_SUPPORTED_DURATIONS_SEC;
  let best = supported[0]!;
  let bestDelta = Math.abs(best - seconds);
  for (const candidate of supported) {
    const delta = Math.abs(candidate - seconds);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

function assertHttpsUri(uri: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new SeedanceMappingError(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new SeedanceMappingError(`${label} must be an https URI`);
  }
  return uri;
}

function looksLikePrivateStoragePath(value: string): boolean {
  return (
    !/^https?:\/\//i.test(value) &&
    (/\/library\//.test(value) || /^[0-9a-f-]{36}\//i.test(value))
  );
}

function mapImageRole(
  role: string
): SeedanceModelArkImageContent["role"] {
  const normalized = role.trim().toLowerCase();
  if (normalized === "first_frame" || normalized === "first-frame") {
    return "first_frame";
  }
  if (normalized === "last_frame" || normalized === "last-frame") {
    throw new SeedanceMappingError("Seedance last-frame conditioning is not certified for EmberOS V1");
  }
  return "reference_image";
}

/**
 * Map canonical Envelope + resolved payload into a ModelArk create request.
 * Does not mutate Story Version, Scene order, Shot order, or authorization facts.
 *
 * `idempotencyKey` is EmberOS runtime correlation only (Envelope / Worker Attempt
 * identity). It is NOT transmitted to ModelArk — Provider-native idempotency is
 * unsupported for V1. Duplicate delivery protection remains via Worker replay
 * convergence on canonical identities.
 */
export async function mapCanonicalEnvelopeToSeedanceRequest(input: {
  readonly envelope: ExecutionEnvelope;
  /** EmberOS canonical idempotency identity — not sent to Seedance. */
  readonly idempotencyKey: string;
  readonly model: string;
  readonly payloadResolver: SeedancePayloadResolver;
  readonly assetAccessResolver?: SeedanceAssetAccessResolver;
}): Promise<SeedanceModelArkCreateRequest> {
  const payloadRaw = await input.payloadResolver.resolve(
    input.envelope.canonicalRequest.normalizedPayloadReference
  );
  const compiledRequestResult = AiStoryCompiledProviderRequestSchema.safeParse(payloadRaw);
  if (
    typeof payloadRaw === "object" &&
    payloadRaw !== null &&
    "contractVersion" in payloadRaw &&
    payloadRaw.contractVersion === "ai-story-compiled-provider-request.v1" &&
    !compiledRequestResult.success
  ) {
    throw new SeedanceMappingError("Immutable compiled Provider request is invalid");
  }
  if (compiledRequestResult.success && !validateAiStoryCompiledRequestFingerprint(compiledRequestResult.data)) {
    throw new SeedanceMappingError("Immutable compiled Provider request fingerprint mismatch");
  }
  if (compiledRequestResult.success) {
    try {
      assertAiStoryCompiledProviderWireModeCompatibility(compiledRequestResult.data);
    } catch (error) {
      if (error instanceof AiStoryProviderWireModeContractError) {
        throw new SeedanceMappingError(error.message, error.code);
      }
      throw error;
    }
  }
  const packageResult = AiStorySceneExecutionPackageSchema.safeParse(payloadRaw);
  if (
    typeof payloadRaw === "object" &&
    payloadRaw !== null &&
    "contractVersion" in payloadRaw &&
    payloadRaw.contractVersion === "ai-story-scene-execution-package.v1" &&
    !packageResult.success
  ) {
    throw new SeedanceMappingError("Canonical Scene execution package is invalid; legacy payload fallback is denied");
  }
  const directorCompilation = !compiledRequestResult.success && packageResult.success
    ? compileSceneExecutionPackageForSeedance(packageResult.data)
    : null;
  if (directorCompilation && directorCompilation.requestFacts.model !== input.model) {
    throw new SeedanceMappingError("Scene execution package model binding does not match the configured Seedance model");
  }
  const payload = CanonicalScenePayloadSchema.parse(
    compiledRequestResult.success
      ? {
          prompt: compiledRequestResult.data.compiledPrompt,
          durationSec: compiledRequestResult.data.structuredRequest.duration,
          aspectRatio: compiledRequestResult.data.structuredRequest.ratio,
          resolution: compiledRequestResult.data.structuredRequest.resolution,
          watermark: compiledRequestResult.data.structuredRequest.watermark,
          generationMode: compiledRequestResult.data.generationMode,
          assetReferences: compiledRequestResult.data.referenceMappings.map((reference) => ({
            assetId: reference.assetId,
            ...(reference.storagePath ? { storagePath: reference.storagePath } : {}),
            ...(reference.mediaType ? { mediaType: reference.mediaType } : {}),
            role: reference.wireRole,
          })),
        }
      : directorCompilation
      ? {
          prompt: directorCompilation.prompt,
          durationSec: directorCompilation.requestFacts.duration,
          aspectRatio: directorCompilation.requestFacts.ratio,
          resolution: directorCompilation.requestFacts.resolution,
          watermark: directorCompilation.requestFacts.watermark,
          generationMode: directorCompilation.requestFacts.generationMode,
          assetReferences: directorCompilation.selectedReferences.map((reference) => ({
            assetId: reference.assetId,
            ...(reference.uri ? { uri: reference.uri } : {}),
            ...(reference.storagePath ? { storagePath: reference.storagePath } : {}),
            ...(reference.mediaType ? { mediaType: reference.mediaType } : {}),
            role: reference.firstFrame ? "first_frame" : "reference_image",
          })),
        }
      : payloadRaw
  );

  let prompt =
    payload.prompt?.trim() ||
    (typeof payload.kind === "string" && payload.kind.length > 0
      ? `Generate animation video for ${payload.kind}`
      : "");
  if (!prompt) {
    throw new SeedanceMappingError("Canonical payload is missing a prompt");
  }

  // ModelArk has no first-class identity_constraints / shot_map fields.
  // Fold Adapter-owned constraints into the text content only.
  if (payload.identityConstraints && payload.identityConstraints.length > 0) {
    prompt = `${prompt}\nConstraints: ${payload.identityConstraints.join("; ")}`;
  }
  if (payload.negativePrompt?.trim()) {
    prompt = `${prompt}\nAvoid: ${payload.negativePrompt.trim()}`;
  }
  if (payload.shotMap && payload.shotMap.length > 0) {
    const ordered = [...payload.shotMap].sort(
      (left, right) =>
        (left.order ?? left.sectionIndex ?? 0) -
        (right.order ?? right.sectionIndex ?? 0)
    );
    prompt = `${prompt}\nShot order: ${ordered
      .map((shot, index) => `${index + 1}:${shot.shotId}`)
      .join(", ")}`;
  }

  const durationSec =
    payload.durationSec ??
    (payload.durationMs ? payload.durationMs / 1000 : 5);
  const duration = nearestSupportedDuration(durationSec);

  const ratio = payload.aspectRatio ?? "9:16";
  if (!(SEEDANCE_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(ratio)) {
    throw new SeedanceMappingError(`Unsupported aspect ratio: ${ratio}`);
  }

  const resolution = payload.resolution ?? "1080p";
  if (!(SEEDANCE_SUPPORTED_RESOLUTIONS as readonly string[]).includes(resolution)) {
    throw new SeedanceMappingError(`Unsupported resolution: ${resolution}`);
  }

  const assets = payload.assetReferences ?? [];
  const firstFrameMode =
    payload.generationMode === PRODUCT_GROUNDED_VIDEO_MODE ||
    payload.generationMode === "FIRST_FRAME_IMAGE_TO_VIDEO";
  if (payload.generationMode === PRODUCT_GROUNDED_VIDEO_MODE) {
    if (!payload.productGrounding) {
      throw new SeedanceMappingError(
        "Product-grounded Provider dispatch requires a grounding contract"
      );
    }
    const certification = payload.visualAuthorityCertification;
    const trace = input.envelope.executionContext.trace ?? {};
    if (
      !certification ||
      certification.orgId !== input.envelope.tenantId ||
      certification.workspaceId !== input.envelope.workspaceId ||
      certification.campaignId !==
        input.envelope.canonicalRequest.executionIdentity.campaignId ||
      certification.executionPlanId !== trace.executionPlanId ||
      certification.sceneExecutionId !== trace.sceneExecutionId
    ) {
      throw new SeedanceMappingError(
        "Product visual authority uncertified: certification does not match the Execution Envelope"
      );
    }
    try {
      assertProductGroundingPreDispatch({
        grounding: payload.productGrounding,
        visualAuthorityCertification:
          payload.visualAuthorityCertification,
        prompt,
        assetReferences: assets,
      });
    } catch (error) {
      throw new SeedanceMappingError(
        String((error as { message?: string })?.message ?? error)
      );
    }
    if (
      payload.productGrounding.providerMode !==
      SEEDANCE_SELECTED_PRODUCT_GROUNDED_MODE
    ) {
      throw new SeedanceMappingError(
        "Seedance PRODUCT_GROUNDED_VIDEO requires certified FIRST_FRAME_I2V"
      );
    }
    if (!seedanceSupportsFirstFrameI2v(input.model)) {
      throw new SeedanceMappingError(
        `Seedance model ${input.model} is not certified for FIRST_FRAME_I2V`
      );
    }
  }
  if (assets.length > SEEDANCE_MAX_REFERENCE_IMAGES) {
    throw new SeedanceMappingError(
      `Seedance accepts at most ${SEEDANCE_MAX_REFERENCE_IMAGES} reference images`
    );
  }

  const content: SeedanceModelArkContentItem[] = [
    { type: "text", text: prompt },
  ];

  for (const asset of assets) {
    if (asset.mediaType && !asset.mediaType.startsWith("image/")) {
      throw new SeedanceMappingError(
        `Unsupported media type for Seedance reference asset ${asset.assetId}`
      );
    }
    let uri = asset.uri;
    if (!uri && input.assetAccessResolver) {
      const campaignId = input.envelope.canonicalRequest.executionIdentity.campaignId;
      if (!campaignId) {
        throw new SeedanceMappingError(
          "Campaign authority is required to resolve a product reference"
        );
      }
      uri = await input.assetAccessResolver.resolveProviderAccessibleUri({
        assetId: asset.assetId,
        workspaceId: input.envelope.workspaceId,
        orgId: input.envelope.tenantId,
        campaignId,
        ...(asset.storagePath ? { storagePath: asset.storagePath } : {}),
      });
    } else if (!uri && asset.storagePath) {
      if (looksLikePrivateStoragePath(asset.storagePath)) {
        throw new SeedanceMappingError(
          "Private storage paths cannot be sent to Seedance; signed URI required"
        );
      }
      uri = asset.storagePath;
    }
    if (!uri) {
      throw new SeedanceMappingError(
        `Reference asset ${asset.assetId} is missing a provider-accessible URI`
      );
    }
    content.push({
      type: "image_url",
      image_url: { url: assertHttpsUri(uri, `Asset ${asset.assetId}`) },
      role:
        firstFrameMode &&
        (asset.role === "first_frame" ||
          (payload.productGrounding?.providerMode === "FIRST_FRAME_I2V" &&
            payload.productGrounding.primaryAuthority.assetId === asset.assetId))
          ? "first_frame"
          : mapImageRole(asset.role),
    });
  }

  if (firstFrameMode) {
    const firstFrames = content.filter(
      (item): item is SeedanceModelArkImageContent =>
        item.type === "image_url" && item.role === "first_frame"
    );
    if (firstFrames.length !== 1) {
      throw new SeedanceMappingError(
        "Seedance FIRST_FRAME_I2V requires exactly one canonical first frame"
      );
    }
    const referenceImages = content.filter(
      (item): item is SeedanceModelArkImageContent =>
        item.type === "image_url" && item.role === "reference_image"
    );
    if (referenceImages.length !== 0 || content.filter((item) => item.type === "image_url").length !== 1) {
      throw new SeedanceMappingError(
        "Seedance FIRST_FRAME_IMAGE_TO_VIDEO forbids reference_image inputs",
        "SEEDANCE_FIRST_FRAME_I2V_WIRE_MODE_INVALID"
      );
    }
  }

  return {
    model: input.model,
    content,
    duration,
    ratio,
    resolution,
    generate_audio: false,
    watermark: payload.watermark ?? false,
  };
}
