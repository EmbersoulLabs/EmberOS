import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  AiStoryFinalAudioMixEvidenceSchema,
  computeAiStoryAudioMixFingerprint,
  type AiStoryAudioFailureCode,
  type AiStoryAudioMixExecutionPlan,
  type AiStoryFinalAudioMixEvidence,
} from "@ceo-agent/shared/server";

const execFileAsync = promisify(execFile);
const QUIET = ["-hide_banner", "-loglevel", "error", "-nostats"] as const;

export class AiStoryAudioMixError extends Error {
  constructor(
    readonly code: AiStoryAudioFailureCode,
    message: string
  ) {
    super(message);
    this.name = "AiStoryAudioMixError";
  }
}

export type AiStoryAudioMixResult = {
  readonly outputPath: string;
  readonly contentHash: string;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly evidence: AiStoryFinalAudioMixEvidence;
  readonly workDir: string;
};

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

function ffprobePath(): string {
  const ffmpeg = ffmpegPath();
  if (/ffmpeg\.exe$/i.test(ffmpeg)) return ffmpeg.replace(/ffmpeg\.exe$/i, "ffprobe.exe");
  if (/ffmpeg$/i.test(ffmpeg)) return ffmpeg.replace(/ffmpeg$/i, "ffprobe");
  return process.env.FFPROBE_PATH ?? "ffprobe";
}

async function runFfmpeg(
  args: readonly string[],
  code: AiStoryAudioFailureCode
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(ffmpegPath(), [...QUIET, ...args], {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    });
  } catch (error) {
    const diagnostic =
      typeof error === "object" && error && "stderr" in error
        ? String((error as { stderr: unknown }).stderr).slice(-4000)
        : "";
    throw new AiStoryAudioMixError(
      code,
      `AI Story audio mix execution failed${diagnostic ? `: ${diagnostic}` : ""}`
    );
  }
}

async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function probeFinal(path: string): Promise<{
  durationMs: number;
  sampleRate: number;
  channelCount: number;
}> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath(),
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        sample_rate?: string;
        channels?: number;
      }>;
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
    const durationMs = Math.round(Number(parsed.format?.duration ?? 0) * 1000);
    if (
      !video ||
      !audio ||
      durationMs <= 0 ||
      Number(audio.sample_rate) <= 0 ||
      !audio.channels
    ) {
      throw new Error("invalid streams");
    }
    return {
      durationMs,
      sampleRate: Number(audio.sample_rate),
      channelCount: audio.channels,
    };
  } catch {
    throw new AiStoryAudioMixError(
      "FINAL_AUDIO_STREAM_INVALID",
      "Final audiovisual output probe failed"
    );
  }
}

async function probeAudioSource(path: string): Promise<{
  durationMs: number;
  sampleRate: number;
  channelCount: number;
}> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath(),
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
      ],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        duration?: string;
        sample_rate?: string;
        channels?: number;
      }>;
    };
    const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
    const durationMs = Math.round(
      Number(audio?.duration ?? parsed.format?.duration ?? 0) * 1000
    );
    const sampleRate = Number(audio?.sample_rate ?? 0);
    const channelCount = Number(audio?.channels ?? 0);
    if (!audio || durationMs <= 0 || sampleRate <= 0 || channelCount <= 0) {
      throw new Error("invalid audio source");
    }
    return { durationMs, sampleRate, channelCount };
  } catch {
    throw new AiStoryAudioMixError(
      "TTS_OUTPUT_INVALID",
      "Authorized audio source is not decodable"
    );
  }
}

async function measureLoudness(path: string): Promise<{
  integratedLufs: number;
  truePeakDbfs: number;
}> {
  try {
    const { stderr } = await execFileAsync(
      ffmpegPath(),
      [
        "-hide_banner",
        "-nostats",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-filter:a",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }
    );
    const loudness = [...stderr.matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS/g)];
    const peaks = [...stderr.matchAll(/\bPeak:\s*(-?\d+(?:\.\d+)?)\s+dBFS/g)];
    const integratedLufs = Number(loudness.at(-1)?.[1]);
    const truePeakDbfs = Number(peaks.at(-1)?.[1]);
    if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbfs)) {
      throw new Error("loudness unavailable");
    }
    return { integratedLufs, truePeakDbfs };
  } catch {
    throw new AiStoryAudioMixError(
      "LOUDNESS_NORMALIZATION_FAILED",
      "Final mix loudness evidence could not be measured"
    );
  }
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(6);
}

function duckingVolumeExpression(
  plan: AiStoryAudioMixExecutionPlan,
  rule: AiStoryAudioMixExecutionPlan["duckingRules"][number]
): string {
  const duckGain = 10 ** (-rule.duckingAmountDb / 20);
  const attackSeconds = rule.attackMs / 1000;
  const releaseSeconds = rule.releaseMs / 1000;
  const speech = plan.resolvedTracks
    .filter(
      (track) =>
        track.trackKind === "SPEECH" &&
        track.speechSegmentId &&
        rule.speechSegmentIds.includes(track.speechSegmentId)
    )
    .sort((left, right) => left.startMs - right.startMs);
  let expression = "1";
  for (const track of [...speech].reverse()) {
    const start = track.startMs / 1000;
    const end = track.endMs / 1000;
    const attackStart = Math.max(0, start - attackSeconds);
    const releaseEnd = end + releaseSeconds;
    const attack =
      attackSeconds > 0
        ? `1-(1-${duckGain})*((t-${attackStart})/${attackSeconds})`
        : String(duckGain);
    const release =
      releaseSeconds > 0
        ? `${duckGain}+(1-${duckGain})*((t-${end})/${releaseSeconds})`
        : "1";
    expression =
      `if(between(t,${attackStart},${start}),${attack},` +
      `if(between(t,${start},${end}),${duckGain},` +
      `if(between(t,${end},${releaseEnd}),${release},${expression})))`;
  }
  return expression;
}

function assertPlanIntegrity(plan: AiStoryAudioMixExecutionPlan): void {
  if (computeAiStoryAudioMixFingerprint(plan) !== plan.fingerprint) {
    throw new AiStoryAudioMixError(
      "MIX_POLICY_INVALID",
      "Audio Mix Plan changed after compilation"
    );
  }
  const speechIds = new Set(
    plan.resolvedTracks
      .filter((track) => track.trackKind === "SPEECH")
      .map((track) => track.speechSegmentId!)
  );
  const musicIds = new Set(
    plan.resolvedTracks
      .filter((track) => track.trackKind === "MUSIC")
      .map((track) => track.trackId)
  );
  if (
    speechIds.size > 0 &&
    musicIds.size > 0 &&
    plan.mixPolicy.duckingRequiredWhenSpeechAndMusic
  ) {
    const rule = plan.duckingRules.length === 1 ? plan.duckingRules[0] : null;
    if (
      !rule ||
      new Set(rule.speechSegmentIds).size !== speechIds.size ||
      new Set(rule.targetMusicTrackIds).size !== musicIds.size ||
      rule.speechSegmentIds.some((id) => !speechIds.has(id)) ||
      rule.targetMusicTrackIds.some((id) => !musicIds.has(id))
    ) {
      throw new AiStoryAudioMixError(
        "MIX_POLICY_INVALID",
        "Audio Mix Plan lacks exact global ducking authority"
      );
    }
  }
}

export async function runAiStoryAudioMix(input: {
  readonly plan: AiStoryAudioMixExecutionPlan;
  readonly assemblyV2VideoPath: string;
  readonly sourcePathByAssetId: ReadonlyMap<string, string>;
  readonly workDir?: string;
  readonly outputPath?: string;
  readonly now?: () => Date;
}): Promise<AiStoryAudioMixResult> {
  assertPlanIntegrity(input.plan);
  if (input.plan.resolvedTracks.length === 0) {
    throw new AiStoryAudioMixError(
      "MIX_POLICY_INVALID",
      "AUDIO_MIX_V1 requires at least one authorized track"
    );
  }
  const startedAt = (input.now ?? (() => new Date()))().toISOString();
  const workDir =
    input.workDir ??
    (await mkdtemp(join(tmpdir(), `ember-audio-mix-${input.plan.audioMixPlanId.slice(0, 8)}-`)));
  await mkdir(workDir, { recursive: true });
  try {
    const stats = await stat(input.assemblyV2VideoPath);
    if (stats.size <= 0) throw new Error("empty");
  } catch {
    throw new AiStoryAudioMixError(
      "FINAL_AUDIO_STREAM_INVALID",
      "Assembly V2 video source is missing"
    );
  }
  if (
    (await hashFile(input.assemblyV2VideoPath)) !==
    input.plan.assemblyV2VideoContentHash
  ) {
    throw new AiStoryAudioMixError(
      "AUDIO_SOURCE_HASH_MISMATCH",
      "Assembly V2 video source changed after Audio Mix planning"
    );
  }

  const args: string[] = ["-y", "-i", input.assemblyV2VideoPath];
  const labelsByKind = new Map<string, string[]>();
  const trackFilters: string[] = [];
  for (const [index, track] of input.plan.resolvedTracks.entries()) {
    const path = input.sourcePathByAssetId.get(track.sourceAssetId);
    if (!path) {
      const missingCode: AiStoryAudioFailureCode =
        track.trackKind === "SPEECH"
          ? "TTS_OUTPUT_INVALID"
          : track.trackKind === "MUSIC"
            ? "BGM_SOURCE_MISSING"
            : track.trackKind === "AMBIENCE"
              ? "AMBIENCE_SOURCE_MISSING"
              : "SFX_SOURCE_MISSING";
      throw new AiStoryAudioMixError(
        missingCode,
        `Authorized ${track.trackKind} source is missing`
      );
    }
    if ((await hashFile(path)) !== track.contentHash) {
      throw new AiStoryAudioMixError(
        "AUDIO_SOURCE_HASH_MISMATCH",
        "Audio source changed after mix planning"
      );
    }
    const sourceProbe = await probeAudioSource(path);
    if (
      Math.abs(sourceProbe.durationMs - track.sourceDurationMs) > 150 ||
      sourceProbe.sampleRate !== track.sourceSampleRate ||
      sourceProbe.channelCount !== track.sourceChannelCount
    ) {
      throw new AiStoryAudioMixError(
        track.trackKind === "SPEECH" ? "TTS_OUTPUT_INVALID" : "AUDIO_SOURCE_HASH_MISMATCH",
        "Audio source probe does not match frozen duration/channel authority"
      );
    }
    if (track.loop) args.push("-stream_loop", "-1");
    args.push("-i", path);
    const label = `track${index}`;
    const durationMs = track.endMs - track.startMs;
    const sourceTrimMs = track.loop
      ? durationMs
      : Math.min(track.sourceDurationMs, durationMs);
    const fadeOutStartMs = Math.max(0, durationMs - track.fadeOutMs);
    const filters = [
      `atrim=0:${seconds(sourceTrimMs)}`,
      "asetpts=PTS-STARTPTS",
      `aresample=${input.plan.mixPolicy.sampleRate}`,
      `aformat=sample_fmts=fltp:channel_layouts=${input.plan.mixPolicy.channelLayout}`,
      `volume=${track.gainDb}dB`,
    ];
    if (track.fadeInMs > 0) {
      filters.push(`afade=t=in:st=0:d=${seconds(track.fadeInMs)}`);
    }
    if (track.fadeOutMs > 0) {
      filters.push(
        `afade=t=out:st=${seconds(fadeOutStartMs)}:d=${seconds(track.fadeOutMs)}`
      );
    }
    filters.push(
      `atrim=0:${seconds(durationMs)}`,
      `adelay=${track.startMs}|${track.startMs}`,
      `apad=whole_dur=${seconds(input.plan.videoDurationMs)}`,
      `atrim=0:${seconds(input.plan.videoDurationMs)}`
    );
    const kindLabels = labelsByKind.get(track.trackKind) ?? [];
    kindLabels.push(label);
    labelsByKind.set(track.trackKind, kindLabels);
    trackFilters.push(`[${index + 1}:a]${filters.join(",")}[${label}]`);
  }

  function combineKind(kind: string, outputLabel: string): string | null {
    const labels = labelsByKind.get(kind) ?? [];
    if (labels.length === 0) return null;
    if (labels.length === 1) {
      trackFilters.push(`[${labels[0]}]anull[${outputLabel}]`);
    } else {
      trackFilters.push(
        `${labels.map((label) => `[${label}]`).join("")}amix=inputs=${labels.length}:duration=longest:dropout_transition=0:normalize=0[${outputLabel}]`
      );
    }
    return outputLabel;
  }

  let speechLabel = combineKind("SPEECH", "speechmix");
  let musicLabel = combineKind("MUSIC", "musicmix");
  const ambienceLabel = combineKind("AMBIENCE", "ambiencemix");
  const sfxLabel = combineKind("SFX", "sfxmix");
  if (speechLabel && musicLabel && input.plan.duckingRules.length > 0) {
    const rule = input.plan.duckingRules[0]!;
    const expression = duckingVolumeExpression(input.plan, rule);
    trackFilters.push(
      `[${musicLabel}]volume='${expression}':eval=frame[musicducked]`
    );
    musicLabel = "musicducked";
  }
  const components = [
    speechLabel,
    musicLabel,
    ambienceLabel,
    sfxLabel,
  ].filter((label): label is string => Boolean(label));
  const effectiveTruePeakTarget = Math.min(
    input.plan.mixPolicy.peakCeilingDbfs,
    input.plan.mixPolicy.truePeakTargetDbtp
  );
  trackFilters.push(
    `${components.map((label) => `[${label}]`).join("")}amix=inputs=${components.length}:duration=longest:dropout_transition=0:normalize=0,loudnorm=I=${input.plan.mixPolicy.loudnessTargetLufs}:TP=${effectiveTruePeakTarget}:LRA=11,atrim=0:${seconds(input.plan.videoDurationMs)}[aout]`
  );

  const outputPath = input.outputPath ?? join(workDir, "final-story-audio-mix.mp4");
  await mkdir(dirname(outputPath), { recursive: true });
  args.push(
    "-filter_complex",
    trackFilters.join(";"),
    "-map",
    "0:v:0",
    "-map",
    "[aout]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-ar",
    String(input.plan.mixPolicy.sampleRate),
    "-ac",
    "2",
    "-t",
    seconds(input.plan.videoDurationMs),
    "-movflags",
    "+faststart",
    outputPath
  );
  await runFfmpeg(args, "FINAL_AUDIO_STREAM_INVALID");
  await runFfmpeg(
    ["-v", "error", "-i", outputPath, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"],
    "FINAL_AUDIO_STREAM_INVALID"
  );

  const probe = await probeFinal(outputPath);
  if (
    Math.abs(probe.durationMs - input.plan.videoDurationMs) > 150 ||
    probe.sampleRate !== input.plan.mixPolicy.sampleRate ||
    probe.channelCount !== 2
  ) {
    throw new AiStoryAudioMixError(
      "FINAL_AUDIO_STREAM_INVALID",
      "Final audiovisual output does not match Audio Mix authority"
    );
  }
  const loudness = await measureLoudness(outputPath);
  if (
    Math.abs(loudness.integratedLufs - input.plan.mixPolicy.loudnessTargetLufs) > 1.5 ||
    loudness.truePeakDbfs > effectiveTruePeakTarget + 0.5
  ) {
    throw new AiStoryAudioMixError(
      "LOUDNESS_NORMALIZATION_FAILED",
      "Final mix is outside certified loudness bounds"
    );
  }
  const contentHash = await hashFile(outputPath);
  const completedAt = (input.now ?? (() => new Date()))().toISOString();
  const evidence = AiStoryFinalAudioMixEvidenceSchema.parse({
    audioPlanId: input.plan.audioPlanId,
    audioMixFingerprint: input.plan.fingerprint,
    finalContentHash: contentHash,
    durationMs: probe.durationMs,
    sampleRate: probe.sampleRate,
    channelCount: probe.channelCount,
    measuredIntegratedLufs: loudness.integratedLufs,
    measuredTruePeakDbfs: loudness.truePeakDbfs,
    speechSegmentCount: input.plan.resolvedTracks.filter((track) => track.trackKind === "SPEECH").length,
    musicTrackCount: input.plan.resolvedTracks.filter((track) => track.trackKind === "MUSIC").length,
    ambienceTrackCount: input.plan.resolvedTracks.filter((track) => track.trackKind === "AMBIENCE").length,
    sfxTrackCount: input.plan.resolvedTracks.filter((track) => track.trackKind === "SFX").length,
    jCutCount: input.plan.resolvedTracks.filter((track) => track.jCutExecuted).length,
    lCutCount: input.plan.resolvedTracks.filter((track) => track.lCutExecuted).length,
    executionStartedAt: startedAt,
    executionCompletedAt: completedAt,
  });
  return {
    outputPath,
    contentHash,
    durationMs: probe.durationMs,
    sampleRate: probe.sampleRate,
    channelCount: probe.channelCount,
    evidence,
    workDir,
  };
}
