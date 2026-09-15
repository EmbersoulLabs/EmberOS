import {
  AiStoryCanonicalSceneAuthorityService,
  resolveCurrentFrozenCanonicalSceneSet,
  resolveCurrentFrozenOutlineForStoryVersion,
  resolveCurrentFrozenScriptForStoryVersion,
  type AiStoryScriptScope,
  getDb,
} from "@ceo-agent/db";
import {
  type AiStoryCanonicalScene,
  type AiStoryOutlineVersion,
  type AiStoryScriptVersion,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type DirectorThinking,
  type PlanningCharacterAuthorityProjection,
  type ScenePlanItem,
  type StoryBeat,
  type WorldContinuity,
} from "@ceo-agent/shared";
import {
  composeAiStoryCanonicalSceneSetV1,
  computeAiStoryScriptSemanticInputFingerprint,
} from "@ceo-agent/shared/server";
import { resolveStoryProductSources } from "@/lib/ai-story-product-sources";

type Db = ReturnType<typeof getDb>;

export class AiStoryCanonicalSceneProducerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryCanonicalSceneProducerError";
  }
}

export type EnsureCurrentFrozenCanonicalSceneSetInput = {
  db: Db;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  actorUserId: string;
  story: AiStoryStructuredDraft;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  worldContinuity: WorldContinuity;
  characterAuthorities: PlanningCharacterAuthorityProjection[];
};

export type CanonicalSceneProducerDependencies = {
  resolveCurrentOutline: typeof resolveCurrentFrozenOutlineForStoryVersion;
  resolveCurrentScript: typeof resolveCurrentFrozenScriptForStoryVersion;
  resolveProducts: typeof resolveStoryProductSources;
  readCurrent: (db: Db, scope: AiStoryScriptScope) => Promise<AiStoryCanonicalScene[]>;
  compose: typeof composeAiStoryCanonicalSceneSetV1;
  propose: (db: Db, scope: AiStoryScriptScope, scenes: AiStoryCanonicalScene[]) => Promise<AiStoryCanonicalScene[]>;
  transition: (db: Db, scope: AiStoryScriptScope, to: "VALIDATED" | "APPROVED" | "FROZEN") => Promise<AiStoryCanonicalScene[]>;
  resolveFrozen: typeof resolveCurrentFrozenCanonicalSceneSet;
  now: () => string;
};

const defaultDependencies: CanonicalSceneProducerDependencies = {
  resolveCurrentOutline: resolveCurrentFrozenOutlineForStoryVersion,
  resolveCurrentScript: resolveCurrentFrozenScriptForStoryVersion,
  resolveProducts: resolveStoryProductSources,
  readCurrent: (db, scope) => new AiStoryCanonicalSceneAuthorityService(db).readCurrentSet(scope),
  compose: composeAiStoryCanonicalSceneSetV1,
  propose: (db, scope, scenes) => new AiStoryCanonicalSceneAuthorityService(db).proposeRevisionSet(scope, scenes),
  transition: (db, scope, to) => new AiStoryCanonicalSceneAuthorityService(db).transitionSet(scope, to),
  resolveFrozen: resolveCurrentFrozenCanonicalSceneSet,
  now: () => new Date().toISOString(),
};

async function advanceToFrozen(
  input: EnsureCurrentFrozenCanonicalSceneSetInput,
  scope: AiStoryScriptScope,
  initial: AiStoryCanonicalScene[],
  deps: CanonicalSceneProducerDependencies,
) {
  let current = initial;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (current.every((scene) => scene.status === "FROZEN")) return current;
    const statuses = new Set(current.map((scene) => scene.status));
    if (statuses.size !== 1) throw new AiStoryCanonicalSceneProducerError("CANONICAL_SCENE_SET_LIFECYCLE_AMBIGUOUS", "Scene lifecycle set is mixed");
    const status = current[0]?.status;
    if (status !== "DRAFT" && status !== "VALIDATED" && status !== "APPROVED") {
      throw new AiStoryCanonicalSceneProducerError("CANONICAL_SCENE_SET_LIFECYCLE_INVALID", "Scene lifecycle cannot advance");
    }
    const to = status === "DRAFT" ? "VALIDATED" : status === "VALIDATED" ? "APPROVED" : "FROZEN";
    try {
      current = await deps.transition(input.db, scope, to);
    } catch (error) {
      const refreshed = await deps.readCurrent(input.db, scope);
      if (!refreshed.length || refreshed[0]!.status === status) throw error;
      current = refreshed;
    }
  }
  throw new AiStoryCanonicalSceneProducerError("CANONICAL_SCENE_LIFECYCLE_DID_NOT_CONVERGE", "Canonical Scene lifecycle did not converge to FROZEN");
}

/** Ensures the exact current complete FROZEN Canonical Scene set without any model call. */
export async function ensureCurrentFrozenCanonicalSceneSet(
  input: EnsureCurrentFrozenCanonicalSceneSetInput,
  deps: CanonicalSceneProducerDependencies = defaultDependencies,
) {
  const authorityScope = {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
  };
  const outline = await deps.resolveCurrentOutline(input.db, authorityScope);
  if (!outline) throw new AiStoryCanonicalSceneProducerError("CURRENT_FROZEN_OUTLINE_REQUIRED", "Canonical Scene production requires the exact current FROZEN Outline");
  const script = await deps.resolveCurrentScript(input.db, authorityScope);
  if (!script) throw new AiStoryCanonicalSceneProducerError("CURRENT_FROZEN_SCRIPT_REQUIRED", "Canonical Scene production requires the exact current FROZEN Script");
  const productAuthorityIds = [...(outline.productStoryProfile?.productAuthorityIds ?? [])].sort();
  const semanticInputFingerprint = computeAiStoryScriptSemanticInputFingerprint({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    outlineVersionId: outline.outlineVersionId,
    outlineSourceHash: outline.sourceHash,
    story: input.story,
    storyBeats: input.storyBeats,
    scenePlan: input.scenePlan,
    creativeContext: input.creativeContext,
    directorThinking: input.directorThinking,
    characterAuthorities: input.characterAuthorities,
    productAuthorityIds,
  });
  if (!script.semanticInputFingerprint || script.semanticInputFingerprint !== semanticInputFingerprint) {
    throw new AiStoryCanonicalSceneProducerError("CANONICAL_SCENE_SCRIPT_PLANNING_INPUT_STALE", "Persisted planning semantics no longer match the current FROZEN Script");
  }
  const products = await deps.resolveProducts(input.db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
  });
  if (JSON.stringify(products.map((product) => product.assetId).sort()) !== JSON.stringify(productAuthorityIds)) {
    throw new AiStoryCanonicalSceneProducerError("CANONICAL_SCENE_PRODUCT_AUTHORITY_UNRESOLVED", "Current Product sources differ from the FROZEN Outline policy");
  }
  const scope: AiStoryScriptScope = { ...authorityScope, actorUserId: input.actorUserId, requireCurrentFrozenStoryVersion: true };
  const current = await deps.readCurrent(input.db, scope);
  const candidates = deps.compose({
    ...input,
    frozenOutline: outline,
    frozenScript: script,
    productSources: products,
    currentScenes: current,
    createdAt: deps.now(),
  });
  const sameSource = current.length > 0 && candidates.every((scene, index) => scene.sourceHash === current[index]?.sourceHash);
  let initial = current;
  if (!sameSource) {
    try {
      initial = await deps.propose(input.db, scope, candidates);
    } catch (error) {
      const refreshed = await deps.readCurrent(input.db, scope);
      const refreshedCandidates = refreshed.length ? deps.compose({
        ...input,
        frozenOutline: outline,
        frozenScript: script,
        productSources: products,
        currentScenes: refreshed,
        createdAt: deps.now(),
      }) : [];
      if (!refreshed.length || refreshedCandidates.length !== refreshed.length || !refreshedCandidates.every((scene, index) => scene.sourceHash === refreshed[index]?.sourceHash)) throw error;
      initial = refreshed;
    }
  }
  await advanceToFrozen(input, scope, initial, deps);
  const frozen = await deps.resolveFrozen(input.db, authorityScope);
  if (!frozen) throw new AiStoryCanonicalSceneProducerError("CURRENT_FROZEN_SCENE_SET_REQUIRED", "Canonical Scene lifecycle completed without resolvable FROZEN authority");
  return frozen;
}
