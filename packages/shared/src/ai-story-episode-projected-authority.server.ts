import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_DIRECTOR_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION,
  AI_STORY_MOTION_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION,
  AiStoryEpisodeProjectedDirectorPlanSchema,
  AiStoryEpisodeProjectedMotionPlanSchema,
  EpisodeProjectedAuthorityError,
  projectEpisodeDirectorScenes,
  projectEpisodeMotionScenes,
  type AiStoryEpisodeProjectedDirectorPlan,
  type AiStoryEpisodeProjectedMotionPlan,
  type EpisodeProjectedAuthoritySource,
} from "./ai-story-episode-projected-authority";

type Lineage = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  outlineVersionId: string;
  scriptVersionId: string;
  handoffId: string;
  sourceHandoffFingerprint: string;
  animationPackageId: string;
};

function assertLineage(lineage: Lineage, source: EpisodeProjectedAuthoritySource) {
  if (lineage.animationPackageId !== source.animationPackageId) {
    throw new EpisodeProjectedAuthorityError("EPISODE_PROJECTED_AUTHORITY_CONFLICT", "Animation Package identity contradicts the Episode projection source");
  }
}

export function buildEpisodeProjectedDirectorPlan(input: {
  lineage: Lineage;
  source: EpisodeProjectedAuthoritySource;
  version: number;
  supersedesDirectorPlanId: string | null;
  createdBy: string;
  createdAt: string;
}): AiStoryEpisodeProjectedDirectorPlan {
  assertLineage(input.lineage, input.source);
  const sceneDirections = projectEpisodeDirectorScenes(input.source);
  const base = {
    contractVersion: AI_STORY_DIRECTOR_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION,
    ...input.lineage,
    sceneDirections,
  };
  const sourceHash = sha256CanonicalIntegrityHash(base);
  const directorFingerprint = sha256CanonicalIntegrityHash({ ...base, sourceHash, version: input.version, supersedesDirectorPlanId: input.supersedesDirectorPlanId });
  return AiStoryEpisodeProjectedDirectorPlanSchema.parse({
    ...input.lineage,
    directorPlanId: deterministicUuidFromFingerprint("ai-story-director-plan.episode-projected", sourceHash),
    version: input.version,
    contractVersion: AI_STORY_DIRECTOR_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION,
    sceneDirections,
    sourceHash,
    directorFingerprint,
    status: "DRAFT",
    supersedesDirectorPlanId: input.supersedesDirectorPlanId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  });
}

export function buildEpisodeProjectedMotionPlan(input: {
  directorPlan: AiStoryEpisodeProjectedDirectorPlan;
  source: EpisodeProjectedAuthoritySource;
  version: number;
  supersedesMotionPlanId: string | null;
  createdBy: string;
  createdAt: string;
}): AiStoryEpisodeProjectedMotionPlan {
  if (input.directorPlan.status !== "FROZEN") {
    throw new EpisodeProjectedAuthorityError("EPISODE_PROJECTED_AUTHORITY_CONFLICT", "Projected Motion requires a FROZEN projected Director plan");
  }
  if (input.directorPlan.contractVersion !== AI_STORY_DIRECTOR_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION) {
    throw new EpisodeProjectedAuthorityError("EPISODE_PROJECTED_AUTHORITY_CONFLICT", "Projected Motion cannot bind an authored Director plan");
  }
  const sceneMotionPlans = projectEpisodeMotionScenes(input.source, input.directorPlan.sceneDirections);
  const base = {
    contractVersion: AI_STORY_MOTION_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION,
    storyId: input.directorPlan.storyId,
    storyVersionId: input.directorPlan.storyVersionId,
    outlineVersionId: input.directorPlan.outlineVersionId,
    scriptVersionId: input.directorPlan.scriptVersionId,
    handoffId: input.directorPlan.handoffId,
    directorPlanId: input.directorPlan.directorPlanId,
    orgId: input.directorPlan.orgId,
    workspaceId: input.directorPlan.workspaceId,
    campaignId: input.directorPlan.campaignId,
    animationPackageId: input.directorPlan.animationPackageId,
    sourceDirectorFingerprint: input.directorPlan.directorFingerprint,
    sceneMotionPlans,
  };
  const sourceHash = sha256CanonicalIntegrityHash(base);
  const motionFingerprint = sha256CanonicalIntegrityHash({ ...base, sourceHash, version: input.version, supersedesMotionPlanId: input.supersedesMotionPlanId });
  return AiStoryEpisodeProjectedMotionPlanSchema.parse({
    ...base,
    motionPlanId: deterministicUuidFromFingerprint("ai-story-motion-plan.episode-projected", sourceHash),
    version: input.version,
    sourceHash,
    motionFingerprint,
    status: "DRAFT",
    supersedesMotionPlanId: input.supersedesMotionPlanId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  });
}
