/**
 * Sprint 3 PR 3.4B — Canonical Envelope → MiniMax Video V2 request.
 * MiniMax-specific fields remain Adapter-owned. Does not mutate Story/Scene identity.
 *
 * MiniMax create body (Video Generation V2 API):
 * {
 *   model, content[{type:text|image_url,...}],
 *   duration, ratio, resolution
 * }
 *
 * Does not send callback_url (callbacks unsupported in EmberOS V1).
 * Does not send undocumented idempotency fields.
 */
import { z } from "zod";
import type { ExecutionEnvelope } from "@ceo-agent/shared";
import {
  MINIMAX_MAX_REFERENCE_IMAGES,
  MINIMAX_SUPPORTED_ASPECT_RATIOS,
  MINIMAX_SUPPORTED_DURATIONS_SEC,
  MINIMAX_SUPPORTED_RESOLUTIONS,
} from "./minimax-capability";

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

export type MinimaxVideoV2TextContent = {
  readonly type: "text";
  readonly text: string;
};

export type MinimaxVideoV2ImageContent = {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
  readonly role: "reference_image" | "first_frame" | "last_frame";
};

export type MinimaxVideoV2ContentItem =
  | MinimaxVideoV2TextContent
  | MinimaxVideoV2ImageContent;

/**
 * Wire request body for POST /v2/video_generation
 */
export type MinimaxVideoV2CreateRequest = {
  readonly model: string;
  readonly content: readonly MinimaxVideoV2ContentItem[];
  readonly duration: number;
  readonly ratio: string;
  readonly resolution: string;
};

/** @deprecated Prefer MinimaxVideoV2CreateRequest — kept for type alias clarity in tests. */
export type MinimaxGenerationRequest = MinimaxVideoV2CreateRequest;

export class MinimaxMappingError extends Error {
  readonly code = "BUSINESS_VALIDATION_FAILED";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "MinimaxMappingError";
  }
}

export type MinimaxPayloadResolver = {
  resolve(reference: {
    readonly uri: string;
    readonly contentHash: string;
    readonly mediaType?: string;
  }): Promise<unknown>;
};

export type MinimaxAssetAccessResolver = {
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
  const supported: readonly number[] = MINIMAX_SUPPORTED_DURATIONS_SEC;
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

/**
 * Map canonical / friendly resolution labels onto MiniMax wire values.
 */
export function mapToMinimaxResolution(raw: string): string {
  const normalized = raw.trim();
  const upper = normalized.toUpperCase();
  if ((MINIMAX_SUPPORTED_RESOLUTIONS as readonly string[]).includes(upper)) {
    return upper === "768P" ? "768P" : upper;
  }
  const lower = normalized.toLowerCase();
  if (lower === "480p" || lower === "720p" || lower === "768p") {
    return "768P";
  }
  if (lower === "1080p" || lower === "2k") {
    return "2K";
  }
  throw new MinimaxMappingError(`Unsupported resolution: ${raw}`);
}

function assertHttpsUri(uri: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new MinimaxMappingError(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new MinimaxMappingError(`${label} must be an https URI`);
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
): MinimaxVideoV2ImageContent["role"] {
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
 * Map canonical Envelope + resolved payload into a MiniMax Video V2 create request.
 * Does not mutate Story Version, Scene order, Shot order, or authorization facts.
 *
 * `idempotencyKey` is EmberOS runtime correlation only (Envelope / Worker Attempt
 * identity). It is NOT transmitted to MiniMax — Provider-native idempotency is
 * unsupported for V1. Duplicate delivery protection remains via Worker replay
 * convergence on canonical identities.
 */
export async function mapCanonicalEnvelopeToMinimaxRequest(input: {
  readonly envelope: ExecutionEnvelope;
  /** EmberOS canonical idempotency identity — not sent to MiniMax. */
  readonly idempotencyKey: string;
  readonly model: string;
  readonly payloadResolver: MinimaxPayloadResolver;
  readonly assetAccessResolver?: MinimaxAssetAccessResolver;
}): Promise<MinimaxVideoV2CreateRequest> {
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
    throw new MinimaxMappingError("Canonical payload is missing a prompt");
  }
  if (prompt.length > 7000) {
    throw new MinimaxMappingError("Prompt exceeds MiniMax 7000 character limit");
  }

  // MiniMax has no first-class identity_constraints / shot_map fields.
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
  if (!(MINIMAX_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(ratio)) {
    throw new MinimaxMappingError(`Unsupported aspect ratio: ${ratio}`);
  }

  const resolution = mapToMinimaxResolution(payload.resolution ?? "768P");

  const assets = payload.assetReferences ?? [];
  if (assets.length > MINIMAX_MAX_REFERENCE_IMAGES) {
    throw new MinimaxMappingError(
      `MiniMax accepts at most ${MINIMAX_MAX_REFERENCE_IMAGES} reference images`
    );
  }

  const content: MinimaxVideoV2ContentItem[] = [
    { type: "text", text: prompt },
  ];

  let hasFirstOrLast = false;
  let hasReference = false;

  for (const asset of assets) {
    if (asset.mediaType && !asset.mediaType.startsWith("image/")) {
      throw new MinimaxMappingError(
        `Unsupported media type for MiniMax reference asset ${asset.assetId}`
      );
    }
    let uri = asset.uri;
    if (!uri && input.assetAccessResolver) {
      const campaignId = input.envelope.canonicalRequest.executionIdentity.campaignId;
      if (!campaignId) {
        throw new MinimaxMappingError(
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
        throw new MinimaxMappingError(
          "Private storage paths cannot be sent to MiniMax; signed URI required"
        );
      }
      uri = asset.storagePath;
    }
    if (!uri) {
      throw new MinimaxMappingError(
        `Reference asset ${asset.assetId} is missing a provider-accessible URI`
      );
    }
    const role = mapImageRole(asset.role);
    if (role === "first_frame" || role === "last_frame") {
      hasFirstOrLast = true;
    } else {
      hasReference = true;
    }
    content.push({
      type: "image_url",
      image_url: { url: assertHttpsUri(uri, `Asset ${asset.assetId}`) },
      role,
    });
  }

  // Official contract: image-to-video and reference-to-video are mutually exclusive.
  if (hasFirstOrLast && hasReference) {
    throw new MinimaxMappingError(
      "MiniMax cannot mix first_frame/last_frame with reference_image in one request"
    );
  }

  // Text-to-video requires a concrete ratio (already validated).
  // Image-to-video: Provider treats ratio as adaptive; still send mapped ratio for
  // wire completeness — Provider may ignore per docs.
  return {
    model: input.model,
    content,
    duration,
    ratio: hasFirstOrLast ? "adaptive" : ratio,
    resolution,
  };
}
