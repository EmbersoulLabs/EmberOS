import { callJsonModel } from "./llm";
import { COPY_VARIANT_COUNT, isChineseText } from "@ceo-agent/shared";
import { getPlatformSpec, truncateForPlatform } from "@ceo-agent/shared/platform-specs";
import type {
  BrandProfile,
  CopyVariant,
  Platform,
  VisionAnalysis,
  StrategyPlan,
  HookSet,
  CopyLocale,
  CopyMixSlot,
  CopyTemplate,
} from "@ceo-agent/shared";

const TEMPLATES = ["pain_point", "comparison", "story"] as const;

export interface CopyInput {
  vision: VisionAnalysis;
  brandProfile: BrandProfile;
  platform: Platform;
  goal: string;
  campaignName?: string;
  strategyPlan?: StrategyPlan;
  hookSet?: HookSet;
  locale?: CopyLocale;
  templates?: CopyTemplate[];
  slotIds?: string[];
}

export interface CopyMixInput extends Omit<CopyInput, "platform" | "locale" | "templates" | "slotIds"> {
  mix: CopyMixSlot[];
}

function matchesLocaleText(text: string, locale: CopyLocale): boolean {
  if (!text.trim()) return true;
  const hasCjk = isChineseText(text);
  return locale === "zh" ? hasCjk : !hasCjk;
}

function variantMatchesLocale(v: Pick<CopyVariant, "hook" | "body" | "cta" | "title">, locale: CopyLocale): boolean {
  return [v.hook, v.body, v.cta, v.title].every((t) => matchesLocaleText(t ?? "", locale));
}

function isCompleteCopy(v: Pick<CopyVariant, "hook" | "body" | "cta">, locale: CopyLocale): boolean {
  const minHook = locale === "zh" ? 6 : 12;
  const minBody = locale === "zh" ? 28 : 48;
  return v.hook.trim().length >= minHook && v.body.trim().length >= minBody && v.cta.trim().length >= 4;
}

function isWeddingFloristContext(input: CopyInput): boolean {
  const blob = [
    input.campaignName,
    input.goal,
    input.vision.subjects.join(" "),
    input.vision.products.map((p) => p.name).join(" "),
    input.vision.transcriptSummary,
  ]
    .filter(Boolean)
    .join(" ");
  return /wedding|婚|floral|flower|car|花艺|婚车|bmw|decor/i.test(blob);
}

function resolveTopicZh(input: CopyInput): string {
  return (
    input.campaignName?.trim() ||
    input.vision.products[0]?.name ||
    input.vision.subjects.filter((s) => s !== "product").join("、") ||
    "婚车花艺"
  );
}

function resolveTopicEn(input: CopyInput): string {
  if (isWeddingFloristContext(input)) return "wedding car florals";
  const raw =
    input.campaignName?.trim() ||
    input.vision.products[0]?.name ||
    input.vision.subjects.filter((s) => s !== "product").join(" ") ||
    "your content";
  return isChineseText(raw) ? "this look" : raw;
}

function englishHooksForTemplate(template: CopyTemplate, topic: string, wedding: boolean): string {
  if (wedding) {
    const map: Record<CopyTemplate, string> = {
      pain_point: "Tight budget but want a luxe wedding car?",
      comparison: "DIY ribbons vs pro wedding car florals?",
      story: "This BMW wedding car setup stopped everyone",
    };
    return map[template];
  }
  const map: Record<CopyTemplate, string> = {
    pain_point: `Why does your ${topic} never look as good as you hoped?`,
    comparison: `Most ${topic} vs what actually converts on camera`,
    story: `Real ${topic} — the moment it clicked for me`,
  };
  return map[template];
}

function englishBodyForTemplate(template: CopyTemplate, topic: string, wedding: boolean, input: CopyInput): string {
  if (wedding) {
    const map: Record<CopyTemplate, string> = {
      pain_point:
        "Three things make wedding car florals look expensive: layered depth, colors that match your theme, and secure styling that survives the drive. You do not need a huge budget — you need the right design.",
      comparison:
        "Basic ribbon bows fade in photos. Pro styling uses depth, cohesive palette, and firm mounting so petals stay perfect from driveway to venue. The difference shows instantly on camera.",
      story:
        "We styled this wedding car with soft roses, baby's breath, and a clean white bow — layered for photos, secured for the road. Small details that make the whole day feel polished.",
    };
    return map[template];
  }
  const visionNote = input.vision.transcriptSummary?.slice(0, 100);
  const map: Record<CopyTemplate, string> = {
    pain_point: `Struggling with ${topic}? Here is what most people miss — and how to fix it for scroll-stopping results.${visionNote ? ` ${visionNote}` : ""}`,
    comparison: `Side by side: average ${topic} vs a pro approach. Color, layers, and on-camera impact make the difference.`,
    story: `Behind this ${topic}: real setup, real results. ${visionNote ?? "Built for feeds that convert."}`,
  };
  return map[template];
}

function chineseBodyForTemplate(template: CopyTemplate, topic: string, goal: string, strategy?: StrategyPlan): string {
  const map: Record<CopyTemplate, string> = {
    pain_point: `${topic}｜${goal}：${strategy?.painPoints[0] ?? "预算有限也能做出高级感，关键是层次、配色与稳固性。"} 专业设计让婚车成为照片焦点，路上也不散架。`,
    comparison: `对比普通方案：${strategy?.marketingAngle ?? "专业婚车花艺在层次、配色、稳固性上差距一目了然"}。同样的车，不同的花艺，气质完全不同。`,
    story: `从实拍看${topic}：${strategy?.targetAudience ?? "适合正在备婚、追求精致细节的你"}。每一层花材都为镜头和路况而设计。`,
  };
  return map[template];
}

function englishTags(platform: Platform, wedding: boolean): string[] {
  const spec = getPlatformSpec(platform);
  const raw = wedding
    ? ["weddingcar", "weddingflowers", "floraldesign", "weddinginspo", "bridetobe"]
    : [platform, "contentcreator"];
  return raw.slice(0, spec.maxTags).map((t) => (t.startsWith("#") ? t : `${spec.tagPrefix}${t}`));
}

function enforceLocaleVariants(input: CopyInput, variants: CopyVariant[], locale: CopyLocale): CopyVariant[] {
  const templates = input.templates ?? [...TEMPLATES];
  const fallbacks = buildFallbackVariants({ ...input, locale, templates });

  return variants.map((v, i) => {
    if (variantMatchesLocale(v, locale) && isCompleteCopy(v, locale)) return v;
    const fb = fallbacks[i] ?? fallbacks[0];
    if (!fb) return v;
    return {
      ...fb,
      id: input.slotIds?.[i] ?? v.id,
      platform: input.platform,
      locale,
      template: v.template ?? fb.template,
    };
  });
}

function normalizeTemplate(value: unknown): CopyTemplate {
  const raw = String(value ?? "story")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (raw.includes("pain")) return "pain_point";
  if (raw.includes("compar")) return "comparison";
  if (raw.includes("list")) return "story";
  if (raw.includes("review")) return "story";
  return TEMPLATES.includes(raw as CopyTemplate) ? (raw as CopyTemplate) : "story";
}

function normalizeTags(value: unknown, platform: Platform, goal: string, locale?: CopyLocale): string[] {
  const spec = getPlatformSpec(platform);
  if (Array.isArray(value)) {
    const tags = value.map((t) => String(t).trim()).filter(Boolean);
    if (tags.length > 0) {
      const filtered =
        locale === "en" ? tags.filter((t) => !isChineseText(t)) : locale === "zh" ? tags : tags;
      if (filtered.length > 0) return filtered.slice(0, spec.maxTags);
    }
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,\s#]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, spec.maxTags);
  }
  if (locale === "en") {
    return englishTags(platform, /wedding|婚|floral|flower|婚车/i.test(goal));
  }
  return isChineseText(goal)
    ? [goal, platform === "xiaohongshu" ? "小红书种草" : platform]
    : [`${spec.tagPrefix}${platform}`];
}

function parseCopyVariants(
  result: unknown,
  platform: Platform,
  goal: string,
  locale?: CopyLocale,
  slotIds?: string[]
): CopyVariant[] | null {
  if (!result || typeof result !== "object") return null;
  const root = result as Record<string, unknown>;
  const list = root.variants ?? root.copy_variants ?? root.copyVariants;
  if (!Array.isArray(list) || list.length === 0) return null;

  const variants: CopyVariant[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i] as Record<string, unknown>;
    const hook = String(item.hook ?? item.opening ?? item.title ?? "").trim();
    const body = String(item.body ?? item.caption ?? item.content ?? "").trim();
    const title = String(item.title ?? item.headline ?? hook).trim();
    if (!hook && !body && !title) continue;

    variants.push({
      id: String(item.id ?? slotIds?.[i] ?? `v${i + 1}`),
      template: normalizeTemplate(item.template),
      hook: hook || title,
      body: body || title,
      cta: String(item.cta ?? item.call_to_action ?? "").trim() || defaultCta(locale ?? "en", goal),
      title: truncateForPlatform(title || hook, platform, "title"),
      tags: normalizeTags(item.tags, platform, goal, locale),
      platform,
      locale,
      estimatedReadSec: typeof item.estimatedReadSec === "number" ? item.estimatedReadSec : 8,
    });
  }

  return variants.length > 0 ? variants : null;
}

function defaultCta(locale: CopyLocale, goal: string): string {
  if (locale === "zh" || isChineseText(goal)) return "关注我了解更多";
  return "Follow for more";
}

function buildFallbackVariants(input: CopyInput): CopyVariant[] {
  const locale = input.locale ?? (isChineseText(input.goal) ? "zh" : "en");
  const templates = input.templates ?? [...TEMPLATES];
  const ids = input.slotIds ?? templates.map((_, i) => (locale === "zh" ? `v-zh-${i + 1}` : `v-en-${i + 1}`));
  const strategy = input.strategyPlan;
  const wedding = isWeddingFloristContext(input);

  if (locale === "zh") {
    const topic = resolveTopicZh(input);
    const goal = input.goal || "种草";
    const hookTexts =
      input.hookSet?.hooks?.map((h) => h.text) ??
      (strategy
        ? [strategy.marketingAngle, strategy.painPoints[0] ?? strategy.marketingAngle, strategy.ctaStrategy]
        : null);
    const hooks = hookTexts ?? [
      `你知道${topic}的秘密吗？`,
      `为什么你的${topic}总是达不到预期？`,
      `${topic}实拍来了，效果比想象更好`,
    ];
    const ctas = [
      strategy?.ctaStrategy ?? input.brandProfile.cta ?? "私信获取婚车花艺方案",
      input.brandProfile.cta ?? "收藏备用",
      input.brandProfile.cta ?? "关注我，看更多案例",
    ];

    return templates.map((template, i) => ({
      id: ids[i] ?? `v-zh-${i + 1}`,
      template,
      hook: hooks[i] ?? hooks[0]!,
      body: truncateForPlatform(chineseBodyForTemplate(template, topic, goal, strategy), input.platform, "body"),
      cta: ctas[i] ?? ctas[0]!,
      title: truncateForPlatform(`${topic}｜${goal}`, input.platform, "title"),
      tags: normalizeTags([topic, goal, strategy?.industry ?? topic], input.platform, goal, "zh"),
      platform: input.platform,
      locale: "zh" as const,
      estimatedReadSec: 8,
    }));
  }

  const topic = resolveTopicEn(input);
  const enCta = wedding
    ? "DM us for your wedding car floral plan"
    : (input.brandProfile.cta && !isChineseText(input.brandProfile.cta)
        ? input.brandProfile.cta
        : "Follow for more ideas");

  return templates.map((template, i) => ({
    id: ids[i] ?? `v-en-${i + 1}`,
    template,
    hook: englishHooksForTemplate(template, topic, wedding),
    body: truncateForPlatform(englishBodyForTemplate(template, topic, wedding, input), input.platform, "body"),
    cta: enCta,
    title: truncateForPlatform(wedding ? "Wedding car florals that photograph beautifully" : `${topic} | ${input.goal || "tips"}`, input.platform, "title"),
    tags: englishTags(input.platform, wedding),
    platform: input.platform,
    locale: "en" as const,
    estimatedReadSec: 8,
  }));
}

function emptyUsage() {
  return { input: 0, output: 0, costUsd: 0 };
}

export async function runCopyAgent(input: CopyInput): Promise<{
  variants: CopyVariant[];
  recommendedVariantId: string;
  usage: { input: number; output: number; costUsd: number };
}> {
  const locale = input.locale ?? (isChineseText(input.goal) ? "zh" : "en");
  const templates = input.templates ?? [...TEMPLATES];
  const count = templates.length || COPY_VARIANT_COUNT;
  const spec = getPlatformSpec(input.platform);

  const system = `You are a viral short-form copywriter for ${spec.name}.
Generate exactly ${count} distinct variant(s) using templates: ${templates.join(", ")}.
${
  locale === "zh"
    ? "Write ALL copy in natural Chinese (简体中文). Do NOT use English except brand names."
    : `Write ALL copy in natural English (${input.brandProfile.locale ?? spec.locale}). Do NOT use any Chinese characters — even if the campaign goal is in Chinese.`
}
Brand tone: ${input.brandProfile.tone ?? "engaging"}. Banned: ${(input.brandProfile.bannedWords ?? []).join(", ") || "none"}.
Title max ${spec.titleMaxLength} chars. Body max ${spec.bodyMaxLength} chars.
Structure: hook (0-3s, max 12 words / 16 Chinese chars) → concrete value → CTA.
${input.strategyPlan ? `Strategy context (translate into ${locale === "zh" ? "Chinese" : "English"}): angle=${input.strategyPlan.marketingAngle}; pains=${input.strategyPlan.painPoints.join("; ")}; CTA=${input.strategyPlan.ctaStrategy}; audience=${input.strategyPlan.targetAudience}.` : ""}
${input.hookSet?.hooks?.length ? `Hook inspiration (translate/adapt to ${locale === "zh" ? "Chinese" : "English"}): ${input.hookSet.hooks.map((h) => `[${h.type}] ${h.text}`).join(" | ")}` : ""}
Output JSON: { "variants": [{ "id", "template", "hook", "body", "cta", "title", "tags" }] }`;

  const user = JSON.stringify({
    campaignName: input.campaignName,
    goal: input.goal,
    platform: input.platform,
    locale,
    templates,
    variantIds: input.slotIds,
    strategy: input.strategyPlan,
    hooks: input.hookSet?.hooks,
    vision: {
      subjects: input.vision.subjects,
      hooks: input.vision.hooks,
      products: input.vision.products,
      scenes: input.vision.scenes,
      transcript: input.vision.transcriptSummary,
    },
    brand: input.brandProfile,
  });

  const { result, usage } = await callJsonModel<unknown>(system, user, "CopyVariants");
  const parsed = parseCopyVariants(result, input.platform, input.goal, locale, input.slotIds);

  const variantsRaw =
    parsed && parsed.length > 0
      ? parsed.map((v, i) => ({
          ...v,
          id: input.slotIds?.[i] ?? v.id,
          platform: input.platform,
          locale,
          title: truncateForPlatform(v.title, input.platform, "title"),
          body: truncateForPlatform(v.body, input.platform, "body"),
        }))
      : buildFallbackVariants(input);

  const variants = enforceLocaleVariants(input, variantsRaw, locale);

  const root = result as Record<string, unknown> | null;
  const recommended =
    typeof root?.recommendedVariantId === "string"
      ? root.recommendedVariantId
      : (variants[0]?.id ?? input.slotIds?.[0] ?? "v-en-1");

  return {
    variants,
    recommendedVariantId: variants.some((v) => v.id === recommended)
      ? recommended
      : (variants[0]?.id ?? "v-en-1"),
    usage,
  };
}

/** Campaign copy mix — e.g. 2 English + 1 Chinese when TikTok/IG + 小红书. */
export async function runCopyAgentMix(input: CopyMixInput): Promise<{
  variants: CopyVariant[];
  recommendedVariantId: string;
  usage: { input: number; output: number; costUsd: number };
}> {
  const allVariants: CopyVariant[] = [];
  let usageTotal = emptyUsage();

  for (const slot of input.mix) {
    const { variants, usage } = await runCopyAgent({
      vision: input.vision,
      brandProfile: input.brandProfile,
      platform: slot.platform,
      goal: input.goal,
      campaignName: input.campaignName,
      strategyPlan: input.strategyPlan,
      hookSet: input.hookSet,
      locale: slot.locale,
      templates: [slot.template],
      slotIds: [slot.id],
    });

    const variant = variants[0];
    if (variant) {
      allVariants.push({
        ...variant,
        id: slot.id,
        platform: slot.platform,
        locale: slot.locale,
        template: slot.template,
        tags: normalizeTags(variant.tags, slot.platform, input.goal, slot.locale),
      });
    }
    usageTotal.input += usage.input;
    usageTotal.output += usage.output;
    usageTotal.costUsd += usage.costUsd;
  }

  const enFirst = allVariants.find((v) => v.locale === "en")?.id;
  return {
    variants: allVariants,
    recommendedVariantId: enFirst ?? allVariants[0]?.id ?? "v-en-1",
    usage: usageTotal,
  };
}
