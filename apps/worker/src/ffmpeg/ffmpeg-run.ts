import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegPath } from "./ffmpeg-path";

const execFileAsync = promisify(execFile);

/** Global FFmpeg flags that keep stderr small (no banner, errors only, no per-frame stats). */
export const FFMPEG_QUIET_FLAGS = ["-hide_banner", "-loglevel", "error", "-nostats"] as const;

/**
 * Centralized FFmpeg runner. Prepends quiet flags so stderr stays tiny and
 * defaults maxBuffer to 64MB to avoid "stderr maxBuffer length exceeded".
 */
export function runFfmpeg(
  args: string[],
  options?: { cwd?: string; maxBuffer?: number }
) {
  return execFileAsync(getFfmpegPath(), [...FFMPEG_QUIET_FLAGS, ...args], {
    cwd: options?.cwd,
    windowsHide: true,
    maxBuffer: options?.maxBuffer ?? 64 * 1024 * 1024,
  });
}
