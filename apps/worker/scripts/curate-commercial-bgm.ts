/**
 * Replace the built-in (CC BY-NC) BGM beds with commercially licensable tracks
 * from Jamendo, keeping the SAME track ids/categories so all existing mappings
 * (recommendations, legacy keys) keep working.
 *
 * Requires a Jamendo client_id:  https://devportal.jamendo.com/
 *
 * Usage:
 *   JAMENDO_CLIENT_ID=xxxx pnpm --filter @ceo-agent/worker curate:bgm
 *
 * It will:
 *   1. Query Jamendo per category for non-NonCommercial, downloadable tracks.
 *   2. Verify each by downloading the mp3 into apps/worker/assets/bgm/<id>.mp3.
 *   3. Write packages/shared/src/bgm/commercial-library.generated.ts.
 *
 * After running: restart the worker and re-render clips.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FMA_FALLBACK_LIBRARY, type BgmCategory } from "@ceo-agent/shared";

const CLIENT_ID = process.env.JAMENDO_CLIENT_ID;
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "bgm");
const GENERATED_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "shared",
  "src",
  "bgm",
  "commercial-library.generated.ts"
);

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; EmberOS-Worker/1.0)",
  Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
};

/** Jamendo search keywords per category (commercial / marketing oriented). */
const CATEGORY_TAGS: Record<BgmCategory, string> = {
  luxury: "piano elegant relaxing",
  corporate: "corporate motivational positive",
  emotional: "emotional piano heartfelt",
  inspirational: "inspirational uplifting hopeful",
  cinematic: "cinematic epic orchestral",
  modern_tech: "electronic technology modern",
  retail_promotion: "upbeat happy pop commercial",
  upbeat: "upbeat energetic fun",
  calm: "calm ambient relaxing",
  storytelling: "acoustic folk warm",
};

type JamendoTrack = {
  id: string;
  name: string;
  artist_name?: string;
  duration?: number;
  audiodownload?: string;
  audiodownload_allowed?: boolean;
  license_ccurl?: string;
};

function isCommercialSafe(t: JamendoTrack): boolean {
  if (t.audiodownload_allowed === false) return false;
  if (!t.audiodownload) return false;
  const lic = (t.license_ccurl ?? "").toLowerCase();
  if (!lic) return false;
  if (lic.includes("/by-nc") || lic.includes("nc-")) return false;
  return true;
}

async function searchCategory(tags: string): Promise<JamendoTrack[]> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    format: "json",
    limit: "40",
    audioformat: "mp32",
    audiodlallowed: "true",
    include: "licenses",
    order: "popularity_total",
    groupby: "artist_id",
    search: tags,
  });
  const res = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Jamendo search failed (${res.status})`);
  const data = (await res.json()) as { results?: JamendoTrack[] };
  return (data.results ?? []).filter(isCommercialSafe);
}

async function downloadVerify(id: string, url: string): Promise<boolean> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4096) return false;
  await writeFile(join(ASSETS_DIR, `${id}.mp3`), buf);
  return true;
}

type GeneratedTrack = {
  id: string;
  name: string;
  category: BgmCategory;
  durationSec: number;
  bpm: number;
  mood: string;
  tags: string[];
  fileUrl: string;
  brightness?: "warm" | "neutral" | "dark";
  license: "royalty_free";
  attribution: string;
  licenseUrl: string;
};

async function main() {
  if (!CLIENT_ID) {
    console.error(
      "JAMENDO_CLIENT_ID is not set. Get a free client_id at https://devportal.jamendo.com/ and re-run."
    );
    process.exit(1);
  }

  await mkdir(ASSETS_DIR, { recursive: true });

  // Use the full built-in list as templates so ids/categories stay stable.
  const templates = FMA_FALLBACK_LIBRARY;
  const cache = new Map<BgmCategory, JamendoTrack[]>();
  const usedTrackIds = new Set<string>();
  const out: GeneratedTrack[] = [];

  for (const tmpl of templates) {
    const category = tmpl.category;
    if (!cache.has(category)) {
      try {
        cache.set(category, await searchCategory(CATEGORY_TAGS[category] ?? tmpl.mood));
      } catch (err) {
        console.warn(`[curate] search failed for ${category}:`, err);
        cache.set(category, []);
      }
    }

    const candidates = cache.get(category)!;
    let picked: JamendoTrack | undefined;
    while (candidates.length > 0) {
      const candidate = candidates.shift()!;
      if (usedTrackIds.has(candidate.id)) continue;
      const ok = await downloadVerify(tmpl.id, candidate.audiodownload!);
      if (ok) {
        picked = candidate;
        usedTrackIds.add(candidate.id);
        break;
      }
      console.warn(`[curate] verify failed for "${candidate.name}", trying next`);
    }

    if (!picked) {
      console.warn(`[curate] no commercial track found for ${tmpl.id} (${category}) — skipped`);
      continue;
    }

    out.push({
      id: tmpl.id,
      name: tmpl.name,
      category,
      durationSec: picked.duration ?? tmpl.durationSec,
      bpm: tmpl.bpm,
      mood: tmpl.mood,
      tags: tmpl.tags,
      fileUrl: picked.audiodownload!,
      brightness: tmpl.brightness,
      license: "royalty_free",
      attribution: `"${picked.name}" by ${picked.artist_name ?? "Unknown"} (Jamendo)`,
      licenseUrl: picked.license_ccurl ?? "",
    });
    console.log(`[curate] ${tmpl.id} ← "${picked.name}" by ${picked.artist_name}`);
  }

  if (out.length === 0) {
    console.error("[curate] No commercial tracks resolved. Library not changed.");
    process.exit(1);
  }

  const body = `/**
 * AUTO-GENERATED by \`pnpm --filter @ceo-agent/worker curate:bgm\` — do not edit by hand.
 * Commercially licensable BGM (non-NonCommercial CC) sourced from Jamendo.
 */
import type { BgmTrack } from "./library";

export const COMMERCIAL_BGM_LIBRARY: BgmTrack[] = ${JSON.stringify(out, null, 2)};
`;

  await writeFile(GENERATED_FILE, body);
  console.log(
    `\n[curate] Wrote ${out.length} commercial tracks to commercial-library.generated.ts and bundled mp3s.`
  );
  console.log("[curate] Restart the worker and re-render clips to apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
