import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EditPlan } from "@ceo-agent/shared";

const execFileAsync = promisify(execFile);

export function getFfmpegPath() {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  codec: string;
}

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

function buildAssSubtitles(subtitles: EditPlan["subtitles"]): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,0,5,10,10,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = subtitles.map((s) => {
    const start = formatAssTime(s.startSec);
    const end = formatAssTime(s.endSec);
    const text = s.text.replace(/\n/g, "\\N");
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
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

export async function renderVideo(
  inputPath: string,
  editPlan: EditPlan,
  outputPath: string,
  resolution: "preview" | "export" = "preview"
): Promise<void> {
  const workDir = join(tmpdir(), `ceo-render-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const clip = editPlan.clips[0];
    const startSec = clip?.startSec ?? 0;
    const endSec = clip?.endSec ?? editPlan.targetDurationSec;
    const scale = resolution === "preview" ? "720:1280" : "1080:1920";
    const crf = resolution === "preview" ? "23" : "20";

    const clipPath = join(workDir, "clip.mp4");
    await execFileAsync(getFfmpegPath(), [
      "-y",
      "-ss",
      String(startSec),
      "-to",
      String(endSec),
      "-i",
      inputPath,
      "-vf",
      `crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${scale}`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      crf,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      clipPath,
    ]);

    if (editPlan.subtitles.length > 0) {
      const assPath = join(workDir, "subs.ass");
      await writeFile(assPath, buildAssSubtitles(editPlan.subtitles));
      const subtitledPath = join(workDir, "subtitled.mp4");
      await execFileAsync(getFfmpegPath(), [
        "-y",
        "-i",
        clipPath,
        "-vf",
        `ass=${assPath.replace(/\\/g, "/")}`,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        crf,
        "-c:a",
        "copy",
        subtitledPath,
      ]);

      if (editPlan.audio.normalize) {
        await execFileAsync(getFfmpegPath(), [
          "-y",
          "-i",
          subtitledPath,
          "-af",
          "loudnorm=I=-16:TP=-1.5:LRA=11",
          "-c:v",
          "copy",
          outputPath,
        ]);
      } else {
        await execFileAsync(getFfmpegPath(), ["-y", "-i", subtitledPath, "-c", "copy", outputPath]);
      }
    } else {
      await execFileAsync(getFfmpegPath(), ["-y", "-i", clipPath, "-c", "copy", outputPath]);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
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

export async function downloadToTemp(url: string, filename: string): Promise<string> {
  const path = join(tmpdir(), filename);
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(path, buffer);
  return path;
}

export { readFile };
