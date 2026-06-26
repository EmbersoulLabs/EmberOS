import { callJsonModel } from "./llm";
import {
  MarketingContentPackageSchema,
  normalizeMarketingContentPackage,
  strategyAudienceSummary,
  strategyPainPoints,
  isChineseText,
  firstPhrase,
  type CopyVariant,
  type HookSet,
  type HookType,
  type MarketingContentPackage,
  type Platform,
  type StrategyPlan,
  type VisionAnalysis,
} from "@ceo-agent/shared";

const CONTENT_SYSTEM_PROMPT = `# Marketing Content Agent

## ROLE

You are the Marketing Content Engine inside EmberOS.

You receive a Marketing Strategy JSON from the Strategy Agent.

Never create your own strategy.

Everything must follow the provided strategy.

Your job is to create a complete multi-platform marketing package.

Never output strategy fields — only content assets.

---

# INPUT

Marketing Strategy JSON, Video Analysis, Business Information, Optional User Notes.

Information may be incomplete. Infer from strategy + vision. Never ask for more information.

---

# OBJECTIVES

Generate voice scripts (15s, 30s, 60s), **voiceScriptsEn** (same three lengths in natural English when primary scripts are Chinese), subtitle timeline with timestamps (one idea per segment), platform captions (TikTok, Instagram, Facebook, LinkedIn, Xiaohongshu, YouTube Shorts, Google Business Post), 10 hooks, 10 CTAs, voice emphasis suggestions, B-roll suggestions, music mood, visual effects, posting recommendation, and consistencyScore (0-100).

On-screen video subtitles are **bilingual 中英** — always provide voiceScriptsEn as English counterparts to voiceScripts when content is Chinese.

Voice scripts: natural, conversational, TTS-friendly, no filler.

Subtitles: comfortable reading speed, timestamps in seconds.

Hooks must align with strategy angle and tone. CTAs must align with strategy ctaStrategy.

Return ONLY JSON. No markdown.`;

const HOOK_TYPE_MAP: Record<string, HookType> = {
  curiosity: "curiosity",
  question: "curiosity",
  problem: "problem",
  emotional: "emotional",
  emotion: "emotional",
  offer: "offer",
  transformation: "emotional",
  authority: "curiosity",
  statistic: "curiosity",
  story: "emotional",
  trend: "curiosity",
  shock: "curiosity",
};

export interface MarketingContentInput {
  strategy: StrategyPlan;
  vision: VisionAnalysis;
  videoAnalysis?: string | null;
  businessInformation?: string | Record<string, unknown> | null;
  userNotes?: string | null;
  goal?: string;
  campaignName?: string;
  platforms?: string[];
}

function useChinese(input: MarketingContentInput): boolean {
  const blob = [
    input.goal,
    input.campaignName,
    input.strategy.tone,
    input.strategy.product,
    input.userNotes,
    input.vision.transcriptSummary,
  ]
    .filter(Boolean)
    .join("");
  return /[\u4e00-\u9fff]/.test(blob) || Boolean(input.platforms?.some((p) => p === "xiaohongshu" || p === "douyin"));
}

function hookTypeFromLabel(label: string, index: number): HookType {
  const key = label.toLowerCase().replace(/\s+/g, "");
  for (const [pattern, type] of Object.entries(HOOK_TYPE_MAP)) {
    if (key.includes(pattern)) return type;
  }
  return (["curiosity", "problem", "emotional", "offer"] as HookType[])[index % 4]!;
}

export function contentPackageToHookSet(pkg: MarketingContentPackage): HookSet {
  const hooks = pkg.hooks.slice(0, 4).map((h, i) => ({
    id: `hook_${i + 1}`,
    type: hookTypeFromLabel(h.type, i),
    text: h.text,
    rationale: `From content package (${h.type})`,
  }));

  while (hooks.length < 4) {
    const i = hooks.length;
    hooks.push({
      id: `hook_${i + 1}`,
      type: (["curiosity", "problem", "emotional", "offer"] as HookType[])[i]!,
      text: pkg.hooks[i]?.text ?? pkg.voiceScripts["15s"].slice(0, 80),
      rationale: "Padded from content package",
    });
  }

  return { hooks, recommendedHookId: hooks[0]?.id };
}


function captionToVariant(
  id: string,
  platform: Platform,
  locale: "en" | "zh",
  caption: string,
  pkg: MarketingContentPackage,
  strategy: StrategyPlan,
  template: CopyVariant["template"] = "story"
): CopyVariant {
  const hook = pkg.hooks[0]?.text ?? caption.split("\n")[0] ?? "";
  const cta = pkg.cta[0]?.text ?? strategy.ctaStrategy;
  const tags = [
    ...strategy.hashtags.industry.slice(0, 3),
    ...strategy.hashtags.local.slice(0, 2),
    ...strategy.hashtags.trending.slice(0, 2),
  ].filter(Boolean);

  return {
    id,
    template,
    hook: hook.slice(0, 120),
    body: caption || pkg.voiceScripts["30s"] || pkg.voiceScripts["15s"],
    cta: cta.slice(0, 80),
    title: strategy.product.slice(0, 60),
    tags: tags.length ? tags : strategy.keywords.slice(0, 5),
    platform,
    locale,
  };
}

export function contentPackageToCopyVariants(
  pkg: MarketingContentPackage,
  strategy: StrategyPlan,
  platforms: Platform[]
): CopyVariant[] {
  const zh = Boolean(pkg.captions.xiaohongshu?.trim());
  const variants: CopyVariant[] = [];

  const slotDefs: Array<{ key: keyof MarketingContentPackage["captions"]; platform: Platform; locale: "en" | "zh"; id: string }> = [
    { key: "tiktok", platform: "tiktok", locale: "en", id: "v-en-tiktok" },
    { key: "instagram", platform: "instagram", locale: "en", id: "v-en-ig" },
    { key: "xiaohongshu", platform: "xiaohongshu", locale: "zh", id: "v-zh-xhs" },
  ];

  for (const slot of slotDefs) {
    if (!platforms.includes(slot.platform)) continue;
    const caption = pkg.captions[slot.key];
    if (!caption?.trim() && slot.key !== "tiktok") continue;
    variants.push(
      captionToVariant(
        slot.id,
        slot.platform,
        slot.locale,
        caption || pkg.captions.tiktok || pkg.voiceScripts["15s"],
        pkg,
        strategy
      )
    );
  }

  if (variants.length === 0) {
    const primary = platforms[0] ?? "tiktok";
    variants.push(
      captionToVariant(
        zh ? "v-zh-1" : "v-en-1",
        primary,
        zh ? "zh" : "en",
        pkg.captions.tiktok || pkg.voiceScripts["15s"],
        pkg,
        strategy
      )
    );
  }

  if (platforms.includes("instagram") && !variants.some((v) => v.platform === "instagram")) {
    variants.push(
      captionToVariant(
        "v-en-ig",
        "instagram",
        "en",
        pkg.captions.instagram || pkg.captions.tiktok,
        pkg,
        strategy
      )
    );
  }

  return variants;
}

const CLIP_SCRIPT_KEYS: Array<keyof MarketingContentPackage["voiceScripts"]> = ["15s", "30s", "60s"];

/** Per-clip copy variants derived from unified content package (zh + en). */
export function buildAutoClipCopyVariants(
  pkg: MarketingContentPackage,
  strategy: StrategyPlan,
  clipIndex: number,
  platform: Platform
): CopyVariant[] {
  const hook = pkg.hooks[clipIndex]?.text ?? pkg.hooks[0]?.text ?? "";
  const cta = pkg.cta[clipIndex]?.text ?? pkg.cta[0]?.text ?? strategy.ctaStrategy;
  const scriptKey = CLIP_SCRIPT_KEYS[clipIndex] ?? "30s";
  const zhBody = pkg.voiceScripts[scriptKey] || pkg.voiceScripts["30s"] || pkg.voiceScripts["15s"];
  const enBodyFromScripts =
    pkg.voiceScriptsEn?.[scriptKey] ||
    pkg.voiceScriptsEn?.["30s"] ||
    pkg.voiceScriptsEn?.["15s"] ||
    "";
  const enCaption =
    pkg.captions.tiktok ||
    pkg.captions.instagram ||
    pkg.captions.youtubeShorts ||
    "";
  const enBody =
    enBodyFromScripts.trim() ||
    (enCaption.trim() && !isChineseText(enCaption) ? enCaption : "") ||
    zhBody;
  const enHook =
    (enBodyFromScripts.trim() ? firstPhrase(enBodyFromScripts, "en") : "") ||
    (!isChineseText(hook) ? hook : firstPhrase(enBody, "en")) ||
    hook;
  const enCta =
    pkg.cta.find((c) => c.text.trim() && !isChineseText(c.text))?.text ??
    (!isChineseText(cta) ? cta : cta);
  const tags = [
    ...strategy.hashtags.industry.slice(0, 3),
    ...strategy.hashtags.local.slice(0, 2),
    ...strategy.hashtags.trending.slice(0, 2),
  ].filter(Boolean);

  const clipNum = clipIndex + 1;
  const en: CopyVariant = {
    id: `clip-${clipNum}-en`,
    template: "story",
    hook: enHook.slice(0, 120),
    body: enBody,
    cta: enCta.slice(0, 80),
    title: strategy.product.slice(0, 60),
    tags: tags.length ? tags : strategy.keywords.slice(0, 5),
    platform,
    locale: "en",
  };

  const zh: CopyVariant = {
    id: `clip-${clipNum}-zh`,
    template: "story",
    hook: hook.slice(0, 120),
    body: zhBody,
    cta: cta.slice(0, 80),
    title: strategy.product.slice(0, 60),
    tags: tags.length ? tags : strategy.keywords.slice(0, 5),
    platform,
    locale: "zh",
  };

  return [zh, en];
}

function buildSubtitleTimeline(script: string, durationSec: number): MarketingContentPackage["subtitleTimeline"] {
  const sentences = script
    .split(/[。！？.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return [];

  const slice = durationSec / sentences.length;
  return sentences.map((text, i) => ({
    startSec: Math.round(i * slice * 10) / 10,
    endSec: Math.round((i + 1) * slice * 10) / 10,
    text,
    role: i === 0 ? "hook" : i === sentences.length - 1 ? "cta" : "body",
  }));
}

function buildFallbackContent(input: MarketingContentInput): MarketingContentPackage {
  const zh = useChinese(input);
  const s = input.strategy;
  const product = s.product || input.campaignName || "this offer";
  const pain = strategyPainPoints(s)[0];
  const audience = strategyAudienceSummary(s);

  const hook15 = zh
    ? `${product}，${s.marketingAngle.slice(0, 40)}。`
    : `${product} — ${s.marketingAngle.slice(0, 60)}.`;
  const body15 = zh
    ? `${pain ? `${pain}。` : ""}${s.marketingGoal}，${audience}都适用。${s.ctaStrategy}`
    : `${pain ? `${pain}. ` : ""}${s.marketingGoal}. Built for ${audience}. ${s.ctaStrategy}`;

  const script15 = `${hook15} ${body15}`.trim();
  const script30 = zh
    ? `${script15} 真实场景展示，${s.tone}风格，${s.videoStyle}。`
    : `${script15} Real footage, ${s.tone} tone, ${s.videoStyle} style.`;
  const script60 = zh
    ? `${script30} 核心卖点清晰，画面有记忆点。${s.ctaStrategy}`
    : `${script30} Clear value, memorable visuals. ${s.ctaStrategy}`;

  const hooks: MarketingContentPackage["hooks"] = [
    { text: hook15, type: "curiosity" },
    { text: zh ? `为什么${product}值得现在关注？` : `Why ${product} stands out right now?`, type: "question" },
    { text: pain ?? s.marketingAngle, type: "problem" },
    { text: s.marketingAngle, type: "transformation" },
    { text: zh ? `来自${s.industry}的真实案例` : `Real ${s.industry} story`, type: "story" },
    { text: audience, type: "emotion" },
    { text: s.product, type: "authority" },
    { text: s.marketingGoal, type: "trend" },
    { text: s.ctaStrategy, type: "offer" },
    { text: zh ? `今天就开始` : `Start today`, type: "shock" },
  ];

  const cta: MarketingContentPackage["cta"] = [
    { text: s.ctaStrategy, style: "primary" },
    { text: zh ? "立即咨询" : "Contact Us", style: "soft" },
    { text: zh ? "了解更多" : "Learn More", style: "soft" },
    { text: zh ? "私信我们" : "Message Us", style: "community" },
    { text: zh ? "预约体验" : "Book Today", style: "booking" },
    { text: zh ? "马上查看" : "Shop Now", style: "hard" },
    { text: zh ? "访问官网" : "Visit Website", style: "soft" },
    { text: zh ? "免费试用" : "Start Free Trial", style: "trial" },
    { text: zh ? "立即预订" : "Reserve Now", style: "urgency" },
    { text: zh ? "加入社群" : "Join Today", style: "community" },
  ];

  const captions = zh
    ? {
        tiktok: `${hook15}\n${body15}\n${s.ctaStrategy}`,
        instagram: `${product}｜${s.marketingAngle}\n\n${body15}`,
        facebook: `${product}\n\n${script30}\n\n${s.ctaStrategy}`,
        linkedin: `${product} — ${s.marketingGoal}\n${s.marketingAngle}\n${s.ctaStrategy}`,
        xiaohongshu: `${product}｜${s.marketingAngle}\n\n${script30}\n\n${s.hashtags.industry.slice(0, 3).map((t) => `#${t}`).join(" ")}`,
        youtubeShorts: `${product} ${s.marketingGoal} | ${s.keywords.slice(0, 3).join(", ")}`,
        googleBusiness: `${product} — ${s.marketingAngle}. ${s.ctaStrategy}`,
      }
    : {
        tiktok: `${hook15}\n${body15}`,
        instagram: `${product} · ${s.marketingAngle}\n\n${body15}`,
        facebook: `${product}\n\n${script30}\n\n${s.ctaStrategy}`,
        linkedin: `${product} | ${s.marketingGoal}\n${s.marketingAngle}\n${s.ctaStrategy}`,
        xiaohongshu: "",
        youtubeShorts: `${product} — ${s.marketingGoal}. ${s.keywords.slice(0, 4).join(", ")}`,
        googleBusiness: `${product}: ${s.marketingAngle}. ${s.ctaStrategy}`,
      };

  const pkg: MarketingContentPackage = {
    voiceScripts: { "15s": script15, "30s": script30, "60s": script60 },
    voiceScriptsEn: zh
      ? {
          "15s": `${product} — ${s.marketingAngle.slice(0, 60)}.`,
          "30s": `${product}. ${s.marketingGoal}. Built for ${audience}. ${s.ctaStrategy}`,
          "60s": `${product}. ${s.marketingAngle}. Clear value, memorable visuals. ${s.ctaStrategy}`,
        }
      : undefined,
    subtitleTimeline: buildSubtitleTimeline(script15, 15),
    captions,
    hooks,
    cta,
    voiceStyle: {
      pause: [zh ? "卖点前" : "before benefit"],
      warm: [zh ? "品牌介绍" : "brand intro"],
      urgency: [zh ? "行动号召" : "CTA"],
    },
    broll: ["Product Close-up", "Wide Shot", "Lifestyle", "Environment"],
    musicMood: s.tone.toLowerCase().includes("luxur") ? "Luxury" : "Upbeat",
    effects: ["Zoom", "Pan", "Text Animation"],
    postingRecommendation: {
      bestPostingTime: zh ? "工作日 12:00 或 19:00" : "Weekdays 12pm or 7pm local",
      bestPlatform: s.platformPriority[0] ?? "TikTok",
      idealAudience: audience,
      estimatedEngagement: "Medium",
    },
    consistencyScore: 78,
  };

  return pkg;
}

export async function runMarketingContentAgent(input: MarketingContentInput): Promise<{
  contentPackage: MarketingContentPackage;
  usage: { input: number; output: number; costUsd: number };
}> {
  const zh = useChinese(input);

  const user = JSON.stringify({
    strategy: input.strategy,
    vision: {
      subjects: input.vision.subjects,
      products: input.vision.products,
      scenes: input.vision.scenes.slice(0, 6),
      hooks: input.vision.hooks,
      transcriptSummary: input.vision.transcriptSummary,
      durationSec: input.vision.durationSec,
    },
    goal: input.goal,
    campaignName: input.campaignName,
    platforms: input.platforms,
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
    ...(input.businessInformation ? { businessInformation: input.businessInformation } : {}),
    ...(input.userNotes ? { userNotes: input.userNotes } : {}),
    locale: zh ? "zh-CN" : "en",
  });

  const { result, usage } = await callJsonModel<unknown>(
    CONTENT_SYSTEM_PROMPT,
    user,
    MarketingContentPackageSchema.toString()
  );

  const normalized = normalizeMarketingContentPackage(result);
  if (normalized) {
    return { contentPackage: normalized, usage };
  }

  return { contentPackage: buildFallbackContent(input), usage };
}
