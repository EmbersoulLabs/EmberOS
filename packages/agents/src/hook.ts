import { callJsonModel } from "./llm";
import {
  HookSetSchema,
  resolveStrategyIndustryEnum,
  type HookItem,
  type HookSet,
  type HookType,
  type StrategyPlan,
  type VisionAnalysis,
} from "@ceo-agent/shared";
import { hasKnowledgeSeed, queryKnowledge } from "./knowledge/query";

const HOOK_TYPES: HookType[] = ["curiosity", "problem", "emotional", "offer"];

export interface HookInput {
  strategy: StrategyPlan;
  vision: VisionAnalysis;
  goal: string;
  campaignName?: string;
  videoAnalysis?: string | null;
}

function buildFallbackHooks(input: HookInput): HookSet {
  const industry = resolveStrategyIndustryEnum(input.strategy);
  const knowledge = queryKnowledge(industry);
  const byType = new Map<HookType, string>();

  for (const snippet of knowledge) {
    if (snippet.category === "hook" && snippet.hookType && !byType.has(snippet.hookType)) {
      byType.set(snippet.hookType, snippet.text);
    }
  }

  const subject =
    input.vision.products[0]?.name ||
    input.vision.subjects.filter((s) => s !== "product").join("、") ||
    input.campaignName ||
    "品牌内容";

  const angle = input.strategy.marketingAngle;
  const isB2b = industry === "b2b_saas";

  const hooks: HookItem[] = HOOK_TYPES.map((type) => {
    const seed = byType.get(type);
    let text = seed ?? "";
    if (!text) {
      if (isB2b) {
        const b2bFallbacks: Record<HookType, string> = {
          curiosity: `为什么有的企业上了系统效率翻倍，有的却用不起来？`,
          problem: `还在用 Excel 管${subject}？漏单、对账、报表全靠人工？`,
          emotional: `老板终于不用半夜盯数据和回款了`,
          offer: `${subject}方案支持预约演示，按需模块上线`,
        };
        text = b2bFallbacks[type];
      } else {
        const consumerFallbacks: Record<HookType, string> = {
          curiosity: angle ? `${angle.slice(0, 28)}…` : `第一眼就被${subject}吸引住了`,
          problem: `为什么你的${subject}总是达不到预期效果？`,
          emotional: `看到${subject}的那一刻，就知道选对了`,
          offer: `想了解${subject}？私信/get详情`,
        };
        text = consumerFallbacks[type];
      }
    }
    return {
      id: `hook_${type}`,
      type,
      text,
      rationale: seed
        ? `From industry seed (${type})`
        : `Generated from strategy context (${type}, ${industry})`,
    };
  });

  return { hooks, recommendedHookId: hooks[0]?.id };
}

export async function runHookAgent(input: HookInput): Promise<{
  hookSet: HookSet;
  usage: { input: number; output: number; costUsd: number };
}> {
  const industry = resolveStrategyIndustryEnum(input.strategy);
  const seeded = hasKnowledgeSeed(industry);
  const zh = /[\u4e00-\u9fff]/.test(
    `${input.goal}${input.campaignName ?? ""}${input.strategy.marketingAngle}`
  );

  const system = `You are the Hook Agent for short-form video marketing.
Generate exactly 4 hooks, one per type: curiosity, problem, emotional, offer.
${zh ? "Write hooks in natural Chinese (简体中文)." : "Write in English."}
Each hook must work as 0-3s opening line for vertical video.
Base hooks on the strategy plan (audience, pain points, marketing angle) and vision analysis.
${seeded ? "You may align with common patterns for this industry." : "There are NO industry templates — write original hooks specific to this campaign; do NOT reuse wedding/florist/ERP clichés unless relevant."}
Output JSON: { "hooks": [{ "id", "type", "text", "rationale" }], "recommendedHookId" }`;

  const user = JSON.stringify({
    strategy: input.strategy,
    vision: {
      subjects: input.vision.subjects,
      products: input.vision.products,
      scenes: input.vision.scenes,
      hooks: input.vision.hooks,
    },
    goal: input.goal,
    campaignName: input.campaignName,
    hasSeededKnowledge: seeded,
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
  });

  const { result, usage } = await callJsonModel<unknown>(system, user, HookSetSchema.toString());
  const parsed = HookSetSchema.safeParse(result);

  if (parsed.success && parsed.data.hooks.length >= 4) {
    return { hookSet: parsed.data, usage };
  }

  return { hookSet: buildFallbackHooks(input), usage };
}
