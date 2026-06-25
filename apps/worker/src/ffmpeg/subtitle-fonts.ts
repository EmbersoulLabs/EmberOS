import { existsSync } from "node:fs";
import { copyFile as copyFileAsync } from "node:fs/promises";
import { dirname, join } from "node:path";
import { platform as nodePlatform } from "node:os";
import { fileURLToPath } from "node:url";

/** Internal family name of bundled NotoSansCJKsc-Regular.otf — used for all subtitle styles. */
export const SUBTITLE_FONT_NAME = "Noto Sans CJK SC";

export const BUNDLED_FONT_FILENAME = "NotoSansCJKsc-Regular.otf";

/** Resolve worker package root (works for tsx src/ and compiled dist/). */
function workerPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ffmpeg or dist/ffmpeg → apps/worker
  return join(here, "..", "..");
}

const BUNDLED_FONTS_DIR = join(workerPackageRoot(), "assets", "fonts");
const BUNDLED_FONT_FILE = join(BUNDLED_FONTS_DIR, BUNDLED_FONT_FILENAME);

function systemFontsDir(): string {
  if (nodePlatform() === "win32") return "C:/Windows/Fonts";
  if (nodePlatform() === "darwin") return "/System/Library/Fonts";
  return "/usr/share/fonts";
}

function systemFallbackFontName(): string {
  if (nodePlatform() === "win32") return "Microsoft YaHei";
  if (nodePlatform() === "darwin") return "PingFang SC";
  return "Noto Sans CJK SC";
}

export function hasBundledSubtitleFont(): boolean {
  return existsSync(BUNDLED_FONT_FILE);
}

/** One font family for hook/body/CTA and EN/ZH lines. */
export function subtitleFontName(): string {
  // Windows: bundled OTF + libass fontsdir is unreliable; YaHei is always present on CN Windows.
  if (nodePlatform() === "win32") return "Microsoft YaHei";
  return hasBundledSubtitleFont() ? SUBTITLE_FONT_NAME : systemFallbackFontName();
}

/** Directory passed to ffmpeg ass filter fontsdir= */
export function subtitleFontsDir(): string {
  if (nodePlatform() === "win32") return systemFontsDir();
  return hasBundledSubtitleFont() ? BUNDLED_FONTS_DIR : systemFontsDir();
}

/** Escape path for ffmpeg ass filter (Windows drive colons). */
export function ffmpegAssFontsDir(): string {
  return subtitleFontsDir().replace(/\\/g, "/").replace(/:/g, "\\:");
}

/**
 * Copy bundled CJK font next to subs.ass so ffmpeg libass can load glyphs reliably
 * (especially on Windows where absolute fontsdir paths often fail).
 */
export async function stageSubtitleFontForRender(workDir: string): Promise<boolean> {
  // Windows uses system Microsoft YaHei — no need to copy OTF beside subs.ass.
  if (nodePlatform() === "win32") return false;
  if (!hasBundledSubtitleFont()) return false;
  const dest = join(workDir, BUNDLED_FONT_FILENAME);
  if (!existsSync(dest)) {
    await copyFileAsync(BUNDLED_FONT_FILE, dest);
  }
  return true;
}

export function logSubtitleFontStatus(): void {
  const bundled = hasBundledSubtitleFont();
  console.log(
    `[worker] subtitles: font=${subtitleFontName()} bundled=${bundled} dir=${subtitleFontsDir()}`
  );
  if (!bundled) {
    console.warn(
      "[worker] bundled NotoSansCJKsc-Regular.otf missing — Chinese subtitles may show as boxes"
    );
  }
}
