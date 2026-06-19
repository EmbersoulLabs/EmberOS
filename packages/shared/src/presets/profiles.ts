import type { ContentType, PresetId, PresetProfile, SceneRole } from "./types";

const SCENE_ROLES: SceneRole[] = ["hook", "product", "benefits", "proof", "cta"];

function profile(
  id: PresetId,
  label: string,
  labelZh: string,
  scenePacing: PresetProfile["scenePacing"],
  motionByRole: PresetProfile["motionByRole"],
  speedByRole: PresetProfile["speedByRole"],
  cutStyle: PresetProfile["cutStyle"] = "jump"
): PresetProfile {
  return {
    id,
    label,
    labelZh,
    scenePacing,
    motionByRole,
    speedByRole,
    captionStyle: "bilingual",
    ctaStyle: "slide_up",
    cutStyle,
  };
}

export const PRESET_PROFILES: Record<PresetId, PresetProfile> = {
  florist: profile(
    "florist",
    "Florist",
    "花店",
    { hook: 2.2, product: 2.8, benefits: 2.5, proof: 2.5, cta: 2.5 },
    {
      hook: "slow_zoom_in",
      product: "pan_right",
      benefits: "pan_left",
      proof: "focus_pull",
      cta: "slow_zoom_out",
    },
    { hook: 1.12, product: 1.06, benefits: 1.04, proof: 1.0, cta: 0.96 },
    "jump"
  ),
  wedding: profile(
    "wedding",
    "Wedding",
    "婚礼",
    { hook: 2.8, product: 3.2, benefits: 2.8, proof: 2.5, cta: 2.7 },
    {
      hook: "fade_in",
      product: "slow_zoom_in",
      benefits: "pan_right",
      proof: "focus_pull",
      cta: "slow_zoom_out",
    },
    { hook: 1.0, product: 1.02, benefits: 1.0, proof: 0.98, cta: 0.95 },
    "soft"
  ),
  marketing: profile(
    "marketing",
    "Marketing",
    "通用营销",
    { hook: 2.0, product: 2.5, benefits: 2.5, proof: 2.0, cta: 2.5 },
    {
      hook: "slow_zoom_in",
      product: "pan_right",
      benefits: "pan_left",
      proof: "static",
      cta: "focus_pull",
    },
    { hook: 1.15, product: 1.08, benefits: 1.05, proof: 1.0, cta: 1.0 },
    "jump"
  ),
  restaurant: profile(
    "restaurant",
    "Restaurant",
    "餐饮",
    { hook: 2.0, product: 3.0, benefits: 2.5, proof: 2.0, cta: 2.5 },
    {
      hook: "slow_zoom_in",
      product: "pan_right",
      benefits: "pan_left",
      proof: "static",
      cta: "focus_pull",
    },
    { hook: 1.12, product: 1.05, benefits: 1.04, proof: 1.0, cta: 1.0 },
    "jump"
  ),
  beauty: profile(
    "beauty",
    "Beauty",
    "美业",
    { hook: 2.5, product: 3.0, benefits: 2.5, proof: 2.0, cta: 2.5 },
    {
      hook: "fade_in",
      product: "slow_zoom_in",
      benefits: "pan_right",
      proof: "focus_pull",
      cta: "slow_zoom_out",
    },
    { hook: 1.08, product: 1.04, benefits: 1.02, proof: 1.0, cta: 0.96 },
    "soft"
  ),
  property: profile(
    "property",
    "Property",
    "房产",
    { hook: 2.5, product: 3.5, benefits: 2.5, proof: 2.5, cta: 2.5 },
    {
      hook: "pan_right",
      product: "slow_zoom_in",
      benefits: "pan_left",
      proof: "static",
      cta: "focus_pull",
    },
    { hook: 1.0, product: 1.02, benefits: 1.0, proof: 1.0, cta: 0.98 },
    "soft"
  ),
  education: profile(
    "education",
    "Education",
    "教育",
    { hook: 2.5, product: 3.0, benefits: 3.0, proof: 2.0, cta: 2.5 },
    {
      hook: "fade_in",
      product: "static",
      benefits: "pan_right",
      proof: "static",
      cta: "focus_pull",
    },
    { hook: 1.05, product: 1.0, benefits: 1.0, proof: 1.0, cta: 1.0 },
    "soft"
  ),
  story: profile(
    "story",
    "Story",
    "故事",
    { hook: 3.0, product: 3.0, benefits: 2.5, proof: 2.5, cta: 2.5 },
    {
      hook: "fade_in",
      product: "slow_zoom_in",
      benefits: "pan_left",
      proof: "focus_pull",
      cta: "slow_zoom_out",
    },
    { hook: 1.0, product: 1.0, benefits: 1.0, proof: 0.98, cta: 0.95 },
    "soft"
  ),
  podcast: profile(
    "podcast",
    "Podcast",
    "播客",
    { hook: 2.5, product: 3.5, benefits: 2.5, proof: 2.0, cta: 2.0 },
    {
      hook: "static",
      product: "static",
      benefits: "static",
      proof: "static",
      cta: "static",
    },
    { hook: 1.0, product: 1.0, benefits: 1.0, proof: 1.0, cta: 1.0 },
    "soft"
  ),
  corporate: profile(
    "corporate",
    "Corporate",
    "企业",
    { hook: 2.5, product: 3.0, benefits: 2.5, proof: 2.5, cta: 2.5 },
    {
      hook: "fade_in",
      product: "pan_right",
      benefits: "static",
      proof: "static",
      cta: "focus_pull",
    },
    { hook: 1.0, product: 1.02, benefits: 1.0, proof: 1.0, cta: 1.0 },
    "soft"
  ),
};

export function getPresetProfile(id: PresetId): PresetProfile {
  return PRESET_PROFILES[id];
}

export function presetTotalDurationSec(preset: PresetProfile): number {
  return SCENE_ROLES.reduce((sum, role) => sum + preset.scenePacing[role], 0);
}

export { SCENE_ROLES };
