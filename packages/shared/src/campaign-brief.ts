/** User-provided creative direction on campaign upload (optional). */

import {
  DEFAULT_BGM_PREFERENCE,
  isBgmUserPreference,
  type BgmUserPreference,
} from "./bgm/library";
import {
  BGM_START_PREFERENCES,
  DEFAULT_BGM_START_PREFERENCE,
  isBgmStartPreference,
  type BgmStartPreference,
} from "./bgm/start-offset";

export { BGM_START_PREFERENCES, type BgmStartPreference };

export const VOICE_PRESETS = [
  "auto",
  "female",
  "male",
  "keep_original",
  "none",
] as const;
export type VoicePreset = (typeof VOICE_PRESETS)[number];

export const CONTENT_STYLES = [
  "promotional",
  "educational",
  "storytelling",
  "product_showcase",
  "behind_the_scenes",
  "luxury_brand",
  "custom",
] as const;
export type ContentStyle = (typeof CONTENT_STYLES)[number];

export const CAMPAIGN_MARKETING_GOALS = [
  "more_views",
  "more_engagement",
  "more_leads",
  "more_sales",
  "brand_awareness",
] as const;
export type CampaignMarketingGoal = (typeof CAMPAIGN_MARKETING_GOALS)[number];

export interface CampaignCreativeBrief {
  campaignBrief?: string;
  voicePreset: VoicePreset;
  contentStyle?: ContentStyle;
  campaignGoal?: CampaignMarketingGoal;
  bgmPreference?: BgmUserPreference;
  bgmStartPreference?: BgmStartPreference;
}

export const DEFAULT_VOICE_PRESET: VoicePreset = "auto";

export function isVoicePreset(value: unknown): value is VoicePreset {
  return typeof value === "string" && (VOICE_PRESETS as readonly string[]).includes(value);
}

export function isContentStyle(value: unknown): value is ContentStyle {
  return typeof value === "string" && (CONTENT_STYLES as readonly string[]).includes(value);
}

export function isCampaignMarketingGoal(value: unknown): value is CampaignMarketingGoal {
  return typeof value === "string" && (CAMPAIGN_MARKETING_GOALS as readonly string[]).includes(value);
}

export function parseCampaignCreativeBrief(campaign: {
  campaignBrief?: string | null;
  voicePreset?: string | null;
  contentStyle?: string | null;
  campaignGoal?: string | null;
  bgmPreference?: string | null;
  metadata?: Record<string, unknown> | null;
}): CampaignCreativeBrief {
  const meta = campaign.metadata ?? {};
  const fromMeta = (key: string) => {
    const v = meta[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };

  const campaignBrief =
    campaign.campaignBrief?.trim() ||
    fromMeta("campaignBrief") ||
    undefined;

  const voiceRaw = campaign.voicePreset ?? fromMeta("voicePreset");
  const voicePreset = isVoicePreset(voiceRaw) ? voiceRaw : DEFAULT_VOICE_PRESET;

  const styleRaw = campaign.contentStyle ?? fromMeta("contentStyle");
  const contentStyle = isContentStyle(styleRaw) ? styleRaw : undefined;

  const goalRaw = campaign.campaignGoal ?? fromMeta("campaignGoal");
  const campaignGoal = isCampaignMarketingGoal(goalRaw) ? goalRaw : undefined;

  const bgmRaw = campaign.bgmPreference ?? fromMeta("bgmPreference");
  const bgmPreference = isBgmUserPreference(bgmRaw) ? bgmRaw : DEFAULT_BGM_PREFERENCE;

  const bgmStartRaw = fromMeta("bgmStartPreference");
  const bgmStartPreference = isBgmStartPreference(bgmStartRaw)
    ? bgmStartRaw
    : DEFAULT_BGM_START_PREFERENCE;

  return { campaignBrief, voicePreset, contentStyle, campaignGoal, bgmPreference, bgmStartPreference };
}

export function hasCreativeBriefInput(brief: CampaignCreativeBrief): boolean {
  return Boolean(
    brief.campaignBrief ||
      brief.contentStyle ||
      brief.campaignGoal ||
      (brief.voicePreset && brief.voicePreset !== "auto") ||
      (brief.bgmPreference && brief.bgmPreference !== "auto") ||
      (brief.bgmStartPreference && brief.bgmStartPreference !== "auto")
  );
}

const BGM_PREFERENCE_LABELS: Record<BgmUserPreference, string> = {
  auto: "Auto Select",
  luxury: "Luxury",
  corporate: "Corporate",
  emotional: "Emotional",
  inspirational: "Inspirational",
  cinematic: "Cinematic",
  modern_tech: "Modern Tech",
  retail_promotion: "Retail Promotion",
  calm: "Calm",
  upbeat: "Upbeat",
};

const VOICE_PRESET_LABELS: Record<VoicePreset, string> = {
  auto: "Auto Select",
  female: "Female Voice",
  male: "Male Voice",
  keep_original: "Keep Original Audio",
  none: "No Voiceover",
};

const CONTENT_STYLE_LABELS: Record<ContentStyle, string> = {
  promotional: "Promotional",
  educational: "Educational",
  storytelling: "Storytelling",
  product_showcase: "Product Showcase",
  behind_the_scenes: "Behind The Scenes",
  luxury_brand: "Luxury Brand",
  custom: "Custom",
};

const CAMPAIGN_GOAL_LABELS: Record<CampaignMarketingGoal, string> = {
  more_views: "More Views",
  more_engagement: "More Engagement",
  more_leads: "More Leads",
  more_sales: "More Sales",
  brand_awareness: "Brand Awareness",
};

/** Human-readable block injected into LLM user prompts. */
export function buildVideoAnalysisPrompt(brief: CampaignCreativeBrief): string | null {
  if (!brief.campaignBrief && !hasCreativeBriefInput(brief)) {
    return null;
  }

  const lines = ["VIDEO ANALYSIS", ""];

  lines.push("User Brief:");
  lines.push(brief.campaignBrief?.trim() || "(not provided — use automatic analysis)");

  lines.push("");
  lines.push("Background Music:");
  lines.push(BGM_PREFERENCE_LABELS[brief.bgmPreference ?? DEFAULT_BGM_PREFERENCE]);

  lines.push("");
  lines.push("Voice Preference:");
  lines.push(VOICE_PRESET_LABELS[brief.voicePreset]);

  lines.push("");
  lines.push("Content Style:");
  lines.push(brief.contentStyle ? CONTENT_STYLE_LABELS[brief.contentStyle] : "(auto-detect from footage)");

  lines.push("");
  lines.push("Marketing Goal:");
  lines.push(brief.campaignGoal ? CAMPAIGN_GOAL_LABELS[brief.campaignGoal] : "(general engagement)");

  lines.push("");
  lines.push("Generate:");
  lines.push("1. Campaign Strategy");
  lines.push("2. Hook Ideas");
  lines.push("3. Script");
  lines.push("4. Voiceover Direction");
  lines.push("5. Editing Plan");
  lines.push("6. Marketing Score");

  return lines.join("\n");
}

/** Map marketing goal to legacy goal enum for heuristics. */
export function legacyGoalFromMarketingGoal(goal?: CampaignMarketingGoal): string {
  switch (goal) {
    case "more_views":
      return "涨粉";
    case "more_engagement":
      return "种草";
    case "more_leads":
      return "带货";
    case "more_sales":
      return "带货";
    case "brand_awareness":
      return "品牌曝光";
    default:
      return "种草";
  }
}

export function effectiveCampaignGoal(
  brief: CampaignCreativeBrief,
  fallbackGoal?: string | null
): string {
  if (brief.campaignGoal) return legacyGoalFromMarketingGoal(brief.campaignGoal);
  return fallbackGoal?.trim() || "种草";
}
