/**
 * FFmpeg filter fragments for fitting arbitrary aspect ratios into 9:16.
 * Avoids single-quoted expressions (breaks on Windows) and crop x/y references to w/h.
 */

/** Upscale the short dimension so a center 9:16 crop always fits. */
export const FFMPEG_SCALE_FOR_916 =
  "scale=if(gt(iw/ih\\,9/16)\\,-2\\,iw*1.25):if(gt(iw/ih\\,9/16)\\,ih*1.25\\,-2):flags=lanczos";

/** Center crop to 9:16 — crop by height when wide, by width when tall/narrow. */
export const FFMPEG_CROP_916_CENTER =
  "crop=w=if(gt(iw/ih\\,9/16)\\,ih*9/16\\,iw):h=if(gt(iw/ih\\,9/16)\\,ih\\,iw*16/9):x=if(gt(iw/ih\\,9/16)\\,(iw-ih*9/16)/2\\,0):y=if(gt(iw/ih\\,9/16)\\,0\\,(ih-iw*16/9)/2)";

/** Scale → crop → optional middle filters → output scale. */
export function build916FitChain(scale: string, middle = ""): string {
  const mid = middle ? `,${middle}` : "";
  return `${FFMPEG_SCALE_FOR_916},${FFMPEG_CROP_916_CENTER}${mid},scale=${scale}:flags=lanczos`;
}

/** True when source is narrower than 9:16 (crop must use full width). */
export function isNarrowerThan916(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return width / height < 9 / 16;
}
