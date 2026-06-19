import { callJsonModel } from "./llm";
import { StrategyPlanSchema, type BrandProfile, type StrategyPlan, type Industry } from "@ceo-agent/shared";
import {
  defaultPlatformPriority,
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
}

const INDUSTRY_FALLBACK_ZH: Partial<
  Record<
    Industry,
    { audience: string; pains: string[]; angle: string; cta: string; objectives: string[] }
  >
> = {
  b2b_saas: {
    audience: "中小企业老板、运营负责人、财务/仓管决策者",
    pains: ["数据分散在 Excel 或多个系统", "报表滞后，决策靠经验", "重复录入，效率低且易出错"],
    angle: "用真实业务场景展示系统如何降本增效",
    cta: "私信预约产品演示",
    objectives: ["获客", "预约演示", "建立专业信任"],
  },
  wedding: {
    audience: "备婚新人、注重仪式感的年轻情侣",
    pains: ["不知道如何选择合适风格", "担心实拍效果与预期不符", "预算有限但想要高级感"],
    angle: "用实拍对比突出专业布置价值",
    cta: "私信获取同款方案",
    objectives: ["种草", "提升咨询转化", "建立信任"],
  },
  florist: {
    audience: "注重仪式感和视觉呈现的花艺/生活方式消费者",
    pains: ["不知道如何选择合适的花艺风格", "担心实拍效果与预期不符", "预算有限但想要高级感"],
    angle: "用层次、配色和实拍效果突出花艺专业度",
    cta: "私信获取同款方案",
    objectives: ["种草", "提升咨询转化", "建立信任"],
  },
  restaurant: {
    audience: "附近食客、探店用户、注重用餐体验的消费者",
    pains: ["选择太多不知道吃什么", "担心踩雷、图文不符", "想要有记忆点的用餐体验"],
    angle: "用真实探店场景突出招牌菜与环境氛围",
    cta: "收藏地址，周末来试试",
    objectives: ["种草", "到店转化", "提升曝光"],
  },
  retail: {
    audience: "对产品有明确需求、注重性价比的消费者",
    pains: ["不知道哪款适合自己", "担心买错或售后麻烦", "想要真实使用反馈"],
    angle: "用对比测评和使用场景建立购买信心",
    cta: "点击主页链接查看详情",
    objectives: ["种草", "促进购买", "提升信任"],
  },
  beauty: {
    audience: "关注颜值管理、护肤妆效的目标用户",
    pains: ["产品太多不会选", "担心过敏或效果夸大", "想要可复制的变美方案"],
    angle: "用前后对比和步骤拆解展示真实效果",
    cta: "收藏备用，跟着做",
    objectives: ["种草", "建立专业信任", "促进咨询"],
  },
  real_estate: {
    audience: "有购房/租房需求的用户及家庭决策者",
    pains: ["信息不透明、难比价", "担心地段和配套不符预期", "想要真实看房参考"],
    angle: "用实地探访和数据对比呈现真实价值",
    cta: "私信获取资料包或预约看房",
    objectives: ["获取线索", "建立信任", "促进咨询"],
  },
  phone_buyback: {
    audience: "想换新机、关注回收价格的用户",
    pains: ["不知道哪里回收价高", "担心压价和数据安全", "流程复杂耗时间"],
    angle: "用透明估价流程和到账速度建立信任",
    cta: "评论机型，获取估价",
    objectives: ["获取线索", "促进到店/上门", "建立信任"],
  },
};

function genericFallbackZh(input: StrategyInput, industry: Industry): StrategyPlan {
  const profile = INDUSTRY_FALLBACK_ZH[industry] ?? INDUSTRY_FALLBACK_ZH.general;
  const topic = input.campaignName.trim() || "本品牌";
  const goal = input.goal || "种草";

  return {
    targetAudience: input.brandProfile.targetAudience ?? profile?.audience ?? `${topic} 的目标用户`,
    painPoints: profile?.pains ?? [
      "不知道如何选择合适方案",
      "担心效果与宣传不符",
      "希望获得可信赖的参考",
    ],
    marketingAngle: profile?.angle ?? `围绕「${topic}」用真实场景展示核心价值`,
    ctaStrategy: input.brandProfile.cta ?? profile?.cta ?? "私信了解更多",
    platformPriority: defaultPlatformPriority(input.platforms),
    objectives: profile?.objectives ?? [goal, "提升咨询转化", "建立信任"],
    industry: industry === "general" ? undefined : industry,
  };
}

function buildFallbackStrategy(input: StrategyInput, industry: Industry): StrategyPlan {
  const zh = /[\u4e00-\u9fff]/.test(`${input.goal}${input.campaignName}`);
  const knowledge = queryKnowledge(industry);
  const angles = knowledge.filter((k) => k.category === "angle").map((k) => k.text);
  const ctas = knowledge.filter((k) => k.category === "cta").map((k) => k.text);
  const hooks = knowledge.filter((k) => k.category === "hook").map((k) => k.text);

  if (zh) {
    const base = genericFallbackZh(input, industry);
    return {
      ...base,
      marketingAngle: angles[0] ?? hooks[0] ?? base.marketingAngle,
      ctaStrategy: ctas[0] ?? base.ctaStrategy,
      industry: industry === "general" ? base.industry : industry,
    };
  }

  return {
    targetAudience:
      input.brandProfile.targetAudience ?? "Short-form video audience with relevant interest",
    painPoints: ["Hard to stand out", "Unclear value proposition", "Low engagement on posts"],
    marketingAngle: angles[0] ?? hooks[0] ?? `Show real value for ${input.campaignName || "this offer"}`,
    ctaStrategy: ctas[0] ?? input.brandProfile.cta ?? "Follow for more",
    platformPriority: defaultPlatformPriority(input.platforms),
    objectives: [input.goal || "awareness", "drive engagement"],
    industry: industry === "general" ? undefined : industry,
  };
}

export async function runStrategyAgent(input: StrategyInput): Promise<{
  strategy: StrategyPlan;
  industry: Industry;
  knowledgeSnippets: ReturnType<typeof queryKnowledge>;
  usage: { input: number; output: number; costUsd: number };
}> {
  const industry = inferIndustry(
    input.goal,
    input.campaignName,
    input.brandProfile.industry
  );
  const knowledgeSnippets = queryKnowledge(industry, input.brandProfile.locale ?? "zh-CN");
  const knowledgeBlock = formatKnowledgeForPrompt(knowledgeSnippets);
  const seeded = hasKnowledgeSeed(industry);

  const system = `You are the Strategy Agent for EmberOS marketing OS.
Define audience, pain points, marketing angle, CTA strategy, and platform priority.
${seeded ? "Use the provided industry knowledge snippets to align tone and patterns." : "There are NO pre-built templates for this industry. Infer everything from campaign goal, name, brand profile, and inferred industry — do NOT copy wedding, florist, or ERP examples unless the campaign is actually about those topics."}
Output JSON matching StrategyPlan schema.
Fields: targetAudience, painPoints[], marketingAngle, ctaStrategy, platformPriority[], objectives[], industry.`;

  const user = JSON.stringify({
    campaignName: input.campaignName,
    goal: input.goal,
    platforms: input.platforms,
    brandProfile: input.brandProfile,
    inferredIndustry: industry,
    hasSeededKnowledge: seeded,
    knowledge: knowledgeBlock,
  });

  const { result, usage } = await callJsonModel<unknown>(
    system,
    user,
    StrategyPlanSchema.toString()
  );

  const parsed = StrategyPlanSchema.safeParse(result);
  const strategy = parsed.success
    ? {
        ...parsed.data,
        platformPriority: parsed.data.platformPriority.length
          ? parsed.data.platformPriority
          : defaultPlatformPriority(input.platforms),
        industry: parsed.data.industry ?? (industry === "general" ? undefined : industry),
      }
    : buildFallbackStrategy(input, industry);

  return { strategy, industry: strategy.industry ?? industry, knowledgeSnippets, usage };
}
