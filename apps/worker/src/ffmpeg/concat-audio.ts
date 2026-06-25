import { copyFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { getFfmpegPath } from "./ffmpeg-path";

const execFileAsync = promisify(execFile);

export async function concatMp3Files(
  inputPaths: string[],
  outputPath: string,
  workDir: string
): Promise<void> {
  if (inputPaths.length === 0) {
    throw new Error("No audio files to concat");
  }
  if (inputPaths.length === 1) {
    await copyFile(inputPaths[0]!, outputPath);
    return;
  }

  const listPath = join(workDir, "audio-concat.txt");
  const list = inputPaths
    .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, list);

  await execFileAsync(
    getFfmpegPath(),
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:a", "libmp3lame", "-q:a", "2", outputPath],
    { windowsHide: true }
  );
}
