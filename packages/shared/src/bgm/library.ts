/** EmberOS AI Music Library — marketing-focused beds (FMA Chad Crouch, CC BY-NC). */

import { COMMERCIAL_BGM_LIBRARY } from "./commercial-library.generated";

const FMA = "https://files.freemusicarchive.org/storage-freemusicarchive-org/music/ccCommunity/Chad_Crouch";
const AMB = `${FMA}/Ambient_Atmospheres`;
const ARPS = `${FMA}/Arps`;

/**
 * Distinct marketing beds (Chad Crouch, CC BY-NC). Each constant is a *different*
 * audio file so the library no longer collapses to a single song.
 * - Ambient Atmospheres → elegant / cinematic / calm piano + pads.
 * - Arps → warm analog-synth arpeggios for tech / upbeat / promo energy.
 */
const AMB_TUSCAN_SUN = `${AMB}/Chad_Crouch_-_Tuscan_Sun.mp3`; // warm piano
const AMB_CORAL = `${AMB}/Chad_Crouch_-_Coral.mp3`; // soft, intimate
const AMB_RUBY = `${AMB}/Chad_Crouch_-_Ruby.mp3`; // bright, short
const AMB_CHARCOAL = `${AMB}/Chad_Crouch_-_Charcoal.mp3`; // dark, cinematic
const AMB_TAUT = `${AMB}/Chad_Crouch_-_Taut.mp3`; // tense, narrative
const ARP_ALGORITHMS = `${ARPS}/Chad_Crouch_-_Algorithms.mp3`; // energetic synth
const ARP_ELIPSIS = `${ARPS}/Chad_Crouch_-_Elipsis.mp3`; // flowing synth
const ARP_ILLUSTRATED = `${ARPS}/Chad_Crouch_-_Illustrated_Novel.mp3`; // playful synth
const ARP_MOONRISE = `${ARPS}/Chad_Crouch_-_Moonrise.mp3`; // dreamy synth
const ARP_NEGENTROPY = `${ARPS}/Chad_Crouch_-_Negentropy.mp3`; // uplifting build
const ARP_ORGANISMS = `${ARPS}/Chad_Crouch_-_Organisms.mp3`; // bouncy synth
const ARP_SHIPPING = `${ARPS}/Chad_Crouch_-_Shipping_Lanes.mp3`; // steady synth

export const BGM_CATEGORIES = [
  "luxury",
  "corporate",
  "emotional",
  "inspirational",
  "cinematic",
  "modern_tech",
  "retail_promotion",
  "upbeat",
  "calm",
  "storytelling",
] as const;

export type BgmCategory = (typeof BGM_CATEGORIES)[number];

export const BGM_USER_PREFERENCES = [
  "auto",
  "luxury",
  "corporate",
  "emotional",
  "inspirational",
  "cinematic",
  "modern_tech",
  "retail_promotion",
  "calm",
  "upbeat",
] as const;

export type BgmUserPreference = (typeof BGM_USER_PREFERENCES)[number];
export const DEFAULT_BGM_PREFERENCE: BgmUserPreference = "auto";

export type BgmLicense = "royalty_free" | "licensed" | "ai_generated";

export interface BgmTrack {
  id: string;
  name: string;
  category: BgmCategory;
  durationSec: number;
  bpm: number;
  mood: string;
  tags: string[];
  fileUrl: string;
  /** warm = bright marketing-friendly; neutral = versatile; dark = cinematic/ambient (use sparingly). */
  brightness?: "warm" | "neutral" | "dark";
  energyLevel?: "low" | "medium" | "high";
  emotionalTone?: string;
  license?: BgmLicense;
  /** Human-readable credit line (e.g. CC0 / CC-BY tracks). */
  attribution?: string;
  /** License deed URL for the track. */
  licenseUrl?: string;
}

export function bgmAudioSourceKey(track: BgmTrack): string {
  return track.fileUrl;
}

/**
 * Built-in FMA fallback beds (Chad Crouch, CC BY-NC — NOT for commercial use).
 * Replaced at runtime by COMMERCIAL_BGM_LIBRARY once `curate:bgm` has populated it.
 * Exported as the canonical template list for the curation scripts (stable regardless
 * of whether the generated commercial library is currently active).
 */
export const FMA_FALLBACK_LIBRARY: BgmTrack[] = [
  {
    id: "luxury_piano",
    name: "Luxury Piano",
    category: "luxury",
    durationSec: 200,
    bpm: 72,
    mood: "elegant",
    tags: ["piano", "premium", "floral", "beauty"],
    fileUrl: AMB_TUSCAN_SUN,
    brightness: "warm",
  },
  {
    id: "luxury_strings",
    name: "Luxury Strings",
    category: "luxury",
    durationSec: 135,
    bpm: 68,
    mood: "soft",
    tags: ["strings", "romantic", "boutique"],
    fileUrl: AMB_CORAL,
    brightness: "warm",
  },
  {
    id: "luxury_ambient",
    name: "Luxury Ambient",
    category: "luxury",
    durationSec: 180,
    bpm: 72,
    mood: "elegant",
    tags: ["piano", "spa", "high-end"],
    fileUrl: AMB_TAUT,
    brightness: "neutral",
  },
  {
    id: "luxury_soft_piano",
    name: "Luxury Soft Piano",
    category: "luxury",
    durationSec: 135,
    bpm: 70,
    mood: "intimate",
    tags: ["piano", "soft", "gift"],
    fileUrl: AMB_CORAL,
    brightness: "warm",
  },
  {
    id: "corporate_inspirational",
    name: "Corporate Inspirational",
    category: "corporate",
    durationSec: 145,
    bpm: 88,
    mood: "confident",
    tags: ["business", "trust", "property"],
    fileUrl: ARP_NEGENTROPY,
    brightness: "warm",
  },
  {
    id: "corporate_steady",
    name: "Corporate Steady",
    category: "corporate",
    durationSec: 145,
    bpm: 82,
    mood: "stable",
    tags: ["professional", "b2b", "finance"],
    fileUrl: ARP_SHIPPING,
    brightness: "warm",
  },
  {
    id: "emotional_warm",
    name: "Emotional Warm",
    category: "emotional",
    durationSec: 200,
    bpm: 74,
    mood: "heartfelt",
    tags: ["emotional", "wedding", "family"],
    fileUrl: AMB_TUSCAN_SUN,
    brightness: "warm",
  },
  {
    id: "inspirational_uplift",
    name: "Inspirational Uplift",
    category: "inspirational",
    durationSec: 145,
    bpm: 96,
    mood: "uplifting",
    tags: ["motivation", "growth", "education"],
    fileUrl: ARP_ALGORITHMS,
    brightness: "warm",
  },
  {
    id: "cinematic_wide",
    name: "Cinematic Wide",
    category: "cinematic",
    durationSec: 200,
    bpm: 78,
    mood: "epic",
    tags: ["cinematic", "brand", "hero"],
    fileUrl: AMB_CHARCOAL,
    brightness: "neutral",
  },
  {
    id: "modern_tech_pulse",
    name: "Modern Tech Pulse",
    category: "modern_tech",
    durationSec: 180,
    bpm: 104,
    mood: "innovative",
    tags: ["tech", "saas", "startup"],
    fileUrl: ARP_ELIPSIS,
    brightness: "warm",
  },
  {
    id: "retail_upbeat",
    name: "Upbeat Retail",
    category: "retail_promotion",
    durationSec: 145,
    bpm: 110,
    mood: "energetic",
    tags: ["retail", "promo", "sale"],
    fileUrl: AMB_RUBY,
    brightness: "warm",
  },
  {
    id: "retail_promotion",
    name: "Retail Promotion",
    category: "retail_promotion",
    durationSec: 145,
    bpm: 108,
    mood: "bright",
    tags: ["shopping", "fashion", "deal"],
    fileUrl: ARP_ILLUSTRATED,
    brightness: "warm",
  },
  {
    id: "upbeat_energy",
    name: "Upbeat Energy",
    category: "upbeat",
    durationSec: 145,
    bpm: 118,
    mood: "fun",
    tags: ["fast", "social", "tiktok"],
    fileUrl: ARP_ORGANISMS,
    brightness: "warm",
  },
  {
    id: "calm_ambient",
    name: "Calm Warm",
    category: "calm",
    durationSec: 180,
    bpm: 72,
    mood: "warm",
    tags: ["calm", "wellness", "soft", "cozy"],
    fileUrl: AMB_CORAL,
    brightness: "warm",
  },
  {
    id: "storytelling_narrative",
    name: "Storytelling Narrative",
    category: "storytelling",
    durationSec: 200,
    bpm: 76,
    mood: "narrative",
    tags: ["story", "vlog", "journey"],
    fileUrl: AMB_TAUT,
    brightness: "neutral",
  },
  {
    id: "florist_soft",
    name: "Soft Floral",
    category: "luxury",
    durationSec: 135,
    bpm: 70,
    mood: "floral",
    energyLevel: "low",
    emotionalTone: "elegant",
    tags: ["florist", "flowers", "gift", "romantic"],
    fileUrl: AMB_CORAL,
    license: "royalty_free",
    brightness: "warm",
  },
  {
    id: "cafe_upbeat",
    name: "Upbeat Acoustic",
    category: "upbeat",
    durationSec: 145,
    bpm: 105,
    mood: "playful",
    energyLevel: "high",
    emotionalTone: "playful",
    tags: ["cafe", "coffee", "lifestyle", "acoustic"],
    fileUrl: ARP_ILLUSTRATED,
    license: "royalty_free",
    brightness: "warm",
  },
  {
    id: "coffeehouse_calm",
    name: "Coffeehouse",
    category: "calm",
    durationSec: 180,
    bpm: 74,
    mood: "cozy",
    energyLevel: "medium",
    emotionalTone: "relaxing",
    tags: ["cafe", "coffee", "cozy", "lifestyle"],
    fileUrl: ARP_SHIPPING,
    license: "royalty_free",
    brightness: "warm",
  },
  {
    id: "lifestyle_acoustic",
    name: "Lifestyle Acoustic",
    category: "calm",
    durationSec: 160,
    bpm: 82,
    mood: "warm",
    energyLevel: "medium",
    emotionalTone: "relaxing",
    tags: ["lifestyle", "cafe", "boutique", "acoustic"],
    fileUrl: ARP_MOONRISE,
    license: "royalty_free",
    brightness: "warm",
  },
  {
    id: "modern_luxury_pop",
    name: "Modern Luxury",
    category: "modern_tech",
    durationSec: 170,
    bpm: 98,
    mood: "premium",
    energyLevel: "medium",
    emotionalTone: "premium",
    tags: ["beauty", "salon", "spa", "modern"],
    fileUrl: ARP_NEGENTROPY,
    license: "royalty_free",
    brightness: "warm",
  },
];

/**
 * Active library: prefer the curated commercial-safe set when available,
 * otherwise fall back to the built-in FMA beds.
 */
export const BGM_LIBRARY: BgmTrack[] =
  COMMERCIAL_BGM_LIBRARY.length > 0 ? COMMERCIAL_BGM_LIBRARY : FMA_FALLBACK_LIBRARY;

const TRACK_BY_ID = new Map(BGM_LIBRARY.map((t) => [t.id, t]));

/** Legacy clip keys → library track id */
export const LEGACY_BGM_KEY_MAP: Record<string, string> = {
  marketing: "retail_upbeat",
  wedding: "emotional_warm",
  florist: "florist_soft",
  restaurant: "cafe_upbeat",
  cafe: "lifestyle_acoustic",
  beauty: "modern_luxury_pop",
  education: "inspirational_uplift",
  story: "storytelling_narrative",
  corporate: "corporate_inspirational",
  chill: "lifestyle_acoustic",
  synth: "modern_tech_pulse",
  cinematic: "cinematic_wide",
  minimal: "lifestyle_acoustic",
  default: "lifestyle_acoustic",
  property: "corporate_inspirational",
  podcast: "lifestyle_acoustic",
};

export function getBgmTrackById(trackId: string): BgmTrack | undefined {
  const id = LEGACY_BGM_KEY_MAP[trackId] ?? trackId;
  return TRACK_BY_ID.get(id);
}

export function getTracksByCategory(category: BgmCategory): BgmTrack[] {
  return BGM_LIBRARY.filter((t) => t.category === category);
}

export function listAlternativeTracks(trackId: string, limit = 4): BgmTrack[] {
  const track = getBgmTrackById(trackId);
  if (!track) return BGM_LIBRARY.slice(0, limit);
  const usedSources = new Set([bgmAudioSourceKey(track)]);
  const same = getTracksByCategory(track.category).filter((t) => {
    if (t.id === track.id) return false;
    const source = bgmAudioSourceKey(t);
    if (usedSources.has(source)) return false;
    usedSources.add(source);
    return true;
  });
  return [track, ...same].slice(0, limit);
}

/** One representative track per distinct audio file — for manual BGM pickers. */
export function listDistinctBgmTracks(): BgmTrack[] {
  const seen = new Set<string>();
  const out: BgmTrack[] = [];
  for (const track of BGM_LIBRARY) {
    const source = bgmAudioSourceKey(track);
    if (seen.has(source)) continue;
    seen.add(source);
    out.push(track);
  }
  return out;
}

export function isBgmUserPreference(value: unknown): value is BgmUserPreference {
  return typeof value === "string" && (BGM_USER_PREFERENCES as readonly string[]).includes(value);
}

export function isBgmCategory(value: unknown): value is BgmCategory {
  return typeof value === "string" && (BGM_CATEGORIES as readonly string[]).includes(value);
}
