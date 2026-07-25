import { stat } from "node:fs/promises";
import {
  RENDER_PROVIDER_CONTRACT_VERSION,
  renderFingerprint,
  validateRenderRequest,
  type RenderProvider,
  type RenderProviderCapability,
  type RenderRequest,
  type RenderResult,
} from "./contracts";
import { hexToAssColor } from "@ceo-agent/shared";
import {
  extractCover,
  extractCoverFromImage,
  probeVideo,
  renderVideo,
  type RenderAssetMap,
} from "../ffmpeg/pipeline";
import { extractBrandColorFromLogo } from "../ffmpeg/brand-color";

const CAPABILITIES = new Set<RenderProviderCapability>([
  "VIDEO",
  "IMAGE",
  "SUBTITLES",
  "VOICEOVER",
  "BGM",
  "BRAND_OVERLAY",
  "CACHE",
  "COVER",
]);

export class FFmpegRenderProvider implements RenderProvider {
  readonly id = "legacy-ffmpeg";
  readonly version = "1";

  capabilities(): ReadonlySet<RenderProviderCapability> {
    return CAPABILITIES;
  }

  async execute(
    request: RenderRequest,
    onProgress?: Parameters<RenderProvider["execute"]>[1]
  ): Promise<RenderResult> {
    const canonicalRequest = validateRenderRequest(request);
    const editPlan = canonicalRequest.legacyEditPlan;
    if (!editPlan) {
      throw new Error("Legacy FFmpeg provider requires a compatibility EditPlan");
    }

    const assets: RenderAssetMap = new Map(
      canonicalRequest.sourceAssets.map((asset) => [
        asset.assetId,
        { path: asset.uri, type: asset.mediaType },
      ])
    );
    if (assets.size === 0 && !canonicalRequest.cachedBaseUri) {
      throw new Error("No render source assets");
    }

    let sourceDurationSec = canonicalRequest.sourceDurationSec ?? 0;
    const sourceVideo = canonicalRequest.sourceAssets.find(
      (asset) => asset.mediaType === "video"
    );
    if (sourceDurationSec <= 0 && sourceVideo) {
      try {
        sourceDurationSec = (await probeVideo(sourceVideo.uri)).durationSec;
      } catch {
        sourceDurationSec = editPlan.targetDurationSec;
      }
    }

    let brandColorAss: string | null = null;
    if (canonicalRequest.branding?.logoUri) {
      try {
        const workDir =
          canonicalRequest.destinations.outputUri.replace(/[\\/][^\\/]+$/, "") || ".";
        brandColorAss = hexToAssColor(
          await extractBrandColorFromLogo(canonicalRequest.branding.logoUri, workDir)
        );
      } catch {
        brandColorAss = null;
      }
    }

    const { usedCache } = await renderVideo(
      assets,
      editPlan,
      canonicalRequest.destinations.outputUri,
      canonicalRequest.outputProfile.mode,
      {
        cachedBasePath: canonicalRequest.cachedBaseUri,
        cacheOutputPath: canonicalRequest.destinations.cacheOutputUri,
        sourceDurationSec,
        onProgress,
        profileKey: canonicalRequest.outputProfile.profileKey,
        logoPath: canonicalRequest.branding?.logoUri,
        brandColorAss,
      }
    );

    if (canonicalRequest.destinations.coverOutputUri && canonicalRequest.cover) {
      const coverAsset = canonicalRequest.cover.sourceAssetId
        ? canonicalRequest.sourceAssets.find(
            (asset) => asset.assetId === canonicalRequest.cover?.sourceAssetId
          )
        : undefined;
      if (coverAsset?.mediaType === "image") {
        await extractCoverFromImage(
          coverAsset.uri,
          canonicalRequest.destinations.coverOutputUri
        );
      } else {
        const coverSource =
          canonicalRequest.cachedBaseUri ??
          coverAsset?.uri ??
          sourceVideo?.uri ??
          canonicalRequest.destinations.outputUri;
        await extractCover(
          coverSource,
          canonicalRequest.cover.atSec,
          canonicalRequest.destinations.coverOutputUri
        );
      }
    }

    const outputStat = await stat(canonicalRequest.destinations.outputUri);
    const outputReferences = [
      {
        uri: canonicalRequest.destinations.outputUri,
        mediaType: "video" as const,
        role: "output" as const,
      },
    ];
    const coverReferences = canonicalRequest.destinations.coverOutputUri
      ? [
          {
            uri: canonicalRequest.destinations.coverOutputUri,
            mediaType: "image" as const,
            role: "cover" as const,
          },
        ]
      : [];
    const cacheReferences =
      canonicalRequest.destinations.cacheOutputUri && !usedCache
        ? [
            {
              uri: canonicalRequest.destinations.cacheOutputUri,
              mediaType: "video" as const,
              role: "cache" as const,
            },
          ]
        : [];
    const resultBody = {
      requestKey: canonicalRequest.retry.deterministicKey,
      specificationKey: canonicalRequest.renderSpecification.deterministicKey,
      outputReferences,
      coverReferences,
      cacheReferences,
      fileSizeBytes: outputStat.size,
    };

    return {
      contractVersion: RENDER_PROVIDER_CONTRACT_VERSION,
      status: "COMPLETED",
      outputReferences: [...outputReferences, ...cacheReferences],
      previewReferences:
        canonicalRequest.outputProfile.mode === "preview" ? outputReferences : [],
      coverReferences,
      durationSec: canonicalRequest.renderSpecification.timing.durationSec,
      resolution: {
        width: canonicalRequest.qualityProfile.width,
        height: canonicalRequest.qualityProfile.height,
      },
      fileSizeBytes: outputStat.size,
      fingerprint: renderFingerprint(resultBody),
      providerMetadata: {
        providerId: this.id,
        providerVersion: this.version,
        details: { usedCache },
      },
      correlation: canonicalRequest.correlation,
      warnings: [],
      provenance: [
        {
          providerId: this.id,
          sourceAssetIds: canonicalRequest.sourceAssets.map((asset) => asset.assetId),
          renderSpecificationKey:
            canonicalRequest.renderSpecification.deterministicKey,
          correlationId: canonicalRequest.correlation.correlationId,
          timestamp: new Date().toISOString(),
        },
      ],
      usedCache,
    };
  }
}
