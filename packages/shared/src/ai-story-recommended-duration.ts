/**
 * Provider-neutral Recommended Duration Authority.
 *
 * One canonical timing decision sits between planner proposals and Scene
 * execution. Story estimatedDuration stays a human/planner hint and is not an
 * input. Product, character, brand, visual style, cover, and continuity
 * authorities do not carry duration.
 *
 * Source-locked mode preserves OUTPUT_DURATION_FOLLOWS_SOURCE: the
 * authoritative source interval wins, and the local package may represent
 * that interval as plannedDurationMs / 1000 when the source seconds and
 * milliseconds already agree within half a millisecond.
 */
import { z } from "zod";
import { AI_STORY_SCENE_GENERATION_STRATEGIES } from "./ai-story-generation-authority";

export const AI_STORY_RECOMMENDED_DURATION_AUTHORITY_VERSION =
  "ai-story-recommended-duration-authority.v1" as const;

export const AI_STORY_RECOMMENDED_DURATION_RESOLUTIONS = [
  "SOURCE_LOCKED",
  "SHOT_TIMING",
  "SCENE_PLAN_FALLBACK",
] as const;

export const AI_STORY_RECOMMENDED_DURATION_GENERATION_STRATEGIES = [
  ...AI_STORY_SCENE_GENERATION_STRATEGIES,
  "VIDEO_TO_VIDEO",
] as const;

export const AI_STORY_RECOMMENDED_DURATION_REASON_CODES = [
  "OUTPUT_DURATION_FOLLOWS_SOURCE",
  "SHOT_DURATION_TOTAL",
  "SCENE_PLAN_DURATION",
] as const;

const DurationSecSchema = z.number().finite().positive();

export class AiStoryRecommendedDurationError extends Error {
  readonly code:
    | "INVALID_DURATION"
    | "SOURCE_DURATION_REQUIRED"
    | "SCENE_SHOT_IDENTITY_MISMATCH";

  constructor(code: AiStoryRecommendedDurationError["code"], message: string) {
    super(message);
    this.name = "AiStoryRecommendedDurationError";
    this.code = code;
  }
}

export const AiStoryRecommendedDurationShotEvidenceSchema = z.object({
  shotId: z.string().trim().min(1),
  planningSceneId: z.string().trim().min(1),
  durationSec: DurationSecSchema,
  storyVersionId: z.string().uuid().optional(),
  animationPackageId: z.string().uuid().optional(),
}).strict();

export const AiStoryRecommendedDurationInputsSchema = z.object({
  sceneProposedDurationSec: DurationSecSchema,
  shotDurationsSec: z.array(DurationSecSchema),
  shots: z.array(AiStoryRecommendedDurationShotEvidenceSchema),
  sourceDurationSec: DurationSecSchema.optional(),
}).strict();

export const AiStoryRecommendedDurationDecisionSchema = z.object({
  recommendedDurationSec: DurationSecSchema,
  plannedDurationMs: z.number().int().positive(),
  resolution: z.enum(AI_STORY_RECOMMENDED_DURATION_RESOLUTIONS),
  reasonCodes: z.array(z.enum(AI_STORY_RECOMMENDED_DURATION_REASON_CODES)).min(1),
}).strict();

export const AiStoryRecommendedDurationAuthoritySchema = z.object({
  contractVersion: z.literal(AI_STORY_RECOMMENDED_DURATION_AUTHORITY_VERSION),
  authorityId: z.string().uuid(),
  organizationId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid(),
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  sceneId: z.string().uuid(),
  planningSceneId: z.string().trim().min(1),
  sceneOrder: z.number().int().nonnegative(),
  generationStrategy: z.enum(AI_STORY_RECOMMENDED_DURATION_GENERATION_STRATEGIES),
  inputs: AiStoryRecommendedDurationInputsSchema,
  decision: AiStoryRecommendedDurationDecisionSchema,
  semanticFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
}).strict();

export type AiStoryRecommendedDurationAuthority = z.infer<
  typeof AiStoryRecommendedDurationAuthoritySchema
>;
export type AiStoryRecommendedDurationDecision = z.infer<
  typeof AiStoryRecommendedDurationDecisionSchema
>;

export type RecommendedDurationShotEvidence = {
  shotId: string;
  planningSceneId: string;
  durationSec: number;
  storyVersionId?: string;
  animationPackageId?: string;
};

export type RecommendedDurationResolveInput = {
  organizationId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  animationPackageId: string;
  sceneId: string;
  planningSceneId: string;
  sceneOrder: number;
  generationStrategy: (typeof AI_STORY_RECOMMENDED_DURATION_GENERATION_STRATEGIES)[number];
  sceneProposedDurationSec: number;
  shots: readonly RecommendedDurationShotEvidence[];
  sourceDurationLocked?: boolean;
  sourceDurationSec?: number | null;
  sourceDurationMs?: number | null;
};

export type RecommendedDurationSemanticBody = {
  contractVersion: typeof AI_STORY_RECOMMENDED_DURATION_AUTHORITY_VERSION;
  organizationId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  animationPackageId: string;
  sceneId: string;
  planningSceneId: string;
  sceneOrder: number;
  generationStrategy: RecommendedDurationResolveInput["generationStrategy"];
  inputs: z.infer<typeof AiStoryRecommendedDurationInputsSchema>;
  decision: AiStoryRecommendedDurationDecision;
};

export function positiveDurationSecToMs(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new AiStoryRecommendedDurationError(
      "INVALID_DURATION",
      "Duration must be a finite number greater than zero."
    );
  }
  const ms = Math.round(durationSec * 1000);
  if (!Number.isInteger(ms) || ms <= 0) {
    throw new AiStoryRecommendedDurationError(
      "INVALID_DURATION",
      "Duration does not project to a positive millisecond value."
    );
  }
  return ms;
}

export function localGenerationDurationSecFromPlannedDurationMs(
  plannedDurationMs: number
): number {
  if (!Number.isInteger(plannedDurationMs) || plannedDurationMs <= 0) {
    throw new AiStoryRecommendedDurationError(
      "INVALID_DURATION",
      "Planned duration must be a positive integer millisecond value."
    );
  }
  return plannedDurationMs / 1000;
}

export function projectRecommendedStoryRuntimeSec(
  sceneRecommendedDurationSec: readonly number[]
): number {
  const totalMs = sceneRecommendedDurationSec.reduce(
    (sum, durationSec) => sum + positiveDurationSecToMs(durationSec),
    0
  );
  return totalMs / 1000;
}

export function plannedDurationMatchesRecommendedDuration(
  authority: Pick<AiStoryRecommendedDurationAuthority, "decision">,
  plannedDurationMs: number
): boolean {
  if (plannedDurationMs !== authority.decision.plannedDurationMs) return false;
  const projectedMs = authority.decision.recommendedDurationSec * 1000;
  if (authority.decision.resolution === "SOURCE_LOCKED") {
    return Math.abs(projectedMs - plannedDurationMs) <= 0.5;
  }
  return Math.round(projectedMs) === plannedDurationMs;
}

function assertFinitePositive(durationSec: number, label: string): void {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new AiStoryRecommendedDurationError(
      "INVALID_DURATION",
      `${label} must be a finite number greater than zero.`
    );
  }
}

function assertShotIdentity(
  input: RecommendedDurationResolveInput,
  shot: RecommendedDurationShotEvidence
): void {
  if (shot.planningSceneId !== input.planningSceneId) {
    throw new AiStoryRecommendedDurationError(
      "SCENE_SHOT_IDENTITY_MISMATCH",
      "Shot timing does not belong to the Scene."
    );
  }
  if (shot.storyVersionId && shot.storyVersionId !== input.storyVersionId) {
    throw new AiStoryRecommendedDurationError(
      "SCENE_SHOT_IDENTITY_MISMATCH",
      "Shot timing does not belong to the Story Version."
    );
  }
  if (
    shot.animationPackageId &&
    shot.animationPackageId !== input.animationPackageId
  ) {
    throw new AiStoryRecommendedDurationError(
      "SCENE_SHOT_IDENTITY_MISMATCH",
      "Shot timing does not belong to the Animation Package."
    );
  }
}

function sourceLocked(input: RecommendedDurationResolveInput): boolean {
  return input.sourceDurationLocked === true || input.generationStrategy === "VIDEO_TO_VIDEO";
}

function resolveSourceDurationMs(input: RecommendedDurationResolveInput): number {
  const sourceDurationSec = input.sourceDurationSec;
  if (sourceDurationSec == null) {
    throw new AiStoryRecommendedDurationError(
      "SOURCE_DURATION_REQUIRED",
      "Source-locked execution requires an authoritative source duration."
    );
  }
  assertFinitePositive(sourceDurationSec, "Source duration");
  if (input.sourceDurationMs == null) {
    return positiveDurationSecToMs(sourceDurationSec);
  }
  if (!Number.isInteger(input.sourceDurationMs) || input.sourceDurationMs <= 0) {
    throw new AiStoryRecommendedDurationError(
      "INVALID_DURATION",
      "Source duration milliseconds must be a positive integer."
    );
  }
  if (Math.abs(sourceDurationSec * 1000 - input.sourceDurationMs) > 0.5) {
    throw new AiStoryRecommendedDurationError(
      "INVALID_DURATION",
      "Source duration seconds and milliseconds do not describe the same interval."
    );
  }
  return input.sourceDurationMs;
}

/**
 * Deterministic duration decision. Same planning evidence always returns the
 * same decision. No model or provider is consulted.
 */
export function resolveRecommendedDuration(
  input: RecommendedDurationResolveInput
): RecommendedDurationSemanticBody {
  assertFinitePositive(input.sceneProposedDurationSec, "Scene duration");
  const shots = input.shots.map((shot) => {
    assertFinitePositive(shot.durationSec, "Shot duration");
    assertShotIdentity(input, shot);
    return {
      shotId: shot.shotId,
      planningSceneId: shot.planningSceneId,
      durationSec: shot.durationSec,
      ...(shot.storyVersionId ? { storyVersionId: shot.storyVersionId } : {}),
      ...(shot.animationPackageId
        ? { animationPackageId: shot.animationPackageId }
        : {}),
    };
  });

  const locked = sourceLocked(input);
  let decision: AiStoryRecommendedDurationDecision;
  if (locked) {
    const plannedDurationMs = resolveSourceDurationMs(input);
    decision = {
      recommendedDurationSec: input.sourceDurationSec!,
      plannedDurationMs,
      resolution: "SOURCE_LOCKED",
      reasonCodes: ["OUTPUT_DURATION_FOLLOWS_SOURCE"],
    };
  } else if (shots.length > 0) {
    const plannedDurationMs = shots.reduce(
      (sum, shot) => sum + positiveDurationSecToMs(shot.durationSec),
      0
    );
    decision = {
      recommendedDurationSec: plannedDurationMs / 1000,
      plannedDurationMs,
      resolution: "SHOT_TIMING",
      reasonCodes: ["SHOT_DURATION_TOTAL"],
    };
  } else {
    const plannedDurationMs = positiveDurationSecToMs(input.sceneProposedDurationSec);
    decision = {
      recommendedDurationSec: plannedDurationMs / 1000,
      plannedDurationMs,
      resolution: "SCENE_PLAN_FALLBACK",
      reasonCodes: ["SCENE_PLAN_DURATION"],
    };
  }

  return {
    contractVersion: AI_STORY_RECOMMENDED_DURATION_AUTHORITY_VERSION,
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    animationPackageId: input.animationPackageId,
    sceneId: input.sceneId,
    planningSceneId: input.planningSceneId,
    sceneOrder: input.sceneOrder,
    generationStrategy: input.generationStrategy,
    inputs: {
      sceneProposedDurationSec: input.sceneProposedDurationSec,
      shotDurationsSec: shots.map((shot) => shot.durationSec),
      shots,
      ...(locked ? { sourceDurationSec: input.sourceDurationSec! } : {}),
    },
    decision,
  };
}
