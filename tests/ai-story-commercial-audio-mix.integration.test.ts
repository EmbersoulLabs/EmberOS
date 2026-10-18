import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { mixBackgroundMusic } from "../apps/worker/src/ffmpeg/audio-mix";
import { getFfmpegPath } from "../apps/worker/src/ffmpeg/ffmpeg-path";
import { mediaHasAudio } from "../apps/worker/src/ffmpeg/probe-audio";

const execFileAsync = promisify(execFile);

describe("commercial audio reuses the Video Studio mixer", () => {
  it("adds an audio stream to a silent picture and keeps the picture duration", async () => {
    const ffmpeg = getFfmpegPath();
    const dir = await mkdtemp(join(tmpdir(), "commercial-audio-mix-"));
    try {
      const video = join(dir, "silent.mp4");
      const tone = join(dir, "tone.mp3");
      const output = join(dir, "mixed.mp4");
      await execFileAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=5", "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", video], { windowsHide: true });
      await execFileAsync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:a", "libmp3lame", tone], { windowsHide: true });
      expect(await mediaHasAudio(video)).toBe(false);
      await mixBackgroundMusic(video, tone, output, 5, false, 0);
      expect(await mediaHasAudio(output)).toBe(true);
      const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
      const probe = async (file: string) => Number((await execFileAsync(ffprobe, ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file], { windowsHide: true })).stdout.trim());
      expect(Math.abs(await probe(output) - await probe(video))).toBeLessThan(0.5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
