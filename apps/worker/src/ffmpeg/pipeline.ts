import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveBgmFile } from "../bgm/resolve";
import { mixBackgroundMusic } from "./audio-mix";
import { resolveBgmTrackKey } from "@ceo-agent/shared";
import type { EditPlan } from "@ceo-agent/shared";
import type { ClipMotion } from "@ceo-agent/shared";
import { getRenderProfile, type RenderMode, type RenderPhase } from "@ceo-agent/shared";
import { getFfmpegPath } from "./ffmpeg-path";
import { mediaHasAudio } from "./probe-audio";

const execFileAsync = promisify(execFile);

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

function assStyleLine(
  name: string,
  fontSize: number,
  colour: string,
  alignment: number,
  marginV: number,
  outline = 4,
  marginH = 72
): string {
  return `Style: ${name},Arial,${fontSize},${colour},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,${outline},2,${alignment},${marginH},${marginH},${marginV},1`;
}

function buildAssSubtitles(subtitles: EditPlan["subtitles"], playResY: number): string {
  const scale = playResY / 1920;
  const playResX = Math.round((playResY * 9) / 16);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${assStyleLine("HookZh", Math.round(58 * scale), "&H000C58EA", 8, Math.round(340 * scale), 5)}
${assStyleLine("HookEn", Math.round(44 * scale), "&H00FFFFFF", 8, Math.round(280 * scale), 4)}
${assStyleLine("BodyZh", Math.round(46 * scale), "&H00FFFFFF", 2, Math.round(320 * scale), 4)}
${assStyleLine("BodyEn", Math.round(38 * scale), "&H0000E6FF", 2, Math.round(250 * scale), 4)}
${assStyleLine("CtaZh", Math.round(50 * scale), "&H0000D7FF", 2, Math.round(190 * scale), 5)}
${assStyleLine("CtaEn", Math.round(40 * scale), "&H0000FFFF", 2, Math.round(140 * scale), 4)}
Style: Default,Arial,${Math.round(44 * scale)},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,72,72,${Math.round(300 * scale)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const styleMap: Record<string, string> = {
    hook: "HookZh",
    hook_zh: "HookZh",
    hook_en: "HookEn",
    bold_center: "HookZh",
    body: "BodyZh",
    body_zh: "BodyZh",
    body_en: "BodyEn",
    cta: "CtaZh",
    cta_zh: "CtaZh",
    cta_en: "CtaEn",
  };
  const lines = subtitles.map((s) => {
    const start = formatAssTime(s.startSec);
    const end = formatAssTime(s.endSec);
    const text = `{\\q2}${s.text.replace(/\n/g, "\\N")}`;
    const style = styleMap[s.style] ?? "BodyZh";
    return `Dialogue: 0,${start},${end},${style},,0,0,0,,${text}`;
  });
  return header + lines.join("\n");
}

function formatAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function buildClipVideoFilter(
  scale: string,
  clipDurationSec: number,
  speed: number,
  renderMode: RenderMode,
  motion?: ClipMotion,
  effects?: EditPlan["effects"]
): string {
  const [w, h] = scale.split(":").map(Number);
  const frames = Math.max(24, Math.ceil(clipDurationSec * 30));
  const fadeIn = effects?.find((e) => e.type === "fade_in");

  let cropX = "(iw-ih*9/16)/2";
  if (motion === "pan_right") cropX = "(iw-ih*9/16)/2+(iw-ih*9/16)*0.1";
  if (motion === "pan_left") cropX = "(iw-ih*9/16)/2-(iw-ih*9/16)*0.1";
  if (motion === "pan_up") cropX = "(iw-ih*9/16)/2";

  let chain: string;
  if (motion === "slow_zoom_in" && renderMode === "final") {
    chain = `crop=ih*9/16:ih:${cropX}:0,scale=${scale},zoompan=z='min(zoom+0.0015,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30`;
  } else if (motion === "slow_zoom_out" && renderMode === "final") {
    chain = `crop=ih*9/16:ih:${cropX}:0,scale=${scale},zoompan=z='if(lte(zoom,1.0),1.12,max(1.001,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30`;
  } else if (motion === "slow_zoom_in" || motion === "focus_pull") {
    chain = `scale=iw*1.1:ih*1.1,crop=ih*9/16:ih:(iw-ih*9/16)/2:(ih-ih/11)/2,scale=${scale}`;
  } else if (motion === "slow_zoom_out") {
    chain = `scale=iw*1.04:ih*1.04,crop=ih*9/16:ih:(iw-ih*9/16)/2:(ih-ih/26)/2,scale=${scale}`;
  } else {
    chain = `crop=ih*9/16:ih:${cropX}:0,scale=${scale}`;
  }

  if ((motion === "fade_in" || fadeIn) && renderMode === "final") {
    chain += `,fade=t=in:st=0:d=${fadeIn?.durationSec ?? 0.3}`;
  } else if (motion === "fade_in") {
    chain += ",fade=t=in:st=0:d=0.2";
  }

  if (speed !== 1) {
    chain += `,setpts=PTS/${speed}`;
  }
  return chain;
}

function isImageAsset(ref: RenderAssetRef): boolean {
  return ref.type === "image" || /\.(jpe?g|png|webp)$/i.test(ref.path);
}

function buildImageVideoFilter(
  scale: string,
  durationSec: number,
  motion?: ClipMotion,
  renderMode: RenderMode = "preview"
): string {
  const [w, h] = scale.split(":").map(Number);
  const frames = Math.max(24, Math.ceil(durationSec * 30));
  const cropBase = `scale='if(gt(a,9/16),-2,iw*1.25)':'if(gt(a,9/16),ih*1.25,-2)',crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${scale}`;

  if (motion === "slow_zoom_in" && renderMode === "final") {
    return `${cropBase},zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30`;
  }
  if (motion === "slow_zoom_out" && renderMode === "final") {
    return `${cropBase},zoompan=z='if(lte(zoom,1.0),1.18,max(1.001,zoom-0.0012))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30`;
  }
  if (motion === "pan_right") {
    return `${cropBase},zoompan=z='1.08':x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=${w}x${h}:fps=30`;
  }
  if (motion === "pan_left") {
    return `${cropBase},zoompan=z='1.08':x='(iw-iw/zoom)*(1-on/${frames})':y='(ih-ih/zoom)/2':d=${frames}:s=${w}x${h}:fps=30`;
  }
  if (motion === "slow_zoom_in" || motion === "focus_pull") {
    return `${cropBase},zoompan=z='min(zoom+0.001,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30`;
  }
  return `${cropBase},zoompan=z='1.05':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=30`;
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
  let vf = buildImageVideoFilter(scale, outputDur, clip.motion, renderMode);
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
    "-shortest",
    outputPath,
  ];
  await execFileAsync(getFfmpegPath(), clipArgs, { cwd: workDir, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
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
  sourceDurationSec: number
): Promise<void> {
  const speed = clip.speed ?? 1;
  const outputDur = clip.outputDurationSec ?? Math.max(1.5, (clip.endSec - clip.startSec) / speed);
  const inputNeed = Math.max(0.6, outputDur * speed);
  const startSec = clip.startSec;
  const knownSource = sourceDurationSec > 0;
  const needsLoop = !knownSource || startSec + inputNeed > sourceDurationSec + 0.05;

  const scale = profileScale(profile);
  const vfBase = buildClipVideoFilter(
    scale,
    outputDur,
    speed,
    renderMode,
    clip.motion,
    undefined
  );
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
      "-shortest"
    );
  }
  clipArgs.push(outputPath);
  await execFileAsync(getFfmpegPath(), clipArgs, { cwd: workDir, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
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
    await execFileAsync(getFfmpegPath(), args, {
      cwd: options?.cwd,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
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

export async function renderBaseClip(
  assets: RenderAssetMap | string,
  editPlan: EditPlan,
  outputPath: string,
  renderMode: RenderMode,
  onProgress?: RenderProgressCallback,
  sourceDurationSec = 0
): Promise<void> {
  const profile = getRenderProfile(renderMode === "subtitles_only" ? "preview" : renderMode);
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

    const renderOne = async (clip: EditPlan["clips"][number], segPath: string) => {
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
          sourceDurationSec
        );
      }
    };

    if (clips.length === 1) {
      await renderOne(clips[0]!, outputPath);
    } else {
      const segmentPaths: string[] = [];
      const step = Math.max(1, Math.floor(40 / clips.length));
      for (let i = 0; i < clips.length; i++) {
        const segPath = join(workDir, `seg_${i}.mp4`);
        await renderOne(clips[i]!, segPath);
        segmentPaths.push(segPath);
        await onProgress?.(15 + step * (i + 1), "base_clip");
      }

      const listFile = join(workDir, "concat.txt");
      await writeFile(
        listFile,
        segmentPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n")
      );
      await execFileAsync(
        getFfmpegPath(),
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listFile,
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
          outputPath,
        ],
        { cwd: workDir, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
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
  onProgress?: RenderProgressCallback
): Promise<void> {
  const profile = getRenderProfile(renderMode === "subtitles_only" ? "preview" : renderMode);
  const workDir = join(tmpdir(), `ceo-subs-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const runInWorkDir = { cwd: workDir, windowsHide: true } as const;

  try {
    await onProgress?.(60, "subtitles");
    let normalizedLocal = join(workDir, "normalized.mp4");

    if (editPlan.subtitles.length === 0) {
      await copyFile(baseClipPath, normalizedLocal);
    } else {
      await writeFile(join(workDir, "subs.ass"), buildAssSubtitles(editPlan.subtitles, profile.height));
      const subtitledLocal = join(workDir, "subtitled.mp4");
      await execFileAsync(
        getFfmpegPath(),
        [
          "-y",
          "-i",
          baseClipPath,
          "-vf",
          "ass=subs.ass",
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
          subtitledLocal,
        ],
        runInWorkDir
      );

      if (editPlan.audio.normalize) {
        await execFileAsync(
          getFfmpegPath(),
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

    const shouldMixBgm = editPlan.audio.bgm !== "none";
    const useVoiceover =
      editPlan.audio.voiceover?.enabled && (editPlan.audio.voiceover.segments?.length ?? 0) > 0;

    if (useVoiceover) {
      try {
        await onProgress?.(72, "subtitles");
        const { synthesizeSpeech } = await import("@ceo-agent/agents");
        const { mixVideoWithVoiceoverAndBgm } = await import("./voiceover-mix");
        await mixVideoWithVoiceoverAndBgm(
          normalizedLocal,
          outputPath,
          editPlan,
          workDir,
          synthesizeSpeech
        );
        console.log("[ffmpeg] voiceover + BGM mixed");
      } catch (err) {
        console.warn("[ffmpeg] voiceover failed, falling back to BGM only:", err);
        if (shouldMixBgm) {
          const bgmKey = resolveBgmTrackKey(editPlan.audio.bgm ?? "default");
          const bgmPath = await resolveBgmFile(bgmKey);
          await mixBackgroundMusic(normalizedLocal, bgmPath, outputPath, editPlan.targetDurationSec, false);
        } else {
          await copyFile(normalizedLocal, outputPath);
        }
      }
    } else if (shouldMixBgm) {
      const bgmKey = resolveBgmTrackKey(editPlan.audio.bgm ?? "default");
      try {
        await onProgress?.(78, "subtitles");
        const bgmPath = await resolveBgmFile(bgmKey);
        await mixBackgroundMusic(
          normalizedLocal,
          bgmPath,
          outputPath,
          editPlan.targetDurationSec,
          false
        );
        console.log(`[ffmpeg] BGM mixed key=${bgmKey} dur=${editPlan.targetDurationSec}s`);
      } catch (err) {
        console.warn("[ffmpeg] BGM mix failed, using video without music:", err);
        await copyFile(normalizedLocal, outputPath);
      }
    } else {
      await copyFile(normalizedLocal, outputPath);
    }
    await onProgress?.(85, "subtitles");
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
        sourceDur
      );
      if (options?.cacheOutputPath) {
        await copyFile(baseLocal, options.cacheOutputPath);
      }
    } else {
      throw new Error("subtitles_only render requires cached base clip");
    }

    await burnSubtitles(baseLocal, editPlan, outputPath, renderMode, options?.onProgress);
    await options?.onProgress?.(95, "upload");
    return { usedCache };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function extractCoverFromImage(imagePath: string, outputPath: string): Promise<void> {
  await execFileAsync(getFfmpegPath(), [
    "-y",
    "-i",
    imagePath,
    "-vf",
    "scale='if(gt(a,9/16),-2,iw*1.1)':'if(gt(a,9/16),ih*1.1,-2)',crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=720:1280",
    "-q:v",
    "2",
    outputPath,
  ]);
}

export async function extractCover(inputPath: string, atSec: number, outputPath: string): Promise<void> {
  await execFileAsync(getFfmpegPath(), [
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
