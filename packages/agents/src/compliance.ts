import { callJsonModel } from "./llm";
import { ComplianceResultSchema } from "@ceo-agent/shared";
import type { BrandProfile, ComplianceResult, CopyVariant } from "@ceo-agent/shared";

const DEFAULT_BANNED = ["guaranteed", "100%", "cure", "miracle", "best in the world"];

export interface ComplianceInput {
  copyVariants: CopyVariant[];
  subtitles: string[];
  brandProfile: BrandProfile;
}

export async function runComplianceAgent(input: ComplianceInput): Promise<{
  result: ComplianceResult;
  usage: { input: number; output: number; costUsd: number };
}> {
  const banned = [...DEFAULT_BANNED, ...(input.brandProfile.bannedWords ?? [])];

  const system = `You are a Compliance Agent for Singapore/SEA advertising.
Check for superlatives, false claims, medical/financial disclaimers, and banned words.
Brand banned list: ${banned.join(", ")}. Output passed boolean and flags with suggestions.`;

  const user = JSON.stringify({
    variants: input.copyVariants,
    subtitles: input.subtitles,
  });

  const { result, usage } = await callJsonModel<unknown>(system, user, "ComplianceResult");
  const parsed = ComplianceResultSchema.safeParse(result);

  if (parsed.success) {
    return { result: parsed.data, usage };
  }

  const flags: ComplianceResult["flags"] = [];
  for (const variant of input.copyVariants) {
    const text = `${variant.hook} ${variant.body} ${variant.cta} ${variant.title}`;
    for (const word of banned) {
      if (text.toLowerCase().includes(word.toLowerCase())) {
        flags.push({
          source: "copy",
          variantId: variant.id,
          word,
          reason: "banned_word",
          suggestion: "Remove or rephrase",
        });
      }
    }
  }

  return {
    result: {
      passed: flags.length === 0,
      score: flags.length === 0 ? 0.95 : 0.6,
      flags,
      checkedAt: new Date().toISOString(),
    },
    usage,
  };
}
