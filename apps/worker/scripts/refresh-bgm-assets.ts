/**

 * Download bundled BGM mp3 files from the music library (run after catalog changes).

 * Usage: pnpm --filter @ceo-agent/worker refresh:bgm

 */

import { writeFile, mkdir } from "node:fs/promises";

import { dirname, join } from "node:path";

import { fileURLToPath } from "node:url";

import { BGM_LIBRARY } from "@ceo-agent/shared";



const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "bgm");



const HEADERS = {

  "User-Agent": "Mozilla/5.0 (compatible; EmberOS-Worker/1.0)",

  Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",

};



async function download(key: string, url: string) {

  const res = await fetch(url, { headers: HEADERS });

  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length < 4096) throw new Error(`${key}: file too small (${buf.length} bytes)`);

  const out = join(OUT_DIR, `${key}.mp3`);

  await writeFile(out, buf);

  console.log(`[refresh-bgm] ${key} → ${out} (${(buf.length / 1024).toFixed(0)} KB)`);

}



async function main() {

  await mkdir(OUT_DIR, { recursive: true });

  const seen = new Set<string>();

  for (const track of BGM_LIBRARY) {

    if (seen.has(track.id)) continue;

    seen.add(track.id);

    await download(track.id, track.fileUrl);

  }

  console.log(`\nBundled ${seen.size} BGM tracks. Restart worker and re-render clips.`);

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});

