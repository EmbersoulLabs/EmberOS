import { callJsonModel } from "./llm";
import { inferIndustry } from "./knowledge/query";
import type { VisionAnalysis } from "@ceo-agent/shared";
import {
  ContentClassificationSchema,
  classificationWithPreset,
  resolvePresetId,
  type ContentClassification,
  type ContentType,
  type Industry,
} from "@ceo-agent/shared";

export interface ContentTypeInput {
  goal: string;
  campaignName?: string;
  vision: VisionAnalysis;
  platforms?: string[];
  videoAnalysis?: string | null;
}

const GOAL_PATTERNS: { pattern: RegExp; contentType: ContentType }[] = [
  { pattern: /花店|鲜花|花艺|bouquet|florist|flower/i, contentType: "florist" },
  { pattern: /婚礼|婚车|新娘|wedding|bride|marriage/i, contentType: "wedding" },
  { pattern: /餐饮|美食|餐厅|restaurant|food|menu/i, contentType: "restaurant" },
  { pattern: /美容|美甲|护肤|beauty|salon|skincare/i, contentType: "beauty" },
  { pattern: /房产|楼盘|property|real estate|condo/i, contentType: "real_estate" },
  { pattern: /教育|课程|培训|education|course|tutorial/i, contentType: "education" },
  { pattern: /回收|trade-?in|buyback|旧手机/i, contentType: "phone_buyback" },
  { pattern: /播客|podcast|访谈/i, contentType: "podcast" },
  { pattern: /招聘|hiring|recruit|join us/i, contentType: "recruitment" },
  { pattern: /品牌|branding|brand story/i, contentType: "branding" },
  { pattern: /活动|event|promo|促销/i, contentType: "event_promotion" },
  { pattern: /故事|story|vlog/i, contentType: "storytelling" },
  { pattern: /服务|service|咨询|consult/i, contentType: "service_promotion" },
  { pattern: /产品|product|展示|showcase/i, contentType: "product_showcase" },
];

function inferContentType(goal: string, campaignName: string, vision: VisionAnalysis): ContentType {
  const text = `${campaignName} ${goal} ${vision.subjects.join(" ")} ${vision.products.map((p) => p.name).join(" ")}`;
  for (const { pattern, contentType } of GOAL_PATTERNS) {
    if (pattern.test(text)) return contentType;
  }
  if (vision.mediaType === "image") return "product_showcase";
  return "general";
}

function industryFromContentType(contentType: ContentType, fallback: Industry): Industry {
  const map: Partial<Record<ContentType, Industry>> = {
    florist: "florist",
    wedding: "wedding",
    restaurant: "restaurant",
    beauty: "beauty",
    real_estate: "real_estate",
    education: "education",
    phone_buyback: "phone_buyback",
  };
  return map[contentType] ?? fallback;
}

function buildFallback(input: ContentTypeInput): ContentClassification {
  const industry = inferIndustry(input.goal, input.campaignName ?? "");
  const contentType = inferContentType(input.goal, input.campaignName ?? "", input.vision);
  return classificationWithPreset({
    industry: industryFromContentType(contentType, industry),
    contentType,
    confidence: 0.72,
    rationale: "规则匹配 + 素材语义",
  });
}

export async function runContentTypeAgent(input: ContentTypeInput): Promise<{
  classification: ContentClassification;
  usage: { input: number; output: number; costUsd: number };
}> {
  const fallback = buildFallback(input);

  const system = `You classify marketing content for short-form video campaigns.
Output JSON: { "industry", "contentType", "confidence", "rationale" }
industry: florist|wedding|restaurant|retail|beauty|real_estate|phone_buyback|b2b_saas|education|general
contentType: product_showcase|service_promotion|wedding|florist|restaurant|beauty|education|real_estate|phone_buyback|podcast|storytelling|event_promotion|recruitment|branding|general`;

  const user = JSON.stringify({
    goal: input.goal,
    campaignName: input.campaignName,
    platforms: input.platforms,
    vision: {
      subjects: input.vision.subjects,
      products: input.vision.products,
      hooks: input.vision.hooks,
      scenes: input.vision.scenes.slice(0, 4),
      mediaType: input.vision.mediaType,
    },
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
  });

  try {
    const { result, usage } = await callJsonModel<unknown>(system, user, "ContentClassification");
    const parsed = ContentClassificationSchema.safeParse({
      ...(result as Record<string, unknown>),
      presetId: resolvePresetId({
        contentType: (result as { contentType?: ContentType }).contentType,
        industry: (result as { industry?: Industry }).industry,
      }),
    });
    if (parsed.success) {
      return { classification: parsed.data, usage };
    }
  } catch {
    // fall through
  }

  return { classification: fallback, usage: { input: 0, output: 0, costUsd: 0 } };
}
