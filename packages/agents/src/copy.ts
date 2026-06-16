import { callJsonModel } from "./llm";
import { COPY_VARIANT_COUNT } from "@ceo-agent/shared";
import { getPlatformSpec, truncateForPlatform } from "@ceo-agent/shared/platform-specs";
import type { BrandProfile, CopyVariant, Platform, VisionAnalysis } from "@ceo-agent/shared";
import { z } from "zod";

const CopyOutputSchema = z.object({
  platform: z.string(),
  locale: z.string(),
  variants: z.array(
    z.object({
      id: z.string(),
      template: z.enum(["pain_point", "comparison", "story", "listicle", "review"]),
      hook: z.string(),
      body: z.string(),
      cta: z.string(),
      title: z.string(),
      tags: z.array(z.string()),
      estimatedReadSec: z.number().optional(),
    })
  ),
  recommendedVariantId: z.string().optional(),
});

const TEMPLATES = ["pain_point", "comparison", "story"] as const;

export interface CopyInput {
  vision: VisionAnalysis;
  brandProfile: BrandProfile;
  platform: Platform;
  goal: string;
}

export async function runCopyAgent(input: CopyInput): Promise<{
  variants: CopyVariant[];
  recommendedVariantId: string;
  usage: { input: number; output: number; costUsd: number };
}> {
  const spec = getPlatformSpec(input.platform);
  const system = `You are a viral copywriter for ${spec.name} in ${input.brandProfile.locale ?? spec.locale}.
Generate exactly ${COPY_VARIANT_COUNT} copy variants using templates: pain_point, comparison, story.
Brand tone: ${input.brandProfile.tone ?? "engaging"}. Banned: ${(input.brandProfile.bannedWords ?? []).join(", ") || "none"}.
Title max ${spec.titleMaxLength} chars. Body max ${spec.bodyMaxLength} chars. Tags max ${spec.maxTags}.
Follow hook (0-3s attention) → value (≤3 points) → CTA structure.`;

  const user = JSON.stringify({
    goal: input.goal,
    platform: input.platform,
    vision: {
      subjects: input.vision.subjects,
      hooks: input.vision.hooks,
      products: input.vision.products,
      transcript: input.vision.transcriptSummary,
    },
    brand: input.brandProfile,
  });

  const { result, usage } = await callJsonModel<unknown>(system, user, "CopyVariants");
  const parsed = CopyOutputSchema.safeParse(result);

  let variants: CopyVariant[] = [];
  if (parsed.success) {
    variants = parsed.data.variants.map((v) => ({
      ...v,
      platform: input.platform,
      title: truncateForPlatform(v.title, input.platform, "title"),
      body: truncateForPlatform(v.body, input.platform, "body"),
    }));
  } else {
    variants = TEMPLATES.map((template, i) => ({
      id: `v${i + 1}`,
      template,
      hook: `Discover ${input.vision.subjects[0] ?? "something amazing"}`,
      body: `Here's why ${input.goal}. ${input.vision.transcriptSummary?.slice(0, 100) ?? ""}`,
      cta: input.brandProfile.cta ?? "Follow for more!",
      title: truncateForPlatform(`${input.goal}`.slice(0, 50), input.platform, "title"),
      tags: [`${spec.tagPrefix}${input.platform}`],
      platform: input.platform,
      estimatedReadSec: 8,
    }));
  }

  return {
    variants,
    recommendedVariantId: parsed.success
      ? (parsed.data.recommendedVariantId ?? variants[0]?.id ?? "v1")
      : (variants[0]?.id ?? "v1"),
    usage,
  };
}
