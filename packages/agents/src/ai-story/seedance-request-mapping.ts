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
import type { ExecutionEnvelope } from "@ceo-agent/shared";
import {
  SEEDANCE_MAX_REFERENCE_IMAGES,
  SEEDANCE_SUPPORTED_ASPECT_RATIOS,
  SEEDANCE_SUPPORTED_DURATIONS_SEC,
  SEEDANCE_SUPPORTED_RESOLUTIONS,
} from "./seedance-capability";

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
  })
  .passthrough();

export type SeedanceModelArkTextContent = {
  readonly type: "text";
  readonly text: string;
};

export type SeedanceModelArkImageContent = {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
  readonly role: "reference_image" | "first_frame" | "last_frame";
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
  readonly watermark: false;
};

/** @deprecated Prefer SeedanceModelArkCreateRequest — kept for type alias clarity in tests. */
export type SeedanceGenerationRequest = SeedanceModelArkCreateRequest;

export class SeedanceMappingError extends Error {
  readonly code = "BUSINESS_VALIDATION_FAILED";
  readonly status = 400;

  constructor(message: string) {
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
    return "last_frame";
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
  const payload = CanonicalScenePayloadSchema.parse(payloadRaw);

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
    if (!uri && asset.storagePath) {
      if (looksLikePrivateStoragePath(asset.storagePath)) {
        if (!input.assetAccessResolver) {
          throw new SeedanceMappingError(
            "Private storage paths cannot be sent to Seedance; signed URI required"
          );
        }
        uri = await input.assetAccessResolver.resolveProviderAccessibleUri({
          assetId: asset.assetId,
          workspaceId: input.envelope.workspaceId,
          orgId: input.envelope.tenantId,
          storagePath: asset.storagePath,
        });
      } else {
        uri = asset.storagePath;
      }
    }
    if (!uri) {
      throw new SeedanceMappingError(
        `Reference asset ${asset.assetId} is missing a provider-accessible URI`
      );
    }
    content.push({
      type: "image_url",
      image_url: { url: assertHttpsUri(uri, `Asset ${asset.assetId}`) },
      role: mapImageRole(asset.role),
    });
  }

  return {
    model: input.model,
    content,
    duration,
    ratio,
    resolution,
    generate_audio: false,
    watermark: false,
  };
}
