import { callJsonModel } from "./llm";
import {
  MarketingScoreSchema,
  type CopyVariant,
  type EditPlan,
  type MarketingScore,
  type StrategyPlan,
  type VisionAnalysis,
  type HookSet,
  type Platform,
} from "@ceo-agent/shared";

export interface ScoreInput {
  strategy: StrategyPlan;
  hookSet: HookSet;
  vision: VisionAnalysis;
  copyVariants: CopyVariant[];
  editPlan: EditPlan | null;
  platforms: Platform[];
  selectedHookId?: string;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildFallbackScore(input: ScoreInput): MarketingScore {
  const selectedHook =
    input.hookSet.hooks.find((h) => h.id === input.selectedHookId) ??
    input.hookSet.hooks.find((h) => h.id === input.hookSet.recommendedHookId) ??
    input.hookSet.hooks[0];
  const primaryCopy = input.copyVariants[0];

  const hookScore = selectedHook?.text.length >= 8 && selectedHook.text.length <= 40 ? 78 : 65;
  const visualScore =
    input.vision.scenes.length >= 2 && (input.vision.confidence ?? 0.7) >= 0.5 ? 80 : 68;
  const copyScore = primaryCopy?.hook && primaryCopy?.body && primaryCopy?.cta ? 75 : 60;
  const ctaScore = primaryCopy?.cta && primaryCopy.cta.length >= 4 ? 72 : 58;
  const platformFitScore = input.copyVariants.some((v) =>
    input.platforms.includes(v.platform)
  )
    ? 76
    : 62;

  const overallScore = Math.round(
    avg([hookScore, visualScore, copyScore, ctaScore, platformFitScore])
  );

  const improvements: string[] = [];
  if (hookScore < 75) improvements.push("强化前 3 秒钩子，增加好奇心或对比");
  if (visualScore < 75) improvements.push("增加更多高情绪画面或产品特写镜头");
  if (copyScore < 75) improvements.push("文案结构改为 Hook → 3 卖点 → CTA");
  if (ctaScore < 70) improvements.push("CTA 更具体，例如私信/预约/收藏");
  if (platformFitScore < 75) improvements.push("按平台调整标题长度与标签风格");

  return {
    overallScore,
    hookScore,
    visualScore,
    copyScore,
    ctaScore,
    platformFitScore,
    improvements,
    scoredAt: new Date().toISOString(),
  };
}

export async function runScoreAgent(input: ScoreInput): Promise<{
  score: MarketingScore;
  usage: { input: number; output: number; costUsd: number };
}> {
  const system = `You are the Marketing Score Agent for EmberOS.
Score the creative 0-100 on: hookScore, visualScore, copyScore, ctaScore, platformFitScore.
Compute overallScore as weighted average (hook 25%, visual 20%, copy 25%, cta 15%, platform 15%).
Provide 2-5 actionable improvements in Chinese if content is Chinese, else English.
Output JSON matching MarketingScore schema.`;

  const user = JSON.stringify({
    strategy: input.strategy,
    hooks: input.hookSet,
    vision: input.vision,
    copyVariants: input.copyVariants,
    editPlan: input.editPlan
      ? { duration: input.editPlan.targetDurationSec, subtitles: input.editPlan.subtitles?.length }
      : null,
    platforms: input.platforms,
    selectedHookId: input.selectedHookId,
  });

  const { result, usage } = await callJsonModel<unknown>(
    system,
    user,
    MarketingScoreSchema.toString()
  );
  const parsed = MarketingScoreSchema.safeParse(result);

  if (parsed.success) {
    return { score: parsed.data, usage };
  }

  return { score: buildFallbackScore(input), usage };
}
