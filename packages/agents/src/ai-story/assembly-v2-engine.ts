import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  AiStoryAssemblyV2ExecutionEvidenceSchema,
  AiStoryAssemblyV2PlanSchema,
  computeAiStoryAssemblyV2Fingerprint,
  type AiStoryAssemblyV2ExecutionEvidence,
  type AiStoryAssemblyV2FailureCode,
  type AiStoryAssemblyV2Plan,
} from "@ceo-agent/shared/server";
import { hashFileSha256 } from "./assembly-runtime-media-access";
import { probeAssemblyMedia } from "./assembly-runtime-media-probe";

const execFileAsync = promisify(execFile);
const QUIET = ["-hide_banner", "-loglevel", "error", "-nostats"] as const;

export class AiStoryAssemblyV2ExecutionError extends Error {
  constructor(
    readonly code: AiStoryAssemblyV2FailureCode,
    message: string
  ) {
    super(message);
    this.name = "AiStoryAssemblyV2ExecutionError";
  }
}

export type AiStoryAssemblyV2ExecutionResult = {
  readonly outputPath: string;
  readonly contentHash: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly byteSize: number;
  readonly evidence: AiStoryAssemblyV2ExecutionEvidence;
  readonly workDir: string;
};

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

async function runFfmpeg(
  args: readonly string[],
  code: AiStoryAssemblyV2FailureCode,
  timeoutMs = 120_000
): Promise<void> {
  try {
    await execFileAsync(ffmpegPath(), [...QUIET, ...args], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    });
  } catch {
    throw new AiStoryAssemblyV2ExecutionError(code, "Assembly V2 media execution failed");
  }
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(6);
}

async function normalizeTrimmedEntry(input: {
  sourcePath: string;
  outputPath: string;
  startMs: number;
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
}): Promise<void> {
  await runFfmpeg(
    [
      "-y",
      "-i",
      input.sourcePath,
      "-ss",
      seconds(input.startMs),
      "-t",
      seconds(input.durationMs),
      "-map",
      "0:v:0",
      "-vf",
      `scale=${input.width}:${input.height}:flags=lanczos,fps=${input.frameRate},format=yuv420p,setpts=PTS-STARTPTS`,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
    "ASSEMBLY_V2_ENGINE_FAILED"
  );
}

async function composeHardCut(input: {
  currentPath: string;
  nextPath: string;
  outputPath: string;
  frameRate: number;
}): Promise<void> {
  await runFfmpeg(
    [
      "-y",
      "-i",
      input.currentPath,
      "-i",
      input.nextPath,
      "-filter_complex",
      "[0:v]settb=AVTB,setpts=PTS-STARTPTS[v0];[1:v]settb=AVTB,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-r",
      String(input.frameRate),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
    "ASSEMBLY_V2_ENGINE_FAILED"
  );
}

async function composeDissolve(input: {
  currentPath: string;
  nextPath: string;
  outputPath: string;
  currentDurationMs: number;
  dissolveDurationMs: number;
  frameRate: number;
}): Promise<void> {
  const offsetMs = input.currentDurationMs - input.dissolveDurationMs;
  if (offsetMs < 0 || input.dissolveDurationMs <= 0) {
    throw new AiStoryAssemblyV2ExecutionError(
      "TRIM_WINDOW_INVALID",
      "Dissolve overlap exceeds available media"
    );
  }
  await runFfmpeg(
    [
      "-y",
      "-i",
      input.currentPath,
      "-i",
      input.nextPath,
      "-filter_complex",
      `[0:v]settb=AVTB,setpts=PTS-STARTPTS[v0];[1:v]settb=AVTB,setpts=PTS-STARTPTS[v1];[v0][v1]xfade=transition=fade:duration=${seconds(input.dissolveDurationMs)}:offset=${seconds(offsetMs)}[v]`,
      "-map",
      "[v]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-r",
      String(input.frameRate),
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      input.outputPath,
    ],
    "ASSEMBLY_V2_ENGINE_FAILED"
  );
}

function assertPlanIntegrity(plan: AiStoryAssemblyV2Plan): void {
  const parsed = AiStoryAssemblyV2PlanSchema.parse(plan);
  const fingerprint = computeAiStoryAssemblyV2Fingerprint(parsed);
  if (fingerprint !== parsed.assemblyFingerprint) {
    throw new AiStoryAssemblyV2ExecutionError(
      "EDITORIAL_PLAN_FINGERPRINT_MISMATCH",
      "Assembly V2 Plan changed after compilation"
    );
  }
}

export async function runAiStoryAssemblyV2(input: {
  readonly plan: AiStoryAssemblyV2Plan;
  readonly sourcePathByResultId: ReadonlyMap<string, string>;
  readonly workDir?: string;
  readonly outputPath?: string;
  readonly now?: () => Date;
}): Promise<AiStoryAssemblyV2ExecutionResult> {
  assertPlanIntegrity(input.plan);
  const now = input.now ?? (() => new Date());
  const executionStartedAt = now().toISOString();
  const workDir =
    input.workDir ??
    (await mkdtemp(join(tmpdir(), `ember-assembly-v2-${input.plan.assemblyV2PlanId.slice(0, 8)}-`)));
  await mkdir(workDir, { recursive: true });

  const normalizedPaths: string[] = [];
  for (const [index, entry] of input.plan.resolvedTimeline.entries()) {
    const sourcePath = input.sourcePathByResultId.get(entry.sourceResultId);
    if (!sourcePath) {
      throw new AiStoryAssemblyV2ExecutionError(
        "SOURCE_MEDIA_MISSING",
        `Exact source ${entry.sourceResultId} is unavailable`
      );
    }
    let sourceStats;
    try {
      sourceStats = await stat(sourcePath);
    } catch {
      throw new AiStoryAssemblyV2ExecutionError(
        "SOURCE_MEDIA_MISSING",
        `Exact source ${entry.sourceResultId} is unavailable`
      );
    }
    if (sourceStats.size <= 0) {
      throw new AiStoryAssemblyV2ExecutionError(
        "SOURCE_MEDIA_MISSING",
        "Source media is empty"
      );
    }
    const contentHash = await hashFileSha256(sourcePath);
    if (contentHash !== entry.sourceContentHash) {
      throw new AiStoryAssemblyV2ExecutionError(
        "SOURCE_HASH_MISMATCH",
        "Source media changed after Assembly V2 planning"
      );
    }
    let probe;
    try {
      probe = await probeAssemblyMedia({
        sceneResultId: entry.sourceResultId,
        localPath: sourcePath,
        expectedContentHash: entry.sourceContentHash,
      });
    } catch {
      throw new AiStoryAssemblyV2ExecutionError(
        "SOURCE_DURATION_INVALID",
        "Source media metadata could not be verified"
      );
    }
    if (
      Math.abs(probe.durationMs - entry.sourceDurationMs) > 100 ||
      probe.width !== entry.sourceWidth ||
      probe.height !== entry.sourceHeight
    ) {
      throw new AiStoryAssemblyV2ExecutionError(
        "SOURCE_DURATION_INVALID",
        "Source media metadata changed after Assembly V2 planning"
      );
    }
    if (entry.trimWindow.sourceEndMs > probe.durationMs) {
      throw new AiStoryAssemblyV2ExecutionError(
        "TRIM_WINDOW_INVALID",
        "Resolved trim exceeds actual source duration"
      );
    }
    const normalizedPath = join(workDir, `entry-${index}.mp4`);
    await normalizeTrimmedEntry({
      sourcePath,
      outputPath: normalizedPath,
      startMs: entry.trimWindow.sourceStartMs,
      durationMs: entry.trimWindow.durationMs,
      width: input.plan.outputProfile.width,
      height: input.plan.outputProfile.height,
      frameRate: input.plan.outputProfile.frameRate,
    });
    normalizedPaths.push(normalizedPath);
  }

  let currentPath = normalizedPaths[0]!;
  let currentDurationMs = input.plan.resolvedTimeline[0]!.trimWindow.durationMs;
  for (let index = 1; index < normalizedPaths.length; index += 1) {
    const entry = input.plan.resolvedTimeline[index]!;
    const composedPath = join(workDir, `sequence-${index}.mp4`);
    if (entry.transitionFromPrevious.executionKind === "DISSOLVE") {
      await composeDissolve({
        currentPath,
        nextPath: normalizedPaths[index]!,
        outputPath: composedPath,
        currentDurationMs,
        dissolveDurationMs: entry.transitionFromPrevious.durationMs,
        frameRate: input.plan.outputProfile.frameRate,
      });
      currentDurationMs +=
        entry.trimWindow.durationMs - entry.transitionFromPrevious.durationMs;
    } else {
      await composeHardCut({
        currentPath,
        nextPath: normalizedPaths[index]!,
        outputPath: composedPath,
        frameRate: input.plan.outputProfile.frameRate,
      });
      currentDurationMs += entry.trimWindow.durationMs;
    }
    currentPath = composedPath;
  }

  const outputPath = input.outputPath ?? join(workDir, "final-story-v2.mp4");
  await mkdir(dirname(outputPath), { recursive: true });
  if (currentPath !== outputPath) await copyFile(currentPath, outputPath);
  await runFfmpeg(
    ["-v", "error", "-i", outputPath, "-map", "0:v:0", "-f", "null", "-"],
    "FINAL_MEDIA_INVALID"
  );

  let finalProbe;
  try {
    finalProbe = await probeAssemblyMedia({
      sceneResultId: input.plan.assemblyV2PlanId,
      localPath: outputPath,
    });
  } catch {
    throw new AiStoryAssemblyV2ExecutionError(
      "FINAL_MEDIA_INVALID",
      "Final Assembly V2 output failed media validation"
    );
  }
  const toleranceMs = Math.max(
    150,
    Math.ceil(2000 / input.plan.outputProfile.frameRate)
  );
  if (
    Math.abs(finalProbe.durationMs - input.plan.expectedOutputDurationMs) >
      toleranceMs ||
    finalProbe.width !== input.plan.outputProfile.width ||
    finalProbe.height !== input.plan.outputProfile.height ||
    finalProbe.byteSize === null ||
    finalProbe.byteSize <= 0
  ) {
    throw new AiStoryAssemblyV2ExecutionError(
      "FINAL_MEDIA_INVALID",
      "Final media does not match the resolved editorial timeline"
    );
  }

  const executionCompletedAt = now().toISOString();
  const evidence = AiStoryAssemblyV2ExecutionEvidenceSchema.parse({
    assemblyVersion: "V2",
    editorialPlanId: input.plan.editorialPlanId,
    editorialFingerprint: input.plan.editorialFingerprint,
    assemblyFingerprint: input.plan.assemblyFingerprint,
    timelineEntryCount: input.plan.resolvedTimeline.length,
    usedUnitCount: input.plan.resolvedTimeline.length,
    omittedUnitCount: input.plan.omittedGenerationUnitIds.length,
    finalDurationMs: finalProbe.durationMs,
    transitionCount: input.plan.resolvedTimeline.filter(
      (entry) => entry.transitionFromPrevious.durationMs > 0
    ).length,
    executionStartedAt,
    executionCompletedAt,
  });
  return {
    outputPath,
    contentHash: finalProbe.contentHash,
    durationMs: finalProbe.durationMs,
    width: finalProbe.width,
    height: finalProbe.height,
    frameRate: finalProbe.frameRate ?? input.plan.outputProfile.frameRate,
    byteSize: finalProbe.byteSize!,
    evidence,
    workDir,
  };
}
