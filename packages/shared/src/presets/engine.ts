import type { Industry } from "../types/marketing-os";
import type { ContentType, PresetId, ContentClassification } from "./types";
import { getPresetProfile, PRESET_PROFILES } from "./profiles";

const CONTENT_TO_PRESET: Partial<Record<ContentType, PresetId>> = {
  florist: "florist",
  wedding: "wedding",
  restaurant: "restaurant",
  beauty: "beauty",
  real_estate: "property",
  education: "education",
  podcast: "podcast",
  storytelling: "story",
  product_showcase: "marketing",
  service_promotion: "marketing",
  event_promotion: "marketing",
  recruitment: "corporate",
  branding: "corporate",
  phone_buyback: "marketing",
  general: "marketing",
};

const INDUSTRY_TO_PRESET: Partial<Record<Industry, PresetId>> = {
  florist: "florist",
  wedding: "wedding",
  restaurant: "restaurant",
  beauty: "beauty",
  real_estate: "property",
  education: "education",
  retail: "marketing",
  phone_buyback: "marketing",
  b2b_saas: "corporate",
  general: "marketing",
};

export function resolvePresetId(input: {
  contentType?: ContentType;
  industry?: Industry;
}): PresetId {
  if (input.contentType && CONTENT_TO_PRESET[input.contentType]) {
    return CONTENT_TO_PRESET[input.contentType]!;
  }
  if (input.industry && INDUSTRY_TO_PRESET[input.industry]) {
    return INDUSTRY_TO_PRESET[input.industry]!;
  }
  return "corporate";
}

export function resolvePreset(input: {
  contentType?: ContentType;
  industry?: Industry;
}) {
  const id = resolvePresetId(input);
  return getPresetProfile(id);
}

export function listPresets() {
  return Object.values(PRESET_PROFILES);
}

export function classificationWithPreset(
  partial: Omit<ContentClassification, "presetId"> & { presetId?: PresetId }
): ContentClassification {
  const presetId =
    partial.presetId ??
    resolvePresetId({ contentType: partial.contentType, industry: partial.industry });
  return { ...partial, presetId };
}
