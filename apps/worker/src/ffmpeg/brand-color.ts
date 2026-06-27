import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { getFfmpegPath } from "./ffmpeg-path";
import { FFMPEG_QUIET_FLAGS } from "./ffmpeg-run";

const execFileAsync = promisify(execFile);

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v: max };
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Extract a brand accent color from a logo image using ffmpeg palettegen.
 * Picks the most saturated, well-lit non-gray swatch. Returns #rrggbb or null.
 */
export async function extractBrandColorFromLogo(
  logoPath: string,
  workDir: string
): Promise<string | null> {
  const palettePath = join(workDir, `palette-${Date.now()}.png`);
  try {
    await execFileAsync(
      getFfmpegPath(),
      [
        ...FFMPEG_QUIET_FLAGS,
        "-y",
        "-i",
        logoPath,
        "-vf",
        "palettegen=max_colors=16:stats_mode=full",
        palettePath,
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    );

    const { stdout } = await execFileAsync(
      getFfmpegPath(),
      [...FFMPEG_QUIET_FLAGS, "-i", palettePath, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: "buffer" }
    );

    const buf = stdout as unknown as Buffer;
    let best: { hex: string; score: number } | null = null;
    let mostSaturated: { hex: string; s: number } | null = null;

    for (let i = 0; i + 3 < buf.length; i += 4) {
      const r = buf[i]!;
      const g = buf[i + 1]!;
      const b = buf[i + 2]!;
      const a = buf[i + 3]!;
      if (a < 128) continue;
      const { s, v } = rgbToHsv(r, g, b);
      const hex = toHex(r, g, b);

      if (!mostSaturated || s > mostSaturated.s) mostSaturated = { hex, s };

      // Skip near-white, near-black, and washed-out grays.
      if (v < 0.2 || v > 0.97 || s < 0.25) continue;
      const score = s * Math.min(v, 0.9);
      if (!best || score > best.score) best = { hex, score };
    }

    if (best) return best.hex;
    if (mostSaturated && mostSaturated.s > 0.15) return mostSaturated.hex;
    return null;
  } catch (err) {
    console.warn("[render] brand color extraction failed:", err);
    return null;
  } finally {
    await rm(palettePath, { force: true });
  }
}
