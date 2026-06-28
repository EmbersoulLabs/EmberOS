import { stat } from "node:fs/promises";
import { runFfmpeg } from "./ffmpeg-run";

const TARGET_SIZE_BYTES = 480 * 1024 * 1024; // 480MB with 20MB safety margin

/**
 * Compress a source video to fit within ~480MB using bitrate targeting.
 * Caps height at 1920px so 4K/2K vertical footage is downscaled to 1080p first.
 * Returns true if compression was run, false if file was already small enough.
 */
export async function compressSourceVideo(
  inputPath: string,
  outputPath: string,
  durationSec: number
): Promise<{ compressed: boolean; originalBytes: number; outputBytes: number }> {
  const { size: originalBytes } = await stat(inputPath);

  if (originalBytes <= TARGET_SIZE_BYTES) {
    return { compressed: false, originalBytes, outputBytes: originalBytes };
  }

  const totalBitrateBps = (TARGET_SIZE_BYTES * 8) / durationSec;
  const audioBps = 128_000;
  const videoBps = Math.max(1_500_000, totalBitrateBps - audioBps);
  const videoBitrateKbps = Math.round(videoBps / 1000);
  const maxRateKbps = Math.round(videoBitrateKbps * 1.5);
  const bufsizeKbps = Math.round(videoBitrateKbps * 2);

  await runFfmpeg([
    "-i", inputPath,
    // Scale: cap height at 1920 (1080p max), preserve aspect ratio, ensure even dims.
    // For 9:16 vertical video this keeps max 1080×1920; for 16:9 keeps max 3413×1920.
    "-vf", "scale=-2:min(1920\\,ih)",
    "-c:v", "libx264",
    "-b:v", `${videoBitrateKbps}k`,
    "-maxrate", `${maxRateKbps}k`,
    "-bufsize", `${bufsizeKbps}k`,
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ]);

  const { size: outputBytes } = await stat(outputPath);
  return { compressed: true, originalBytes, outputBytes };
}
