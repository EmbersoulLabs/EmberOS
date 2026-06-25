import { copyFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFfmpegPath } from "./ffmpeg-path";

const execFileAsync = promisify(execFile);

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

  const listPath = join(workDir, "video-concat.txt");
  const list = inputPaths
    .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, list);

  await execFileAsync(
    getFfmpegPath(),
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { windowsHide: true }
  );
}
