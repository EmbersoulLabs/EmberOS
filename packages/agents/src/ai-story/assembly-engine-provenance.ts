/**
 * Sprint 4 Phase A — real Assembly engine provenance from runtime evidence.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import {
  buildAssemblyEngineSnapshotContentHash,
  type AssemblyEngineSnapshotConfig,
} from "@ceo-agent/shared/server";

export type AssemblyEngineProvenanceEvidence = {
  readonly ffmpegPath: string;
  readonly ffmpegVersionText: string;
  readonly ffmpegVersion: string;
  readonly ffmpegBinaryHash: string | null;
  readonly workerBuildSha: string | null;
  readonly binaryHashFallbackReason?: string;
};

function parseFfmpegVersion(versionText: string): string {
  const match = /ffmpeg\s+version\s+([^\s]+)/i.exec(versionText);
  return match?.[1] ?? "unknown";
}

async function hashBinarySha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Collect verifiable ffmpeg provenance. Prefer binary SHA-256 when the path
 * resolves to a real file; otherwise document fallback risk.
 */
export async function collectAssemblyEngineProvenance(
  env: NodeJS.ProcessEnv = process.env
): Promise<AssemblyEngineProvenanceEvidence> {
  const ffmpegPath = env.FFMPEG_PATH?.trim() || "ffmpeg";
  let versionText = "";
  try {
    versionText = execFileSync(ffmpegPath, ["-version"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).slice(0, 2000);
  } catch (error) {
    throw new Error(
      `Unable to collect ffmpeg provenance: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const ffmpegVersion = parseFfmpegVersion(versionText);
  const workerBuildSha =
    env.EMBEROS_WORKER_BUILD_SHA?.trim() ||
    env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    env.SOURCE_VERSION?.trim() ||
    null;

  let ffmpegBinaryHash: string | null = null;
  let binaryHashFallbackReason: string | undefined;
  if (existsSync(ffmpegPath)) {
    try {
      ffmpegBinaryHash = await hashBinarySha256(ffmpegPath);
    } catch (error) {
      binaryHashFallbackReason = `binary hash failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  } else {
    binaryHashFallbackReason =
      "ffmpeg path is not a resolvable file (PATH lookup); binary hash unavailable";
  }

  return {
    ffmpegPath,
    ffmpegVersionText: versionText.split("\n")[0] ?? versionText,
    ffmpegVersion,
    ffmpegBinaryHash,
    workerBuildSha,
    ...(binaryHashFallbackReason ? { binaryHashFallbackReason } : {}),
  };
}

/**
 * Build deterministic Assembly engine snapshot hash from collected evidence.
 * Does not include wall-clock or random data.
 */
export function buildAssemblyEngineSnapshotHashFromProvenance(
  evidence: AssemblyEngineProvenanceEvidence
): string {
  const binaryBuildHash =
    evidence.ffmpegBinaryHash ??
    `sha256:${createHash("sha256")
      .update(
        JSON.stringify({
          kind: "ffmpeg-provenance-fallback",
          version: evidence.ffmpegVersion,
          versionText: evidence.ffmpegVersionText,
          workerBuildSha: evidence.workerBuildSha,
          reason: evidence.binaryHashFallbackReason ?? "unspecified",
        }),
        "utf8"
      )
      .digest("hex")}`;

  const config: AssemblyEngineSnapshotConfig = {
    engineName: "ember-story-assembly",
    engineContractVersion: "1",
    engineImplementationVersion: "1.0.0",
    binaryName: "ffmpeg",
    binaryVersion: evidence.ffmpegVersion,
    binaryBuildHash,
    operatingEnvironmentContractVersion: "1",
    containerFormat: "mp4",
    videoCodec: "h264",
    videoCodecProfile: "high",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    frameRatePolicy: "constant-30",
    targetFrameRate: 30,
    timeBasePolicy: "1/15360",
    audioSampleRate: 48000,
    audioChannelPolicy: "stereo",
    streamMappingPolicy: "video-first-audio-second",
    rotationNormalizationPolicy: "apply-and-strip",
    metadataStrippingPolicy: "strip-nonessential",
    timestampNormalizationPolicy: "frozen-constant",
    resolutionNormalizationPolicy: "scale-and-pad",
    aspectRatioNormalizationPolicy: "preserve-with-pad",
    normalizationPolicyVersion: "1",
  };
  return buildAssemblyEngineSnapshotContentHash(config);
}

let cachedSnapshotHash: string | undefined;

/**
 * Production snapshot hash — collected once per process, never placeholder ffff…
 */
export async function resolveProductionAssemblyEngineSnapshotHash(
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  if (env.EMBEROS_ASSEMBLY_ENGINE_SNAPSHOT_HASH?.trim()) {
    return env.EMBEROS_ASSEMBLY_ENGINE_SNAPSHOT_HASH.trim();
  }
  if (cachedSnapshotHash) return cachedSnapshotHash;
  const evidence = await collectAssemblyEngineProvenance(env);
  cachedSnapshotHash = buildAssemblyEngineSnapshotHashFromProvenance(evidence);
  return cachedSnapshotHash;
}

/** Test helper to clear process cache. */
export function resetAssemblyEngineSnapshotHashCache(): void {
  cachedSnapshotHash = undefined;
}
