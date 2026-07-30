import { z } from "zod";

/** Campaign-owned AI Story (V1) — distinct from workspace Asset Story (`stories`). */
export const AI_STORY_STATUSES = [
  "draft",
  "generating",
  "review",
  "approved",
  "ready_for_animation",
  "planning",
  "planning_review",
  "ready_for_execution",
  "failed",
  "archived",
] as const;

export type AiStoryStatus = (typeof AI_STORY_STATUSES)[number];

export const AiStoryStructuredDraftSchema = z.object({
  title: z.string().max(500),
  summary: z.string().max(4000),
  objective: z.string().max(2000),
  targetAudience: z.string().max(2000),
  tone: z.string().max(500),
  estimatedDuration: z.string().max(200),
  story: z.object({
    opening: z.string().max(8000),
    development: z.string().max(8000),
    ending: z.string().max(8000),
  }),
  keyMessages: z.array(z.string().max(500)).max(20),
  cta: z.string().max(1000),
  assetReferences: z.array(z.string().uuid()).max(32),
  warnings: z.array(z.string().max(500)).max(20),
});

export type AiStoryStructuredDraft = z.infer<typeof AiStoryStructuredDraftSchema>;

export const AiStoryCreateBodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  originalIdea: z.string().trim().min(1).max(8000),
  assetIds: z.array(z.string().uuid()).max(32).optional(),
});

export const AiStoryUpdateDraftBodySchema = z.object({
  structuredContent: AiStoryStructuredDraftSchema,
});

export const AI_STORY_ALLOWED_TRANSITIONS: Record<
  AiStoryStatus,
  readonly AiStoryStatus[]
> = {
  draft: ["generating", "archived"],
  generating: ["review", "failed"],
  review: ["generating", "approved", "draft", "archived"],
  approved: ["ready_for_animation", "review"],
  ready_for_animation: ["planning", "archived"],
  planning: ["planning_review", "failed"],
  planning_review: ["planning", "ready_for_execution", "archived"],
  ready_for_execution: ["archived"],
  failed: ["draft", "generating", "planning", "archived"],
  archived: [],
};

export function assertAiStoryTransition(from: AiStoryStatus, to: AiStoryStatus): void {
  if (from === to) return;
  const allowed = AI_STORY_ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid AI Story transition: ${from} → ${to}`);
  }
}

export function nextAiStoryVersionNumber(existing: readonly { versionNumber: number }[]): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((v) => v.versionNumber)) + 1;
}

export type AiStoryContextWarning = {
  code: string;
  message: string;
};

export function buildAiStoryContextWarnings(input: {
  businessProfileComplete?: boolean;
  campaignObjective?: string | null;
  targetAudience?: string | null;
  brandTone?: string | null;
  assetCount: number;
}): AiStoryContextWarning[] {
  const warnings: AiStoryContextWarning[] = [];
  if (!input.businessProfileComplete) {
    warnings.push({
      code: "business_profile_incomplete",
      message: "Business Profile is incomplete — story polish may be less on-brand.",
    });
  }
  if (!input.campaignObjective?.trim()) {
    warnings.push({
      code: "missing_objective",
      message: "Campaign objective is missing — objective field may be generic.",
    });
  }
  if (!input.targetAudience?.trim()) {
    warnings.push({
      code: "missing_audience",
      message: "Target audience is missing — audience targeting may be broad.",
    });
  }
  if (!input.brandTone?.trim()) {
    warnings.push({
      code: "missing_brand_tone",
      message: "Brand tone is not set — tone may default to neutral marketing voice.",
    });
  }
  if (input.assetCount === 0) {
    warnings.push({
      code: "no_assets",
      message: "No Campaign assets selected — visual references will be omitted.",
    });
  }
  return warnings;
}

export const ANIMATION_PACKAGE_STATUSES = [
  "generating",
  "review",
  "ready_for_execution",
  "failed",
] as const;

export type AnimationPackageStatus = (typeof ANIMATION_PACKAGE_STATUSES)[number];

export const STORY_BEAT_NAMES = [
  "Opening",
  "Setup",
  "Conflict",
  "Development",
  "Climax",
  "Ending",
  "CTA",
] as const;

export const STORY_PLANNING_STAGE_ORDER = [
  "creative_context",
  "director_thinking",
  "story_beats",
  "scene_plan",
  "shot_plan",
  "character_continuity",
  "world_continuity",
  "animation_package",
] as const;

const NonEmptyTextSchema = z.string().trim().min(1);

export const CreativeContextCharacterSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: NonEmptyTextSchema,
  role: z.string().default(""),
  description: z.string().default(""),
  motivation: z.string().default(""),
  visualNotes: z.string().default(""),
});

export const CreativeContextSchema = z.object({
  storyContext: z.object({
    title: z.string().default(""),
    summary: z.string().default(""),
    objective: z.string().default(""),
    targetAudience: z.string().default(""),
    tone: z.string().default(""),
    estimatedDuration: z.string().default(""),
    keyMessages: z.array(z.string()).default([]),
    cta: z.string().default(""),
  }),
  characterContext: z.object({
    characters: z.array(CreativeContextCharacterSchema).default([]),
    relationships: z.array(z.string()).default([]),
  }),
  worldContext: z.object({
    locations: z.array(z.string()).default([]),
    visualStyle: z.string().default(""),
    lighting: z.string().default(""),
    environment: z.string().default(""),
    objects: z.array(z.string()).default([]),
    timeline: z.string().default(""),
    worldRules: z.array(z.string()).default([]),
  }),
  narrativeContext: z.object({
    arc: z.string().default(""),
    pacing: z.string().default(""),
    emotionalJourney: z.string().default(""),
    themes: z.array(z.string()).default([]),
    dialogue: z
      .array(
        z.object({
          speaker: NonEmptyTextSchema,
          line: NonEmptyTextSchema,
          beatHint: z.string().default(""),
        })
      )
      .default([]),
  }),
  directorContext: z.record(z.unknown()).default({}),
});

export type CreativeContext = z.infer<typeof CreativeContextSchema>;

export const DirectorThinkingSchema = z.object({
  coreMessage: NonEmptyTextSchema,
  hero: NonEmptyTextSchema,
  conflict: NonEmptyTextSchema,
  turningPoint: NonEmptyTextSchema,
  climax: NonEmptyTextSchema,
  takeaway: NonEmptyTextSchema,
});

export type DirectorThinking = z.infer<typeof DirectorThinkingSchema>;

export const StoryBeatSchema = z.object({
  id: NonEmptyTextSchema,
  name: NonEmptyTextSchema,
  purpose: NonEmptyTextSchema,
  order: z.number().int().nonnegative(),
  summary: NonEmptyTextSchema,
});

export type StoryBeat = z.infer<typeof StoryBeatSchema>;

export const ScenePlanItemSchema = z.object({
  id: NonEmptyTextSchema,
  beatIds: z.array(NonEmptyTextSchema).min(1),
  purpose: NonEmptyTextSchema,
  durationSec: z.number().positive(),
  transition: z.string().default(""),
  continuityNotes: z.string().default(""),
  order: z.number().int().nonnegative(),
});

export type ScenePlanItem = z.infer<typeof ScenePlanItemSchema>;

export const ShotPlanItemSchema = z.object({
  id: NonEmptyTextSchema,
  sceneId: NonEmptyTextSchema,
  cameraType: NonEmptyTextSchema,
  cameraMovement: NonEmptyTextSchema,
  composition: NonEmptyTextSchema,
  framing: NonEmptyTextSchema,
  lensSuggestion: z.string().default(""),
  durationSec: z.number().positive(),
  focus: NonEmptyTextSchema,
  emotion: NonEmptyTextSchema,
  information: NonEmptyTextSchema,
  order: z.number().int().nonnegative(),
});

export type ShotPlanItem = z.infer<typeof ShotPlanItemSchema>;

export const CharacterContinuityEntrySchema = z.object({
  characterId: z.string().trim().min(1).optional(),
  name: NonEmptyTextSchema,
  appearance: NonEmptyTextSchema,
  emotion: NonEmptyTextSchema,
  costume: z.string().default(""),
  accessories: z.string().default(""),
  age: z.string().default(""),
  pose: z.string().default(""),
  identity: NonEmptyTextSchema,
});

export type CharacterContinuityEntry = z.infer<typeof CharacterContinuityEntrySchema>;

export const WorldContinuitySchema = z.object({
  location: NonEmptyTextSchema,
  lighting: NonEmptyTextSchema,
  environment: NonEmptyTextSchema,
  objects: z.array(NonEmptyTextSchema).min(1),
  timeline: NonEmptyTextSchema,
  worldRules: z.array(NonEmptyTextSchema).min(1),
});

export type WorldContinuity = z.infer<typeof WorldContinuitySchema>;

export const NarrativeIntegrationReportSchema = z.object({
  consistent: z.boolean(),
  issues: z.array(z.string()),
  links: z.array(
    z.object({
      beatId: NonEmptyTextSchema,
      sceneIds: z.array(NonEmptyTextSchema),
      shotIds: z.array(NonEmptyTextSchema),
    })
  ),
});

export type NarrativeIntegrationReport = z.infer<
  typeof NarrativeIntegrationReportSchema
>;

export const PlanningUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});

export type PlanningUsage = z.infer<typeof PlanningUsageSchema>;

export type StoryPlanningStage = (typeof STORY_PLANNING_STAGE_ORDER)[number];

/** In-progress Animation Package built stage-by-stage (status generating). */
export const StoryPlanningDraftSchema = z.object({
  kind: z.literal("planning_draft"),
  completedStages: z.array(z.enum(STORY_PLANNING_STAGE_ORDER)).default([]),
  story: AiStoryStructuredDraftSchema,
  creativeContext: CreativeContextSchema.optional(),
  directorThinking: DirectorThinkingSchema.optional(),
  storyBeats: z.array(StoryBeatSchema).optional(),
  scenePlan: z.array(ScenePlanItemSchema).optional(),
  shotPlan: z.array(ShotPlanItemSchema).optional(),
  characterContinuity: z.array(CharacterContinuityEntrySchema).optional(),
  worldContinuity: WorldContinuitySchema.optional(),
  usage: PlanningUsageSchema.optional(),
});

export type StoryPlanningDraft = z.infer<typeof StoryPlanningDraftSchema>;

export function isStoryPlanningDraft(value: unknown): value is StoryPlanningDraft {
  return StoryPlanningDraftSchema.safeParse(value).success;
}

export function nextRequiredPlanningStage(
  completed: readonly StoryPlanningStage[]
): StoryPlanningStage | null {
  for (const stage of STORY_PLANNING_STAGE_ORDER) {
    if (!completed.includes(stage)) return stage;
  }
  return null;
}

export function prunePlanningDraftAfterStage(
  draft: StoryPlanningDraft,
  stage: StoryPlanningStage
): StoryPlanningDraft {
  const stageIndex = STORY_PLANNING_STAGE_ORDER.indexOf(stage);
  const keep = new Set(STORY_PLANNING_STAGE_ORDER.slice(0, stageIndex));
  return {
    ...draft,
    completedStages: draft.completedStages.filter((s) => keep.has(s)),
    creativeContext: keep.has("creative_context") ? draft.creativeContext : undefined,
    directorThinking: keep.has("director_thinking") ? draft.directorThinking : undefined,
    storyBeats: keep.has("story_beats") ? draft.storyBeats : undefined,
    scenePlan: keep.has("scene_plan") ? draft.scenePlan : undefined,
    shotPlan: keep.has("shot_plan") ? draft.shotPlan : undefined,
    characterContinuity: keep.has("character_continuity")
      ? draft.characterContinuity
      : undefined,
    worldContinuity: keep.has("world_continuity") ? draft.worldContinuity : undefined,
  };
}

export const AnimationPackagePayloadSchema = z.object({
  story: AiStoryStructuredDraftSchema,
  characters: z.array(CreativeContextCharacterSchema),
  creativeContext: CreativeContextSchema,
  directorThinking: DirectorThinkingSchema,
  storyBeats: z.array(StoryBeatSchema).min(1),
  scenePlan: z.array(ScenePlanItemSchema).min(1),
  shotPlan: z.array(ShotPlanItemSchema).min(1),
  characterContinuity: z.array(CharacterContinuityEntrySchema),
  worldContinuity: WorldContinuitySchema,
  narrative: CreativeContextSchema.shape.narrativeContext,
  narrativeIntegration: NarrativeIntegrationReportSchema,
  status: z.enum(ANIMATION_PACKAGE_STATUSES),
  usage: PlanningUsageSchema.optional(),
});

export type AnimationPackagePayload = z.infer<typeof AnimationPackagePayloadSchema>;

function includesMergeNote(scene: ScenePlanItem, beat: StoryBeat): boolean {
  const note = `${scene.purpose} ${scene.continuityNotes}`.toLowerCase();
  return (
    note.includes("merge") &&
    (note.includes(beat.id.toLowerCase()) || note.includes(beat.name.toLowerCase()))
  );
}

export function validatePlanningConsistency(
  animationPackage: AnimationPackagePayload
): NarrativeIntegrationReport {
  const issues: string[] = [];
  const links = animationPackage.storyBeats.map((beat) => {
    const scenes = animationPackage.scenePlan.filter((scene) =>
      scene.beatIds.includes(beat.id)
    );
    const merged = animationPackage.scenePlan.some((scene) => includesMergeNote(scene, beat));
    if (scenes.length === 0 && !merged) {
      issues.push(`Story beat ${beat.id} is not referenced by any scene`);
    }
    const sceneIds = scenes.map((scene) => scene.id);
    const shotIds = animationPackage.shotPlan
      .filter((shot) => sceneIds.includes(shot.sceneId))
      .map((shot) => shot.id);
    return { beatId: beat.id, sceneIds, shotIds };
  });

  for (const scene of animationPackage.scenePlan) {
    const shots = animationPackage.shotPlan.filter((shot) => shot.sceneId === scene.id);
    if (shots.length === 0) {
      issues.push(`Scene ${scene.id} has no shots`);
    }
  }

  const characterIds = new Set(
    animationPackage.creativeContext.characterContext.characters
      .map((character) => character.id?.trim().toLowerCase())
      .filter((id): id is string => Boolean(id))
  );
  const characterNames = new Set(
    animationPackage.creativeContext.characterContext.characters.map((character) =>
      character.name.trim().toLowerCase()
    )
  );
  for (const entry of animationPackage.characterContinuity) {
    const idMatches = entry.characterId
      ? characterIds.has(entry.characterId.trim().toLowerCase())
      : false;
    const nameMatches = characterNames.has(entry.name.trim().toLowerCase());
    if (!idMatches && !nameMatches) {
      issues.push(`Character continuity entry ${entry.name} is not in character context`);
    }
  }

  const world = animationPackage.worldContinuity;
  if (
    !world.location.trim() ||
    !world.lighting.trim() ||
    !world.environment.trim() ||
    world.objects.length === 0 ||
    !world.timeline.trim() ||
    world.worldRules.length === 0
  ) {
    issues.push("World continuity fields must be non-empty");
  }

  return {
    consistent: issues.length === 0,
    issues,
    links,
  };
}
