/**
 * Campaign-owned AI Story planning persistence helpers.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AiStoryScriptAuthorityService, ApprovedAnimationPackageAuthorityError, getDb, resolveCurrentFrozenCanonicalSceneSet, resolveCurrentFrozenScriptForStoryVersion, schema } from "@ceo-agent/db";
import { AiStoryPlanningCharacterAuthorityError, projectAcceptedCharactersToPlanning, refreshBoundCharacterAuthority } from "@ceo-agent/agents";
import {
  AuthoritativeAnimationPackagePayloadSchema,
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  StoryPlanningDraftSchema,
  isStoryPlanningDraft,
  validatePlanningConsistency,
  type AnimationPackagePayload,
  AiStoryCharacterAuthorityVersionSchema,
  type AiStoryCharacterAuthorityVersion,
  type AiStoryScriptVersion,
  type AiStoryExecutionCapabilityAuthority,
  type AiStorySceneCastDirection,
  AiStorySceneCastDirectionSchema,
  type CreativeContext,
  type NarrativeIntegrationReport,
  type StoryPlanningDraft,
  AI_STORY_EXECUTION_UNIT_DURATION_SUCCESSOR_CONTRACT,
  applyExecutionUnitDurationChanges,
  bindProductShotCameraSafety,
} from "@ceo-agent/shared";
import { assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent, buildAiStoryAnimationPackageCanonicalSceneAuthorityV1, buildAiStoryScriptVersion, sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import { revalidatePlanningProductMaterialAuthority } from "@/lib/ai-story-product-material-runtime";
import { assertFreshExecutionCapabilityAuthority } from "@/lib/ai-story-execution-capability";
import {
  creativeScenePlanProjection,
  castNeutralCreativeScenePlanProjection,
  durationAndCastNeutralCreativeScenePlanProjection,
  durationNeutralCreativeScenePlanProjection,
  ensureCurrentFrozenCanonicalSceneSet,
} from "@/lib/ai-story-canonical-scene-producer";
import { resolveStoryProductSources, type AiStoryResolvedProductSource } from "@/lib/ai-story-product-sources";

type Db = ReturnType<typeof getDb>;

export async function loadLatestCreativeContextForStory(
  db: Db,
  input: { campaignId: string; storyId: string; workspaceId: string }
) {
  const [context] = await db
    .select()
    .from(schema.aiStoryCreativeContexts)
    .where(
      and(
        eq(schema.aiStoryCreativeContexts.campaignId, input.campaignId),
        eq(schema.aiStoryCreativeContexts.storyId, input.storyId),
        eq(schema.aiStoryCreativeContexts.workspaceId, input.workspaceId)
      )
    )
    .orderBy(desc(schema.aiStoryCreativeContexts.createdAt))
    .limit(1);
  return context ?? null;
}

export async function saveCreativeContext(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
    payload: CreativeContext;
  }
) {
  const payload = CreativeContextSchema.parse(input.payload);
  const [context] = await db
    .insert(schema.aiStoryCreativeContexts)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      payload,
    })
    .returning();
  if (!context) throw new Error("Failed to save AI Story creative context");
  return context;
}

export class AiStoryPlanningDialogueRevisionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryPlanningDialogueRevisionError";
  }
}

export class AiStoryPreDirectorCharacterSyncError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryPreDirectorCharacterSyncError";
  }
}

/** Atomically rebind one accepted Character successor without another Provider call. */
export async function synchronizePreDirectorCharacterAuthority(
  db: Db,
  input: {
    orgId: string; workspaceId: string; campaignId: string; storyId: string;
    storyVersionId: string; character: AiStoryCharacterAuthorityVersion;
  }
) {
  const character = AiStoryCharacterAuthorityVersionSchema.parse(input.character);
  const [authority] = projectAcceptedCharactersToPlanning({
    orgId: input.orgId, workspaceId: input.workspaceId,
    campaignId: input.campaignId, characters: [character],
  });
  if (!authority) {
    throw new AiStoryPreDirectorCharacterSyncError(
      "PLANNING_CHARACTER_AUTHORITY_REQUIRED", "Current Character authority is unavailable"
    );
  }
  return db.transaction(async (tx) => {
    const [latestPackage] = await tx.select().from(schema.aiStoryAnimationPackages)
      .where(and(
        eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId)
      )).orderBy(desc(schema.aiStoryAnimationPackages.createdAt)).limit(1);
    if (!latestPackage || !isStoryPlanningDraft(latestPackage.payload)) {
      throw new AiStoryPreDirectorCharacterSyncError(
        "PLANNING_CHARACTER_SUCCESSOR_REQUIRED",
        "Character authority can only be synchronized while the Story is in Planning"
      );
    }
    const currentDraft = StoryPlanningDraftSchema.parse(latestPackage.payload);
    if (currentDraft.completedStages.some((stage) => stage !== "creative_context")) {
      throw new AiStoryPreDirectorCharacterSyncError(
        "PLANNING_CHARACTER_SUCCESSOR_REQUIRED",
        "Director or later authority already exists; create a durable Episode successor"
      );
    }
    if (!currentDraft.creativeContext) {
      throw new AiStoryPreDirectorCharacterSyncError(
        "PLANNING_CHARACTER_CONTEXT_REQUIRED",
        "Creative Context is required before Character authority can be synchronized"
      );
    }
    let creativeContext: CreativeContext;
    try {
      creativeContext = refreshBoundCharacterAuthority({
        creativeContext: currentDraft.creativeContext, characterAuthority: authority,
      });
    } catch (error) {
      if (error instanceof AiStoryPlanningCharacterAuthorityError) {
        throw new AiStoryPreDirectorCharacterSyncError(
          "PLANNING_CHARACTER_NOT_BOUND", "This Character is not accepted in the current Story"
        );
      }
      throw error;
    }
    const nextDraft = StoryPlanningDraftSchema.parse({
      ...currentDraft, creativeContext, completedStages: ["creative_context"],
    });
    const [context] = await tx.insert(schema.aiStoryCreativeContexts).values({
      orgId: input.orgId, workspaceId: input.workspaceId,
      campaignId: input.campaignId, storyId: input.storyId,
      storyVersionId: input.storyVersionId, payload: creativeContext,
    }).returning();
    const [planningDraft] = await tx.update(schema.aiStoryAnimationPackages)
      .set({ payload: nextDraft, updatedAt: new Date() })
      .where(and(
        eq(schema.aiStoryAnimationPackages.id, latestPackage.id),
        eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId)
      )).returning();
    if (!context || !planningDraft) {
      throw new AiStoryPreDirectorCharacterSyncError(
        "PLANNING_CHARACTER_WRITE_CONFLICT",
        "Character authority synchronization could not be persisted atomically"
      );
    }
    return { context, planningDraft, providerCalls: 0 as const };
  });
}

export function applyUserAuthoredDialogueToPlanningDraft(
  current: StoryPlanningDraft,
  creativeContext: CreativeContext
): StoryPlanningDraft {
  const draft = StoryPlanningDraftSchema.parse(current);
  const payload = CreativeContextSchema.parse(creativeContext);
  if (draft.completedStages.some((stage) => stage !== "creative_context")) {
    throw new AiStoryPlanningDialogueRevisionError(
      "PLANNING_DIALOGUE_SUCCESSOR_REQUIRED",
      "Director or later authority already exists; create a durable Episode dialogue revision"
    );
  }
  return { ...draft, creativeContext: payload, completedStages: ["creative_context"] };
}

/** Persist user-authored dialogue before Director authority exists. */
export async function savePreDirectorCreativeContextRevision(
  db: Db,
  input: {
    orgId: string; workspaceId: string; campaignId: string; storyId: string;
    storyVersionId: string; payload: CreativeContext;
  }
) {
  const payload = CreativeContextSchema.parse(input.payload);
  return db.transaction(async (tx) => {
    const [latestPackage] = await tx.select().from(schema.aiStoryAnimationPackages)
      .where(and(
        eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId)
      )).orderBy(desc(schema.aiStoryAnimationPackages.createdAt)).limit(1);
    if (!latestPackage || !isStoryPlanningDraft(latestPackage.payload)) {
      throw new AiStoryPlanningDialogueRevisionError(
        "PLANNING_DIALOGUE_SUCCESSOR_REQUIRED",
        "Dialogue can only be edited in Planning before a complete Animation Package exists"
      );
    }
    const nextDraft = applyUserAuthoredDialogueToPlanningDraft(
      StoryPlanningDraftSchema.parse(latestPackage.payload), payload
    );
    const [context] = await tx.insert(schema.aiStoryCreativeContexts).values({
      orgId: input.orgId, workspaceId: input.workspaceId,
      campaignId: input.campaignId, storyId: input.storyId,
      storyVersionId: input.storyVersionId, payload,
    }).returning();
    const [planningDraft] = await tx.update(schema.aiStoryAnimationPackages)
      .set({ payload: nextDraft, updatedAt: new Date() })
      .where(and(
        eq(schema.aiStoryAnimationPackages.id, latestPackage.id),
        eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId)
      )).returning();
    if (!context || !planningDraft) {
      throw new AiStoryPlanningDialogueRevisionError(
        "PLANNING_DIALOGUE_WRITE_CONFLICT",
        "Dialogue revision could not be persisted atomically"
      );
    }
    return { context, planningDraft };
  });
}

export async function getLatestAnimationPackageForStory(
  db: Db,
  input: { campaignId: string; storyId: string; workspaceId: string }
) {
  const [animationPackage] = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId)
      )
    )
    .orderBy(desc(schema.aiStoryAnimationPackages.createdAt))
    .limit(1);
  return animationPackage ?? null;
}

export async function savePlanningDraft(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
    payload: StoryPlanningDraft;
  }
) {
  const payload = StoryPlanningDraftSchema.parse(input.payload);
  const [animationPackage] = await db
    .insert(schema.aiStoryAnimationPackages)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      status: "generating",
      payload,
      consistencyReport: { consistent: false, issues: ["Planning draft incomplete"], links: [] },
    })
    .returning();
  if (!animationPackage) throw new Error("Failed to save AI Story planning draft");
  return animationPackage;
}

export async function saveAnimationPackage(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
    payload: AnimationPackagePayload;
  }
) {
  const parsed = AuthoritativeAnimationPackagePayloadSchema.parse(input.payload);
  const consistencyReport: NarrativeIntegrationReport = validatePlanningConsistency(parsed);
  const payload: AnimationPackagePayload = {
    ...parsed,
    narrativeIntegration: consistencyReport,
    status: "review",
  };
  const [animationPackage] = await db
    .insert(schema.aiStoryAnimationPackages)
    .values({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      status: payload.status,
      payload,
      consistencyReport,
    })
    .returning();
  if (!animationPackage) throw new Error("Failed to save AI Story animation package");
  return animationPackage;
}

export function readPlanningDraftFromPackage(
  animationPackage: { payload: unknown; status: string } | null
): StoryPlanningDraft | null {
  if (!animationPackage) return null;
  if (isStoryPlanningDraft(animationPackage.payload)) {
    return StoryPlanningDraftSchema.parse(animationPackage.payload);
  }
  return null;
}

export function readCompleteAnimationPackage(
  animationPackage: { payload: unknown; status: string } | null
): AnimationPackagePayload | null {
  if (!animationPackage) return null;
  if (isStoryPlanningDraft(animationPackage.payload)) return null;
  const parsed = AnimationPackagePayloadSchema.safeParse(animationPackage.payload);
  return parsed.success ? parsed.data : null;
}

export async function getLatestCompleteAnimationPackageForStory(
  db: Db,
  input: { campaignId: string; storyId: string; workspaceId: string }
) {
  const rows = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId)
      )
    )
    .orderBy(desc(schema.aiStoryAnimationPackages.createdAt))
    .limit(20);
  for (const row of rows) {
    if (isStoryPlanningDraft(row.payload)) continue;
    const parsed = AnimationPackagePayloadSchema.safeParse(row.payload);
    if (parsed.success) return row;
  }
  return null;
}

export class AiStoryGenerationStrategyRecoveryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryGenerationStrategyRecoveryError";
  }
}

export type FrozenSuccessorAuthority = {
  frozenScript: AiStoryScriptVersion;
  productSources: readonly AiStoryResolvedProductSource[];
  characterVersions: readonly AiStoryCharacterAuthorityVersion[];
};

type GenerationStrategyLineagePackage = {
  id: string;
  payload: unknown;
};

/**
 * Resolve the immutable semantic Scene Plan that originally produced the
 * frozen Script. A successor may itself be recovered repeatedly; using only
 * its immediate parent would incorrectly treat a strategy-only revision as a
 * new Script semantic input. Every hop must retain identical creative facts.
 */
export async function resolveGenerationStrategySemanticAncestor(
  sourceRow: GenerationStrategyLineagePackage,
  loadParent: (id: string) => Promise<GenerationStrategyLineagePackage | null>,
) {
  return (await resolvePlanningSemanticAncestor(sourceRow, loadParent)).scenePlan;
}

/**
 * Walks strategy and duration successors back to the Plan that produced the
 * frozen Script. Strategy hops must keep every creative fact; duration hops may
 * only change Scene durations, which marks the lineage as duration-adjusted.
 */
export async function resolvePlanningSemanticAncestor(
  sourceRow: GenerationStrategyLineagePackage,
  loadParent: (id: string) => Promise<GenerationStrategyLineagePackage | null>,
) {
  const visited = new Set<string>();
  let currentRow = sourceRow;
  let current = AuthoritativeAnimationPackagePayloadSchema.parse(currentRow.payload);
  const source = current;
  let durationAdjusted = false;
  let castAdjusted = false;
  const projection = () => durationAdjusted && castAdjusted
    ? durationAndCastNeutralCreativeScenePlanProjection
    : durationAdjusted
      ? durationNeutralCreativeScenePlanProjection
      : castAdjusted
        ? castNeutralCreativeScenePlanProjection
        : creativeScenePlanProjection;
  for (let depth = 0; current.strategyRecovery || current.durationRecovery || current.castRecovery; depth += 1) {
    if (depth >= 32 || visited.has(currentRow.id)) {
      throw new AiStoryGenerationStrategyRecoveryError(
        "GENERATION_STRATEGY_SUCCESSOR_LINEAGE_AMBIGUOUS",
        "Generation strategy successor lineage is cyclic or exceeds the supported immutable history depth",
      );
    }
    visited.add(currentRow.id);
    if (current.durationRecovery) durationAdjusted = true;
    if (current.castRecovery) castAdjusted = true;
    const expectedCreative = JSON.stringify(projection()(source.scenePlan));
    const parent = await loadParent(
      current.strategyRecovery?.supersedesAnimationPackageId
        ?? current.durationRecovery?.supersedesAnimationPackageId
        ?? current.castRecovery!.supersedesAnimationPackageId,
    );
    if (!parent || isStoryPlanningDraft(parent.payload)) {
      throw new AiStoryGenerationStrategyRecoveryError(
        "GENERATION_STRATEGY_SUCCESSOR_LINEAGE_MISSING",
        "Generation strategy successor lineage does not resolve to a complete immutable ancestor",
      );
    }
    const parentPayload = AuthoritativeAnimationPackagePayloadSchema.parse(parent.payload);
    if (JSON.stringify(projection()(parentPayload.scenePlan)) !== expectedCreative) {
      throw new AiStoryGenerationStrategyRecoveryError(
        "GENERATION_STRATEGY_SUCCESSOR_CREATIVE_LINEAGE_CHANGED",
        "Generation strategy successor lineage changed approved creative Scene facts",
      );
    }
    currentRow = parent;
    current = parentPayload;
  }
  return { scenePlan: current.scenePlan, durationAdjusted, castAdjusted };
}

type PlanningPackageScope = {
  orgId: string; workspaceId: string; campaignId: string; storyId: string; storyVersionId: string;
};

function scopedPackageLoader(db: Db, input: PlanningPackageScope) {
  return async (parentId: string) => {
    const [parent] = await db.select().from(schema.aiStoryAnimationPackages).where(and(
      eq(schema.aiStoryAnimationPackages.id, parentId),
      eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
      eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
      eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
      eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
      eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId),
    )).limit(1);
    return parent ?? null;
  };
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function recoveredSceneAuthority(
  scene: AnimationPackagePayload["scenePlan"][number],
  frozen?: FrozenSuccessorAuthority,
) {
  const evidence = scene.groundingLineage?.evidence ?? [];
  const scriptScene = frozen?.frozenScript.scenes.find((item) => item.order === scene.order);
  if (frozen && !scriptScene) {
    throw new AiStoryGenerationStrategyRecoveryError(
      "GENERATION_STRATEGY_SUCCESSOR_SCENE_AUTHORITY_MISSING",
      `Scene ${scene.id} does not resolve to the frozen Script`,
    );
  }
  const productEvidence = unique(evidence.filter((item) => item.role === "PRODUCT_AUTHORITY").map((item) => item.assetId));
  const frozenProductIds = unique(scriptScene?.productAuthorityRefs ?? []);
  const productAssets = frozenProductIds.length > 0 ? frozenProductIds : productEvidence;
  if (productAssets.length > 1) {
    throw new AiStoryGenerationStrategyRecoveryError(
      "GENERATION_STRATEGY_SUCCESSOR_ASSET_SELECTION_REQUIRED",
      `Scene ${scene.id} has multiple Product authorities and requires one consolidated human reference selection`,
    );
  }
  if (frozen && productAssets[0] && !frozen.productSources.some((source) => source.assetId === productAssets[0])) {
    throw new AiStoryGenerationStrategyRecoveryError(
      "GENERATION_STRATEGY_SUCCESSOR_PRODUCT_AUTHORITY_UNRESOLVED",
      `Scene ${scene.id} Product authority does not resolve to a verified frozen Product source`,
    );
  }

  const characterEvidence = unique(evidence.filter((item) => item.role === "CHARACTER_AUTHORITY").map((item) => item.assetId));
  const characterAssets = scriptScene && frozen
    ? unique(scriptScene.characterIds.flatMap((characterId) => {
        const authorityRef = frozen.frozenScript.authorityReferences.find((reference) =>
          reference.authorityType === "CHARACTER" && reference.authorityId === characterId
        );
        if (!authorityRef?.authorityVersionId || !authorityRef.authorityFingerprint) {
          throw new AiStoryGenerationStrategyRecoveryError(
            "GENERATION_STRATEGY_SUCCESSOR_CHARACTER_AUTHORITY_UNRESOLVED",
            `Scene ${scene.id} Character ${characterId} lacks an exact frozen authority snapshot`,
          );
        }
        const version = frozen.characterVersions.find((candidate) =>
          candidate.characterId === characterId
          && candidate.characterVersionId === authorityRef.authorityVersionId
          && candidate.fingerprint === authorityRef.authorityFingerprint
        );
        if (!version) {
          throw new AiStoryGenerationStrategyRecoveryError(
            "GENERATION_STRATEGY_SUCCESSOR_CHARACTER_AUTHORITY_UNRESOLVED",
            `Scene ${scene.id} Character ${characterId} frozen authority cannot be resolved`,
          );
        }
        return version.visualAssetReferences.map((reference) => reference.assetId);
      }))
    : characterEvidence;
  if (characterAssets.length > 1) {
    throw new AiStoryGenerationStrategyRecoveryError(
      "GENERATION_STRATEGY_SUCCESSOR_ASSET_SELECTION_REQUIRED",
      `Scene ${scene.id} has multiple Character visual references and requires one consolidated human reference selection`,
    );
  }
  if (productAssets[0]) {
    return {
      strategy: "PRODUCT_GROUNDED_VIDEO" as const,
      referenceSource: "SCENE_EXPLICIT" as const,
      referenceAssetIds: [productAssets[0], ...characterAssets],
      firstFrameAssetId: productAssets[0],
      productVisualIdentityRequirement: "REQUIRED" as const,
    };
  }
  if (characterAssets[0]) {
    return {
      strategy: "TEXT_TO_VIDEO" as const,
      referenceSource: "CHARACTER_SYNTHETIC_ANCHOR" as const,
      referenceAssetIds: [characterAssets[0]],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE" as const,
    };
  }
  return scene.generationAuthority;
}

export function recoverScenePlanGenerationAuthorities(
  scenePlan: AnimationPackagePayload["scenePlan"],
  frozen?: FrozenSuccessorAuthority,
) {
  if (frozen && frozen.frozenScript.scenes.length !== scenePlan.length) {
    throw new AiStoryGenerationStrategyRecoveryError(
      "GENERATION_STRATEGY_SUCCESSOR_SCENE_AUTHORITY_MISSING",
      "Scene Plan topology does not match the frozen Script",
    );
  }
  return scenePlan.map((scene) => ({ ...scene, generationAuthority: recoveredSceneAuthority(scene, frozen) }));
}

async function resolveFrozenSuccessorAuthority(db: Db, input: {
  orgId: string; workspaceId: string; campaignId: string; storyId: string; storyVersionId: string;
}): Promise<FrozenSuccessorAuthority> {
  const scope = { ...input, requireCurrentFrozenStoryVersion: true };
  const [frozenScript, productSources] = await Promise.all([
    resolveCurrentFrozenScriptForStoryVersion(db, scope),
    resolveStoryProductSources(db, input),
  ]);
  if (!frozenScript) {
    throw new AiStoryGenerationStrategyRecoveryError(
      "GENERATION_STRATEGY_SUCCESSOR_FROZEN_SCRIPT_REQUIRED",
      "Generation strategy recovery requires the exact current frozen Script",
    );
  }
  const characterVersionIds = unique(frozenScript.authorityReferences.flatMap((reference) =>
    reference.authorityType === "CHARACTER" && reference.authorityVersionId ? [reference.authorityVersionId] : []
  ));
  const rows = characterVersionIds.length === 0 ? [] : await db.select({ snapshot: schema.aiStoryCharacterVersions.snapshot })
    .from(schema.aiStoryCharacterVersions)
    .where(and(
      inArray(schema.aiStoryCharacterVersions.characterVersionId, characterVersionIds),
      eq(schema.aiStoryCharacterVersions.orgId, input.orgId),
      eq(schema.aiStoryCharacterVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryCharacterVersions.campaignId, input.campaignId),
    ));
  return {
    frozenScript,
    productSources,
    characterVersions: rows.map((row) => AiStoryCharacterAuthorityVersionSchema.parse(row.snapshot)),
  };
}

/**
 * Creates a no-provider-call successor Planning Package from persisted facts.
 * Canonical Scene rows are revised append-only; the prior Package is retained
 * as SUPERSEDED and the successor returns to normal human Planning Review.
 */
export async function createGenerationStrategySuccessor(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    storyVersionId: string;
    actorUserId: string;
    sourcePackageId: string;
    episodeIntent?: import("@ceo-agent/shared").AiStoryEpisodeIntentAuthority;
  },
) {
  const [sourceRow] = await db.select().from(schema.aiStoryAnimationPackages).where(and(
    eq(schema.aiStoryAnimationPackages.id, input.sourcePackageId),
    eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
    eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
    eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
    eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
    eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId),
  )).limit(1);
  if (!sourceRow || isStoryPlanningDraft(sourceRow.payload)) {
    throw new AiStoryGenerationStrategyRecoveryError("GENERATION_STRATEGY_SUCCESSOR_SOURCE_MISSING", "Complete source Planning Package not found");
  }
  const source = AuthoritativeAnimationPackagePayloadSchema.parse(sourceRow.payload);
  const semanticAncestor = await resolvePlanningSemanticAncestor(sourceRow, scopedPackageLoader(db, input));
  const semanticAncestorScenePlan = semanticAncestor.scenePlan;
  const frozenAuthority = await resolveFrozenSuccessorAuthority(db, input);
  const scenePlan = recoverScenePlanGenerationAuthorities(source.scenePlan, frozenAuthority);
  const recoveredShotPlan = bindProductShotCameraSafety({ scenePlan, shotPlan: source.shotPlan });
  if (sameJson(scenePlan, source.scenePlan) && sameJson(recoveredShotPlan, source.shotPlan)) {
    if (source.strategyRecovery && source.sourcePlanningPackageId) {
      const [supersededSourceRow] = await db.select().from(schema.aiStoryAnimationPackages).where(and(
        eq(schema.aiStoryAnimationPackages.id, source.strategyRecovery.supersedesAnimationPackageId),
        eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId),
      )).limit(1);
      if (supersededSourceRow && !isStoryPlanningDraft(supersededSourceRow.payload)) {
        const supersededSource = AuthoritativeAnimationPackagePayloadSchema.parse(supersededSourceRow.payload);
        if (supersededSource.status !== "superseded") {
          await db.update(schema.aiStoryAnimationPackages).set({
            status: "superseded",
            payload: AnimationPackagePayloadSchema.parse({ ...supersededSource, status: "superseded" }),
            updatedAt: new Date(),
          }).where(eq(schema.aiStoryAnimationPackages.id, supersededSourceRow.id));
        }
      }
      return {
        sourcePackageId: source.strategyRecovery.supersedesAnimationPackageId,
        planningDraftId: source.sourcePlanningPackageId,
        animationPackage: sourceRow,
        externalAiCalls: 0 as const,
        idempotent: true as const,
      };
    }
  }
  const sourceStrategyFingerprint = sha256CanonicalIntegrityHash({
    scenes: scenePlan.map((scene) => ({
      sceneId: scene.id,
      generationAuthority: scene.generationAuthority,
      groundingLineage: scene.groundingLineage,
    })),
    shots: recoveredShotPlan.map((shot) => ({
      shotId: shot.id,
      cameraSafety: shot.cameraSafety ?? null,
    })),
  });
  const strategyRecovery = {
    contractVersion: "ai-story-generation-strategy-successor.v1" as const,
    supersedesAnimationPackageId: sourceRow.id,
    sourceStrategyFingerprint,
    externalAiCalls: 0 as const,
  };
  const draft = StoryPlanningDraftSchema.parse({
    kind: "planning_draft",
    completedStages: ["creative_context", "director_thinking", "story_beats", "scene_plan", "shot_plan", "character_continuity", "world_continuity"],
    story: source.story,
    creativeContext: source.creativeContext,
    directorThinking: source.directorThinking,
    storyBeats: source.storyBeats,
    scenePlan,
    shotPlan: recoveredShotPlan,
    characterContinuity: source.characterContinuity,
    worldContinuity: source.worldContinuity,
    episodeContinuity: source.episodeContinuity,
    usage: source.usage,
    strategyRecovery,
  });
  const existingDraftRows = await db.select().from(schema.aiStoryAnimationPackages).where(and(
    eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
    eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
    eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
    eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
    eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId),
  )).orderBy(desc(schema.aiStoryAnimationPackages.createdAt));
  const existingDraftRow = existingDraftRows.find((row) => {
    if (!isStoryPlanningDraft(row.payload)) return false;
    const candidate = StoryPlanningDraftSchema.parse(row.payload);
    return candidate.strategyRecovery?.supersedesAnimationPackageId === sourceRow.id
      && candidate.strategyRecovery.sourceStrategyFingerprint === sourceStrategyFingerprint;
  });
  const draftRow = existingDraftRow ?? await savePlanningDraft(db, { ...input, payload: draft });
  const shotPlan = recoveredShotPlan.map((shot) => {
    if (!shot.authorityLineage) return shot;
    const scene = scenePlan.find((item) => item.id === shot.sceneId);
    if (!scene?.generationAuthority) return shot;
    return { ...shot, authorityLineage: { ...shot.authorityLineage, planningPackageId: draftRow.id, generationAuthority: scene.generationAuthority } };
  });
  const characterAuthorities = source.creativeContext.characterContext.characters.flatMap((character) =>
    character.canonicalAuthority ? [character.canonicalAuthority] : []
  );
  const canonicalScenes = await ensureCurrentFrozenCanonicalSceneSet({
    db,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    actorUserId: input.actorUserId,
    story: source.story,
    storyBeats: source.storyBeats,
    scenePlan,
    priorScenePlanForStrategySuccessor: semanticAncestorScenePlan,
    allowAuthorizedDurationChanges: semanticAncestor.durationAdjusted,
    creativeContext: source.creativeContext,
    directorThinking: source.directorThinking,
    worldContinuity: source.worldContinuity,
    characterAuthorities,
    ...(input.episodeIntent ? { episodeIntent: input.episodeIntent } : {}),
  });
  const successorPayload = AuthoritativeAnimationPackagePayloadSchema.parse({
    ...source,
    sourcePlanningPackageId: draftRow.id,
    scenePlan,
    shotPlan,
    canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      scenePlan,
      canonicalScenes,
    }),
    executionCapabilityAuthority: undefined,
    strategyRecovery,
    durationRecovery: undefined,
    status: "review",
  });
  const successor = await saveAnimationPackage(db, { ...input, payload: successorPayload });
  const supersededPayload = AnimationPackagePayloadSchema.parse({ ...source, status: "superseded" });
  await db.update(schema.aiStoryAnimationPackages).set({
    status: "superseded",
    payload: supersededPayload,
    updatedAt: new Date(),
  }).where(eq(schema.aiStoryAnimationPackages.id, sourceRow.id));
  return { sourcePackageId: sourceRow.id, planningDraftId: draftRow.id, animationPackage: successor, externalAiCalls: 0 as const, idempotent: false as const };
}

/**
 * Creates a no-provider-call successor Planning revision that changes only Scene
 * durations, as explicitly authorized by a human. Scene topology, order, beats,
 * purpose, transitions, continuity, Shots, camera language and generation
 * authority are preserved; the source revision is retained as SUPERSEDED and the
 * successor returns to normal human Planning Review.
 */
export async function createExecutionUnitDurationSuccessor(
  db: Db,
  input: PlanningPackageScope & {
    actorUserId: string;
    sourcePackageId: string;
    durations: readonly { sceneId: string; durationSec: number }[];
    episodeIntent?: import("@ceo-agent/shared").AiStoryEpisodeIntentAuthority;
  },
) {
  const loadPackage = scopedPackageLoader(db, input);
  const sourceRow = await loadPackage(input.sourcePackageId);
  if (!sourceRow || isStoryPlanningDraft(sourceRow.payload)) {
    throw new AiStoryGenerationStrategyRecoveryError("EXECUTION_UNIT_DURATION_SUCCESSOR_SOURCE_MISSING", "Complete source Planning Package not found");
  }
  const sourcePayload = AnimationPackagePayloadSchema.parse(sourceRow.payload);
  const applied = applyExecutionUnitDurationChanges({
    scenePlan: sourcePayload.scenePlan,
    shotPlan: sourcePayload.shotPlan,
    durations: input.durations,
  });
  const authoritativeSource = AuthoritativeAnimationPackagePayloadSchema.safeParse(sourceRow.payload);
  if (!authoritativeSource.success) {
    throw new AiStoryGenerationStrategyRecoveryError(
      "EXECUTION_UNIT_DURATION_SUCCESSOR_SOURCE_NOT_AUTHORITATIVE",
      "Source Planning Package lacks frozen Canonical Scene authority",
    );
  }
  const source = authoritativeSource.data;
  if (applied.changes.length === 0) {
    if (source.durationRecovery && source.sourcePlanningPackageId) {
      return {
        sourcePackageId: source.durationRecovery.supersedesAnimationPackageId,
        planningDraftId: source.sourcePlanningPackageId,
        animationPackage: sourceRow,
        changes: source.durationRecovery.changes,
        externalAiCalls: 0 as const,
        idempotent: true as const,
      };
    }
    throw new AiStoryGenerationStrategyRecoveryError("EXECUTION_UNIT_DURATION_SUCCESSOR_NO_CHANGE", "Requested durations match the current Planning revision");
  }
  const semanticAncestor = await resolvePlanningSemanticAncestor(sourceRow, loadPackage);
  const durationRecovery = {
    contractVersion: AI_STORY_EXECUTION_UNIT_DURATION_SUCCESSOR_CONTRACT,
    supersedesAnimationPackageId: sourceRow.id,
    changes: applied.changes,
    authorizedBy: input.actorUserId,
    externalAiCalls: 0 as const,
  };
  const draftRow = await savePlanningDraft(db, {
    ...input,
    payload: StoryPlanningDraftSchema.parse({
      kind: "planning_draft",
      completedStages: ["creative_context", "director_thinking", "story_beats", "scene_plan", "shot_plan", "character_continuity", "world_continuity"],
      story: source.story,
      creativeContext: source.creativeContext,
      directorThinking: source.directorThinking,
      storyBeats: source.storyBeats,
      scenePlan: applied.scenePlan,
      shotPlan: applied.shotPlan,
      characterContinuity: source.characterContinuity,
      worldContinuity: source.worldContinuity,
      episodeContinuity: source.episodeContinuity,
      usage: source.usage,
      durationRecovery,
    }),
  });
  const shotPlan = applied.shotPlan.map((shot) => shot.authorityLineage
    ? { ...shot, authorityLineage: { ...shot.authorityLineage, planningPackageId: draftRow.id } }
    : shot);
  const canonicalScenes = await ensureCurrentFrozenCanonicalSceneSet({
    db,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    actorUserId: input.actorUserId,
    story: source.story,
    storyBeats: source.storyBeats,
    scenePlan: applied.scenePlan,
    priorScenePlanForStrategySuccessor: semanticAncestor.scenePlan,
    allowAuthorizedDurationChanges: true,
    creativeContext: source.creativeContext,
    directorThinking: source.directorThinking,
    worldContinuity: source.worldContinuity,
    characterAuthorities: source.creativeContext.characterContext.characters.flatMap((character) =>
      character.canonicalAuthority ? [character.canonicalAuthority] : []
    ),
    ...(input.episodeIntent ? { episodeIntent: input.episodeIntent } : {}),
  });
  const successorPayload = AuthoritativeAnimationPackagePayloadSchema.parse({
    ...source,
    sourcePlanningPackageId: draftRow.id,
    scenePlan: applied.scenePlan,
    shotPlan,
    canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      scenePlan: applied.scenePlan,
      canonicalScenes,
    }),
    executionCapabilityAuthority: undefined,
    strategyRecovery: undefined,
    durationRecovery,
    status: "review",
  });
  const successor = await saveAnimationPackage(db, { ...input, payload: successorPayload });
  await db.update(schema.aiStoryAnimationPackages).set({
    status: "superseded",
    payload: AnimationPackagePayloadSchema.parse({ ...source, status: "superseded" }),
    updatedAt: new Date(),
  }).where(eq(schema.aiStoryAnimationPackages.id, sourceRow.id));
  return {
    sourcePackageId: sourceRow.id,
    planningDraftId: draftRow.id,
    animationPackage: successor,
    changes: applied.changes,
    externalAiCalls: 0 as const,
    idempotent: false as const,
  };
}

/** Creates a no-provider-call successor for an explicit human Scene-cast choice. */
export async function createSceneCastSuccessor(
  db: Db,
  input: PlanningPackageScope & {
    actorUserId: string;
    sourcePackageId: string;
    castDirections: readonly {
      sceneId: string;
      mode: "AUTO" | "SINGLE_CHARACTER" | "MULTI_CHARACTER";
      participants: readonly { castId: string; presence: "ON_SCREEN" | "OFF_SCREEN_DIALOGUE" | "VOICE_ONLY"; visualRole: "PRIMARY_VISUAL" | "SUPPORTING_VISUAL" | "BACKGROUND_VISUAL" }[];
      genericExtras: readonly { description: string; count: number; facesReadable: boolean }[];
    }[];
    episodeIntent?: import("@ceo-agent/shared").AiStoryEpisodeIntentAuthority;
  },
) {
  const loadPackage = scopedPackageLoader(db, input);
  const sourceRow = await loadPackage(input.sourcePackageId);
  if (!sourceRow || isStoryPlanningDraft(sourceRow.payload)) {
    throw new AiStoryGenerationStrategyRecoveryError("SCENE_CAST_SUCCESSOR_SOURCE_MISSING", "Complete source Planning Package not found");
  }
  const source = AuthoritativeAnimationPackagePayloadSchema.parse(sourceRow.payload);
  const requested = new Map(input.castDirections.map((change) => [change.sceneId, change] as const));
  if (requested.size !== input.castDirections.length || [...requested.keys()].some((id) => !source.scenePlan.some((scene) => scene.id === id))) {
    throw new AiStoryGenerationStrategyRecoveryError("SCENE_CAST_SUCCESSOR_SCENE_INVALID", "Scene cast decisions must target each existing Scene at most once");
  }
  let frozenAuthority = await resolveFrozenSuccessorAuthority(db, input);
  const requestedCharacterIds = unique(input.castDirections.flatMap((change) => change.participants.map((participant) => participant.castId)));
  const scriptCastIds = new Set(frozenAuthority.frozenScript.scenes.flatMap((scene) => (scene.castReferences ?? []).map((reference) => reference.id)));
  const missingCharacterIds = requestedCharacterIds.filter((characterId) => !scriptCastIds.has(characterId));
  if (missingCharacterIds.length > 0) {
    const characterRows = await db.select({
      characterId: schema.aiStoryCharacters.characterId,
      status: schema.aiStoryCharacters.status,
      currentCharacterVersionId: schema.aiStoryCharacters.currentCharacterVersionId,
      snapshot: schema.aiStoryCharacterVersions.snapshot,
    }).from(schema.aiStoryCharacters)
      .innerJoin(schema.aiStoryCharacterVersions, eq(schema.aiStoryCharacterVersions.characterVersionId, schema.aiStoryCharacters.currentCharacterVersionId))
      .where(and(
        inArray(schema.aiStoryCharacters.characterId, missingCharacterIds),
        eq(schema.aiStoryCharacters.orgId, input.orgId),
        eq(schema.aiStoryCharacters.workspaceId, input.workspaceId),
        eq(schema.aiStoryCharacters.campaignId, input.campaignId),
      ));
    const currentCharacters = new Map(characterRows
      .filter((row) => row.status === "ACTIVE")
      .map((row) => {
        const character = AiStoryCharacterAuthorityVersionSchema.parse(row.snapshot);
        return [character.characterId, character] as const;
      }));
    if (missingCharacterIds.some((characterId) => !currentCharacters.has(characterId))) {
      throw new AiStoryGenerationStrategyRecoveryError("SCENE_CAST_SUCCESSOR_AUTHORITY_INVALID", "Selected Cast must resolve to an active current Campaign Character authority");
    }
    const requestByOrder = new Map(source.scenePlan.map((scene) => [scene.order, requested.get(scene.id)] as const));
    const scenes = frozenAuthority.frozenScript.scenes.map((scene) => {
      const request = requestByOrder.get(scene.order);
      if (!request) return scene;
      const references = new Map((scene.castReferences ?? []).map((reference) => [reference.id, reference] as const));
      for (const participant of request.participants) {
        if (references.has(participant.castId)) continue;
        const character = currentCharacters.get(participant.castId);
        if (!character) continue;
        references.set(character.characterId, {
          scope: "CAMPAIGN_CHARACTER",
          id: character.characterId,
          campaignId: input.campaignId,
          authorityVersionId: character.characterVersionId,
          authorityFingerprint: character.fingerprint,
          visualIdentityRequirement: participant.presence === "ON_SCREEN" ? "REQUIRED" : "NONE",
        });
      }
      const entries = scene.entries.map((entry) => {
        if (entry.type === "DIALOGUE" && references.has(entry.speakerId)) {
          return { ...entry, speakerCastReference: references.get(entry.speakerId)! };
        }
        if (entry.type === "VO" && references.has(entry.voiceOwnerId)) {
          return { ...entry, voiceOwnerCastReference: references.get(entry.voiceOwnerId)! };
        }
        if (entry.type === "ACTION") {
          const subjectCastReference = references.get(entry.subjectId);
          const objectCastReference = entry.objectId ? references.get(entry.objectId) : undefined;
          return {
            ...entry,
            ...(subjectCastReference ? { subjectCastReference } : {}),
            ...(objectCastReference ? { objectCastReference } : {}),
          };
        }
        return entry;
      });
      return { ...scene, entries, castReferences: [...references.values()] };
    });
    const scriptScope = {
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      actorUserId: input.actorUserId,
      requireCurrentFrozenStoryVersion: true,
    };
    const scriptService = new AiStoryScriptAuthorityService(db);
    const successorScript = buildAiStoryScriptVersion({
      storyId: frozenAuthority.frozenScript.storyId,
      storyVersionId: frozenAuthority.frozenScript.storyVersionId,
      outlineVersionId: frozenAuthority.frozenScript.outlineVersionId,
      orgId: frozenAuthority.frozenScript.orgId,
      workspaceId: frozenAuthority.frozenScript.workspaceId,
      version: frozenAuthority.frozenScript.version + 1,
      profileId: frozenAuthority.frozenScript.profileId,
      profileVersion: frozenAuthority.frozenScript.profileVersion,
      outlineSourceHash: frozenAuthority.frozenScript.outlineSourceHash,
      semanticInputFingerprint: frozenAuthority.frozenScript.semanticInputFingerprint,
      scenes,
      authorityReferences: frozenAuthority.frozenScript.authorityReferences,
      supersedesScriptVersionId: frozenAuthority.frozenScript.scriptVersionId,
      createdBy: input.actorUserId,
      createdAt: new Date().toISOString(),
    });
    await scriptService.propose(scriptScope, successorScript);
    await scriptService.validate(scriptScope, successorScript.scriptVersionId);
    await scriptService.approve(scriptScope, successorScript.scriptVersionId);
    await scriptService.freeze(scriptScope, successorScript.scriptVersionId);
    frozenAuthority = await resolveFrozenSuccessorAuthority(db, input);
  }
  const scriptByOrder = new Map(frozenAuthority.frozenScript.scenes.map((scene) => [scene.order, scene] as const));
  const changes: { sceneId: string; from: AiStorySceneCastDirection | null; to: AiStorySceneCastDirection }[] = [];
  const castScenePlan = source.scenePlan.map((scene) => {
    const request = requested.get(scene.id);
    if (!request) return scene;
    const script = scriptByOrder.get(scene.order);
    const allowed = new Map((script?.castReferences ?? []).map((cast) => [cast.id, cast] as const));
    for (const characterId of script?.characterIds ?? []) {
      if (allowed.has(characterId)) continue;
      const reference = frozenAuthority.frozenScript.authorityReferences.find((candidate) => candidate.authorityType === "CHARACTER" && candidate.authorityId === characterId);
      if (reference?.authorityVersionId && reference.authorityFingerprint) {
        allowed.set(characterId, {
          scope: "CAMPAIGN_CHARACTER",
          id: characterId,
          campaignId: input.campaignId,
          authorityVersionId: reference.authorityVersionId,
          authorityFingerprint: reference.authorityFingerprint,
          visualIdentityRequirement: "PREFERRED",
        });
      }
    }
    if (!script || request.participants.some((participant) => !allowed.has(participant.castId))) {
      throw new AiStoryGenerationStrategyRecoveryError("SCENE_CAST_SUCCESSOR_AUTHORITY_INVALID", `Scene ${scene.id} references Cast outside frozen Script authority`);
    }
    const direction = AiStorySceneCastDirectionSchema.parse({
      mode: request.mode,
      participants: request.participants.map((participant) => ({
        cast: allowed.get(participant.castId)!,
        presence: participant.presence,
        visualRole: participant.visualRole,
      })),
      genericExtras: request.genericExtras,
    });
    if (JSON.stringify(scene.castDirection ?? null) !== JSON.stringify(direction)) {
      changes.push({ sceneId: scene.id, from: scene.castDirection ?? null, to: direction });
    }
    return { ...scene, castDirection: direction };
  });
  if (changes.length === 0) {
    throw new AiStoryGenerationStrategyRecoveryError("SCENE_CAST_SUCCESSOR_NO_CHANGE", "Requested Scene cast decisions match the current Planning revision");
  }
  const semanticAncestor = await resolvePlanningSemanticAncestor(sourceRow, loadPackage);
  const scenePlan = recoverScenePlanGenerationAuthorities(castScenePlan, frozenAuthority);
  const shotPlanBase = bindProductShotCameraSafety({ scenePlan, shotPlan: source.shotPlan });
  const castRecovery = {
    contractVersion: "ai-story-scene-cast-successor.v1" as const,
    supersedesAnimationPackageId: sourceRow.id,
    changes,
    authorizedBy: input.actorUserId,
    externalAiCalls: 0 as const,
  };
  const draftRow = await savePlanningDraft(db, {
    ...input,
    payload: StoryPlanningDraftSchema.parse({
      kind: "planning_draft",
      completedStages: ["creative_context", "director_thinking", "story_beats", "scene_plan", "shot_plan", "character_continuity", "world_continuity"],
      story: source.story,
      creativeContext: source.creativeContext,
      directorThinking: source.directorThinking,
      storyBeats: source.storyBeats,
      scenePlan,
      shotPlan: shotPlanBase,
      characterContinuity: source.characterContinuity,
      worldContinuity: source.worldContinuity,
      episodeContinuity: source.episodeContinuity,
      usage: source.usage,
      castRecovery,
    }),
  });
  const shotPlan = shotPlanBase.map((shot) => {
    if (!shot.authorityLineage) return shot;
    const scene = scenePlan.find((item) => item.id === shot.sceneId);
    return scene?.generationAuthority
      ? { ...shot, authorityLineage: { ...shot.authorityLineage, planningPackageId: draftRow.id, generationAuthority: scene.generationAuthority } }
      : shot;
  });
  const canonicalScenes = await ensureCurrentFrozenCanonicalSceneSet({
    db,
    ...input,
    story: source.story,
    storyBeats: source.storyBeats,
    scenePlan,
    priorScenePlanForStrategySuccessor: semanticAncestor.scenePlan,
    allowAuthorizedDurationChanges: semanticAncestor.durationAdjusted,
    allowAuthorizedCastChanges: true,
    creativeContext: source.creativeContext,
    directorThinking: source.directorThinking,
    worldContinuity: source.worldContinuity,
    characterAuthorities: source.creativeContext.characterContext.characters.flatMap((character) => character.canonicalAuthority ? [character.canonicalAuthority] : []),
    ...(input.episodeIntent ? { episodeIntent: input.episodeIntent } : {}),
  });
  const successorPayload = AuthoritativeAnimationPackagePayloadSchema.parse({
    ...source,
    sourcePlanningPackageId: draftRow.id,
    scenePlan,
    shotPlan,
    canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({ storyId: input.storyId, storyVersionId: input.storyVersionId, scenePlan, canonicalScenes }),
    executionCapabilityAuthority: undefined,
    strategyRecovery: undefined,
    durationRecovery: undefined,
    castRecovery,
    status: "review",
  });
  const successor = await saveAnimationPackage(db, { ...input, payload: successorPayload });
  await db.update(schema.aiStoryAnimationPackages).set({
    status: "superseded",
    payload: AnimationPackagePayloadSchema.parse({ ...source, status: "superseded" }),
    updatedAt: new Date(),
  }).where(eq(schema.aiStoryAnimationPackages.id, sourceRow.id));
  return { sourcePackageId: sourceRow.id, planningDraftId: draftRow.id, animationPackage: successor, changes, externalAiCalls: 0 as const };
}

export async function approveAnimationPackage(
  db: Db,
  input: {
    packageId: string;
    orgId: string;
    campaignId: string;
    storyId: string;
    workspaceId: string;
    approvedBy: string;
    executionCapabilityAuthority: AiStoryExecutionCapabilityAuthority;
    expectedProductMaterialFingerprint?: string;
  }
) {
  const [preflightCandidate] = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.id, input.packageId),
        eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (!preflightCandidate) throw new Error("Animation Package not found");
  const canonicalScenes = await resolveCurrentFrozenCanonicalSceneSet(db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: preflightCandidate.storyVersionId,
  });
  if (!canonicalScenes) {
    throw new ApprovedAnimationPackageAuthorityError(
      "CURRENT_FROZEN_SCENE_SET_REQUIRED",
      "Animation Package approval requires the current FROZEN Canonical Scene set"
    );
  }
  if (!isStoryPlanningDraft(preflightCandidate.payload)) {
    const payload = AuthoritativeAnimationPackagePayloadSchema.parse(preflightCandidate.payload);
    assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({
      storyId: input.storyId,
      storyVersionId: preflightCandidate.storyVersionId,
      scenePlan: payload.scenePlan,
      canonicalScenes,
      authority: payload.canonicalSceneAuthority,
    });
    const productMaterial = await revalidatePlanningProductMaterialAuthority({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: preflightCandidate.storyVersionId,
      actorUserId: input.approvedBy,
      canonicalScenes,
    });
    if (
      input.expectedProductMaterialFingerprint
      && productMaterial.fingerprint !== input.expectedProductMaterialFingerprint
    ) {
      throw new ApprovedAnimationPackageAuthorityError(
        "PLANNING_EXECUTION_AUTHORITY_STALE",
        "Validated product material authority changed during approval",
      );
    }
  }
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(schema.aiStoryAnimationPackages)
      .where(
        and(
          eq(schema.aiStoryAnimationPackages.id, input.packageId),
          eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
          eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
          eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
          eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId)
        )
      )
      .limit(1);
    if (!candidate) throw new Error("Animation Package not found");

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-story-package-approval:${input.storyId}:${candidate.storyVersionId}`}))`
    );

    const [story] = await tx
      .select()
      .from(schema.aiStories)
      .where(
        and(
          eq(schema.aiStories.id, input.storyId),
          eq(schema.aiStories.orgId, input.orgId),
          eq(schema.aiStories.workspaceId, input.workspaceId),
          eq(schema.aiStories.campaignId, input.campaignId)
        )
      )
      .limit(1)
      .for("update");
    if (!story) throw new Error("AI Story not found for Animation Package approval");
    if (story.currentVersionId !== candidate.storyVersionId) {
      throw new ApprovedAnimationPackageAuthorityError(
        "ANIMATION_PACKAGE_STORY_VERSION_NOT_CURRENT",
        "Animation Package does not belong to the current Story Version"
      );
    }

    const packages = await tx
      .select()
      .from(schema.aiStoryAnimationPackages)
      .where(
        and(
          eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
          eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
          eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
          eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
          eq(schema.aiStoryAnimationPackages.storyVersionId, candidate.storyVersionId)
        )
      )
      .for("update");
    const current = packages.find((row) => row.id === input.packageId);
    if (!current) throw new Error("Animation Package changed during approval");
    const approved = packages.filter((row) => row.status === "ready_for_execution");
    if (approved.length > 1) {
      throw new ApprovedAnimationPackageAuthorityError(
        "CURRENT_APPROVED_ANIMATION_PACKAGE_AUTHORITY_AMBIGUOUS",
        "Approved Animation Package authority is ambiguous for this Story Version"
      );
    }
    const existingApproved = approved[0];
    if (existingApproved && existingApproved.id !== current.id) {
      throw new ApprovedAnimationPackageAuthorityError(
        "ANIMATION_PACKAGE_ALREADY_APPROVED_FOR_STORY_VERSION",
        "Another Animation Package is already approved for this Story Version"
      );
    }

    if (current.status === "ready_for_execution") {
      const approvedPayload = AuthoritativeAnimationPackagePayloadSchema.parse(current.payload);
      assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({
        storyId: input.storyId,
        storyVersionId: current.storyVersionId,
        scenePlan: approvedPayload.scenePlan,
        canonicalScenes,
        authority: approvedPayload.canonicalSceneAuthority,
      });
      if (
        approvedPayload.status !== "ready_for_execution" ||
        !current.approvedAt ||
        !current.approvedBy
      ) {
        throw new ApprovedAnimationPackageAuthorityError(
          "ANIMATION_PACKAGE_APPROVAL_STATE_MISMATCH",
          "Animation Package row and payload approval states disagree"
        );
      }
      if (
        !approvedPayload.executionCapabilityAuthority ||
        approvedPayload.executionCapabilityAuthority.capabilityFingerprint !==
          input.executionCapabilityAuthority.capabilityFingerprint
      ) {
        throw new ApprovedAnimationPackageAuthorityError(
          "ANIMATION_PACKAGE_EXECUTION_CAPABILITY_MISMATCH",
          "Approved Animation Package is bound to different execution capability evidence"
        );
      }
      return current;
    }
    if (isStoryPlanningDraft(current.payload)) {
      throw new Error("Planning draft is incomplete — assemble Animation Package first");
    }
    const payload = AuthoritativeAnimationPackagePayloadSchema.parse(current.payload);
    assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({
      storyId: input.storyId,
      storyVersionId: current.storyVersionId,
      scenePlan: payload.scenePlan,
      canonicalScenes,
      authority: payload.canonicalSceneAuthority,
    });
    if (payload.status === "ready_for_execution") {
      throw new ApprovedAnimationPackageAuthorityError(
        "ANIMATION_PACKAGE_APPROVAL_STATE_MISMATCH",
        "Animation Package row and payload approval states disagree"
      );
    }
    assertFreshExecutionCapabilityAuthority(
      input.executionCapabilityAuthority,
      payload.scenePlan,
    );
    const approvedPayload: AnimationPackagePayload = {
      ...payload,
      status: "ready_for_execution",
      executionCapabilityAuthority: input.executionCapabilityAuthority,
    };
    const now = new Date();
    const [updated] = await tx
      .update(schema.aiStoryAnimationPackages)
      .set({
        status: "ready_for_execution",
        payload: approvedPayload,
        approvedAt: now,
        approvedBy: input.approvedBy,
        updatedAt: now,
      })
      .where(eq(schema.aiStoryAnimationPackages.id, current.id))
      .returning();
    if (!updated) throw new Error("Failed to approve Animation Package");
    return updated;
  });
}

export type ApprovedAnimationPackageRevisionInput = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly expectedStoryVersionId: string;
  readonly expectedAnimationPackageId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly reason: string;
  readonly payload: AnimationPackagePayload;
  readonly now?: Date;
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertRetainedItems<T extends { readonly id: string }>(
  label: string,
  previous: readonly T[],
  next: readonly T[]
): void {
  if (next.length !== previous.length + 1) {
    throw new Error(`Approved Animation Package revision must append exactly one ${label}`);
  }
  for (const item of previous) {
    const retained = next.find((candidate) => candidate.id === item.id);
    if (!retained || !sameJson(retained, item)) {
      throw new Error(`Approved Animation Package revision changed retained ${label} ${item.id}`);
    }
  }
}

/**
 * Validate a bounded revision of an already-approved Animation Package.
 * Existing Scene and Story reference authority is immutable; exactly one
 * explicit reference-free T2V Scene may be appended.
 */
export function validateApprovedAnimationPackageRevision(
  previousRaw: unknown,
  nextRaw: unknown
): AnimationPackagePayload {
  const previous = AnimationPackagePayloadSchema.parse(previousRaw);
  const next = AnimationPackagePayloadSchema.parse(nextRaw);
  if (!sameJson(previous.story.assetReferences, next.story.assetReferences)) {
    throw new Error("Approved Animation Package revision cannot change Story asset references");
  }
  for (const [label, before, after] of [
    ["Story", previous.story, next.story],
    ["Characters", previous.characters, next.characters],
    ["Creative Context", previous.creativeContext, next.creativeContext],
    ["Director Thinking", previous.directorThinking, next.directorThinking],
    ["Character Continuity", previous.characterContinuity, next.characterContinuity],
    ["World Continuity", previous.worldContinuity, next.worldContinuity],
  ] as const) {
    if (!sameJson(before, after)) {
      throw new Error(`Approved Animation Package revision changed retained ${label}`);
    }
  }
  assertRetainedItems("Story Beat", previous.storyBeats, next.storyBeats);
  assertRetainedItems("Scene", previous.scenePlan, next.scenePlan);
  assertRetainedItems("Shot", previous.shotPlan, next.shotPlan);
  const previousSceneIds = new Set(previous.scenePlan.map((scene) => scene.id));
  const additions = next.scenePlan.filter((scene) => !previousSceneIds.has(scene.id));
  const added = additions[0];
  if (additions.length !== 1 || !added) {
    throw new Error("Approved Animation Package revision requires one new Scene identity");
  }
  if (
    added.generationAuthority?.strategy !== "TEXT_TO_VIDEO" ||
    added.generationAuthority.referenceSource !== "REFERENCE_FREE_T2V" ||
    added.generationAuthority.referenceAssetIds.length !== 0 ||
    added.generationAuthority.firstFrameAssetId !== null ||
    added.generationAuthority.productVisualIdentityRequirement !== "NONE"
  ) {
    throw new Error("New certification Scene must be explicitly reference-free TEXT_TO_VIDEO");
  }
  const addedBeatIds = new Set(
    next.storyBeats
      .filter((beat) => !previous.storyBeats.some((prior) => prior.id === beat.id))
      .map((beat) => beat.id)
  );
  const addedShots = next.shotPlan.filter(
    (shot) => !previous.shotPlan.some((prior) => prior.id === shot.id)
  );
  if (
    added.beatIds.length !== 1 ||
    !addedBeatIds.has(added.beatIds[0] ?? "") ||
    addedShots.length !== 1 ||
    addedShots[0]?.sceneId !== added.id
  ) {
    throw new Error("New certification Scene must own exactly one new Story Beat and Shot");
  }
  return next;
}

/**
 * Atomically evolve a frozen Story + approved Animation Package without
 * rewriting historical authority or changing the Story lifecycle state.
 */
export async function createApprovedAnimationPackageRevision(
  db: Db,
  input: ApprovedAnimationPackageRevisionInput
) {
  const requestedPayload = AnimationPackagePayloadSchema.parse(input.payload);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-story-package-revision:${input.storyId}`}))`
    );
    const [story] = await tx
      .select()
      .from(schema.aiStories)
      .where(eq(schema.aiStories.id, input.storyId))
      .limit(1)
      .for("update");
    if (
      !story ||
      story.orgId !== input.orgId ||
      story.workspaceId !== input.workspaceId ||
      story.campaignId !== input.campaignId
    ) {
      throw new Error("Story revision scope is not authorized");
    }
    if (!["ready_for_execution", "generate_review"].includes(story.status)) {
      throw new Error("Story must have approved execution authority before package revision");
    }
    const [membership] = await tx
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, input.workspaceId),
          eq(schema.workspaceMembers.userId, input.actorUserId)
        )
      )
      .limit(1);
    if (!membership || !["admin", "operator", "editor", "reviewer"].includes(membership.role)) {
      throw new Error("Story revision actor lacks planning mutation authority");
    }
    const versions = await tx
      .select()
      .from(schema.aiStoryVersions)
      .where(eq(schema.aiStoryVersions.storyId, input.storyId))
      .orderBy(desc(schema.aiStoryVersions.versionNumber));
    const existingRevision = versions.find(
      (version) => version.sourceContextSnapshot?.correlationId === input.correlationId
    );
    if (existingRevision) {
      const [existingPackage] = await tx
        .select()
        .from(schema.aiStoryAnimationPackages)
        .where(
          and(
            eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
            eq(schema.aiStoryAnimationPackages.storyVersionId, existingRevision.id)
          )
        )
        .limit(1);
      if (!existingPackage || existingPackage.status !== "ready_for_execution") {
        throw new Error("Existing correlated Story revision is incomplete");
      }
      if (story.currentVersionId !== existingRevision.id) {
        throw new Error("Existing correlated Story revision is no longer current");
      }
      const existingPayload = AnimationPackagePayloadSchema.parse(existingPackage.payload);
      if (
        !sameJson(existingPayload.story.assetReferences, requestedPayload.story.assetReferences) ||
        !sameJson(existingPayload.storyBeats, requestedPayload.storyBeats) ||
        !sameJson(existingPayload.scenePlan, requestedPayload.scenePlan) ||
        !sameJson(existingPayload.shotPlan, requestedPayload.shotPlan)
      ) {
        throw new Error("Existing correlated Story revision does not match requested authority");
      }
      return { version: existingRevision, animationPackage: existingPackage, idempotent: true };
    }
    if (story.currentVersionId !== input.expectedStoryVersionId) {
      throw new Error("Story current version changed before package revision");
    }
    const previousVersion = versions.find(
      (version) => version.id === input.expectedStoryVersionId
    );
    if (!previousVersion?.frozenAt) {
      throw new Error("Previous Story version must be frozen");
    }
    const [previousPackage] = await tx
      .select()
      .from(schema.aiStoryAnimationPackages)
      .where(
        and(
          eq(schema.aiStoryAnimationPackages.id, input.expectedAnimationPackageId),
          eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
          eq(schema.aiStoryAnimationPackages.storyVersionId, input.expectedStoryVersionId),
          eq(schema.aiStoryAnimationPackages.status, "ready_for_execution")
        )
      )
      .limit(1)
      .for("share");
    if (!previousPackage) {
      throw new Error("Previous approved Animation Package is not current");
    }
    const payload = validateApprovedAnimationPackageRevision(
      previousPackage.payload,
      requestedPayload
    );
    const consistencyReport = validatePlanningConsistency(payload);
    if (!consistencyReport.consistent) {
      throw new Error(
        `Animation Package revision is inconsistent: ${consistencyReport.issues.join("; ")}`
      );
    }
    const versionId = randomUUID();
    const animationPackageId = randomUUID();
    const versionNumber = Math.max(...versions.map((version) => version.versionNumber)) + 1;
    const [version] = await tx
      .insert(schema.aiStoryVersions)
      .values({
        id: versionId,
        storyId: input.storyId,
        versionNumber,
        structuredContent: previousVersion.structuredContent,
        sourceContextSnapshot: {
          ...previousVersion.sourceContextSnapshot,
          action: "approved_animation_package_revision",
          correlationId: input.correlationId,
          reason: input.reason,
          supersedesStoryVersionId: previousVersion.id,
          supersedesAnimationPackageId: previousPackage.id,
        },
        aiMetadata: {
          externalAiCalls: 0,
          generatedBy: "CANONICAL_APPROVED_PACKAGE_REVISION",
        },
        userEdited: true,
        createdBy: input.actorUserId,
        createdAt: now,
        frozenAt: now,
        frozenBy: input.actorUserId,
      })
      .returning();
    if (!version) throw new Error("Failed to persist revised frozen Story version");
    const approvedPayload: AnimationPackagePayload = {
      ...payload,
      narrativeIntegration: consistencyReport,
      status: "ready_for_execution",
    };
    const [animationPackage] = await tx
      .insert(schema.aiStoryAnimationPackages)
      .values({
        id: animationPackageId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        storyId: input.storyId,
        storyVersionId: version.id,
        status: "ready_for_execution",
        payload: approvedPayload,
        consistencyReport,
        createdAt: now,
        updatedAt: now,
        approvedAt: now,
        approvedBy: input.actorUserId,
      })
      .returning();
    if (!animationPackage) throw new Error("Failed to persist revised Animation Package");
    const [updatedStory] = await tx
      .update(schema.aiStories)
      .set({ currentVersionId: version.id, updatedAt: now })
      .where(
        and(
          eq(schema.aiStories.id, input.storyId),
          eq(schema.aiStories.currentVersionId, input.expectedStoryVersionId)
        )
      )
      .returning({ id: schema.aiStories.id });
    if (!updatedStory) throw new Error("Story current version changed during package revision");
    return { version, animationPackage, idempotent: false };
  });
}
