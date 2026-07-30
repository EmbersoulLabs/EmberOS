/**
 * AI Story Sprint 2 planning pipeline.
 *
 * Ends at an Animation Package that is ready for human planning review; it does
 * not dispatch to video, provider execution, render, or billing systems.
 */
import { z } from "zod";
import { callJsonModel } from "../llm";
import {
  AnimationPackagePayloadSchema,
  CharacterContinuityEntrySchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  ScenePlanItemSchema,
  ShotPlanItemSchema,
  StoryBeatSchema,
  validatePlanningConsistency,
  type AiStoryStructuredDraft,
  type AnimationPackagePayload,
  type CharacterContinuityEntry,
  type CreativeContext,
  type DirectorThinking,
  type PlanningUsage,
  type ScenePlanItem,
  type ShotPlanItem,
  type StoryBeat,
  type WorldContinuity,
  WorldContinuitySchema,
} from "@ceo-agent/shared";

type Usage = PlanningUsage;

export type AiStoryPlanningCampaignContext = {
  id?: string;
  name: string;
  objective?: string | null;
  objectiveCustom?: string | null;
  targetAudienceOverride?: string | null;
  campaignBrief?: string | null;
  goal?: string | null;
  platforms?: readonly string[];
};

export type AiStoryPlanningBrandContext = {
  brandName?: string | null;
  brandTone?: string | null;
  targetAudience?: string | null;
  industry?: string | null;
  description?: string | null;
  values?: readonly string[];
  style?: readonly string[];
};

export type StoryPlanningPipelineInput = {
  storyDraft: AiStoryStructuredDraft;
  campaign: AiStoryPlanningCampaignContext;
  brand?: AiStoryPlanningBrandContext | null;
  assetLabels?: readonly string[];
};

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    costUsd: a.costUsd + b.costUsd,
  };
}

async function callStage<T>(
  stage: string,
  system: string,
  user: string,
  schemaHint: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  pick: (result: Record<string, unknown>) => unknown
): Promise<{ value: T; usage: Usage }> {
  const { result, usage } = await callJsonModel<Record<string, unknown>>(
    system,
    user,
    schemaHint
  );
  const parsed = schema.safeParse(pick(result));
  if (!parsed.success) {
    throw new Error(`${stage} returned malformed planning JSON`);
  }
  return { value: parsed.data, usage };
}

function storySummary(storyDraft: AiStoryStructuredDraft): string {
  return [
    `Title: ${storyDraft.title}`,
    `Summary: ${storyDraft.summary}`,
    `Objective: ${storyDraft.objective}`,
    `Audience: ${storyDraft.targetAudience}`,
    `Tone: ${storyDraft.tone}`,
    `Duration: ${storyDraft.estimatedDuration}`,
    `Opening: ${storyDraft.story.opening}`,
    `Development: ${storyDraft.story.development}`,
    `Ending: ${storyDraft.story.ending}`,
    `Key messages: ${storyDraft.keyMessages.join("; ")}`,
    `CTA: ${storyDraft.cta}`,
  ].join("\n");
}

function campaignSummary(
  campaign: AiStoryPlanningCampaignContext,
  brand?: AiStoryPlanningBrandContext | null,
  assetLabels: readonly string[] = []
): string {
  return [
    `Campaign: ${campaign.name}`,
    campaign.objectiveCustom?.trim()
      ? `Objective: ${campaign.objectiveCustom}`
      : campaign.objective?.trim()
        ? `Objective: ${campaign.objective}`
        : campaign.goal?.trim()
          ? `Goal: ${campaign.goal}`
          : "",
    campaign.targetAudienceOverride?.trim()
      ? `Campaign audience: ${campaign.targetAudienceOverride}`
      : "",
    campaign.campaignBrief?.trim() ? `Campaign brief: ${campaign.campaignBrief}` : "",
    campaign.platforms?.length ? `Platforms: ${campaign.platforms.join(", ")}` : "",
    brand?.brandName?.trim() ? `Brand: ${brand.brandName}` : "",
    brand?.brandTone?.trim() ? `Brand tone: ${brand.brandTone}` : "",
    brand?.targetAudience?.trim() ? `Brand audience: ${brand.targetAudience}` : "",
    brand?.industry?.trim() ? `Industry: ${brand.industry}` : "",
    brand?.description?.trim() ? `Brand description: ${brand.description}` : "",
    brand?.values?.length ? `Brand values: ${brand.values.join(", ")}` : "",
    brand?.style?.length ? `Brand style: ${brand.style.join(", ")}` : "",
    assetLabels.length ? `Referenced assets: ${assetLabels.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateCreativeContext(
  storyDraft: AiStoryStructuredDraft,
  campaign: AiStoryPlanningCampaignContext,
  brand?: AiStoryPlanningBrandContext | null,
  assetLabels: readonly string[] = []
): Promise<{ creativeContext: CreativeContext; usage: Usage }> {
  const schemaHint = JSON.stringify({
    creativeContext: {
      storyContext: {
        title: "string",
        summary: "string",
        objective: "string",
        targetAudience: "string",
        tone: "string",
        estimatedDuration: "string",
        keyMessages: ["string"],
        cta: "string",
      },
      characterContext: {
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
      },
      worldContext: {
        locations: ["string"],
        visualStyle: "string",
        lighting: "string",
        environment: "string",
        objects: ["string"],
        timeline: "string",
        worldRules: ["string"],
      },
      narrativeContext: {
        arc: "string",
        pacing: "string",
        emotionalJourney: "string",
        themes: ["string"],
      },
      directorContext: {},
    },
  });
  const { value, usage } = await callStage<CreativeContext>(
    "Creative context",
    [
      "You are a screenwriter preparing an AI Story for animation planning.",
      "Extract only durable creative context from the Story Draft, campaign, brand, and assets.",
      "Keep directorContext as an empty object; the director stage fills Director Thinking later.",
      "Return ONLY JSON.",
    ].join(" "),
    [campaignSummary(campaign, brand, assetLabels), "", storySummary(storyDraft)].join("\n"),
    schemaHint,
    CreativeContextSchema,
    (result) => ({
      ...(result.creativeContext as Record<string, unknown> | undefined),
      directorContext: {},
    })
  );
  return { creativeContext: value, usage };
}

export async function generateDirectorThinking(
  story: AiStoryStructuredDraft,
  creativeContext: CreativeContext
): Promise<{ directorThinking: DirectorThinking; usage: Usage }> {
  const schemaHint = JSON.stringify({
    directorThinking: {
      coreMessage: "string",
      hero: "string",
      conflict: "string",
      turningPoint: "string",
      climax: "string",
      takeaway: "string",
    },
  });
  const { value, usage } = await callStage<DirectorThinking>(
    "Director thinking",
    [
      "You are an animation director translating story context into clear dramatic intent.",
      "Do not write provider prompts, video render settings, or final execution details.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify({ story, creativeContext }, null, 2),
    schemaHint,
    DirectorThinkingSchema,
    (result) => result.directorThinking ?? result
  );
  return { directorThinking: value, usage };
}

export async function generateStoryBeats(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
}): Promise<{ storyBeats: StoryBeat[]; usage: Usage }> {
  const schemaHint = JSON.stringify({
    storyBeats: [
      {
        id: "beat-001",
        name: "Opening | Setup | Conflict | Development | Climax | Ending | CTA or custom",
        purpose: "string",
        order: 0,
        summary: "string",
      },
    ],
  });
  const { value, usage } = await callStage<StoryBeat[]>(
    "Story beats",
    [
      "You are structuring an animation-ready narrative beat sheet.",
      "Use sequential order values starting at 0 and stable beat ids.",
      "Every important story turn must have a beat.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    z.array(StoryBeatSchema).min(1),
    (result) => result.storyBeats
  );
  return { storyBeats: value, usage };
}

export async function generateScenePlan(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
}): Promise<{ scenePlan: ScenePlanItem[]; usage: Usage }> {
  const schemaHint = JSON.stringify({
    scenePlan: [
      {
        id: "scene-001",
        beatIds: ["beat-001"],
        purpose: "string",
        durationSec: 4,
        transition: "string",
        continuityNotes: "string",
        order: 0,
      },
    ],
  });
  const { value, usage } = await callStage<ScenePlanItem[]>(
    "Scene plan",
    [
      "You are an animation scene planner.",
      "Create scenes that cover every story beat, merging beats only when continuityNotes explicitly say which beat was merged.",
      "Use sequential order values starting at 0 and stable scene ids.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    z.array(ScenePlanItemSchema).min(1),
    (result) => result.scenePlan
  );
  return { scenePlan: value, usage };
}

export async function generateShotPlan(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
}): Promise<{ shotPlan: ShotPlanItem[]; usage: Usage }> {
  const schemaHint = JSON.stringify({
    shotPlan: [
      {
        id: "shot-001",
        sceneId: "scene-001",
        cameraType: "string",
        cameraMovement: "string",
        composition: "string",
        framing: "string",
        lensSuggestion: "string",
        durationSec: 2,
        focus: "string",
        emotion: "string",
        information: "string",
        order: 0,
      },
    ],
  });
  const { value, usage } = await callStage<ShotPlanItem[]>(
    "Shot plan",
    [
      "You are an animation shot planner.",
      "Every scene must receive at least one shot.",
      "Use sequential order values starting at 0 and stable shot ids.",
      "Return planning-only camera language; no provider execution fields.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    z.array(ShotPlanItemSchema).min(1),
    (result) => result.shotPlan
  );
  return { shotPlan: value, usage };
}

export async function generateCharacterContinuity(input: {
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  shotPlan: ShotPlanItem[];
}): Promise<{ characterContinuity: CharacterContinuityEntry[]; usage: Usage }> {
  const schemaHint = JSON.stringify({
    characterContinuity: [
      {
        characterId: "same id from creativeContext when available",
        name: "same character name from creativeContext",
        appearance: "string",
        emotion: "string",
        costume: "string",
        accessories: "string",
        age: "string",
        pose: "string",
        identity: "string",
      },
    ],
  });
  const { value, usage } = await callStage<CharacterContinuityEntry[]>(
    "Character continuity",
    [
      "You are a character continuity supervisor.",
      "Only create entries for characters present in creativeContext.characterContext.characters.",
      "Return stable identity, appearance, emotion, costume, accessories, age, and pose guidance.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    z.array(CharacterContinuityEntrySchema),
    (result) => result.characterContinuity
  );
  return { characterContinuity: value, usage };
}

export async function generateWorldContinuity(input: {
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  shotPlan: ShotPlanItem[];
}): Promise<{ worldContinuity: WorldContinuity; usage: Usage }> {
  const schemaHint = JSON.stringify({
    worldContinuity: {
      location: "string",
      lighting: "string",
      environment: "string",
      objects: ["string"],
      timeline: "string",
      worldRules: ["string"],
    },
  });
  const { value, usage } = await callStage<WorldContinuity>(
    "World continuity",
    [
      "You are a world continuity supervisor.",
      "Produce non-empty location, lighting, environment, objects, timeline, and world rules.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    WorldContinuitySchema,
    (result) => result.worldContinuity ?? result
  );
  return { worldContinuity: value, usage };
}

export function buildAnimationPackage(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  shotPlan: ShotPlanItem[];
  characterContinuity: CharacterContinuityEntry[];
  worldContinuity: WorldContinuity;
  usage?: Usage;
}): AnimationPackagePayload {
  const creativeContext: CreativeContext = {
    ...input.creativeContext,
    directorContext: input.directorThinking,
  };
  const draftPackage = AnimationPackagePayloadSchema.parse({
    story: input.story,
    characters: creativeContext.characterContext.characters,
    creativeContext,
    directorThinking: input.directorThinking,
    storyBeats: input.storyBeats,
    scenePlan: input.scenePlan,
    shotPlan: input.shotPlan,
    characterContinuity: input.characterContinuity,
    worldContinuity: input.worldContinuity,
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: false, issues: [], links: [] },
    status: "review",
    usage: input.usage,
  });
  const narrativeIntegration = validatePlanningConsistency(draftPackage);
  return AnimationPackagePayloadSchema.parse({
    ...draftPackage,
    narrativeIntegration,
  });
}

export async function runFullStoryPlanningPipeline(
  input: StoryPlanningPipelineInput
): Promise<AnimationPackagePayload> {
  let usage: Usage = { input: 0, output: 0, costUsd: 0 };

  const creative = await generateCreativeContext(
    input.storyDraft,
    input.campaign,
    input.brand,
    input.assetLabels ?? []
  );
  usage = addUsage(usage, creative.usage);

  const director = await generateDirectorThinking(input.storyDraft, creative.creativeContext);
  usage = addUsage(usage, director.usage);

  const beats = await generateStoryBeats({
    story: input.storyDraft,
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
  });
  usage = addUsage(usage, beats.usage);

  const scenes = await generateScenePlan({
    story: input.storyDraft,
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
  });
  usage = addUsage(usage, scenes.usage);

  const shots = await generateShotPlan({
    story: input.storyDraft,
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
  });
  usage = addUsage(usage, shots.usage);

  const characterContinuity = await generateCharacterContinuity({
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
    shotPlan: shots.shotPlan,
  });
  usage = addUsage(usage, characterContinuity.usage);

  const worldContinuity = await generateWorldContinuity({
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
    shotPlan: shots.shotPlan,
  });
  usage = addUsage(usage, worldContinuity.usage);

  return buildAnimationPackage({
    story: input.storyDraft,
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
    shotPlan: shots.shotPlan,
    characterContinuity: characterContinuity.characterContinuity,
    worldContinuity: worldContinuity.worldContinuity,
    usage,
  });
}
