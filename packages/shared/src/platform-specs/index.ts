import type { Platform } from "../types/index";

export interface PlatformSpec {
  id: Platform;
  name: string;
  aspectRatio: string;
  maxDurationSec: number;
  titleMaxLength: number;
  bodyMaxLength: number;
  maxTags: number;
  tagPrefix: string;
  locale: string;
}

export const PLATFORM_SPECS: Record<Platform, PlatformSpec> = {
  tiktok: {
    id: "tiktok",
    name: "TikTok",
    aspectRatio: "9:16",
    maxDurationSec: 60,
    titleMaxLength: 150,
    bodyMaxLength: 2200,
    maxTags: 30,
    tagPrefix: "#",
    locale: "en-SG",
  },
  xiaohongshu: {
    id: "xiaohongshu",
    name: "小红书",
    aspectRatio: "9:16",
    maxDurationSec: 300,
    titleMaxLength: 20,
    bodyMaxLength: 1000,
    maxTags: 10,
    tagPrefix: "#",
    locale: "zh-CN",
  },
  instagram: {
    id: "instagram",
    name: "Instagram Reels",
    aspectRatio: "9:16",
    maxDurationSec: 90,
    titleMaxLength: 100,
    bodyMaxLength: 2200,
    maxTags: 30,
    tagPrefix: "#",
    locale: "en-SG",
  },
  douyin: {
    id: "douyin",
    name: "抖音",
    aspectRatio: "9:16",
    maxDurationSec: 60,
    titleMaxLength: 30,
    bodyMaxLength: 1000,
    maxTags: 10,
    tagPrefix: "#",
    locale: "zh-CN",
  },
};

export const PHASE1_PLATFORMS: Platform[] = ["tiktok", "xiaohongshu", "instagram"];

export function getPlatformSpec(platform: Platform): PlatformSpec {
  return PLATFORM_SPECS[platform];
}

export function truncateForPlatform(text: string, platform: Platform, field: "title" | "body"): string {
  const spec = PLATFORM_SPECS[platform];
  const max = field === "title" ? spec.titleMaxLength : spec.bodyMaxLength;
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
