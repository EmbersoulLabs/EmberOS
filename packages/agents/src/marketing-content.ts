import { callJsonModel } from "./llm";
import {
  MarketingContentPackageSchema,
  normalizeMarketingContentPackage,
  strategyAudienceSummary,
  strategyPainPoints,
  isChineseText,
  firstPhrase,
  contentLocaleFromMetadata,
  MARKETING_PLATFORMS,
  PlatformMarketingAssetSchema,
  resolveContentSubject,
  assessContentGrounding,
  applyGroundingToAnalysisScores,
  groundingWarningSuggestion,
  substantiveCampaignBrief,
  type ContentLocale,
  type CopyVariant,
  type HookSet,
  type HookType,
  type MarketingContentPackage,
  type MarketingPlatformId,
  type PlatformMarketingAsset,
  type Platform,
  type StrategyPlan,
  type VisionAnalysis,
} from "@ceo-agent/shared";

export type { ContentLocale };
export { contentLocaleFromMetadata };

const CONTENT_SYSTEM_PROMPT = `# EmberOS Marketing Content Engine

You are a senior AI marketing strategist inside EmberOS — NOT a chatbot.
Output structured JSON for an enterprise marketing dashboard.
Never write long paragraphs. Never repeat the same sentence across platforms.
Each platform must feel written by a different expert.

## INPUT
Marketing Strategy JSON + Video Analysis + Business context.

## RULES
- GROUND EVERY ASSET IN THE VIDEO ANALYSIS (vision): reference the actual subjects,
  products, scenes, and spoken content seen in the footage. Do NOT write generic copy
  derived only from the campaign label — use campaignLabel ONLY when vision, goal,
  userNotes, and videoAnalysis are all absent.
  If the vision shows a specific product/scene, the caption must describe THAT.
- Follow strategy exactly. Do not invent strategy fields.
- Every platform asset MUST use unique wording — zero copy-paste between platforms.
- Short bullets and card-friendly strings only (max 2-3 lines per field unless Facebook/LinkedIn caption).
- Return ONLY valid JSON. No markdown.

## REQUIRED OUTPUT

### Core production assets
voiceScripts (15s/30s/60s in the primary output language),
voiceScriptsZh (15s/30s/60s, ALWAYS fully in Simplified Chinese 简体中文),
voiceScriptsEn (15s/30s/60s, ALWAYS fully in English),
subtitleTimeline,
hooks[10] with text/textEn/textMs + type, cta[5] UNIQUE styles (never duplicate text),
voiceStyle, broll, musicMood, effects, postingRecommendation, consistencyScore

### Dashboard: analysis
marketingScore, hookScore, seoScore, emotionalScore, conversionScore (0-100),
estimatedCtr, estimatedEngagement, estimatedConversion (short ranges e.g. "2.1%–3.8%")

### Dashboard: strategyBrief
primaryGoal, targetAudience, contentAngle, painPoint, desiredEmotion, ctaStrategy (one line each)

### Dashboard: platformAssets — UNIQUE per platform
Each key: tiktok, instagram, facebook, linkedin, xiaohongshu, threads, youtubeShorts, googleBusiness
Each object: caption, hook?, title?, description?, hashtags[], cta, formatStyle (one-line platform note)

Platform rules:
- facebook: storytelling, community, longer caption
- linkedin: professional, educational, authority
- xiaohongshu: ALWAYS write in Simplified Chinese (简体中文) regardless of the output
  language above — it is a Chinese-first platform. emoji, line breaks, lifestyle,
  search keywords, hashtags. Never leave it empty.
- instagram: short emotional caption + emoji
- threads: conversational opinion hook
- googleBusiness: local SEO, service keywords, call-now CTA
- youtubeShorts: title + hook + description + hashtags
- tiktok: native hook + trending CTA

Also populate legacy captions map (flattened) for backward compatibility.

### Dashboard: seo
primaryKeywords[], secondaryKeywords[], longTailKeywords[], localKeywords[], searchIntent

### Dashboard: hashtagPack
highVolume[], mediumVolume[], local[], brand[], industry[]

### Dashboard: aiSuggestions
5-8 short actionable bullets (posting time, creative tips, conversion tips)`;

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
  /** UI locale at run time — drives primary output language (zh / en / ms). */
  contentLocale?: ContentLocale;
}

function useChinese(input: MarketingContentInput): boolean {
  const blob = [
    input.goal,
    input.userNotes,
    input.strategy.tone,
    input.strategy.product,
    input.vision.transcriptSummary,
  ]
    .filter(Boolean)
    .join("");
  return /[\u4e00-\u9fff]/.test(blob) || Boolean(input.platforms?.some((p) => p === "xiaohongshu" || p === "douyin"));
}

function resolveContentLocale(input: MarketingContentInput): ContentLocale {
  const l = input.contentLocale;
  if (l === "zh" || l === "en" || l === "ms") return l;
  return useChinese(input) ? "zh" : "en";
}

function localeToPromptTag(locale: ContentLocale): string {
  if (locale === "zh") return "zh-CN";
  if (locale === "ms") return "ms";
  return "en";
}

const BILINGUAL_SCRIPTS_RULE =
  " IMPORTANT: ALWAYS output BOTH voiceScriptsZh (fully in Simplified Chinese 简体中文) AND voiceScriptsEn (fully in English), for all three lengths (15s/30s/60s), regardless of the primary language — they power on-screen 中英 bilingual subtitles. Never leave either empty and never mix languages within one of them.";

function outputLanguageInstruction(locale: ContentLocale): string {
  if (locale === "zh") {
    return (
      "Write ALL primary text (hooks.text, captions, cta.text, strategyBrief, aiSuggestions, platformAssets) in Simplified Chinese (简体中文). Populate textEn and textMs as translations." +
      BILINGUAL_SCRIPTS_RULE
    );
  }
  if (locale === "ms") {
    return (
      "Write ALL primary text in Bahasa Melayu. Populate textEn and textZh (in text field for zh backup) as needed; use textMs as primary Malay copy in hooks." +
      BILINGUAL_SCRIPTS_RULE
    );
  }
  return (
    "Write ALL primary text in English. Populate textEn on hooks when primary is another language; include textMs for Malay translations." +
    BILINGUAL_SCRIPTS_RULE
  );
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

  const pickScript = (src?: MarketingContentPackage["voiceScripts"]): string =>
    (src?.[scriptKey] || src?.["30s"] || src?.["15s"] || "").trim();

  // Resolve Chinese and English scripts independently so on-screen 中英 subtitles
  // always have both languages, regardless of the campaign's primary language.
  const primaryScript = pickScript(pkg.voiceScripts);
  const primaryIsZh = isChineseText(primaryScript);
  const enCaption =
    pkg.captions.tiktok || pkg.captions.instagram || pkg.captions.youtubeShorts || "";

  const zhScript = pickScript(pkg.voiceScriptsZh) || (primaryIsZh ? primaryScript : "");
  const enScript =
    pickScript(pkg.voiceScriptsEn) ||
    (!primaryIsZh ? primaryScript : "") ||
    (enCaption.trim() && !isChineseText(enCaption) ? enCaption : "");

  // Never leave a side empty — fall back to the other language so the variant renders.
  const zhBody = zhScript || enScript || primaryScript;
  const enBody = enScript || zhScript || primaryScript;

  const zhHook =
    (isChineseText(hook) ? hook : "") || (zhScript ? firstPhrase(zhScript, "zh") : "") || hook;
  const enHook =
    (!isChineseText(hook) ? hook : "") || (enScript ? firstPhrase(enScript, "en") : "") || hook;

  const zhCta =
    pkg.cta.find((c) => c.text.trim() && isChineseText(c.text))?.text ||
    (isChineseText(cta) ? cta : "") ||
    cta;
  const enCta =
    pkg.cta.find((c) => c.text.trim() && !isChineseText(c.text))?.text ||
    (!isChineseText(cta) ? cta : "") ||
    cta;
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
    hook: zhHook.slice(0, 120),
    body: zhBody,
    cta: zhCta.slice(0, 80),
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

function groundingContext(input: MarketingContentInput) {
  return assessContentGrounding({
    vision: input.vision,
    campaignName: input.campaignName,
    strategyProduct: input.strategy.product,
    strategyAngle: input.strategy.marketingAngle,
    keywords: input.strategy.keywords,
    hasUserDescription: Boolean(substantiveCampaignBrief(input.userNotes, input.videoAnalysis)),
  });
}

function applyGroundingToPackage(
  pkg: MarketingContentPackage,
  input: MarketingContentInput
): MarketingContentPackage {
  const locale = resolveContentLocale(input);
  const grounding = groundingContext(input);
  if (!grounding.isUngrounded && grounding.scorePenalty === 0) return pkg;

  const raw = pkg.analysis ?? {
    marketingScore: pkg.consistencyScore,
    hookScore: pkg.consistencyScore + 4,
    seoScore: pkg.consistencyScore - 2,
    emotionalScore: pkg.consistencyScore + 2,
    conversionScore: pkg.consistencyScore - 4,
    estimatedCtr: "2.4% – 4.1%",
    estimatedEngagement: "Medium–High",
    estimatedConversion: "1.2% – 2.8%",
  };
  const analysis = applyGroundingToAnalysisScores(
    {
      marketingScore: raw.marketingScore,
      hookScore: raw.hookScore,
      seoScore: raw.seoScore,
      emotionalScore: raw.emotionalScore,
      conversionScore: raw.conversionScore,
    },
    grounding.scorePenalty
  );
  const warning = groundingWarningSuggestion(locale);
  const aiSuggestions = [warning, ...(pkg.aiSuggestions ?? [])].filter(
    (s, i, arr) => arr.indexOf(s) === i
  );

  return {
    ...pkg,
    consistencyScore: analysis.marketingScore,
    analysis: { ...raw, ...analysis },
    aiSuggestions,
  };
}

function buildFallbackContent(input: MarketingContentInput): MarketingContentPackage {
  const locale = resolveContentLocale(input);
  const zh = locale === "zh";
  const s = input.strategy;
  const product = resolveContentSubject(input.vision, {
    goal: input.goal,
    userNotes: substantiveCampaignBrief(input.userNotes, input.videoAnalysis),
    campaignName: input.campaignName,
    locale,
  });
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

  const hookEn = `${product} — ${s.marketingAngle.slice(0, 60)}.`;
  const hookMs = `${product} — ${s.marketingAngle.slice(0, 60)}.`;

  // Always provide both language scripts so on-screen 中英 subtitles can render.
  // For Chinese campaigns, strategy fields (angle/goal/cta) are all in Chinese — use
  // English-only fallback phrases so the en subtitle track is actually in English.
  const enAngle = isChineseText(s.marketingAngle) ? "discover the quality difference" : s.marketingAngle.slice(0, 60);
  const enGoal = isChineseText(s.marketingGoal) ? "Brand awareness" : s.marketingGoal;
  const enAudience = isChineseText(audience) ? "everyone" : audience;
  const enCta = isChineseText(s.ctaStrategy) ? "Follow for more" : s.ctaStrategy;
  const enScripts = {
    "15s": `${product} — ${enAngle}.`,
    "30s": `${product}. ${enGoal}. Built for ${enAudience}. ${enCta}.`,
    "60s": `${product}. ${enAngle}. Clear value, memorable visuals. ${enCta}.`,
  };
  const zhScripts = {
    "15s": `${product}，${s.marketingAngle.slice(0, 40)}。`,
    "30s": `${product}。${s.marketingGoal}，${audience}都适用。${s.ctaStrategy}`,
    "60s": `${product}。${s.marketingAngle}。核心卖点清晰，画面有记忆点。${s.ctaStrategy}`,
  };

  const hooks: MarketingContentPackage["hooks"] = [
    {
      text: hook15,
      textEn: hookEn,
      textMs: hookMs,
      type: "curiosity",
    },
    {
      text: zh ? `为什么${product}值得现在关注？` : `Why ${product} stands out right now?`,
      textEn: `Why ${product} stands out right now?`,
      textMs: `Mengapa ${product} menonjol sekarang?`,
      type: "question",
    },
    {
      text: pain ?? s.marketingAngle,
      textEn: pain ?? s.marketingAngle,
      textMs: pain ?? s.marketingAngle,
      type: "problem",
    },
    {
      text: s.marketingAngle,
      textEn: s.marketingAngle,
      textMs: s.marketingAngle,
      type: "transformation",
    },
    {
      text: zh ? `来自${s.industry}的真实案例` : `Real ${s.industry} story`,
      textEn: `Real ${s.industry} story`,
      textMs: `Kisah sebenar ${s.industry}`,
      type: "story",
    },
    {
      text: audience,
      textEn: audience,
      textMs: audience,
      type: "emotion",
    },
    { text: s.product, textEn: s.product, textMs: s.product, type: "authority" },
    {
      text: s.marketingGoal,
      textEn: s.marketingGoal,
      textMs: s.marketingGoal,
      type: "trend",
    },
    {
      text: s.ctaStrategy,
      textEn: s.ctaStrategy,
      textMs: s.ctaStrategy,
      type: "offer",
    },
    {
      text: zh ? `今天就开始` : `Start today`,
      textEn: "Start today",
      textMs: "Mulakan hari ini",
      type: "shock",
    },
  ];

  const cta: MarketingContentPackage["cta"] = [
    { text: s.ctaStrategy, textEn: s.ctaStrategy, textMs: s.ctaStrategy, style: "primary" },
    {
      text: zh ? "立即咨询" : "Contact Us",
      textEn: "Contact Us",
      textMs: "Hubungi Kami",
      style: "soft",
    },
    {
      text: zh ? "了解更多" : "Learn More",
      textEn: "Learn More",
      textMs: "Ketahui Lebih",
      style: "soft",
    },
    {
      text: zh ? "私信我们" : "Message Us",
      textEn: "Message Us",
      textMs: "Mesej Kami",
      style: "community",
    },
    {
      text: zh ? "预约体验" : "Book Today",
      textEn: "Book Today",
      textMs: "Tempah Hari Ini",
      style: "booking",
    },
    {
      text: zh ? "马上查看" : "Shop Now",
      textEn: "Shop Now",
      textMs: "Beli Sekarang",
      style: "hard",
    },
    {
      text: zh ? "访问官网" : "Visit Website",
      textEn: "Visit Website",
      textMs: "Lawati Laman Web",
      style: "soft",
    },
    {
      text: zh ? "免费试用" : "Start Free Trial",
      textEn: "Start Free Trial",
      textMs: "Cuba Percuma",
      style: "trial",
    },
    {
      text: zh ? "立即预订" : "Reserve Now",
      textEn: "Reserve Now",
      textMs: "Tempah Sekarang",
      style: "urgency",
    },
    {
      text: zh ? "加入社群" : "Join Today",
      textEn: "Join Today",
      textMs: "Sertai Hari Ini",
      style: "community",
    },
  ];

  // Xiaohongshu (小红书) is a Chinese platform — always author copy in Chinese,
  // independent of the campaign's primary output language.
  const xiaohongshuZh = `✨${product}真实测评｜${s.marketingAngle}\n\n${pain ? `😭${pain}\n\n` : ""}${script30}\n\n${[...s.hashtags.industry.slice(0, 3), ...s.hashtags.local.slice(0, 2)].map((t) => `#${t}`).join(" ")}`;

  const captions = zh
    ? {
        tiktok: `${hook15}\n${body15}\n${s.ctaStrategy}`,
        instagram: `${product} ✨\n${s.marketingAngle.slice(0, 80)}`,
        facebook: `${product}\n\n${script30}\n\n${s.ctaStrategy}`,
        linkedin: `${product} — ${s.marketingGoal}\n${s.marketingAngle}\n${s.ctaStrategy}`,
        xiaohongshu: xiaohongshuZh,
        youtubeShorts: `${product} ${s.marketingGoal} | ${s.keywords.slice(0, 3).join(", ")}`,
        googleBusiness: `${product} — ${s.marketingAngle}. ${s.ctaStrategy}`,
      }
    : {
        tiktok: `${hook15}\n${body15}`,
        instagram: `${product} ✨\n${s.marketingAngle.slice(0, 80)}`,
        facebook: `${product}\n\n${script30}\n\n${s.ctaStrategy}`,
        linkedin: `${product} | ${s.marketingGoal}\n${s.marketingAngle}\n${s.ctaStrategy}`,
        xiaohongshu: xiaohongshuZh,
        youtubeShorts: `${product} — ${s.marketingGoal}. ${s.keywords.slice(0, 4).join(", ")}`,
        googleBusiness: `${product}: ${s.marketingAngle}. ${s.ctaStrategy}`,
      };

  const platformAssets = {
    tiktok: {
      hook: hook15,
      caption: zh ? `真实场景｜${s.marketingAngle}` : `Real footage · ${s.marketingAngle.slice(0, 60)}`,
      cta: zh ? "评论区告诉我你最想看哪一款" : "Drop a 🔥 if you want part 2",
      hashtags: [],
      formatStyle: "Trend-native short hook",
    },
    instagram: {
      caption: zh ? `${product} 💐\n${pain ?? s.marketingAngle}\n—\n${s.ctaStrategy}` : `${product} 💐\n${s.marketingAngle}\n—\n${s.ctaStrategy}`,
      cta: zh ? "链接在主页" : "Link in bio",
      hashtags: [],
      formatStyle: "Emotional visual caption",
    },
    facebook: {
      caption: zh
        ? `【${product}】\n\n${script30}\n\n👉 ${s.ctaStrategy}`
        : `Story time: ${product}\n\n${script30}\n\n👉 ${s.ctaStrategy}`,
      cta: s.ctaStrategy,
      hashtags: [],
      formatStyle: "Community storytelling",
    },
    linkedin: {
      caption: zh
        ? `行业观察｜${s.industry}\n${s.marketingGoal}\n${s.marketingAngle}\n\n${s.ctaStrategy}`
        : `Insight · ${s.industry}\n${s.marketingGoal}\n${s.marketingAngle}\n\n${s.ctaStrategy}`,
      cta: zh ? "欢迎私信交流" : "Let's connect",
      hashtags: [],
      formatStyle: "Professional authority",
    },
    xiaohongshu: {
      caption: xiaohongshuZh,
      hashtags: [...s.hashtags.industry.slice(0, 4), ...s.hashtags.local.slice(0, 2)],
      cta: "收藏备用",
      formatStyle: "Lifestyle + search",
    },
    threads: {
      caption: zh ? `${s.marketingAngle} — 你怎么看？` : `${s.marketingAngle} — agree or not?`,
      hook: zh ? `说实话，${product}真的值得吗？` : `Hot take: ${product} is underrated.`,
      cta: "",
      hashtags: [],
      formatStyle: "Opinion / conversation",
    },
    youtubeShorts: {
      caption: "",
      title: zh ? `${product}｜${s.marketingGoal}` : `${product} — ${s.marketingGoal}`,
      hook: hook15,
      description: zh ? `${script30}\n${s.ctaStrategy}` : `${script30}\n${s.ctaStrategy}`,
      hashtags: s.keywords.slice(0, 5),
      cta: "",
      formatStyle: "Shorts SEO",
    },
    googleBusiness: {
      caption: zh
        ? `${product} · ${s.industry} · ${audience}\n${s.marketingAngle}\n📞 立即咨询`
        : `${product} · ${s.industry}\n${s.marketingAngle}\n📞 Call now`,
      cta: zh ? "立即致电" : "Call now",
      hashtags: [],
      formatStyle: "Local SEO",
    },
  };

  const captionsEn = {
    tiktok: `${hookEn}\n${body15}`,
    instagram: `${product} · ${s.marketingAngle}\n\n${body15}`,
    facebook: `${product}\n\n${script30}\n\n${s.ctaStrategy}`,
    linkedin: `${product} | ${s.marketingGoal}\n${s.marketingAngle}\n${s.ctaStrategy}`,
    xiaohongshu: xiaohongshuZh,
    youtubeShorts: `${product} — ${s.marketingGoal}. ${s.keywords.slice(0, 4).join(", ")}`,
    googleBusiness: `${product}: ${s.marketingAngle}. ${s.ctaStrategy}`,
  };

  const captionsMs = {
    tiktok: `${hookMs}\n${body15}`,
    instagram: `${product} · ${s.marketingAngle}\n\n${body15}`,
    facebook: `${product}\n\n${script30}\n\n${s.ctaStrategy}`,
    linkedin: `${product} | ${s.marketingGoal}\n${s.marketingAngle}\n${s.ctaStrategy}`,
    xiaohongshu: xiaohongshuZh,
    youtubeShorts: `${product} — ${s.marketingGoal}. ${s.keywords.slice(0, 4).join(", ")}`,
    googleBusiness: `${product}: ${s.marketingAngle}. ${s.ctaStrategy}`,
  };

  const grounding = groundingContext(input);
  const defaultAnalysis = {
    marketingScore: 78,
    hookScore: 82,
    seoScore: 74,
    emotionalScore: 80,
    conversionScore: 76,
  };
  const analysisScores = applyGroundingToAnalysisScores(defaultAnalysis, grounding.scorePenalty);
  const groundingTips = grounding.isUngrounded
    ? [groundingWarningSuggestion(locale)]
    : [];

  const pkg: MarketingContentPackage = {
    voiceScripts: { "15s": script15, "30s": script30, "60s": script60 },
    voiceScriptsEn: enScripts,
    voiceScriptsZh: zhScripts,
    subtitleTimeline: buildSubtitleTimeline(script15, 15),
    captions,
    captionsEn,
    captionsMs,
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
      estimatedEngagement: "Medium–High",
    },
    consistencyScore: analysisScores.marketingScore,
    analysis: {
      ...analysisScores,
      estimatedCtr: grounding.isUngrounded ? "—" : "2.4% – 4.1%",
      estimatedEngagement: grounding.isUngrounded ? "Low (ungrounded)" : "Medium–High",
      estimatedConversion: grounding.isUngrounded ? "—" : "1.2% – 2.8%",
    },
    strategyBrief: {
      primaryGoal: s.marketingGoal,
      targetAudience: audience,
      contentAngle: s.marketingAngle,
      painPoint: pain ?? "",
      desiredEmotion: s.tone,
      ctaStrategy: s.ctaStrategy,
    },
    platformAssets,
    seo: {
      primaryKeywords: s.keywords.slice(0, 3),
      secondaryKeywords: s.keywords.slice(3, 8),
      longTailKeywords: s.keywords.slice(8, 12),
      localKeywords: s.hashtags.local,
      searchIntent: s.marketingGoal,
    },
    hashtagPack: {
      highVolume: s.hashtags.trending,
      mediumVolume: s.hashtags.seo,
      local: s.hashtags.local,
      brand: [product.replace(/\s+/g, "")],
      industry: s.hashtags.industry,
    },
    aiSuggestions:
      locale === "zh"
        ? [
            ...groundingTips,
            "建议在晚 8 点前发布",
            "加入客户真实评价镜头",
            "使用产品特写增强信任",
            "可考虑加入价格/优惠 overlay",
            "展示 before/after 对比",
          ]
        : locale === "ms"
          ? [
              ...groundingTips,
              "Siarkan sebelum 8 malam waktu tempatan",
              "Tambah klip testimoni pelanggan",
              "Gunakan gambar dekat produk",
              "Pertimbangkan overlay harga/promosi",
              "Tunjukkan perbandingan sebelum/selepas",
            ]
          : [
              ...groundingTips,
              "Post before 8 PM local time",
              "Add a customer testimonial clip",
              "Use close-up product shots",
              "Consider a pricing overlay",
              "Show before/after transformation",
            ],
  };

  return pkg;
}

export async function runMarketingContentAgent(input: MarketingContentInput): Promise<{
  contentPackage: MarketingContentPackage;
  usage: { input: number; output: number; costUsd: number };
}> {
  const locale = resolveContentLocale(input);

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
    ...(input.campaignName &&
    !input.goal?.trim() &&
    !input.userNotes?.trim() &&
    !input.videoAnalysis?.trim()
      ? { campaignLabel: input.campaignName }
      : {}),
    platforms: input.platforms,
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
    ...(input.businessInformation ? { businessInformation: input.businessInformation } : {}),
    ...(input.userNotes ? { userNotes: input.userNotes } : {}),
    locale: localeToPromptTag(locale),
    outputLanguage: outputLanguageInstruction(locale),
  });

  const { result, usage } = await callJsonModel<unknown>(
    CONTENT_SYSTEM_PROMPT,
    user,
    MarketingContentPackageSchema.toString()
  );

  const normalized = normalizeMarketingContentPackage(result);
  if (normalized) {
    console.log(`[content] ok hooks=${normalized.hooks.length} voiceScripts=${!!normalized.voiceScripts["30s"]}`);
    return { contentPackage: applyGroundingToPackage(normalized, input), usage };
  }

  // Log what the LLM actually returned so we can diagnose parse failures.
  const raw = result as Record<string, unknown> | null;
  const hookCount = Array.isArray(raw?.hooks) ? (raw.hooks as unknown[]).length : typeof raw?.hooks;
  const ctaCount = Array.isArray(raw?.cta) ? (raw.cta as unknown[]).length : typeof raw?.cta;
  console.warn(`[content] normalizeMarketingContentPackage failed — using fallback template. hooks=${hookCount} cta=${ctaCount} musicMood=${raw?.musicMood}`);
  return { contentPackage: buildFallbackContent(input), usage };
}

const PLATFORM_REGEN_SYSTEM = `# EmberOS — Single Platform Copy Regenerator
You rewrite ONE social platform's marketing asset for an enterprise dashboard.
GROUND THE COPY IN THE VIDEO ANALYSIS (vision): use the real subjects, products, scenes
and transcript seen in the footage. Do NOT base the copy on the campaign name alone —
the campaign name is a label, not the content.
Make the new version noticeably DIFFERENT from previousCaption: fresh angle, fresh wording.
Keep it platform-native, punchy, and card-friendly (max 2-3 short lines per field unless
Facebook/LinkedIn caption).
Return ONLY valid JSON for a single platform asset:
{ caption, hook?, title?, description?, hashtags[], cta, formatStyle }`;

export interface RegeneratePlatformAssetInput {
  platformId: MarketingPlatformId;
  strategy: StrategyPlan;
  vision: VisionAnalysis;
  campaignName?: string;
  goal?: string;
  userNotes?: string;
  businessInformation?: string | Record<string, unknown> | null;
  contentLocale?: ContentLocale;
  previousCaption?: string;
}

/** Regenerate a single platform's marketing asset with the AI (per-platform refresh). */
export async function regeneratePlatformAsset(input: RegeneratePlatformAssetInput): Promise<{
  asset: PlatformMarketingAsset;
  usage: { input: number; output: number; costUsd: number };
}> {
  const def = MARKETING_PLATFORMS[input.platformId];
  // Xiaohongshu is a Chinese-first platform — always regenerate in Chinese.
  const locale: ContentLocale =
    input.platformId === "xiaohongshu"
      ? "zh"
      : (input.contentLocale ??
        (/[\u4e00-\u9fff]/.test(
          [input.goal, input.userNotes, input.strategy.tone, input.strategy.product]
            .filter(Boolean)
            .join("")
        )
          ? "zh"
          : "en"));

  const user = JSON.stringify({
    platform: input.platformId,
    platformPersona: def.expertPersona,
    requiredFields: def.requiredFields,
    strategy: input.strategy,
    vision: {
      subjects: input.vision.subjects,
      products: input.vision.products,
      scenes: input.vision.scenes.slice(0, 6),
      hooks: input.vision.hooks,
      transcriptSummary: input.vision.transcriptSummary,
    },
    goal: input.goal,
    ...(input.userNotes ? { userNotes: input.userNotes } : {}),
    ...(input.campaignName && !input.goal?.trim() && !input.userNotes?.trim()
      ? { campaignLabel: input.campaignName }
      : {}),
    ...(input.businessInformation ? { businessInformation: input.businessInformation } : {}),
    ...(input.previousCaption ? { previousCaption: input.previousCaption } : {}),
    locale: localeToPromptTag(locale),
    outputLanguage: outputLanguageInstruction(locale),
  });

  const { result, usage } = await callJsonModel<unknown>(
    PLATFORM_REGEN_SYSTEM,
    user,
    PlatformMarketingAssetSchema.toString()
  );

  const parsed = PlatformMarketingAssetSchema.safeParse(result);
  if (parsed.success && parsed.data.caption.trim()) {
    return { asset: parsed.data, usage };
  }

  // Fallback: derive a fresh single-platform asset from the strategy/vision.
  const fallbackPkg = buildFallbackContent({
    strategy: input.strategy,
    vision: input.vision,
    goal: input.goal,
    userNotes: input.userNotes,
    campaignName: input.campaignName,
    businessInformation: input.businessInformation,
    contentLocale: locale,
  });
  const fallbackAsset = fallbackPkg.platformAssets?.[input.platformId];
  return {
    asset: fallbackAsset ?? { caption: "", cta: "", hashtags: [] },
    usage,
  };
}
