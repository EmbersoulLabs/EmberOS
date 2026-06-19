import { z } from "zod";
import { PlatformSchema } from "./index";

export const IndustrySchema = z.enum([
  "florist",
  "wedding",
  "restaurant",
  "retail",
  "beauty",
  "real_estate",
  "phone_buyback",
  "b2b_saas",
  "education",
  "general",
]);
export type Industry = z.infer<typeof IndustrySchema>;

export const StrategyPlanSchema = z.object({
  targetAudience: z.string(),
  painPoints: z.array(z.string()),
  marketingAngle: z.string(),
  ctaStrategy: z.string(),
  platformPriority: z.array(PlatformSchema),
  objectives: z.array(z.string()).default([]),
  industry: IndustrySchema.optional(),
});
export type StrategyPlan = z.infer<typeof StrategyPlanSchema>;

export const HookTypeSchema = z.enum(["curiosity", "problem", "emotional", "offer"]);
export type HookType = z.infer<typeof HookTypeSchema>;

export const HookItemSchema = z.object({
  id: z.string(),
  type: HookTypeSchema,
  text: z.string(),
  rationale: z.string().optional(),
});
export type HookItem = z.infer<typeof HookItemSchema>;

export const HookSetSchema = z.object({
  hooks: z.array(HookItemSchema),
  recommendedHookId: z.string().optional(),
});
export type HookSet = z.infer<typeof HookSetSchema>;

export const MarketingScoreSchema = z.object({
  overallScore: z.number().min(0).max(100),
  hookScore: z.number().min(0).max(100),
  visualScore: z.number().min(0).max(100),
  copyScore: z.number().min(0).max(100),
  ctaScore: z.number().min(0).max(100),
  platformFitScore: z.number().min(0).max(100),
  improvements: z.array(z.string()),
  scoredAt: z.string(),
});
export type MarketingScore = z.infer<typeof MarketingScoreSchema>;

export const KnowledgeSnippetSchema = z.object({
  category: z.enum(["hook", "cta", "angle", "template"]),
  hookType: HookTypeSchema.optional(),
  text: z.string(),
  locale: z.string().default("zh-CN"),
});
export type KnowledgeSnippet = z.infer<typeof KnowledgeSnippetSchema>;
