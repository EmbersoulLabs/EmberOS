import { callJsonModel } from "./llm";
import {
  StrategyPlanSchema,
  normalizeStrategyPlan,
  resolveStrategyIndustryEnum,
  resolveStrategyPlatforms,
  outputLanguagePrompt,
  type BrandProfile,
  type ContentLocale,
  type StrategyPlan,
  type Industry,
} from "@ceo-agent/shared";
import {
  formatKnowledgeForPrompt,
  hasKnowledgeSeed,
  inferIndustry,
  queryKnowledge,
} from "./knowledge/query";

export interface StrategyInput {
  goal: string;
  campaignName: string;
  platforms: string[];
  brandProfile: BrandProfile;
  videoAnalysis?: string | null;
  imageAnalysis?: string | null;
  productInformation?: string | Record<string, unknown> | null;
  businessInformation?: string | Record<string, unknown> | null;
  website?: string | null;
  contentLocale?: ContentLocale;
}

const STRATEGY_SYSTEM_PROMPT = `# Marketing Strategy Agent

## ROLE

You are the Marketing Strategy Engine inside EmberOS.

You are not ChatGPT.

You are not a copywriter.

You are a senior marketing strategist responsible for understanding a business and designing the best marketing strategy before any content is generated.

Your output will be consumed by downstream AI agents.

Never generate captions, subtitles or voice scripts.

Only generate strategy.

---

# INPUT

The system may provide:

* Video Analysis
* Image Analysis
* Product Information
* Business Information
* Brand Profile
* User Description
* Website
* Previous Marketing Assets

Information may be incomplete.

Never ask for more information.

Infer intelligently.

The campaignName field is an internal project label only — never copy it into product, marketingAngle, or keywords. Derive product/service from Video Analysis, goal, and business context.

Never assume content belongs to a florist or wedding vendor unless the input clearly indicates that industry.

Works for any industry: retail, fashion, beauty, restaurant, cafe, bakery, real estate, automotive, electronics, SaaS, mobile app, education, healthcare, fitness, travel, events, finance, professional services, home services, manufacturing, and more.

---

# OBJECTIVES

Determine industry, business type, product/service, core selling points, brand personality, marketing goal, marketing angle, target audience (age, gender, location, interests, buying intent, pain points, desired outcome), customer journey stage, platform priorities, recommended tone, recommended video style, CTA strategy, keywords, and hashtag categories.

Return ONLY JSON matching the schema. No markdown.`;

const INDUSTRY_FALLBACK: Partial<
  Record<
    Industry,
    {
      businessType: string;
      product: string;
      marketingGoal: string;
      angle: string;
      tone: string;
      videoStyle: string;
      audience: StrategyPlan["audience"];
      customerJourney: string;
      cta: string;
      brandPersonality: string[];
      keywords: string[];
    }
  >
> = {
  b2b_saas: {
    businessType: "B2B SaaS",
    product: "Business management software",
    marketingGoal: "Lead Generation",
    angle: "Problem → Solution with real workflow demos",
    tone: "Professional",
    videoStyle: "Product Showcase",
    audience: {
      painPoints: ["Data scattered across spreadsheets", "Slow reporting", "Manual duplicate entry"],
      buyingIntent: "Evaluate software to reduce operational cost",
      desiredOutcome: "Faster decisions with unified data",
      interests: [],
    },
    customerJourney: "Consideration",
    cta: "Consultation CTA — book a demo",
    brandPersonality: ["Professional", "Technology", "Confident"],
    keywords: ["business software", "workflow automation", "SME ERP"],
  },
  restaurant: {
    businessType: "Restaurant / F&B",
    product: "Dining experience",
    marketingGoal: "Traffic",
    angle: "Lifestyle — real dining moments",
    tone: "Friendly",
    videoStyle: "Behind The Scenes",
    audience: {
      painPoints: ["Too many choices", "Fear of disappointing meals", "Want memorable experiences"],
      buyingIntent: "Find a place to eat this week",
      desiredOutcome: "A reliable favorite spot",
      interests: [],
    },
    customerJourney: "Awareness",
    cta: "Soft CTA — save location and visit",
    brandPersonality: ["Friendly", "Warm", "Playful"],
    keywords: ["restaurant near me", "food review", "must try"],
  },
  retail: {
    businessType: "Retail",
    product: "Consumer products",
    marketingGoal: "Sales",
    angle: "Transformation — see the difference in use",
    tone: "Conversational",
    videoStyle: "Product Showcase",
    audience: {
      painPoints: ["Hard to choose the right product", "Worried about quality", "Want honest reviews"],
      buyingIntent: "Ready to purchase with confidence",
      desiredOutcome: "Buy once, love it",
      interests: [],
    },
    customerJourney: "Decision",
    cta: "Hard CTA — shop now",
    brandPersonality: ["Modern", "Bold", "Friendly"],
    keywords: ["best buy", "product review", "deal"],
  },
  beauty: {
    businessType: "Beauty / Wellness",
    product: "Beauty service or product",
    marketingGoal: "Brand Awareness",
    angle: "Before & After transformation",
    tone: "Emotional",
    videoStyle: "Tutorial",
    audience: {
      painPoints: ["Too many products to choose", "Skeptical of exaggerated claims", "Want repeatable results"],
      buyingIntent: "Improve appearance or self-care routine",
      desiredOutcome: "Visible, trustworthy improvement",
      interests: [],
    },
    customerJourney: "Consideration",
    cta: "Booking CTA — reserve appointment",
    brandPersonality: ["Elegant", "Premium", "Friendly"],
    keywords: ["skincare routine", "beauty tips", "salon"],
  },
  real_estate: {
    businessType: "Real Estate",
    product: "Property listing or agency service",
    marketingGoal: "Lead Generation",
    angle: "Authority — neighborhood expertise",
    tone: "Professional",
    videoStyle: "Cinematic",
    audience: {
      painPoints: ["Opaque pricing", "Uncertain location fit", "Need trustworthy walkthroughs"],
      buyingIntent: "Research homes or rentals",
      desiredOutcome: "Find the right property faster",
      interests: [],
    },
    customerJourney: "Consideration",
    cta: "Consultation CTA — schedule viewing",
    brandPersonality: ["Professional", "Luxury", "Confident"],
    keywords: ["property tour", "real estate agent", "home for sale"],
  },
};

function platformLabels(platforms: string[]): string[] {
  const labels: Record<string, string> = {
    tiktok: "TikTok",
    instagram: "Instagram",
    xiaohongshu: "Xiaohongshu",
    douyin: "Douyin",
  };
  return platforms.map((p) => labels[p] ?? p);
}

function resolveStrategyLocale(input: StrategyInput): ContentLocale {
  if (input.contentLocale) return input.contentLocale;
  return /[\u4e00-\u9fff]/.test(`${input.goal}${input.campaignName}`) ? "zh" : "en";
}

function buildFallbackStrategy(input: StrategyInput, industry: Industry): StrategyPlan {
  const locale = resolveStrategyLocale(input);
  const zh = locale === "zh";
  const knowledge = queryKnowledge(industry);
  const angles = knowledge.filter((k) => k.category === "angle").map((k) => k.text);
  const ctas = knowledge.filter((k) => k.category === "cta").map((k) => k.text);
  const profile = INDUSTRY_FALLBACK[industry];
  const topic = input.goal.trim() || input.brandProfile.targetAudience || "this business";
  const product =
    (typeof input.productInformation === "string" ? input.productInformation : undefined) ??
    profile?.product ??
    topic;

  if (zh) {
    return normalizeStrategyPlan(null, {
      industry: industry === "general" ? "综合" : industry,
      businessType: profile?.businessType ?? "本地商户",
      product,
      marketingGoal: profile?.marketingGoal ?? (input.goal || "品牌曝光"),
      marketingAngle: angles[0] ?? profile?.angle ?? `围绕「${topic}」用真实场景展示核心价值`,
      brandPersonality: profile?.brandPersonality ?? ["专业", "友好"],
      tone: profile?.tone ?? "友好",
      videoStyle: profile?.videoStyle ?? "产品展示",
      audience: {
        painPoints: profile?.audience.painPoints ?? [
          "不知道如何选择合适方案",
          "担心效果与宣传不符",
        ],
        desiredOutcome: profile?.audience.desiredOutcome ?? "获得可信赖的参考",
        location: input.brandProfile.locale?.includes("SG") ? "新加坡" : undefined,
        interests: [],
      },
      customerJourney: profile?.customerJourney ?? "认知",
      platformPriority: platformLabels(input.platforms),
      ctaStrategy: input.brandProfile.cta ?? ctas[0] ?? profile?.cta ?? "私信了解更多",
      keywords: profile?.keywords ?? [topic],
      hashtags: { industry: [topic], local: [], trending: [], seo: profile?.keywords ?? [] },
      confidence: 0.65,
    });
  }

  return normalizeStrategyPlan(null, {
    industry: industry === "general" ? "general business" : industry,
    businessType: profile?.businessType ?? "Local business",
    product,
    marketingGoal: profile?.marketingGoal ?? (input.goal || "Brand Awareness"),
    marketingAngle: angles[0] ?? profile?.angle ?? `Show real value for ${topic}`,
    brandPersonality: profile?.brandPersonality ?? ["Professional", "Friendly"],
    tone: profile?.tone ?? "Professional",
    videoStyle: profile?.videoStyle ?? "Product Showcase",
    audience: {
      painPoints: profile?.audience.painPoints ?? [
        "Hard to stand out",
        "Unclear value proposition",
      ],
      desiredOutcome: profile?.audience.desiredOutcome ?? "Make a confident choice",
      interests: [],
    },
    customerJourney: profile?.customerJourney ?? "Awareness",
    platformPriority: platformLabels(input.platforms),
    ctaStrategy: input.brandProfile.cta ?? ctas[0] ?? profile?.cta ?? "Learn More",
    keywords: profile?.keywords ?? [topic],
    hashtags: { industry: [topic], local: [], trending: [], seo: profile?.keywords ?? [] },
    confidence: 0.65,
  });
}

export async function runStrategyAgent(input: StrategyInput): Promise<{
  strategy: StrategyPlan;
  industry: Industry;
  knowledgeSnippets: ReturnType<typeof queryKnowledge>;
  usage: { input: number; output: number; costUsd: number };
}> {
  const inferred = inferIndustry(
    input.goal,
    input.campaignName,
    input.brandProfile.industry
  );
  const locale = resolveStrategyLocale(input);
  const knowledgeLocale = locale === "zh" ? "zh-CN" : locale === "ms" ? "ms-MY" : "en-SG";
  const knowledgeSnippets = queryKnowledge(inferred, knowledgeLocale);
  const knowledgeBlock = formatKnowledgeForPrompt(knowledgeSnippets);
  const seeded = hasKnowledgeSeed(inferred);

  const user = JSON.stringify({
    campaignLabel: input.campaignName,
    goal: input.goal,
    platforms: input.platforms,
    brandProfile: input.brandProfile,
    inferredIndustry: inferred,
    hasSeededKnowledge: seeded,
    knowledge: knowledgeBlock,
    outputLanguage: outputLanguagePrompt(locale),
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
    ...(input.imageAnalysis ? { imageAnalysis: input.imageAnalysis } : {}),
    ...(input.productInformation ? { productInformation: input.productInformation } : {}),
    ...(input.businessInformation ? { businessInformation: input.businessInformation } : {}),
    ...(input.website ? { website: input.website } : {}),
  });

  const { result, usage } = await callJsonModel<unknown>(
    STRATEGY_SYSTEM_PROMPT,
    user,
    StrategyPlanSchema.toString()
  );

  const parsed = StrategyPlanSchema.safeParse(result);
  const strategy = parsed.success
    ? {
        ...parsed.data,
        platformPriority: parsed.data.platformPriority.length
          ? parsed.data.platformPriority
          : platformLabels(input.platforms),
      }
    : buildFallbackStrategy(input, inferred);

  const industry = resolveStrategyIndustryEnum(strategy, inferred);

  return { strategy, industry, knowledgeSnippets, usage };
}

/** Resolved platforms for downstream agents (copy mix, scoring). */
export function strategyPlatformsForTask(plan: StrategyPlan, campaignPlatforms: string[]) {
  return resolveStrategyPlatforms(plan, campaignPlatforms);
}
