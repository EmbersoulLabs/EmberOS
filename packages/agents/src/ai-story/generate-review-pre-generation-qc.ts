/**
 * Generate Review materializes immutable Pre-Generation QC evidence.
 * It does not schedule a Provider, create an attempt, or spend Provider cost.
 */
import { and, eq } from "drizzle-orm";
import {
  AiStoryPreGenerationQcAuthorityService,
  getDb,
  schema,
  type AiStoryScriptScope,
} from "@ceo-agent/db";
import {
  AI_STORY_LOCAL_PACKAGE_GENERATION_MODES,
  AI_STORY_LOCAL_REFERENCE_AUTHORITY_TYPES,
  EXECUTION_CAPABILITY_IDS,
  type AiStoryEffectiveSceneGenerationAuthority,
  type AiStoryGenerateReviewPreQcSummary,
  type AiStoryPreGenerationQcCompilationRequest,
  type AiStoryPreGenerationQcEvaluation,
  type AiStoryPreGenerationQcProviderCapability,
} from "@ceo-agent/shared";
import {
  assertAiStoryPreGenerationQcCurrent,
  validateAiStoryPreGenerationQcFingerprint,
} from "@ceo-agent/shared/server";

type Db = ReturnType<typeof getDb>;

export const MANUAL_LOCAL_PRE_QC_CAPABILITY_VERSION = "manual-local-package.v2" as const;
/** Local Package v2 evaluates one persisted Scene Execution at a time. */
export const MANUAL_LOCAL_PRE_QC_TIMING_STRUCTURE = "SINGLE_SCENE" as const;

export class GenerateReviewPreQcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "GenerateReviewPreQcError";
  }
}

export type FrozenMotionScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
};

type ChainIds = FrozenMotionScope & {
  outlineVersionId: string;
  scriptVersionId: string;
  handoffId: string;
};

export type MotionChainRow = ChainIds & {
  motionPlanId: string;
  directorPlanId: string;
  status: string;
  version: number;
};

export type DirectorChainRow = ChainIds & {
  directorPlanId: string;
  status: string;
};

export type HandoffChainRow = ChainIds & {
  authorityStatus: string;
  frozenAt: Date | string | null;
};

export type ScriptChainRow = FrozenMotionScope & {
  scriptVersionId: string;
  outlineVersionId: string;
  status: string;
};

export type OutlineChainRow = FrozenMotionScope & {
  outlineVersionId: string;
  status: string;
};

function sameScope(row: FrozenMotionScope, scope: FrozenMotionScope): boolean {
  return row.orgId === scope.orgId
    && row.workspaceId === scope.workspaceId
    && row.campaignId === scope.campaignId
    && row.storyId === scope.storyId
    && row.storyVersionId === scope.storyVersionId;
}

/**
 * Exactly one FROZEN Outline → Script → Handoff → Director → Motion chain.
 * A higher version row is not current unless its full chain is frozen and unique.
 */
export function selectUniqueFrozenMotionChain(input: {
  motions: readonly MotionChainRow[];
  directors: readonly DirectorChainRow[];
  handoffs: readonly HandoffChainRow[];
  scripts: readonly ScriptChainRow[];
  outlines: readonly OutlineChainRow[];
  scope: FrozenMotionScope;
}): { motionPlanId: string } {
  const valid = input.motions.filter((motion) => {
    if (motion.status !== "FROZEN" || !sameScope(motion, input.scope)) return false;
    const directors = input.directors.filter((row) => row.directorPlanId === motion.directorPlanId);
    const director = directors.length === 1 ? directors[0] : undefined;
    if (!director || director.status !== "FROZEN" || !sameScope(director, input.scope)) return false;
    if (
      director.outlineVersionId !== motion.outlineVersionId
      || director.scriptVersionId !== motion.scriptVersionId
      || director.handoffId !== motion.handoffId
    ) return false;
    const handoffs = input.handoffs.filter((row) => row.handoffId === motion.handoffId);
    const handoff = handoffs.length === 1 ? handoffs[0] : undefined;
    if (!handoff || handoff.authorityStatus !== "CURRENT" || !handoff.frozenAt || !sameScope(handoff, input.scope)) {
      return false;
    }
    if (
      handoff.outlineVersionId !== motion.outlineVersionId
      || handoff.scriptVersionId !== motion.scriptVersionId
    ) return false;
    const scripts = input.scripts.filter((row) => row.scriptVersionId === motion.scriptVersionId);
    const script = scripts.length === 1 ? scripts[0] : undefined;
    if (!script || script.status !== "FROZEN" || !sameScope(script, input.scope)) return false;
    if (script.outlineVersionId !== motion.outlineVersionId) return false;
    const outlines = input.outlines.filter((row) => row.outlineVersionId === motion.outlineVersionId);
    const outline = outlines.length === 1 ? outlines[0] : undefined;
    return Boolean(outline && outline.status === "FROZEN" && sameScope(outline, input.scope));
  });
  if (valid.length !== 1) {
    throw new GenerateReviewPreQcError(
      valid.length === 0 ? "PRE_QC_MOTION_AUTHORITY_ABSENT" : "PRE_QC_MOTION_AUTHORITY_AMBIGUOUS",
      valid.length === 0
        ? "Current frozen Writer-to-Motion authority is absent"
        : "Current frozen Writer-to-Motion authority is ambiguous"
    );
  }
  return { motionPlanId: valid[0]!.motionPlanId };
}

export async function loadCurrentFrozenMotionChain(
  db: Db,
  scope: FrozenMotionScope
): Promise<{ motionPlanId: string }> {
  const motionScope = and(
    eq(schema.aiStoryMotionPlanVersions.orgId, scope.orgId),
    eq(schema.aiStoryMotionPlanVersions.workspaceId, scope.workspaceId),
    eq(schema.aiStoryMotionPlanVersions.campaignId, scope.campaignId),
    eq(schema.aiStoryMotionPlanVersions.storyId, scope.storyId),
    eq(schema.aiStoryMotionPlanVersions.storyVersionId, scope.storyVersionId)
  );
  const directorScope = and(
    eq(schema.aiStoryDirectorPlanVersions.orgId, scope.orgId),
    eq(schema.aiStoryDirectorPlanVersions.workspaceId, scope.workspaceId),
    eq(schema.aiStoryDirectorPlanVersions.campaignId, scope.campaignId),
    eq(schema.aiStoryDirectorPlanVersions.storyId, scope.storyId),
    eq(schema.aiStoryDirectorPlanVersions.storyVersionId, scope.storyVersionId)
  );
  const handoffScope = and(
    eq(schema.aiStoryScriptDirectorHandoffs.orgId, scope.orgId),
    eq(schema.aiStoryScriptDirectorHandoffs.workspaceId, scope.workspaceId),
    eq(schema.aiStoryScriptDirectorHandoffs.campaignId, scope.campaignId),
    eq(schema.aiStoryScriptDirectorHandoffs.storyId, scope.storyId),
    eq(schema.aiStoryScriptDirectorHandoffs.storyVersionId, scope.storyVersionId)
  );
  const scriptScope = and(
    eq(schema.aiStoryScriptVersions.orgId, scope.orgId),
    eq(schema.aiStoryScriptVersions.workspaceId, scope.workspaceId),
    eq(schema.aiStoryScriptVersions.campaignId, scope.campaignId),
    eq(schema.aiStoryScriptVersions.storyId, scope.storyId),
    eq(schema.aiStoryScriptVersions.storyVersionId, scope.storyVersionId)
  );
  const outlineScope = and(
    eq(schema.aiStoryOutlineVersions.orgId, scope.orgId),
    eq(schema.aiStoryOutlineVersions.workspaceId, scope.workspaceId),
    eq(schema.aiStoryOutlineVersions.campaignId, scope.campaignId),
    eq(schema.aiStoryOutlineVersions.storyId, scope.storyId),
    eq(schema.aiStoryOutlineVersions.storyVersionId, scope.storyVersionId)
  );
  const [motions, directors, handoffs, scripts, outlines] = await Promise.all([
    db.select().from(schema.aiStoryMotionPlanVersions).where(motionScope),
    db.select().from(schema.aiStoryDirectorPlanVersions).where(directorScope),
    db.select().from(schema.aiStoryScriptDirectorHandoffs).where(handoffScope),
    db.select().from(schema.aiStoryScriptVersions).where(scriptScope),
    db.select().from(schema.aiStoryOutlineVersions).where(outlineScope),
  ]);
  return selectUniqueFrozenMotionChain({ motions, directors, handoffs, scripts, outlines, scope });
}

export function buildManualLocalPreGenerationQcCapabilitySnapshot(): AiStoryPreGenerationQcProviderCapability {
  const supportedExecutionModes = [...AI_STORY_LOCAL_PACKAGE_GENERATION_MODES];
  const supportedReferenceRoles = [...AI_STORY_LOCAL_REFERENCE_AUTHORITY_TYPES];
  const contractModesSupported = AI_STORY_LOCAL_PACKAGE_GENERATION_MODES.every((mode) =>
    supportedExecutionModes.includes(mode)
  );
  return {
    capabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    capabilityVersion: MANUAL_LOCAL_PRE_QC_CAPABILITY_VERSION,
    supportedExecutionModes,
    supportedReferenceRoles,
    supportedTimingStructures: [MANUAL_LOCAL_PRE_QC_TIMING_STRUCTURE],
    estimatedAttemptCostUsd: null,
    verified: contractModesSupported,
  };
}

function referenceRoles(authority: AiStoryEffectiveSceneGenerationAuthority): string[] {
  if (authority.referenceSource === "REFERENCE_FREE_T2V") return [];
  if (authority.referenceSource === "CHARACTER_SYNTHETIC_ANCHOR") return ["CHARACTER"];
  if (authority.referenceSource === "SCENE_EXPLICIT") {
    return authority.productVisualIdentityRequirement === "REQUIRED"
      ? ["FIRST_FRAME", "PRODUCT"]
      : ["FIRST_FRAME"];
  }
  throw new GenerateReviewPreQcError(
    "PRE_QC_GENERATION_AUTHORITY_ABSENT",
    "Frozen Scene reference authority is unresolved"
  );
}

function providerNeutralInputsComplete(authority: AiStoryEffectiveSceneGenerationAuthority): boolean {
  if (authority.strategy === "TEXT_TO_VIDEO" && authority.referenceSource === "REFERENCE_FREE_T2V") {
    return authority.effectiveReferenceIds.length === 0
      && authority.firstFrameAssetId === null
      && authority.productVisualIdentityRequirement === "NONE";
  }
  if (authority.strategy === "TEXT_TO_VIDEO" && authority.referenceSource === "CHARACTER_SYNTHETIC_ANCHOR") {
    return authority.effectiveReferenceIds.length === 1 && authority.firstFrameAssetId === null;
  }
  if (
    (authority.strategy === "FIRST_FRAME_IMAGE_TO_VIDEO" || authority.strategy === "PRODUCT_GROUNDED_VIDEO")
    && authority.referenceSource === "SCENE_EXPLICIT"
  ) {
    return authority.firstFrameAssetId !== null
      && authority.effectiveReferenceIds.includes(authority.firstFrameAssetId)
      && authority.productVisualIdentityRequirement === "REQUIRED";
  }
  return false;
}

export function buildManualLocalPreQcCompilationRequest(input: {
  sceneExecutionId: string;
  generationAuthority: AiStoryEffectiveSceneGenerationAuthority | undefined;
}): AiStoryPreGenerationQcCompilationRequest {
  const authority = input.generationAuthority;
  if (!authority) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_GENERATION_AUTHORITY_ABSENT",
      "Frozen Scene generation authority is missing"
    );
  }
  return {
    sceneExecutionId: input.sceneExecutionId,
    requestedCapabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    executionMode: authority.strategy,
    referenceRoles: referenceRoles(authority),
    timingStructure: MANUAL_LOCAL_PRE_QC_TIMING_STRUCTURE,
    providerNeutralInputsComplete: providerNeutralInputsComplete(authority),
  };
}

export async function materializeGenerateReviewPreGenerationQc(input: {
  db: Db;
  scope: AiStoryScriptScope;
  scenes: readonly {
    sceneExecutionId: string;
    generationAuthority: AiStoryEffectiveSceneGenerationAuthority | undefined;
  }[];
  qc?: Pick<AiStoryPreGenerationQcAuthorityService, "evaluate">;
  resolveMotion?: () => Promise<{ motionPlanId: string }>;
}): Promise<AiStoryGenerateReviewPreQcSummary> {
  if (!input.scope.actorUserId) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_ACTOR_REQUIRED",
      "Pre-Generation QC requires the authenticated operator"
    );
  }
  if (input.scenes.length === 0) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_LINEAGE_ABSENT",
      "Generate Review has no persisted Scene Execution"
    );
  }
  const motion = input.resolveMotion
    ? await input.resolveMotion()
    : await loadCurrentFrozenMotionChain(input.db, input.scope);
  const capability = buildManualLocalPreGenerationQcCapabilitySnapshot();
  const qc = input.qc ?? new AiStoryPreGenerationQcAuthorityService(input.db);
  const scenes: AiStoryGenerateReviewPreQcSummary["scenes"] = [];
  for (const scene of input.scenes) {
    const compilationRequest = buildManualLocalPreQcCompilationRequest(scene);
    const evaluation = await qc.evaluate(input.scope, {
      motionPlanId: motion.motionPlanId,
      providerCapability: capability,
      compilationRequest,
    });
    scenes.push({
      sceneExecutionId: scene.sceneExecutionId,
      qcEvaluationId: evaluation.qcEvaluationId,
      qcFingerprint: evaluation.qcFingerprint,
      dispatchDecision: evaluation.dispatchDecision,
    });
  }
  return {
    PRE_QC_SCENE_COUNT: scenes.length,
    PRE_QC_BLOCKED_COUNT: scenes.filter((scene) => scene.dispatchDecision === "DISPATCH_BLOCKED").length,
    PRE_QC_WARNING_COUNT: scenes.filter((scene) => scene.dispatchDecision === "DISPATCH_ELIGIBLE_WITH_WARNINGS").length,
    scenes,
  };
}

export function assertRuntimePreGenerationQcEvidence(input: {
  evaluation: AiStoryPreGenerationQcEvaluation | null;
  sceneExecutionId: string;
  storyVersionId: string;
  motionPlanId: string;
  currentSceneVersionIds: readonly string[];
}): void {
  const evaluation = input.evaluation;
  if (!evaluation) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_LINEAGE_ABSENT",
      "Current Canonical Scene is missing frozen Pre-QC lineage"
    );
  }
  if (evaluation.sceneExecutionId !== input.sceneExecutionId) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_LINEAGE_ABSENT",
      "Pre-QC scene execution does not match the ordered Scene"
    );
  }
  if (evaluation.storyVersionId !== input.storyVersionId) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_STALE_SCENE",
      "Pre-QC story version is not current"
    );
  }
  if (evaluation.motionPlanId !== input.motionPlanId) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_STALE_MOTION",
      "Pre-QC motion authority is not the current frozen chain"
    );
  }
  if (!evaluation.sceneVersionIds?.length) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_STALE_SCENE",
      "Pre-QC is missing the current Scene version set"
    );
  }
  if (evaluation.dispatchDecision === "DISPATCH_BLOCKED") {
    throw new GenerateReviewPreQcError(
      "PRE_QC_DISPATCH_BLOCKED",
      "Pre-Generation QC blocked execution"
    );
  }
  if (!validateAiStoryPreGenerationQcFingerprint(evaluation)) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_FINGERPRINT_INVALID",
      "Pre-QC fingerprint is not valid"
    );
  }
  try {
    assertAiStoryPreGenerationQcCurrent(evaluation, {
      outlineVersionId: evaluation.outlineVersionId,
      scriptVersionId: evaluation.scriptVersionId,
      handoffId: evaluation.handoffId,
      directorPlanId: evaluation.directorPlanId,
      motionPlanId: input.motionPlanId,
      sceneVersionIds: input.currentSceneVersionIds,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_PREGEN_QC_SCENE_DENIED") {
      throw new GenerateReviewPreQcError("PRE_QC_STALE_SCENE", "Pre-QC scene version set is stale");
    }
    if (error instanceof Error && error.message === "STALE_PREGEN_QC_DENIED") {
      throw new GenerateReviewPreQcError("PRE_QC_STALE_MOTION", "Pre-QC Writer-to-Motion lineage is stale");
    }
    throw error;
  }
}

export async function loadCurrentSceneVersionIds(
  db: Db,
  workspaceId: string,
  storyVersionId: string
): Promise<string[]> {
  const rows = await db
    .select({ sceneVersionId: schema.aiStoryCanonicalScenes.currentSceneVersionId })
    .from(schema.aiStoryCanonicalScenes)
    .innerJoin(
      schema.aiStoryCanonicalSceneVersions,
      eq(
        schema.aiStoryCanonicalSceneVersions.sceneVersionId,
        schema.aiStoryCanonicalScenes.currentSceneVersionId
      )
    )
    .where(and(
      eq(schema.aiStoryCanonicalSceneVersions.storyVersionId, storyVersionId),
      eq(schema.aiStoryCanonicalScenes.workspaceId, workspaceId)
    ));
  return rows.map((row) => row.sceneVersionId);
}

export async function assertCurrentPreGenerationQcForRuntimeAuthorization(input: {
  db?: Db;
  scope: AiStoryScriptScope;
  orderedSceneExecutionIds: readonly string[];
  resolveMotion?: () => Promise<{ motionPlanId: string }>;
  loadSceneVersionIds?: (storyVersionId: string) => Promise<readonly string[]>;
  qc?: Pick<AiStoryPreGenerationQcAuthorityService, "history" | "assertCurrent">;
}): Promise<void> {
  if (input.orderedSceneExecutionIds.length === 0) {
    throw new GenerateReviewPreQcError(
      "PRE_QC_LINEAGE_ABSENT",
      "Runtime authorization has no ordered Scene"
    );
  }
  const motion = input.resolveMotion
    ? await input.resolveMotion()
    : await loadCurrentFrozenMotionChain(input.db!, input.scope);
  const qc = input.qc ?? new AiStoryPreGenerationQcAuthorityService(input.db);
  const loadSceneVersionIds = input.loadSceneVersionIds
    ?? ((storyVersionId: string) => loadCurrentSceneVersionIds(input.db!, input.scope.workspaceId, storyVersionId));
  for (const sceneExecutionId of input.orderedSceneExecutionIds) {
    const history = await qc.history(input.scope, sceneExecutionId);
    const evaluation = history.at(-1) ?? null;
    const currentSceneVersionIds = evaluation
      ? await loadSceneVersionIds(evaluation.storyVersionId)
      : [];
    assertRuntimePreGenerationQcEvidence({
      evaluation,
      sceneExecutionId,
      storyVersionId: input.scope.storyVersionId,
      motionPlanId: motion.motionPlanId,
      currentSceneVersionIds,
    });
    if (!evaluation) {
      throw new GenerateReviewPreQcError(
        "PRE_QC_LINEAGE_ABSENT",
        "Current Canonical Scene is missing frozen Pre-QC lineage"
      );
    }
    await qc.assertCurrent(input.scope, evaluation.qcEvaluationId);
  }
}

/** Accept a RuntimeAuthorizedFact only after current Pre-QC evidence passes. */
export async function persistRuntimeAuthorizationAfterPreQc<T>(
  assertPreQc: () => Promise<void>,
  accept: () => Promise<T>
): Promise<T> {
  await assertPreQc();
  return accept();
}
