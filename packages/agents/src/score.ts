import { z } from "zod";
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
  videoAnalysis?: string | null;
}

const MARKETING_SCORE_SCHEMA_HINT = `MarketingScore JSON object:
{
  "overallScore": number (0-100, weighted: hook 25%, visual 20%, copy 25%, cta 15%, platform 15%),
  "hookScore": number (0-100),
  "visualScore": number (0-100),
  "copyScore": number (0-100),
  "ctaScore": number (0-100),
  "platformFitScore": number (0-100),
  "improvements": string[] (2-5 items),
  "scoredAt": string (ISO8601, optional)
}`;

/** Accept LLM output that omits scoredAt or overallScore; recompute overall when needed. */
const MarketingScoreLooseSchema = z.object({
  overallScore: z.coerce.number().min(0).max(100).optional(),
  hookScore: z.coerce.number().min(0).max(100),
  visualScore: z.coerce.number().min(0).max(100),
  copyScore: z.coerce.number().min(0).max(100),
  ctaScore: z.coerce.number().min(0).max(100),
  platformFitScore: z.coerce.number().min(0).max(100),
  improvements: z.array(z.string()).default([]),
  scoredAt: z.string().optional(),
});

function weightedOverallScore(scores: {
  hookScore: number;
  visualScore: number;
  copyScore: number;
  ctaScore: number;
  platformFitScore: number;
}): number {
  return Math.round(
    scores.hookScore * 0.25 +
      scores.visualScore * 0.2 +
      scores.copyScore * 0.25 +
      scores.ctaScore * 0.15 +
      scores.platformFitScore * 0.15
  );
}

function preprocessLlmScore(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const aliases: Record<string, string> = {
    overall_score: "overallScore",
    hook_score: "hookScore",
    visual_score: "visualScore",
    copy_score: "copyScore",
    cta_score: "ctaScore",
    platform_fit_score: "platformFitScore",
    platformFit: "platformFitScore",
    suggestions: "improvements",
    improvement: "improvements",
  };
  for (const [from, to] of Object.entries(aliases)) {
    if (from in r && !(to in r)) {
      r[to] = r[from];
    }
  }
  if (Array.isArray(r.improvements) && r.improvements.length === 0 && Array.isArray(r.suggestions)) {
    r.improvements = r.suggestions;
  }
  return r;
}

function normalizeLlmScore(raw: unknown): MarketingScore | null {
  const parsed = MarketingScoreLooseSchema.safeParse(preprocessLlmScore(raw));
  if (!parsed.success) return null;

  const { overallScore, scoredAt, improvements, ...dimensionScores } = parsed.data;
  const score: MarketingScore = {
    ...dimensionScores,
    overallScore: overallScore ?? weightedOverallScore(dimensionScores),
    improvements,
    scoredAt: scoredAt ?? new Date().toISOString(),
  };

  const validated = MarketingScoreSchema.safeParse(score);
  return validated.success ? validated.data : null;
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

  const overallScore = weightedOverallScore({
    hookScore,
    visualScore,
    copyScore,
    ctaScore,
    platformFitScore,
  });

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
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
  });

  const { result, usage } = await callJsonModel<unknown>(
    system,
    user,
    MARKETING_SCORE_SCHEMA_HINT
  );

  const normalized = normalizeLlmScore(result);
  if (normalized) {
    return { score: normalized, usage };
  }

  console.warn(
    "[score] LLM output failed validation, using heuristic fallback:",
    MarketingScoreSchema.safeParse(result).error?.message ??
      MarketingScoreLooseSchema.safeParse(result).error?.message
  );

  return { score: buildFallbackScore(input), usage };
}

/** Score auto-clip output without full agency strategy/hook steps. */
export async function runAutoClipScoreAgent(input: {
  vision: VisionAnalysis;
  copyVariants: CopyVariant[];
  editPlan: EditPlan | null;
  platforms: Platform[];
}): Promise<{
  score: MarketingScore;
  usage: { input: number; output: number; costUsd: number };
}> {
  const hookSet: HookSet = {
    hooks: input.vision.hooks.slice(0, 4).map((text, i) => ({
      id: `auto-${i}`,
      type: "curiosity" as const,
      text: text.slice(0, 80),
    })),
    recommendedHookId: "auto-0",
  };
  if (hookSet.hooks.length === 0) {
    hookSet.hooks.push({ id: "auto-0", type: "curiosity", text: "Opening hook" });
  }

  const primary = input.copyVariants[0];
  const strategy: StrategyPlan = {
    targetAudience: "short-form social viewers",
    painPoints: [],
    marketingAngle: input.vision.hooks[0] ?? primary?.hook ?? "Product highlight",
    ctaStrategy: primary?.cta ?? "Take action",
    platformPriority: input.platforms,
    objectives: [],
  };

  return runScoreAgent({
    strategy,
    hookSet,
    vision: input.vision,
    copyVariants: input.copyVariants,
    editPlan: input.editPlan,
    platforms: input.platforms,
  });
}
