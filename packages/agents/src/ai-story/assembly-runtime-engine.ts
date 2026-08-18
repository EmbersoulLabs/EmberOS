/**
 * Sprint 3 PR 3.6 — provider-independent deterministic assembly engine (FFmpeg).
 * Uses explicit process arguments only. Never logs signed URLs or credentials.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ASSEMBLY_ENGINE_VERSION,
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  ASSEMBLY_RUNTIME_CONTRACT_VERSION,
  AssemblyArtifactSchema,
  buildAssemblyArtifactId,
  buildAssemblyExecutionIdentity,
  redactSensitiveAssemblyValue,
  type AssemblyArtifact,
  type AssemblyNormalizationPlan,
  type AssemblyRuntimeFailureClassification,
  type AssemblyRuntimeInput,
  type AssemblyMediaProbe,
} from "@ceo-agent/shared/server";
import type { AssemblyMediaAccessPort } from "./assembly-runtime-media-access";
import { probeAssemblyMedia } from "./assembly-runtime-media-probe";
import {
  buildAssemblyNormalizationPlan,
  buildNormalizationFilter,
} from "./assembly-runtime-normalization";

const execFileAsync = promisify(execFile);
const FFMPEG_QUIET = ["-hide_banner", "-loglevel", "error", "-nostats"] as const;

export class AssemblyEngineError extends Error {
  constructor(
    readonly classification: AssemblyRuntimeFailureClassification,
    message: string
  ) {
    super(message);
    this.name = "AssemblyEngineError";
  }
}

function getFfmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

async function runFfmpeg(args: string[], timeoutMs = 120_000): Promise<void> {
  try {
    await execFileAsync(getFfmpegPath(), [...FFMPEG_QUIET, ...args], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ffmpeg failed";
    throw new AssemblyEngineError(
      "ASSEMBLY_CONCATENATION_FAILED",
      redactSensitiveAssemblyValue(message).slice(0, 200)
    );
  }
}

async function normalizeScene(input: {
  readonly sourcePath: string;
  readonly outputPath: string;
  readonly plan: AssemblyNormalizationPlan;
  readonly hasAudio: boolean;
}): Promise<void> {
  const filter = buildNormalizationFilter(input.plan);
  const args: string[] = ["-y", "-i", input.sourcePath];
  if (!input.hasAudio) {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  args.push("-map", "0:v:0");
  if (input.hasAudio) {
    args.push("-map", "0:a:0");
  } else {
    args.push("-map", "1:a:0", "-shortest");
  }
  args.push(
    "-vf",
    filter,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    input.plan.pixelFormat,
    "-r",
    String(input.plan.targetFrameRate),
    "-c:a",
    "aac",
    "-ar",
    String(input.plan.audioSampleRate),
    "-ac",
    String(input.plan.audioChannels),
    "-movflags",
    "+faststart",
    input.outputPath
  );
  try {
    await runFfmpeg(args);
  } catch {
    throw new AssemblyEngineError(
      "ASSEMBLY_NORMALIZATION_FAILED",
      "Deterministic scene normalization failed"
    );
  }
}

export type AssemblyEngineResult = {
  readonly artifact: Omit<
    AssemblyArtifact,
    "artifactReference" | "ownership" | "executionPlanId" | "createdAt"
  > & {
    readonly localOutputPath: string;
    readonly probes: readonly AssemblyMediaProbe[];
    readonly normalizationPlan: AssemblyNormalizationPlan;
    readonly executionIdentity: string;
    readonly workDir: string;
  };
};

export async function runDeterministicAssemblyEngine(input: {
  readonly runtimeInput: AssemblyRuntimeInput;
  readonly mediaAccess: AssemblyMediaAccessPort;
  readonly workDir?: string;
}): Promise<AssemblyEngineResult> {
  const workDir =
    input.workDir ??
    (await mkdtemp(join(tmpdir(), `ember-assembly-${input.runtimeInput.assemblyJobId.slice(0, 8)}-`)));
  await mkdir(workDir, { recursive: true });

  const executionIdentity = buildAssemblyExecutionIdentity({
    executionPlanId: input.runtimeInput.executionPlanId,
    assemblyDefinitionId: input.runtimeInput.assemblyDefinitionId,
    assemblyJobId: input.runtimeInput.assemblyJobId,
    orderedSceneResultIds: input.runtimeInput.orderedScenes.map((scene) => scene.sceneResultId),
    orderedSceneContentHashes: input.runtimeInput.orderedScenes.map((scene) => scene.contentHash),
    assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
    assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  });

  const localPaths: string[] = [];
  const probes: AssemblyMediaProbe[] = [];
  try {
    for (const scene of input.runtimeInput.orderedScenes) {
      const resolved = await input.mediaAccess.resolveToLocalPath({
        ownership: input.runtimeInput.ownership,
        scene,
        workDir,
      });
      localPaths.push(resolved.localPath);
      const probe = await probeAssemblyMedia({
        sceneResultId: scene.sceneResultId,
        localPath: resolved.localPath,
      });
      // Strict path: probed bytes must match Scene Result contentHash.
      // HTTPS Provider ingest (Phase F) may attest the plan-bound URI-derived
      // placeholder via mediaAccess until durable workspace object keys exist.
      // In that case mediaAccess returns contentHash === scene.contentHash while
      // probed bytes differ; honor the attestation without weakening local/fixture
      // paths that do not attest.
      const bytesMatch = probe.contentHash === scene.contentHash;
      const mediaAccessAttestsPlanHash =
        resolved.contentHash === scene.contentHash;
      if (!bytesMatch && !mediaAccessAttestsPlanHash) {
        throw new AssemblyEngineError(
          "ASSEMBLY_MEDIA_HASH_MISMATCH",
          "Scene media content hash mismatch"
        );
      }
      probes.push(probe);
    }

    const plan = buildAssemblyNormalizationPlan(probes);
    const normalizedPaths: string[] = [];
    for (let index = 0; index < localPaths.length; index++) {
      const normalizedPath = join(workDir, `norm-${index}.mp4`);
      await normalizeScene({
        sourcePath: localPaths[index]!,
        outputPath: normalizedPath,
        plan,
        hasAudio: probes[index]!.hasAudio,
      });
      normalizedPaths.push(normalizedPath);
    }

    const outputPath = join(workDir, "assembled.mp4");
    if (normalizedPaths.length === 1) {
      await copyFile(normalizedPaths[0]!, outputPath);
    } else {
      const listPath = join(workDir, "concat.txt");
      const list = normalizedPaths
        .map((path) => `file '${path.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
        .join("\n");
      await writeFile(listPath, list, "utf8");
      await runFfmpeg([
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputPath,
      ]);
    }

    const outputProbe = await probeAssemblyMedia({
      sceneResultId: input.runtimeInput.orderedScenes[0]!.sceneResultId,
      localPath: outputPath,
    });
    const expectedDuration = probes.reduce((sum, probe) => sum + probe.durationMs, 0);
    if (outputProbe.durationMs < expectedDuration * 0.85) {
      throw new AssemblyEngineError(
        "ASSEMBLY_OUTPUT_INVALID",
        "Assembled output duration is unexpectedly short"
      );
    }

    const bytes = await readFile(outputPath);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const artifactId = buildAssemblyArtifactId(executionIdentity);

    return {
      artifact: {
        artifactId,
        assemblyJobId: input.runtimeInput.assemblyJobId,
        contentHash,
        mediaType: "video/mp4",
        durationMs: outputProbe.durationMs,
        width: plan.targetWidth,
        height: plan.targetHeight,
        frameRate: plan.targetFrameRate,
        byteSize: bytes.byteLength,
        assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
        normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
        assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
        integrityHash: createHash("sha256")
          .update(
            JSON.stringify({
              artifactId,
              contentHash,
              executionIdentity,
            })
          )
          .digest("hex")
          .replace(/^/, "sha256:"),
        localOutputPath: outputPath,
        probes,
        normalizationPlan: plan,
        executionIdentity,
        workDir,
      },
    };
  } catch (error) {
    if (error instanceof AssemblyEngineError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "classification" in error &&
      typeof (error as { classification: unknown }).classification === "string"
    ) {
      throw new AssemblyEngineError(
        (error as { classification: AssemblyRuntimeFailureClassification }).classification,
        error instanceof Error ? error.message : "Assembly engine failed"
      );
    }
    throw new AssemblyEngineError(
      "ASSEMBLY_INFRASTRUCTURE_TERMINAL",
      "Assembly engine failed"
    );
  }
}

export async function cleanupAssemblyWorkDir(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true });
}

export function validateAssemblyArtifact(artifact: AssemblyArtifact): AssemblyArtifact {
  return AssemblyArtifactSchema.parse(artifact);
}
