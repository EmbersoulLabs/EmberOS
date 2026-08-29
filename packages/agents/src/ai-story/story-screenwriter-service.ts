/**
 * Screenwriter helpers for AI Story: rewrite, characters, dialogue, narrative.
 * Outputs feed Story Versions and/or Creative Context — planning only.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { callJsonModel } from "../llm";
import {
  AiStoryStructuredDraftSchema,
  CreativeContextCharacterSchema,
  CreativeContextSchema,
  type AiStoryCharacterProposal,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type PlanningUsage,
} from "@ceo-agent/shared";

/** Projects legacy Screenwriter output into proposals; only the Character API may accept authority. */
export function projectGeneratedCharactersToProposals(
  characters: CreativeContext["characterContext"]["characters"]
): AiStoryCharacterProposal[] {
  return characters.map((character) => ({
    proposalId: randomUUID(),
    proposalOnly: true,
    name: character.name,
    identity: character.description,
    appearance: character.visualNotes,
    personality: character.motivation || character.description,
    emotionalArc: character.motivation || "No canonical emotional arc proposed.",
    relationships: [],
    visualAssetIds: [],
  }));
}

type Usage = PlanningUsage;

export type ScreenwriterCampaignContext = {
  name: string;
  objective?: string | null;
  objectiveCustom?: string | null;
  targetAudienceOverride?: string | null;
  campaignBrief?: string | null;
  goal?: string | null;
};

export type ScreenwriterBrandContext = {
  brandName?: string | null;
  brandTone?: string | null;
  targetAudience?: string | null;
  industry?: string | null;
  description?: string | null;
};

const DialogueLineSchema = z.object({
  speaker: z.string().trim().min(1),
  line: z.string().trim().min(1),
  beatHint: z.string().default(""),
});

const NarrativeBlockSchema = CreativeContextSchema.shape.narrativeContext;

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    costUsd: a.costUsd + b.costUsd,
  };
}

function campaignBlock(
  campaign: ScreenwriterCampaignContext,
  brand?: ScreenwriterBrandContext | null
): string {
  return [
    `Campaign: ${campaign.name}`,
    campaign.objectiveCustom?.trim() || campaign.objective?.trim()
      ? `Objective: ${campaign.objectiveCustom?.trim() || campaign.objective}`
      : "",
    campaign.targetAudienceOverride?.trim()
      ? `Audience: ${campaign.targetAudienceOverride}`
      : "",
    campaign.campaignBrief?.trim() ? `Brief: ${campaign.campaignBrief}` : "",
    brand?.brandName?.trim() ? `Brand: ${brand.brandName}` : "",
    brand?.brandTone?.trim() ? `Tone: ${brand.brandTone}` : "",
    brand?.description?.trim() ? `Brand description: ${brand.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function rewriteAiStoryDraft(input: {
  draft: AiStoryStructuredDraft;
  originalIdea: string;
  rewriteBrief?: string;
  campaign: ScreenwriterCampaignContext;
  brand?: ScreenwriterBrandContext | null;
  assetLabels?: readonly string[];
}): Promise<
  | { ok: true; draft: AiStoryStructuredDraft; usage: Usage }
  | { ok: false; error: string }
> {
  const schemaHint = JSON.stringify({
    title: "string",
    summary: "string",
    objective: "string",
    targetAudience: "string",
    tone: "string",
    estimatedDuration: "string",
    story: { opening: "string", development: "string", ending: "string" },
    keyMessages: ["string"],
    cta: "string",
    assetReferences: [],
    warnings: ["string"],
  });
  try {
    const { result, usage } = await callJsonModel<Record<string, unknown>>(
      [
        "You are a screenwriter rewriting an approved Story Draft structure.",
        "Preserve campaign intent while improving clarity, drama, and CTA focus.",
        "Do not invent shot lists, provider prompts, or animation execution details.",
        "Return ONLY JSON matching the schema hint.",
      ].join(" "),
      [
        campaignBlock(input.campaign, input.brand),
        input.assetLabels?.length
          ? `Referenced assets: ${input.assetLabels.join("; ")}`
          : "",
        `Original idea:\n${input.originalIdea}`,
        input.rewriteBrief?.trim() ? `Rewrite brief:\n${input.rewriteBrief}` : "",
        "",
        `Current Story Draft JSON:\n${JSON.stringify(input.draft, null, 2)}`,
      ]
        .filter(Boolean)
        .join("\n"),
      schemaHint
    );
    const parsed = AiStoryStructuredDraftSchema.safeParse({
      ...result,
      assetReferences: Array.isArray(result.assetReferences)
        ? result.assetReferences.filter((v): v is string => typeof v === "string")
        : input.draft.assetReferences,
      warnings: Array.isArray(result.warnings)
        ? result.warnings.filter((v): v is string => typeof v === "string")
        : [],
    });
    if (!parsed.success) {
      return { ok: false, error: "AI returned malformed rewritten Story Draft" };
    }
    return { ok: true, draft: parsed.data, usage };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Story rewrite failed",
    };
  }
}

export async function generateStoryCharacters(input: {
  story: AiStoryStructuredDraft;
  creativeContext?: CreativeContext | null;
  campaign: ScreenwriterCampaignContext;
  brand?: ScreenwriterBrandContext | null;
}): Promise<{
  characters: CreativeContext["characterContext"]["characters"];
  relationships: string[];
  usage: Usage;
}> {
  const schemaHint = JSON.stringify({
    characters: [
      {
        id: "stable kebab-case id",
        name: "string",
        role: "string",
        description: "string",
        motivation: "string",
        visualNotes: "string",
      },
    ],
    relationships: ["string"],
  });
  const { result, usage } = await callJsonModel<Record<string, unknown>>(
    [
      "You are a screenwriter generating durable character context for animation planning.",
      "Create only characters required by the story. Use stable ids.",
      "Return ONLY JSON.",
    ].join(" "),
    [
      campaignBlock(input.campaign, input.brand),
      "",
      JSON.stringify(
        { story: input.story, creativeContext: input.creativeContext ?? null },
        null,
        2
      ),
    ].join("\n"),
    schemaHint
  );
  const characters = z
    .array(CreativeContextCharacterSchema)
    .min(1)
    .parse(result.characters);
  const relationships = z.array(z.string()).default([]).parse(result.relationships ?? []);
  return { characters, relationships, usage };
}

export async function generateStoryDialogue(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  campaign: ScreenwriterCampaignContext;
}): Promise<{
  dialogue: Array<{ speaker: string; line: string; beatHint: string }>;
  usage: Usage;
}> {
  const schemaHint = JSON.stringify({
    dialogue: [
      {
        speaker: "character name",
        line: "spoken line",
        beatHint: "opening | conflict | climax | ending | cta",
      },
    ],
  });
  const { result, usage } = await callJsonModel<Record<string, unknown>>(
    [
      "You are a screenwriter writing concise dialogue for an animation story.",
      "Every speaker must match a character in creativeContext when characters exist.",
      "Keep lines short and on-brand. Return ONLY JSON.",
    ].join(" "),
    [
      campaignBlock(input.campaign),
      "",
      JSON.stringify(
        { story: input.story, creativeContext: input.creativeContext },
        null,
        2
      ),
    ].join("\n"),
    schemaHint
  );
  const dialogue = z.array(DialogueLineSchema).min(1).parse(result.dialogue);
  return { dialogue, usage };
}

export async function generateStoryNarrative(input: {
  story: AiStoryStructuredDraft;
  creativeContext?: CreativeContext | null;
  campaign: ScreenwriterCampaignContext;
}): Promise<{
  narrative: CreativeContext["narrativeContext"];
  usage: Usage;
}> {
  const schemaHint = JSON.stringify({
    narrative: {
      arc: "string",
      pacing: "string",
      emotionalJourney: "string",
      themes: ["string"],
      dialogue: [],
    },
  });
  const { result, usage } = await callJsonModel<Record<string, unknown>>(
    [
      "You are a screenwriter producing narrative context for animation planning.",
      "Preserve existing dialogue when provided; otherwise leave dialogue empty.",
      "Return ONLY JSON.",
    ].join(" "),
    [
      campaignBlock(input.campaign),
      "",
      JSON.stringify(
        { story: input.story, creativeContext: input.creativeContext ?? null },
        null,
        2
      ),
    ].join("\n"),
    schemaHint
  );
  const narrative = NarrativeBlockSchema.parse(result.narrative ?? result);
  if (
    input.creativeContext?.narrativeContext.dialogue?.length &&
    (!narrative.dialogue || narrative.dialogue.length === 0)
  ) {
    return {
      narrative: {
        ...narrative,
        dialogue: input.creativeContext.narrativeContext.dialogue,
      },
      usage,
    };
  }
  return { narrative, usage };
}

export function mergeCharactersIntoCreativeContext(
  creativeContext: CreativeContext,
  characters: CreativeContext["characterContext"]["characters"],
  relationships: string[]
): CreativeContext {
  return CreativeContextSchema.parse({
    ...creativeContext,
    characterContext: {
      characters,
      relationships,
    },
  });
}

export function mergeDialogueIntoCreativeContext(
  creativeContext: CreativeContext,
  dialogue: Array<{ speaker: string; line: string; beatHint: string }>
): CreativeContext {
  return CreativeContextSchema.parse({
    ...creativeContext,
    narrativeContext: {
      ...creativeContext.narrativeContext,
      dialogue,
    },
  });
}

export function mergeNarrativeIntoCreativeContext(
  creativeContext: CreativeContext,
  narrative: CreativeContext["narrativeContext"]
): CreativeContext {
  return CreativeContextSchema.parse({
    ...creativeContext,
    narrativeContext: {
      ...narrative,
      dialogue:
        narrative.dialogue?.length > 0
          ? narrative.dialogue
          : creativeContext.narrativeContext.dialogue,
    },
  });
}

export function accumulateScreenwriterUsage(a: Usage, b: Usage): Usage {
  return addUsage(a, b);
}
