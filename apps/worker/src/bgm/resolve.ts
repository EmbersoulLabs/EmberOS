import { mkdir, access, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { getBgmTrack } from "@ceo-agent/shared";

const CACHE_DIR = join(tmpdir(), "ceo-bgm-cache");
const BUNDLED_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "bgm");

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; EmberOS-Worker/1.0)",
  Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
};

async function tryBundled(bgmKey: string): Promise<string | null> {
  for (const key of [bgmKey, "default"]) {
    const bundledPath = join(BUNDLED_DIR, `${key}.mp3`);
    try {
      await access(bundledPath);
      return bundledPath;
    } catch {
      /* next */
    }
  }
  return null;
}

export async function resolveBgmFile(bgmKey: string): Promise<string> {
  const track = getBgmTrack(bgmKey);
  await mkdir(CACHE_DIR, { recursive: true });
  const hash = createHash("sha1").update(track.url).digest("hex").slice(0, 12);
  const localPath = join(CACHE_DIR, `${bgmKey}-${hash}.mp3`);

  const bundled = await tryBundled(bgmKey);
  if (bundled) {
    try {
      await access(localPath);
    } catch {
      await copyFile(bundled, localPath);
    }
    return localPath;
  }

  try {
    await access(localPath);
    return localPath;
  } catch {
    /* cache miss */
  }

  const res = await fetch(track.url, { headers: FETCH_HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to download BGM: ${track.label} (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4096) {
    throw new Error(`BGM download too small (${buf.length} bytes): ${track.label}`);
  }
  await writeFile(localPath, buf);
  return localPath;
}
