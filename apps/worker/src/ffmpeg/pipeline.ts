import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveBgmFileForPlan } from "../bgm/resolve";
import { mixBackgroundMusic } from "./audio-mix";
import { resolveBgmTrackKey } from "@ceo-agent/shared";
import type { EditPlan } from "@ceo-agent/shared";
import type { ClipMotion } from "@ceo-agent/shared";
import { getRenderProfile, DYNAMIC_CAMERA, type RenderMode, type RenderPhase, type RenderProfileKey } from "@ceo-agent/shared";
import { getFfmpegPath } from "./ffmpeg-path";
import { runFfmpeg } from "./ffmpeg-run";
import { mediaHasAudio } from "./probe-audio";
import { FFMPEG_CROP_916_CENTER, FFMPEG_SCALE_FOR_916 } from "./filters-916";
import { assVideoFilter, buildAssSubtitles } from "./ass-subtitles";
import { buildDynamicMotionFilter, buildVideoClipFilter, segmentTransitionFilters } from "./dynamic-motion";

const execFileAsync = promisify(execFile);

function resolveProfile(renderMode: RenderMode, profileKey?: RenderProfileKey) {
  const key = profileKey ?? (renderMode === "subtitles_only" ? "preview" : renderMode);
  return getRenderProfile(key);
}

export { getFfmpegPath } from "./ffmpeg-path";

export interface RenderAssetRef {
  path: string;
  type: "video" | "image";
}

export type RenderAssetMap = Map<string, RenderAssetRef>;

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  codec: string;
}

export type RenderProgressCallback = (percent: number, phase: RenderPhase) => void | Promise<void>;

export async function probeVideo(inputPath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  const data = JSON.parse(stdout);
  const videoStream = data.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  return {
    durationSec: parseFloat(data.format?.duration ?? "0"),
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    codec: videoStream?.codec_name ?? "unknown",
  };
}

function isImageAsset(ref: RenderAssetRef): boolean {
  if (ref.type === "video") return false;
  if (ref.type === "image") return true;
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(ref.path);
}

function buildImageVideoFilter(
  scale: string,
  durationSec: number,
  motion?: ClipMotion,
  renderMode: RenderMode = "preview",
  focus?: { x: number; y: number }
): string {
  let vf = buildDynamicMotionFilter(
    scale,
    durationSec,
    motion ?? "slow_zoom_in",
    focus ?? { x: 0.5, y: 0.5 },
    renderMode === "subtitles_only" ? "preview" : renderMode
  );
  const trans = segmentTransitionFilters(false, false, durationSec);
  if (trans) vf += `,${trans}`;
  return vf;
}

async function renderImageClipSegment(
  imagePath: string,
  clip: EditPlan["clips"][number],
  outputPath: string,
  renderMode: RenderMode,
  profile: ReturnType<typeof getRenderProfile>,
  workDir: string,
  effects?: EditPlan["effects"]
): Promise<void> {
  const outputDur = clip.outputDurationSec ?? Math.max(1.5, clip.endSec - clip.startSec);
  const scale = profileScale(profile);
  const fadeIn = effects?.find((e) => e.type === "fade_in");
  const focus = {
    x: clip.focusX ?? 0.5,
    y: clip.focusY ?? 0.5,
  };
  let vf = buildImageVideoFilter(scale, outputDur, clip.motion, renderMode, focus);
  if (clip.motion === "fade_in" || fadeIn) {
    vf += `,fade=t=in:st=0:d=${fadeIn?.durationSec ?? 0.25}`;
  }

  const clipArgs = [
    "-y",
    "-threads",
    "0",
    "-loop",
    "1",
    "-framerate",
    "30",
    "-i",
    imagePath,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    String(outputDur.toFixed(3)),
    "-filter_complex",
    `[0:v]${vf},trim=duration=${outputDur.toFixed(3)},setpts=PTS-STARTPTS[v];[1:a]atrim=duration=${outputDur.toFixed(3)},asetpts=PTS-STARTPTS[a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    profile.crf,
    "-b:v",
    profile.videoBitrate,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    profile.audioBitrate,
    "-movflags",
    "+faststart",
    outputPath,
  ];
  await runFfmpeg(clipArgs, { cwd: workDir });
}

function resolveClipAsset(
  assets: RenderAssetMap | string,
  clip: EditPlan["clips"][number],
  fallbackAssetId?: string
): RenderAssetRef {
  if (typeof assets === "string") {
    return { path: assets, type: "video" };
  }
  const assetId = clip.assetId || fallbackAssetId;
  if (!assetId) throw new Error("Clip missing assetId");
  const ref = assets.get(assetId);
  if (!ref) throw new Error(`Asset ${assetId} not found for render`);
  return ref;
}

async function renderClipSegment(
  inputPath: string,
  clip: EditPlan["clips"][number],
  outputPath: string,
  renderMode: RenderMode,
  profile: ReturnType<typeof getRenderProfile>,
  workDir: string,
  sourceDurationSec: number,
  effects?: EditPlan["effects"],
  beatIndex = 0,
  beatCount = 1
): Promise<void> {
  const speed = clip.speed ?? 1;
  // Clamp to a sane minimum: a zero/near-zero duration yields trim=duration=0,
  // which produces an empty segment (zero exit code) that later breaks the
  // crossfade filtergraph with "Stream specifier ':v' matches no streams".
  const outputDur = Math.max(
    0.5,
    clip.outputDurationSec ?? Math.max(1.5, (clip.endSec - clip.startSec) / speed)
  );
  const inputNeed = Math.max(0.6, outputDur * speed);
  const startSec = Math.max(0, clip.startSec);
  // Trust the real input duration over the passed-in value: an over-estimated
  // sourceDurationSec (e.g. a 60s default for a much shorter clip) makes us skip
  // stream_loop and seek past the real end, producing an empty segment.
  let effectiveSourceDur = sourceDurationSec;
  try {
    const probedDur = (await probeVideo(inputPath)).durationSec;
    if (probedDur > 0) effectiveSourceDur = probedDur;
  } catch {
    // keep passed-in value
  }
  const knownSource = effectiveSourceDur > 0;
  const needsLoop =
    !knownSource ||
    clip.endSec > effectiveSourceDur + 0.05 ||
    startSec + inputNeed > effectiveSourceDur + 0.05;

  const scale = profileScale(profile);
  // Whole-clip fade effects use absolute timeline (e.g. fade out at 15s). Multi-beat
  // segments are ~2s each — applying those fades breaks ffmpeg on Linux (Debian).
  const segmentEffects =
    beatCount > 1 ? effects?.filter((e) => e.type !== "fade_in" && e.type !== "fade_out") : effects;
  let vfBase = buildVideoClipFilter(scale, speed, segmentEffects);
  const trans = segmentTransitionFilters(beatIndex === 0, beatIndex === beatCount - 1, outputDur);
  if (trans) vfBase += `,${trans}`;
  const videoFilter = `${vfBase},trim=duration=${outputDur.toFixed(3)},setpts=PTS-STARTPTS`;

  const clipArgs = ["-y", "-threads", "0"];
  if (needsLoop) {
    clipArgs.push("-stream_loop", "-1");
  }
  clipArgs.push(
    "-ss",
    String(Math.max(0, startSec)),
    "-i",
    inputPath,
    "-t",
    String(inputNeed.toFixed(3)),
  );

  const hasSourceAudio = await mediaHasAudio(inputPath);
  if (hasSourceAudio) {
    clipArgs.push(
      "-vf",
      videoFilter,
      "-c:v",
      "libx264",
      "-preset",
      profile.preset,
      "-crf",
      profile.crf,
      "-b:v",
      profile.videoBitrate,
      "-maxrate",
      profile.videoBitrate,
      "-bufsize",
      `${parseInt(profile.videoBitrate, 10) * 2}k`,
      "-movflags",
      "+faststart"
    );
    const audioFilter = buildAudioFilter(speed, false);
    if (audioFilter) {
      clipArgs.push("-af", `${audioFilter},atrim=duration=${outputDur.toFixed(3)}`, "-c:a", "aac", "-b:a", profile.audioBitrate);
    } else {
      clipArgs.push("-af", `atrim=duration=${outputDur.toFixed(3)}`, "-c:a", "aac", "-b:a", profile.audioBitrate);
    }
  } else {
    clipArgs.push(
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex",
      `[0:v]${videoFilter}[v];[1:a]atrim=duration=${outputDur.toFixed(3)},asetpts=PTS-STARTPTS[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      profile.preset,
      "-crf",
      profile.crf,
      "-b:v",
      profile.videoBitrate,
      "-maxrate",
      profile.videoBitrate,
      "-bufsize",
      `${parseInt(profile.videoBitrate, 10) * 2}k`,
      "-c:a",
      "aac",
      "-b:a",
      profile.audioBitrate,
      "-movflags",
      "+faststart",
      "-t",
      outputDur.toFixed(3),
    );
  }
  clipArgs.push(outputPath);
  await runFfmpeg(clipArgs, { cwd: workDir });
}

async function execFfmpeg(
  args: string[],
  options?: {
    cwd?: string;
    onProgress?: RenderProgressCallback;
    progressFrom?: number;
    progressTo?: number;
  }
): Promise<void> {
  let tick = options?.progressFrom ?? 0;
  const end = options?.progressTo ?? tick;
  const interval =
    options?.onProgress && end > tick
      ? setInterval(() => {
          tick = Math.min(end - 1, tick + 1);
          void options.onProgress?.(tick, "base_clip");
        }, 4000)
      : undefined;

  try {
    await runFfmpeg(args, { cwd: options?.cwd });
  } finally {
    if (interval) clearInterval(interval);
  }
}

function buildAudioFilter(speed: number, normalize: boolean): string | null {
  const parts: string[] = [];
  if (speed !== 1) parts.push(`atempo=${Math.min(2, Math.max(0.5, speed))}`);
  if (normalize) parts.push("loudnorm=I=-14:TP=-1.5:LRA=11");
  return parts.length > 0 ? parts.join(",") : null;
}

function profileScale(profile: ReturnType<typeof getRenderProfile>): string {
  return `${profile.width}:${profile.height}`;
}

/**
 * A rendered beat segment is usable only if it actually contains both a video
 * and an audio stream. Degenerate clips (e.g. startSec past a short source with
 * stream_loop) can produce empty files with a zero exit code, which later break
 * the crossfade filtergraph with "Stream specifier ':v' matches no streams".
 */
async function segmentHasVideoAndAudio(path: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      path,
    ]);
    return stdout.includes("video") && stdout.includes("audio");
  } catch {
    return false;
  }
}

/** Concat virtual beats with crossfade + audio crossfade for TikTok-style cuts. */
async function concatSegmentsWithCrossfade(
  segmentPaths: string[],
  durations: number[],
  outputPath: string,
  profile: ReturnType<typeof getRenderProfile>,
  workDir: string
): Promise<void> {
  if (segmentPaths.length === 0) throw new Error("No segments to concat");
  if (segmentPaths.length === 1) {
    await copyFile(segmentPaths[0]!, outputPath);
    return;
  }

  const trans = DYNAMIC_CAMERA.CROSSFADE_SEC;
  const inputArgs: string[] = ["-y"];
  for (const p of segmentPaths) {
    inputArgs.push("-i", p);
  }

  const parts: string[] = [];
  let vLabel = "0:v";
  let aLabel = "0:a";
  let timeline = durations[0]! - trans;

  for (let i = 1; i < segmentPaths.length; i++) {
    const outV = `xv${i}`;
    const outA = `xa${i}`;
    const offset = Math.max(0.01, timeline).toFixed(3);
    parts.push(`[${vLabel}][${i}:v]xfade=transition=fade:duration=${trans}:offset=${offset}[${outV}]`);
    parts.push(`[${aLabel}][${i}:a]acrossfade=d=${trans}[${outA}]`);
    vLabel = outV;
    aLabel = outA;
    timeline += durations[i]! - trans;
  }

  inputArgs.push(
    "-filter_complex",
    parts.join(";"),
    "-map",
    `[${vLabel}]`,
    "-map",
    `[${aLabel}]`,
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    profile.crf,
    "-c:a",
    "aac",
    "-b:a",
    profile.audioBitrate,
    "-movflags",
    "+faststart",
    outputPath
  );

  await runFfmpeg(inputArgs, { cwd: workDir });
}

export async function renderBaseClip(
  assets: RenderAssetMap | string,
  editPlan: EditPlan,
  outputPath: string,
  renderMode: RenderMode,
  onProgress?: RenderProgressCallback,
  sourceDurationSec = 0,
  profileKey?: RenderProfileKey
): Promise<void> {
  const profile = resolveProfile(renderMode, profileKey);
  const workDir = join(tmpdir(), `ceo-base-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const defaultAssetId =
    typeof assets === "string" ? undefined : (editPlan.clips[0]?.assetId ?? assets.keys().next().value);

  try {
    await onProgress?.(15, "base_clip");
    const clips =
      editPlan.clips.length > 0
        ? editPlan.clips
        : [
            {
              assetId: defaultAssetId ?? "",
              startSec: 0,
              endSec: editPlan.targetDurationSec,
              outputDurationSec: editPlan.targetDurationSec,
              speed: 1,
            },
          ];

    const renderOne = async (clip: EditPlan["clips"][number], segPath: string, beatIndex: number, beatCount: number) => {
      const ref = resolveClipAsset(assets, clip, defaultAssetId);
      if (isImageAsset(ref)) {
        await renderImageClipSegment(ref.path, clip, segPath, renderMode, profile, workDir, editPlan.effects);
      } else {
        await renderClipSegment(
          ref.path,
          clip,
          segPath,
          renderMode,
          profile,
          workDir,
          sourceDurationSec,
          editPlan.effects,
          beatIndex,
          beatCount
        );
      }
    };

    if (clips.length === 1) {
      await renderOne(clips[0]!, outputPath, 0, 1);
    } else {
      const segmentPaths: string[] = [];
      const beatDurations: number[] = [];
      const step = Math.max(1, Math.floor(40 / clips.length));
      for (let i = 0; i < clips.length; i++) {
        const segPath = join(workDir, `seg_${i}.mp4`);
        await renderOne(clips[i]!, segPath, i, clips.length);
        if (!(await segmentHasVideoAndAudio(segPath))) {
          console.warn(`[render] dropping empty/invalid beat segment seg_${i} (no video+audio stream)`);
          await onProgress?.(15 + step * (i + 1), "base_clip");
          continue;
        }
        segmentPaths.push(segPath);
        const c = clips[i]!;
        beatDurations.push(
          c.outputDurationSec ?? Math.max(1.5, (c.endSec - c.startSec) / (c.speed ?? 1))
        );
        await onProgress?.(15 + step * (i + 1), "base_clip");
      }

      if (segmentPaths.length === 0) {
        throw new Error("All beat segments were empty/invalid — cannot render base clip");
      }

      await concatSegmentsWithCrossfade(
        segmentPaths,
        beatDurations,
        outputPath,
        profile,
        workDir
      );
    }

    await onProgress?.(55, "base_clip");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function burnSubtitles(
  baseClipPath: string,
  editPlan: EditPlan,
  outputPath: string,
  renderMode: RenderMode,
  onProgress?: RenderProgressCallback,
  profileKey?: RenderProfileKey
): Promise<{ editPlan: EditPlan; ttsDurationSec?: number }> {
  const profile = resolveProfile(renderMode, profileKey);
  const workDir = join(tmpdir(), `ceo-subs-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const runInWorkDir = { cwd: workDir } as const;
  const assLocalPath = join(workDir, "subs.ass");

  try {
    await onProgress?.(58, "subtitles");

    const useVoiceover =
      editPlan.audio.voiceover?.enabled && (editPlan.audio.voiceover.segments?.length ?? 0) > 0;

    let plan = editPlan;
    let ttsDurationSec: number | undefined;
    let cachedTtsPath: string | undefined;

    if (useVoiceover) {
      const { synthesizeSpeech } = await import("@ceo-agent/agents");
      const { prepareRenderPlan } = await import("./prepare-render");
      const prepared = await prepareRenderPlan(plan, workDir, synthesizeSpeech, assLocalPath);
      plan = prepared.editPlan;
      ttsDurationSec = prepared.ttsDurationSec;
      cachedTtsPath = join(workDir, "tts_primary.mp3");

      const baseProbe = await probeVideo(baseClipPath);
      if (baseProbe.durationSec < prepared.finalDurationSec - 0.2) {
        const extendedLocal = join(workDir, "base_extended.mp4");
        const { extendVideoToDuration } = await import("./render-validation");
        await extendVideoToDuration(baseClipPath, extendedLocal, prepared.finalDurationSec, {
          preset: profile.preset,
          crf: profile.crf,
          videoBitrate: profile.videoBitrate,
          audioBitrate: profile.audioBitrate,
        });
        baseClipPath = extendedLocal;
      }
    }

    await onProgress?.(60, "subtitles");
    let normalizedLocal = join(workDir, "normalized.mp4");

    if (plan.subtitles.length === 0) {
      await copyFile(baseClipPath, normalizedLocal);
    } else {
      const { stageSubtitleFontForRender } = await import("./subtitle-fonts.js");
      const localFonts = await stageSubtitleFontForRender(workDir);
      await writeFile(assLocalPath, buildAssSubtitles(plan.subtitles, profile.height));
      const subtitledLocal = join(workDir, "subtitled.mp4");
      await runFfmpeg(
        [
          "-y",
          "-i",
          baseClipPath,
          "-vf",
          assVideoFilter(workDir, localFonts),
          "-c:v",
          "libx264",
          "-preset",
          profile.preset,
          "-crf",
          profile.crf,
          "-b:v",
          profile.videoBitrate,
          "-c:a",
          "copy",
          "-t",
          plan.targetDurationSec.toFixed(3),
          subtitledLocal,
        ],
        runInWorkDir
      );

      if (plan.audio.normalize) {
        await runFfmpeg(
          [
            "-y",
            "-i",
            subtitledLocal,
            "-af",
            "loudnorm=I=-14:TP=-1.5:LRA=11",
            "-c:v",
            "copy",
            normalizedLocal,
          ],
          runInWorkDir
        );
      } else {
        await copyFile(subtitledLocal, normalizedLocal);
      }
    }

    const shouldMixBgm = Boolean(plan.audio.bgmExternal?.audioUrl) || plan.audio.bgm !== "none";

    if (useVoiceover) {
      await onProgress?.(72, "subtitles");
      const { synthesizeSpeech } = await import("@ceo-agent/agents");
      const { mixVideoWithVoiceoverAndBgm } = await import("./voiceover-mix");
      const mixResult = await mixVideoWithVoiceoverAndBgm(
        normalizedLocal,
        outputPath,
        plan,
        workDir,
        synthesizeSpeech,
        { cachedTtsPath }
      );
      ttsDurationSec = mixResult.ttsDurationSec;
      console.log(
        `[ffmpeg] voiceover mixed tts=${mixResult.ttsDurationSec.toFixed(1)}s final=${mixResult.finalDurationSec.toFixed(1)}s`
      );
    } else if (shouldMixBgm) {
      const bgmKey =
        plan.audio.bgmExternal?.audioUrl
          ? `${plan.audio.bgmExternal.source ?? "ext"}:${plan.audio.bgmExternal.trackId ?? ""}`
          : resolveBgmTrackKey(plan.audio.bgm ?? "default");
      try {
        await onProgress?.(78, "subtitles");
        const bgmPath = await resolveBgmFileForPlan(plan.audio);
        await mixBackgroundMusic(
          normalizedLocal,
          bgmPath,
          outputPath,
          plan.targetDurationSec,
          false
        );
        console.log(`[ffmpeg] BGM mixed key=${bgmKey} dur=${plan.targetDurationSec}s`);
      } catch (err) {
        console.warn("[ffmpeg] BGM mix failed, using video without music:", err);
        await copyFile(normalizedLocal, outputPath);
      }
    } else {
      await copyFile(normalizedLocal, outputPath);
    }

    const { validateRenderOutput } = await import("./render-validation");
    await validateRenderOutput({
      outputPath,
      editPlan: plan,
      assPath: plan.subtitles.length > 0 ? assLocalPath : undefined,
      ttsDurationSec,
    });

    await onProgress?.(85, "subtitles");
    return { editPlan: plan, ttsDurationSec };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function renderVideo(
  assets: RenderAssetMap | string,
  editPlan: EditPlan,
  outputPath: string,
  renderMode: RenderMode = "preview",
  options?: {
    cachedBasePath?: string;
    cacheOutputPath?: string;
    sourceDurationSec?: number;
    onProgress?: RenderProgressCallback;
    profileKey?: RenderProfileKey;
  }
): Promise<{ usedCache: boolean }> {
  const workDir = join(tmpdir(), `ceo-render-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const baseLocal = join(workDir, "base.mp4");
  let usedCache = false;
  const primaryPath = typeof assets === "string" ? assets : assets.values().next().value?.path;

  try {
    await options?.onProgress?.(5, "downloading");
    if (options?.cachedBasePath) {
      await copyFile(options.cachedBasePath, baseLocal);
      usedCache = true;
      await options?.onProgress?.(50, "base_clip");
    } else if (renderMode !== "subtitles_only") {
      let sourceDur = options?.sourceDurationSec ?? 0;
      if (sourceDur <= 0 && primaryPath) {
        try {
          sourceDur = (await probeVideo(primaryPath)).durationSec;
        } catch {
          sourceDur = editPlan.targetDurationSec;
        }
      }
      await renderBaseClip(
        assets,
        editPlan,
        baseLocal,
        renderMode,
        options?.onProgress,
        sourceDur,
        options?.profileKey
      );
      if (options?.cacheOutputPath) {
        await copyFile(baseLocal, options.cacheOutputPath);
      }
    } else {
      throw new Error("subtitles_only render requires cached base clip");
    }

    await burnSubtitles(baseLocal, editPlan, outputPath, renderMode, options?.onProgress, options?.profileKey);
    await options?.onProgress?.(95, "upload");
    return { usedCache };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function extractCoverFromImage(imagePath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    imagePath,
    "-vf",
    `${FFMPEG_SCALE_FOR_916},${FFMPEG_CROP_916_CENTER},scale=720:1280`,
    "-q:v",
    "2",
    outputPath,
  ]);
}

export async function extractCover(inputPath: string, atSec: number, outputPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-ss",
    String(atSec),
    "-i",
    inputPath,
    "-vframes",
    "1",
    "-q:v",
    "2",
    outputPath,
  ]);
}

export async function createExportZip(
  files: { path: string; name: string }[],
  outputZipPath: string
): Promise<void> {
  const archiver = (await import("archiver")).default;
  const { createWriteStream } = await import("node:fs");

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outputZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);
    for (const file of files) {
      archive.file(file.path, { name: file.name });
    }
    archive.finalize();
  });
}
