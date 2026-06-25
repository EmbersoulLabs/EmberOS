import type { CampaignMarketingGoal, ContentStyle, VoicePreset } from "../campaign-brief";
import type { Platform } from "../types/index";
import {
  analyzeBgmContext,
  trackPoolForAnalysis,
  type BgmContentAnalysis,
  type BgmEmotionalTone,
  type BgmEnergyLevel,
  type VideoContentArchetype,
  type BgmRecommendContext,
} from "./analyze";
import {
  type BgmCategory,
  type BgmTrack,
  type BgmUserPreference,
  BGM_LIBRARY,
  bgmAudioSourceKey,
  getBgmTrackById,
  getTracksByCategory,
  listAlternativeTracks,
  isBgmUserPreference,
} from "./library";

export type {
  BgmContentAnalysis,
  BgmEmotionalTone,
  BgmEnergyLevel,
  VideoContentArchetype,
  BgmRecommendContext,
} from "./analyze";

export interface BgmRecommendation {
  trackId: string;
  trackName: string;
  category: BgmCategory;
  confidenceScore: number;
  reason: string;
  benefits: string[];
  alternatives: Array<{ trackId: string; trackName: string }>;
  analysis: BgmContentAnalysis;
  license: "royalty_free" | "licensed" | "ai_generated";
}

function contextText(ctx: BgmRecommendContext): string {
  return [
    ctx.campaignBrief,
    ctx.goal,
    ctx.industry,
    ...(ctx.visionHooks ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreTrack(
  track: BgmTrack,
  ctx: BgmRecommendContext,
  text: string,
  analysis: BgmContentAnalysis
): number {
  let score = 50;
  const pool = trackPoolForAnalysis(analysis);
  const poolIndex = pool.indexOf(track.id);
  if (poolIndex === 0) score += 32;
  else if (poolIndex > 0) score += 24 - poolIndex * 3;

  if (track.energyLevel === analysis.energyLevel) score += 12;
  if (track.emotionalTone === analysis.emotionalTone) score += 14;

  if (ctx.contentStyle === "luxury_brand" && track.category === "luxury") score += 20;
  if (ctx.contentStyle === "storytelling" && track.category === "storytelling") score += 18;
  if (ctx.contentStyle === "promotional" && track.category === "retail_promotion") score += 16;
  if (ctx.contentStyle === "educational" && track.category === "inspirational") score += 16;

  switch (analysis.contentType) {
    case "sales":
      if (track.category === "retail_promotion" || track.category === "upbeat") score += 18;
      break;
    case "story":
      if (track.category === "storytelling" || track.category === "emotional") score += 20;
      break;
    case "educational":
      if (track.category === "inspirational" || track.category === "corporate") score += 18;
      break;
    case "engagement":
    case "trend":
      if (track.category === "upbeat" || track.category === "modern_tech") score += 20;
      break;
  }

  if (ctx.platform === "tiktok" || ctx.platform === "douyin") {
    if (track.tags.includes("tiktok") || track.energyLevel === "high") score += 8;
  }

  if (ctx.voicePreset === "female" && (track.mood === "elegant" || track.mood === "soft")) score += 6;
  if (ctx.voicePreset === "none" && track.category === "upbeat") score += 8;

  if (track.brightness === "warm") score += 14;
  if (track.brightness === "dark") score -= 18;
  if (
    (analysis.contentType === "sales" ||
      analysis.contentType === "engagement" ||
      analysis.contentType === "trend") &&
    (track.category === "upbeat" || track.category === "retail_promotion")
  ) {
    score += 10;
  }

  const warmMoods = new Set([
    "warm",
    "uplifting",
    "confident",
    "energetic",
    "playful",
    "bright",
    "fun",
    "cozy",
    "heartfelt",
  ]);
  if (warmMoods.has(track.mood)) score += 8;

  for (const tag of track.tags) {
    if (text.includes(tag)) score += 5;
  }

  return Math.min(98, score);
}

function categoryFromPreference(pref: BgmUserPreference): BgmCategory | null {
  if (pref === "auto") return null;
  if (pref === "retail_promotion") return "retail_promotion";
  if (pref === "modern_tech") return "modern_tech";
  return pref as BgmCategory;
}

function buildBenefits(track: BgmTrack, analysis: BgmContentAnalysis): string[] {
  const benefits: string[] = [];
  if (analysis.emotionalTone === "luxury" || analysis.emotionalTone === "elegant")
    benefits.push("Premium brand perception");
  if (analysis.contentType === "sales")
    benefits.push("Supports conversion-focused pacing");
  if (analysis.contentType === "engagement" || analysis.contentType === "trend")
    benefits.push("Higher scroll-stop energy on short-form feeds");
  if (analysis.contentType === "story")
    benefits.push("Emotional engagement and narrative flow");
  if (analysis.contentType === "educational")
    benefits.push("Clear, trustworthy backdrop for teaching moments");
  if (analysis.industry === "florist")
    benefits.push("Matches floral / gift boutique aesthetics");
  if (analysis.industry === "cafe")
    benefits.push("Warm lifestyle feel for café and hospitality");
  if (analysis.industry === "beauty")
    benefits.push("Salon-grade modern luxury tone");
  if (benefits.length === 0) benefits.push("Balanced marketing bed for mixed audiences");
  return benefits.slice(0, 4);
}

function buildReason(track: BgmTrack, analysis: BgmContentAnalysis, score: number): string {
  const parts: string[] = [];

  if (analysis.industry === "florist" && analysis.contentType === "sales")
    parts.push("Elegant piano and soft strings suit luxury floral sales");
  else if (analysis.industry === "cafe")
    parts.push("Coffeehouse and upbeat acoustic beds fit café promotion");
  else if (analysis.industry === "beauty")
    parts.push("Modern luxury ambient supports salon and beauty branding");
  else if (analysis.industry === "retail" && analysis.contentType === "sales")
    parts.push("High-energy commercial pop drives retail promotion");
  else
    parts.push(
      `${track.name} fits ${analysis.contentType.replace("_", " ")} content with ${analysis.emotionalTone} tone`
    );

  parts.push(`${analysis.energyLevel} energy for ${analysis.pacing} pacing`);
  if (analysis.platformFit) parts.push(`optimized for ${analysis.platformFit}`);

  return `${parts.join("; ")} (match ${score}/100).`;
}

export function recommendBgm(ctx: BgmRecommendContext): BgmRecommendation {
  const analysis = analyzeBgmContext(ctx);
  const pref = isBgmUserPreference(ctx.userPreference) ? ctx.userPreference : "auto";
  const forcedCategory = categoryFromPreference(pref);
  const text = contextText(ctx);
  const exclude = new Set(ctx.excludeTrackIds ?? []);
  const excludedSources = new Set(
    [...exclude]
      .map((id) => getBgmTrackById(id))
      .filter((track): track is BgmTrack => Boolean(track))
      .map((track) => bgmAudioSourceKey(track))
  );
  const allowed = (track: BgmTrack) =>
    !exclude.has(track.id) && !excludedSources.has(bgmAudioSourceKey(track));

  const poolIds = trackPoolForAnalysis(analysis);
  let candidates = poolIds
    .map((id) => getBgmTrackById(id))
    .filter((t): t is BgmTrack => Boolean(t) && allowed(t!));

  if (forcedCategory) {
    const forced = getTracksByCategory(forcedCategory).filter(allowed);
    candidates = [...forced, ...candidates];
  }

  if (candidates.length === 0) {
    candidates = BGM_LIBRARY.filter(allowed);
  }

  if (candidates.length === 0) {
    candidates = BGM_LIBRARY.filter((t) => !exclude.has(t.id));
  }

  let best = candidates[0]!;
  let bestScore = -1;
  for (const track of candidates) {
    const s = scoreTrack(track, ctx, text, analysis);
    if (s > bestScore) {
      bestScore = s;
      best = track;
    }
  }

  const confidenceScore = Math.max(62, Math.min(98, bestScore));
  const alts = listAlternativeTracks(best.id, 4).filter(allowed);

  return {
    trackId: best.id,
    trackName: best.name,
    category: best.category,
    confidenceScore,
    reason: buildReason(best, analysis, confidenceScore),
    benefits: buildBenefits(best, analysis),
    alternatives: alts.map((t) => ({ trackId: t.id, trackName: t.name })),
    analysis,
    license: best.license ?? "royalty_free",
  };
}

export function recommendationForTrackId(trackId: string, ctx?: BgmRecommendContext): BgmRecommendation {
  const track = getBgmTrackById(trackId);
  if (!track) return recommendBgm(ctx ?? {});
  const analysis = analyzeBgmContext(ctx ?? {});
  const score = ctx ? scoreTrack(track, ctx, contextText(ctx), analysis) : 85;
  return {
    trackId: track.id,
    trackName: track.name,
    category: track.category,
    confidenceScore: Math.max(70, Math.min(98, score)),
    reason: buildReason(track, analysis, score),
    benefits: buildBenefits(track, analysis),
    alternatives: listAlternativeTracks(track.id, 4).map((t) => ({
      trackId: t.id,
      trackName: t.name,
    })),
    analysis,
    license: track.license ?? "royalty_free",
  };
}

/** Per-creative BGM for content multiplication — unique track per archetype. */
export function recommendBgmBatch(
  baseCtx: BgmRecommendContext,
  archetypes: VideoContentArchetype[]
): BgmRecommendation[] {
  const used = new Set<string>();
  const results: BgmRecommendation[] = [];

  for (const videoArchetype of archetypes) {
    const rec = recommendBgm({
      ...baseCtx,
      videoArchetype,
      excludeTrackIds: [...used],
    });
    used.add(rec.trackId);
    results.push(rec);
  }

  return results;
}
