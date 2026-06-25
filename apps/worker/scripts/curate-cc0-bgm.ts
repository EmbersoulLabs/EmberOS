/**
 * Populate the commercial-safe BGM library from CC0 (public-domain, no-attribution)
 * tracks hosted on the Internet Archive. Reliable, hotlink-friendly, royalty-free.
 *
 * Keeps the SAME track ids/categories as the built-in templates so recommendations
 * and legacy key mappings keep working; only the audio source + display name change.
 *
 * Usage:
 *   pnpm --filter @ceo-agent/worker curate:bgm:cc0
 *
 * After running: restart the worker and re-render clips.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FMA_FALLBACK_LIBRARY, type BgmCategory } from "@ceo-agent/shared";

/** Target track count for the built-in picker (50–60 range). */
const TARGET_TRACK_COUNT = 58;

/** Extra CC0 slots beyond the legacy 20 templates — marketing ids + categories. */
const CC0_EXTRA_TEMPLATES: Array<{
  id: string;
  name: string;
  category: BgmCategory;
  mood: string;
  bpm: number;
  tags: string[];
  brightness?: "warm" | "neutral" | "dark";
}> = [
  { id: "cc0_serene_dawn", name: "Serene Dawn", category: "calm", mood: "peaceful", bpm: 70, tags: ["calm", "morning", "soft"], brightness: "warm" },
  { id: "cc0_gentle_breeze", name: "Gentle Breeze", category: "calm", mood: "relaxing", bpm: 68, tags: ["ambient", "spa", "wellness"], brightness: "warm" },
  { id: "cc0_cozy_corner", name: "Cozy Corner", category: "calm", mood: "cozy", bpm: 72, tags: ["cafe", "lifestyle", "warm"], brightness: "warm" },
  { id: "cc0_soft_horizon", name: "Soft Horizon", category: "calm", mood: "dreamy", bpm: 74, tags: ["ambient", "soft", "background"], brightness: "neutral" },
  { id: "cc0_morning_light", name: "Morning Light", category: "emotional", mood: "hopeful", bpm: 76, tags: ["emotional", "warm", "gentle"], brightness: "warm" },
  { id: "cc0_heartfelt_path", name: "Heartfelt Path", category: "emotional", mood: "tender", bpm: 72, tags: ["story", "family", "warm"], brightness: "warm" },
  { id: "cc0_warm_embrace", name: "Warm Embrace", category: "emotional", mood: "heartfelt", bpm: 70, tags: ["romantic", "gift", "soft"], brightness: "warm" },
  { id: "cc0_golden_hour", name: "Golden Hour", category: "emotional", mood: "nostalgic", bpm: 74, tags: ["sunset", "memory", "warm"], brightness: "warm" },
  { id: "cc0_rise_up", name: "Rise Up", category: "inspirational", mood: "uplifting", bpm: 96, tags: ["motivation", "growth", "positive"], brightness: "warm" },
  { id: "cc0_new_chapter", name: "New Chapter", category: "inspirational", mood: "hopeful", bpm: 92, tags: ["education", "startup", "bright"], brightness: "warm" },
  { id: "cc0_forward_motion", name: "Forward Motion", category: "inspirational", mood: "driven", bpm: 100, tags: ["progress", "team", "energy"], brightness: "warm" },
  { id: "cc0_skyward", name: "Skyward", category: "inspirational", mood: "aspiring", bpm: 94, tags: ["success", "achievement", "bright"], brightness: "warm" },
  { id: "cc0_boardroom", name: "Boardroom", category: "corporate", mood: "professional", bpm: 88, tags: ["business", "b2b", "trust"], brightness: "warm" },
  { id: "cc0_steady_growth", name: "Steady Growth", category: "corporate", mood: "stable", bpm: 84, tags: ["finance", "corporate", "steady"], brightness: "warm" },
  { id: "cc0_team_spirit", name: "Team Spirit", category: "corporate", mood: "confident", bpm: 90, tags: ["team", "office", "positive"], brightness: "warm" },
  { id: "cc0_clear_vision", name: "Clear Vision", category: "corporate", mood: "focused", bpm: 86, tags: ["presentation", "strategy", "clean"], brightness: "neutral" },
  { id: "cc0_grand_opening", name: "Grand Opening", category: "luxury", mood: "elegant", bpm: 72, tags: ["premium", "boutique", "spa"], brightness: "warm" },
  { id: "cc0_velvet_touch", name: "Velvet Touch", category: "luxury", mood: "refined", bpm: 68, tags: ["beauty", "salon", "soft"], brightness: "warm" },
  { id: "cc0_pearl_glow", name: "Pearl Glow", category: "luxury", mood: "intimate", bpm: 70, tags: ["floral", "gift", "romantic"], brightness: "warm" },
  { id: "cc0_silk_road", name: "Silk Road", category: "luxury", mood: "sophisticated", bpm: 74, tags: ["high-end", "fashion", "elegant"], brightness: "neutral" },
  { id: "cc0_wide_lens", name: "Wide Lens", category: "cinematic", mood: "epic", bpm: 78, tags: ["cinematic", "hero", "brand"], brightness: "neutral" },
  { id: "cc0_deep_story", name: "Deep Story", category: "cinematic", mood: "dramatic", bpm: 76, tags: ["narrative", "film", "wide"], brightness: "dark" },
  { id: "cc0_horizon_line", name: "Horizon Line", category: "cinematic", mood: "expansive", bpm: 80, tags: ["landscape", "travel", "epic"], brightness: "neutral" },
  { id: "cc0_twilight_tale", name: "Twilight Tale", category: "cinematic", mood: "mysterious", bpm: 74, tags: ["moody", "story", "ambient"], brightness: "dark" },
  { id: "cc0_digital_pulse", name: "Digital Pulse", category: "modern_tech", mood: "innovative", bpm: 104, tags: ["tech", "saas", "startup"], brightness: "warm" },
  { id: "cc0_future_wave", name: "Future Wave", category: "modern_tech", mood: "futuristic", bpm: 108, tags: ["ai", "digital", "modern"], brightness: "neutral" },
  { id: "cc0_neon_drift", name: "Neon Drift", category: "modern_tech", mood: "sleek", bpm: 102, tags: ["app", "product", "clean"], brightness: "neutral" },
  { id: "cc0_code_flow", name: "Code Flow", category: "modern_tech", mood: "focused", bpm: 100, tags: ["developer", "workspace", "tech"], brightness: "warm" },
  { id: "cc0_shop_happy", name: "Shop Happy", category: "retail_promotion", mood: "bright", bpm: 110, tags: ["retail", "sale", "promo"], brightness: "warm" },
  { id: "cc0_flash_deal", name: "Flash Deal", category: "retail_promotion", mood: "energetic", bpm: 112, tags: ["shopping", "deal", "fast"], brightness: "warm" },
  { id: "cc0_weekend_sale", name: "Weekend Sale", category: "retail_promotion", mood: "fun", bpm: 108, tags: ["fashion", "mall", "promo"], brightness: "warm" },
  { id: "cc0_boutique_pop", name: "Boutique Pop", category: "retail_promotion", mood: "playful", bpm: 106, tags: ["boutique", "lifestyle", "pop"], brightness: "warm" },
  { id: "cc0_sunny_day", name: "Sunny Day", category: "upbeat", mood: "cheerful", bpm: 118, tags: ["social", "tiktok", "fun"], brightness: "warm" },
  { id: "cc0_jump_start", name: "Jump Start", category: "upbeat", mood: "energetic", bpm: 120, tags: ["fast", "dynamic", "youth"], brightness: "warm" },
  { id: "cc0_party_vibe", name: "Party Vibe", category: "upbeat", mood: "festive", bpm: 116, tags: ["event", "celebration", "bright"], brightness: "warm" },
  { id: "cc0_good_times", name: "Good Times", category: "upbeat", mood: "playful", bpm: 114, tags: ["lifestyle", "vlog", "happy"], brightness: "warm" },
  { id: "cc0_road_trip", name: "Road Trip", category: "storytelling", mood: "adventurous", bpm: 88, tags: ["journey", "travel", "vlog"], brightness: "warm" },
  { id: "cc0_page_turner", name: "Page Turner", category: "storytelling", mood: "narrative", bpm: 82, tags: ["story", "blog", "warm"], brightness: "warm" },
  { id: "cc0_village_tale", name: "Village Tale", category: "storytelling", mood: "folk", bpm: 80, tags: ["acoustic", "local", "cozy"], brightness: "warm" },
  { id: "cc0_wanderlust", name: "Wanderlust", category: "storytelling", mood: "curious", bpm: 86, tags: ["explore", "documentary", "soft"], brightness: "neutral" },
];

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

const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

/** Curated CC0 albums on the Internet Archive (Komiku — public domain). */
const IA_ALBUMS = [
  "Komiku-ItsTimeForAdventureVol2",
  "komiku-the-adventure-goes-on-vol.-1",
  "komiku-the-adventure-goes-on-vol.-2",
  "komiku-cliff-road-chill",
  "Komiku-the_binge_watchers",
  "komiku-a-tale-is-never-forgotten",
  "komiku-animal-summer-music-camp",
  "Komiku-HeliceAwesomeDanceAdventure",
  "Komiku-ultra_person_vol1",
  "Komiku-ultra_person_vol2",
  "Komiku-ultra_person_vol3",
  "Komiku-ultra_person_vol4",
  "Komiku-Poupis_incredible_adventures",
  "komiku-incredible-kart-game",
  "Komiku01ChildhoodScene",
];

type IaFile = { name: string; title?: string; length?: string; format?: string };
type PoolTrack = { title: string; url: string; durationSec: number };

function prettifyName(fileName: string): string {
  const base = fileName.replace(/\.mp3$/i, "");
  const m = base.match(/_-_\d+_-_(.+)$/);
  const raw = m ? m[1]! : base;
  return raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseDuration(len?: string): number {
  if (!len) return 0;
  if (len.includes(":")) {
    const parts = len.split(":").map(Number);
    return parts.reduce((acc, n) => acc * 60 + (Number.isFinite(n) ? n : 0), 0);
  }
  const n = Number(len);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function albumTracks(identifier: string): Promise<PoolTrack[]> {
  const res = await fetch(`https://archive.org/metadata/${identifier}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`IA metadata failed for ${identifier} (${res.status})`);
  const data = (await res.json()) as { files?: IaFile[] };
  return (data.files ?? [])
    .filter((f) => /\.mp3$/i.test(f.name))
    .map((f) => ({
      title: f.title?.trim() || prettifyName(f.name),
      url: `https://archive.org/download/${identifier}/${encodeURIComponent(f.name)}`,
      durationSec: parseDuration(f.length),
    }))
    .filter((t) => t.durationSec === 0 || t.durationSec >= 30);
}

async function downloadVerify(id: string, url: string): Promise<boolean> {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4096) return false;
  await writeFile(join(ASSETS_DIR, `${id}.mp3`), buf);
  return true;
}

type GeneratedTrack = {
  id: string;
  name: string;
  category: string;
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
  await mkdir(ASSETS_DIR, { recursive: true });

  // Build a round-robin pool across albums for variety.
  const perAlbum: PoolTrack[][] = [];
  for (const id of IA_ALBUMS) {
    try {
      perAlbum.push(await albumTracks(id));
      console.log(`[cc0] ${id}: ${perAlbum[perAlbum.length - 1]!.length} tracks`);
    } catch (err) {
      console.warn(`[cc0] skip ${id}:`, err);
    }
  }

  const pool: PoolTrack[] = [];
  let added = true;
  for (let i = 0; added; i++) {
    added = false;
    for (const album of perAlbum) {
      if (album[i]) {
        pool.push(album[i]!);
        added = true;
      }
    }
  }

  const legacyTemplates = FMA_FALLBACK_LIBRARY.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    mood: t.mood,
    bpm: t.bpm,
    tags: t.tags,
    brightness: t.brightness,
    durationSec: t.durationSec,
  }));

  const extraNeeded = Math.max(0, TARGET_TRACK_COUNT - legacyTemplates.length);
  const extraTemplates = CC0_EXTRA_TEMPLATES.slice(0, extraNeeded).map((t) => ({
    ...t,
    durationSec: 180,
  }));

  const templates = [...legacyTemplates, ...extraTemplates];
  console.log(`[cc0] curating ${templates.length} tracks (legacy ${legacyTemplates.length} + extra ${extraTemplates.length})`);

  const usedUrls = new Set<string>();
  const out: GeneratedTrack[] = [];
  let cursor = 0;

  for (const tmpl of templates) {
    let picked: PoolTrack | undefined;
    while (cursor < pool.length) {
      const candidate = pool[cursor++]!;
      if (usedUrls.has(candidate.url)) continue;
      const ok = await downloadVerify(tmpl.id, candidate.url);
      if (ok) {
        picked = candidate;
        usedUrls.add(candidate.url);
        break;
      }
      console.warn(`[cc0] verify failed: ${candidate.title}`);
    }

    if (!picked) {
      console.warn(`[cc0] ran out of verified tracks for ${tmpl.id} — skipped`);
      continue;
    }

    out.push({
      id: tmpl.id,
      name: tmpl.name,
      category: tmpl.category,
      durationSec: picked.durationSec || tmpl.durationSec,
      bpm: tmpl.bpm,
      mood: tmpl.mood,
      tags: tmpl.tags,
      fileUrl: picked.url,
      brightness: tmpl.brightness,
      license: "royalty_free",
      attribution: `"${picked.title}" by Komiku (CC0 / Public Domain — no attribution required)`,
      licenseUrl: CC0_URL,
    });
    console.log(`[cc0] ${tmpl.id} ← "${picked.title}"`);
  }

  if (out.length === 0) {
    console.error("[cc0] No tracks resolved. Library not changed.");
    process.exit(1);
  }

  const body = `/**
 * AUTO-GENERATED by \`pnpm --filter @ceo-agent/worker curate:bgm:cc0\` — do not edit by hand.
 * CC0 (public domain, no attribution) BGM sourced from the Internet Archive.
 */
import type { BgmTrack } from "./library";

export const COMMERCIAL_BGM_LIBRARY: BgmTrack[] = ${JSON.stringify(out, null, 2)};
`;

  await writeFile(GENERATED_FILE, body);
  console.log(
    `\n[cc0] Wrote ${out.length} CC0 tracks to commercial-library.generated.ts and bundled mp3s.`
  );
  console.log("[cc0] Restart the worker and re-render clips to apply.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
