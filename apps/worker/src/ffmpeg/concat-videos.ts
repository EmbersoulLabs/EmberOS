import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "./ffmpeg-run";

/** Downscale + normalize each part so concat can use stream copy (low RAM on Railway). */
async function normalizeMergePart(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    "scale='min(720,iw)':-2:flags=fast_bilinear,fps=30,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-threads",
    "1",
    "-c:a",
    "aac",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
}

export async function concatVideoFiles(
  inputPaths: string[],
  outputPath: string,
  workDir: string
): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error("No video files to concat");
  }
  if (inputPaths.length === 1) {
    await copyFile(inputPaths[0]!, outputPath);
    return;
  }

  const normalizedPaths: string[] = [];
  for (let i = 0; i < inputPaths.length; i++) {
    const normalizedPath = join(workDir, `norm-${i}.mp4`);
    await normalizeMergePart(inputPaths[i]!, normalizedPath);
    normalizedPaths.push(normalizedPath);
  }

  const listPath = join(workDir, "video-concat.txt");
  const list = normalizedPaths
    .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, list);

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
