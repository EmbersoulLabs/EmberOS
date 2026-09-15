import { z } from "zod";
import {
  PlanningCharacterAuthorityProjectionSchema,
  ScenePlanItemSchema,
  StoryBeatSchema,
} from "./ai-story";
import { buildCanonicalOutlineBeatBasis } from "./ai-story-outline-beat-promotion.server";
import { AiStoryOutlineVersionSchema } from "./ai-story-outline";
import {
  AiStoryScriptAuthorityReferenceSchema,
  AiStoryScriptSceneSchema,
  type AiStoryScriptVersion,
} from "./ai-story-script";
import {
  AiStoryScriptSemanticProposalV1Schema,
  type AiStoryScriptSemanticProposalV1,
} from "./ai-story-script-semantic-writer";
import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";

export const AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY_V1 = Object.freeze({
  policyId: "AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY",
  policyVersion: 1,
  contractVersion: "ai-story-script-semantic-promotion.v1",
  durationPolicy: "EXACT_SCENE_DURATION_EQUAL_ENTRY_SHARES_WITH_FINAL_RESIDUAL",
  locationPolicy: "NONE_UNLESS_CANONICAL_AUTHORITY_SUPPLIED",
  propPolicy: "NONE_UNLESS_CANONICAL_AUTHORITY_SUPPLIED",
  assetPolicy: "NONE_UNLESS_CANONICAL_AUTHORITY_SUPPLIED",
  evidencePolicy: "EMPTY_WITHOUT_CANONICAL_CLAIM_AUTHORITY",
} as const);

export class AiStoryScriptSemanticPromotionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryScriptSemanticPromotionError";
  }
}

const InputSchema = z.object({
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  frozenOutline: AiStoryOutlineVersionSchema,
  storyBeatProposals: z.array(StoryBeatSchema.strict()).min(1),
  scenePlan: z.array(ScenePlanItemSchema.strict()).min(1),
  characterAuthorities: z.array(PlanningCharacterAuthorityProjectionSchema),
  semanticProposal: AiStoryScriptSemanticProposalV1Schema,
}).strict();

type PromotedScriptScene = AiStoryScriptVersion["scenes"][number];
type ScriptAuthorityReference = z.infer<typeof AiStoryScriptAuthorityReferenceSchema>;

export type PromoteAiStoryScriptSemanticProposalV1Input = {
  storyId: string;
  storyVersionId: string;
  frozenOutline: z.input<typeof AiStoryOutlineVersionSchema>;
  storyBeatProposals: z.input<typeof StoryBeatSchema>[];
  scenePlan: z.input<typeof ScenePlanItemSchema>[];
  characterAuthorities: z.input<typeof PlanningCharacterAuthorityProjectionSchema>[];
  semanticProposal: AiStoryScriptSemanticProposalV1;
};

export type PromotedAiStoryScriptSemanticMaterialV1 = {
  scenes: PromotedScriptScene[];
  authorityReferences: ScriptAuthorityReference[];
};

const canonical = (value: unknown) => sha256CanonicalIntegrityHash(value);
const unique = (values: readonly string[]) => [...new Set(values)];

function fail(code: string, message: string): never {
  throw new AiStoryScriptSemanticPromotionError(code, message);
}

function exactEntryDurations(duration: number, count: number) {
  const share = duration / count;
  let allocated = 0;
  return Array.from({ length: count }, (_, index) => {
    const seconds = index === count - 1 ? duration - allocated : share;
    allocated += seconds;
    if (!(seconds > 0)) fail("CANONICAL_SCRIPT_ENTRY_DURATION_INVALID", "Entry duration allocation must remain positive");
    return { minSeconds: seconds, maxSeconds: seconds };
  });
}

function contributionType(semanticFunction: string) {
  const values: Record<string, "NEW_PRODUCT_INFORMATION" | "NEW_PRODUCT_RELATIONSHIP" | "NEW_PRODUCT_EVIDENCE" | "NEW_PRODUCT_CONTEXT"> = {
    PRODUCT_INTRODUCTION: "NEW_PRODUCT_INFORMATION",
    PRODUCT_DETAIL_REVEAL: "NEW_PRODUCT_INFORMATION",
    PRODUCT_RELATIONSHIP: "NEW_PRODUCT_RELATIONSHIP",
    PRODUCT_EVIDENCE: "NEW_PRODUCT_EVIDENCE",
    PRODUCT_CONTEXT: "NEW_PRODUCT_CONTEXT",
  };
  return values[semanticFunction] ?? fail("PRODUCT_STORY_FUNCTION_UNSUPPORTED", `Unsupported Product progression function ${semanticFunction}`);
}

function assertStateContinuity(scenes: readonly PromotedScriptScene[]) {
  const key = (fact: { dimension: string; subjectId: string }) => `${fact.dimension}:${fact.subjectId}`;
  for (const scene of scenes) {
    const stateIn = new Map(scene.sceneStateIn.map((fact) => [key(fact), fact.value]));
    const stateOut = new Map(scene.sceneStateOut.map((fact) => [key(fact), fact.value]));
    for (const delta of scene.sceneStateDeltas) {
      if (delta.fromValue !== null && stateIn.get(key(delta)) !== delta.fromValue) {
        fail("CANONICAL_SCRIPT_STATE_CONTRADICTION", `State precondition is false for Scene ${scene.scriptSceneId}`);
      }
      if (stateOut.get(key(delta)) !== delta.value) {
        fail("CANONICAL_SCRIPT_STATE_CONTRADICTION", `State delta is absent from Scene state-out ${scene.scriptSceneId}`);
      }
    }
  }
  for (let index = 0; index < scenes.length - 1; index++) {
    const prior = new Map(scenes[index]!.sceneStateOut.map((fact) => [key(fact), fact.value]));
    for (const next of scenes[index + 1]!.sceneStateIn) {
      if (prior.has(key(next)) && prior.get(key(next)) !== next.value) {
        fail("CANONICAL_SCRIPT_STATE_CONTRADICTION", `Unexplained state reset before Scene ${scenes[index + 1]!.scriptSceneId}`);
      }
    }
  }
}

/** Pure server authority boundary from model proposal to canonical Script material. */
export function promoteAiStoryScriptSemanticProposalV1(
  rawInput: PromoteAiStoryScriptSemanticProposalV1Input,
): PromotedAiStoryScriptSemanticMaterialV1 {
  const input = InputSchema.parse(rawInput);
  const outline = input.frozenOutline;
  if (outline.status !== "FROZEN" || outline.storyId !== input.storyId || outline.storyVersionId !== input.storyVersionId) {
    fail("CANONICAL_SCRIPT_OUTLINE_AUTHORITY_INVALID", "Promotion requires the exact frozen Outline authority");
  }
  if (new Set(input.storyBeatProposals.map((beat) => beat.id)).size !== input.storyBeatProposals.length) {
    fail("CANONICAL_SCRIPT_BEAT_PROPOSAL_ID_AMBIGUOUS", "Story Beat proposal IDs must be unique transport identities");
  }
  input.scenePlan.forEach((scene, index) => {
    if (scene.order !== index) fail("CANONICAL_SCRIPT_SCENE_PLAN_ORDER_INVALID", "Scene Plan order must be contiguous from zero");
  });
  if (new Set(input.scenePlan.map((scene) => scene.id)).size !== input.scenePlan.length) {
    fail("CANONICAL_SCRIPT_SCENE_PLAN_ID_AMBIGUOUS", "Scene Plan proposal IDs must be unique");
  }

  const canonicalBeatBasis = buildCanonicalOutlineBeatBasis({
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    profile: outline.profile,
    proposedStoryBeats: input.storyBeatProposals,
  });
  if (canonical(canonicalBeatBasis) !== canonical(outline.beats)) {
    fail("CANONICAL_SCRIPT_OUTLINE_BEAT_BASIS_MISMATCH", "Persisted Story Beat proposals do not reproduce the frozen Outline Beat authority");
  }
  const proposalBeatToCanonical = new Map(
    input.storyBeatProposals.map((beat, index) => [beat.id, canonicalBeatBasis[index]!.id]),
  );
  const proposalScenes = new Map(input.semanticProposal.scenes.map((scene) => [scene.scenePlanItemId, scene]));
  if (proposalScenes.size !== input.semanticProposal.scenes.length || proposalScenes.size !== input.scenePlan.length) {
    fail("CANONICAL_SCRIPT_PROPOSAL_SCENE_COVERAGE_INVALID", "Semantic proposal must cover every Scene Plan item exactly once");
  }
  for (const scene of input.semanticProposal.scenes) {
    if (!input.scenePlan.some((item) => item.id === scene.scenePlanItemId)) {
      fail("CANONICAL_SCRIPT_PROPOSAL_SCENE_COVERAGE_INVALID", `Unknown proposal Scene ${scene.scenePlanItemId}`);
    }
  }

  const canonicalClaimsByScene = new Map<string, string[]>();
  const claimCounts = new Map<string, number>();
  for (const scene of input.scenePlan) {
    const claims = scene.beatIds.map((id) => proposalBeatToCanonical.get(id) ?? fail("CANONICAL_SCRIPT_BEAT_REFERENCE_INVALID", `Unknown Story Beat proposal ${id}`));
    if (new Set(claims).size !== claims.length) fail("CANONICAL_SCRIPT_BEAT_REFERENCE_DUPLICATE", `Scene ${scene.id} repeats a Beat claim`);
    canonicalClaimsByScene.set(scene.id, claims);
    for (const id of claims) claimCounts.set(id, (claimCounts.get(id) ?? 0) + 1);
  }
  for (const beat of outline.beats.filter((value) => value.required)) {
    if (claimCounts.get(beat.id) !== 1) fail("CANONICAL_SCRIPT_EXCLUSIVE_BEAT_CLAIM_INVALID", `Required Beat ${beat.id} must be claimed exactly once`);
  }

  const characterMap = new Map(input.characterAuthorities.map((item) => [item.characterId, item]));
  if (characterMap.size !== input.characterAuthorities.length) fail("CANONICAL_SCRIPT_CHARACTER_AUTHORITY_AMBIGUOUS", "Character authority IDs must be unique");
  const productPolicy = outline.productStoryProfile;
  const productIds = new Set(productPolicy?.productAuthorityIds ?? []);
  const outlineCharacters = new Map(outline.authorityReferences.filter((ref) => ref.authorityType === "CHARACTER").map((ref) => [ref.authorityId, ref]));
  for (const authority of characterMap.values()) {
    const source = outlineCharacters.get(authority.characterId);
    if (!source || source.authorityVersionId !== authority.characterVersionId || source.authorityFingerprint !== authority.characterFingerprint) {
      fail("CANONICAL_SCRIPT_CHARACTER_AUTHORITY_INVALID", `Character ${authority.characterId} does not bind the exact frozen Outline snapshot`);
    }
  }
  const outlineProducts = new Set(outline.authorityReferences.filter((ref) => ref.authorityType === "PRODUCT").map((ref) => ref.authorityId));
  for (const productId of productIds) {
    if (!outlineProducts.has(productId)) fail("CANONICAL_SCRIPT_PRODUCT_AUTHORITY_INVALID", `Product ${productId} is not bound by the frozen Outline`);
  }
  const allowedIds = new Set([...characterMap.keys(), ...productIds]);
  const outlineBeatById = new Map(outline.beats.map((beat) => [beat.id, beat]));

  const scenes = input.scenePlan.map((scenePlan) => {
    const proposal = proposalScenes.get(scenePlan.id) ?? fail("CANONICAL_SCRIPT_PROPOSAL_SCENE_COVERAGE_INVALID", `Missing proposal Scene ${scenePlan.id}`);
    const claimedBeatIds = canonicalClaimsByScene.get(scenePlan.id)!;
    const goals = (productPolicy?.progressionGoals ?? []).filter((goal) => goal.required && goal.beatIds.some((id) => claimedBeatIds.includes(id)));
    const directFunctions = new Set(goals.map((goal) => goal.semanticFunction).filter((value) => value === "PRODUCT_INTRODUCTION" || value === "PRODUCT_DETAIL_REVEAL"));
    if (!productPolicy?.claimEvidence.length && proposal.sceneFunction === "PRODUCT_BENEFIT_PROOF") {
      fail("CANONICAL_SCRIPT_UNSUPPORTED_PRODUCT_PROOF", "Product benefit proof requires canonical claim evidence");
    }
    if (directFunctions.has("PRODUCT_INTRODUCTION") && proposal.sceneFunction !== "PRODUCT_INTRODUCTION") {
      fail("CANONICAL_SCRIPT_SCENE_FUNCTION_INCOMPATIBLE", "Product introduction Scene must use PRODUCT_INTRODUCTION");
    }
    if (!directFunctions.has("PRODUCT_INTRODUCTION") && directFunctions.has("PRODUCT_DETAIL_REVEAL") && proposal.sceneFunction !== "PRODUCT_DETAIL_REVEAL") {
      fail("CANONICAL_SCRIPT_SCENE_FUNCTION_INCOMPATIBLE", "Product detail Scene must use PRODUCT_DETAIL_REVEAL");
    }
    const usedCharacters = new Set<string>();
    const usedProducts = new Set<string>(goals.length ? productIds : []);
    const assertKnown = (id: string, role: string) => {
      if (!allowedIds.has(id)) fail("CANONICAL_SCRIPT_UNKNOWN_ENTITY_ID", `Unknown ${role} authority ${id}`);
    };
    for (const fact of [...proposal.sceneStateIn, ...proposal.sceneStateDeltas, ...proposal.sceneStateOut]) {
      assertKnown(fact.subjectId, "state subject");
      if (characterMap.has(fact.subjectId)) usedCharacters.add(fact.subjectId); else usedProducts.add(fact.subjectId);
    }
    for (const entry of proposal.entries) {
      if (entry.type === "DIALOGUE" || entry.type === "VO") {
        const speakerId = entry.type === "DIALOGUE" ? entry.speakerId : entry.voiceOwnerId;
        if (!characterMap.has(speakerId)) fail("CANONICAL_SCRIPT_CHARACTER_ID_REQUIRED", "Dialogue and VO require an exact Character authority ID");
        usedCharacters.add(speakerId);
      } else {
        assertKnown(entry.subjectId, "ACTION subject");
        if (characterMap.has(entry.subjectId)) usedCharacters.add(entry.subjectId); else usedProducts.add(entry.subjectId);
        if (entry.objectId) {
          assertKnown(entry.objectId, "ACTION object");
          if (characterMap.has(entry.objectId)) usedCharacters.add(entry.objectId); else usedProducts.add(entry.objectId);
        }
        if (entry.stateDelta && !proposal.sceneStateDeltas.some((delta) => canonical(delta) === canonical(entry.stateDelta))) {
          fail("CANONICAL_SCRIPT_STATE_DELTA_UNBOUND", "ACTION stateDelta must be present in the Scene state delta authority");
        }
      }
    }

    const contributions = goals.map((goal) => ({
      semanticFunction: goal.semanticFunction,
      contributionTypes: [contributionType(goal.semanticFunction)],
      productAuthorityIds: [...productIds].sort(),
      claimIds: [],
      summary: goal.intent,
    }));
    const sceneSemanticHash = canonical({
      policy: AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY_V1.contractVersion,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      outlineVersionId: outline.outlineVersionId,
      order: scenePlan.order,
      claimedBeatIds,
      proposal,
      contributions,
    });
    const scriptSceneId = deterministicUuidFromFingerprint("ai-story-script-scene", sceneSemanticHash);
    const durations = exactEntryDurations(scenePlan.durationSec, proposal.entries.length);
    const entries = proposal.entries.map((entry, order) => {
      const entryId = deterministicUuidFromFingerprint("ai-story-script-entry", canonical({
        policy: AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY_V1.contractVersion,
        storyId: input.storyId,
        storyVersionId: input.storyVersionId,
        outlineVersionId: outline.outlineVersionId,
        scriptSceneId,
        order,
        semanticEntry: entry,
      }));
      return { ...entry, entryId, order, durationRange: durations[order]! };
    });
    return AiStoryScriptSceneSchema.parse({
      scriptSceneId,
      order: scenePlan.order,
      outlineBeatClaims: claimedBeatIds.map((id) => ({ outlineBeatId: id, claim: outlineBeatById.get(id)!.purpose })),
      sceneFunction: proposal.sceneFunction,
      sceneFunctionRegistryVersion: proposal.sceneFunctionRegistryVersion,
      sceneStateIn: proposal.sceneStateIn,
      sceneStateDeltas: proposal.sceneStateDeltas,
      sceneStateOut: proposal.sceneStateOut,
      entries,
      characterIds: [...usedCharacters].sort(),
      locationIds: [],
      propIds: [],
      assetIds: [],
      productAuthorityRefs: [...usedProducts].sort(),
      targetDurationRange: { minSeconds: scenePlan.durationSec, maxSeconds: scenePlan.durationSec },
      mustKeep: [],
      mustAvoid: [],
      newInformation: proposal.newInformation,
      newEvidence: [],
      newActionOutcomes: proposal.newActionOutcomes,
      productEvidence: [],
      ...(contributions.length ? { productStoryContributions: contributions } : {}),
    });
  });
  assertStateContinuity(scenes);

  const usedCharacterIds = unique(scenes.flatMap((scene) => scene.characterIds)).sort();
  const usedProductIds = unique(scenes.flatMap((scene) => scene.productAuthorityRefs)).sort();
  const authorityReferences = [
    ...usedCharacterIds.map((id) => {
      const authority = characterMap.get(id)!;
      return AiStoryScriptAuthorityReferenceSchema.parse({
        authorityType: "CHARACTER",
        authorityId: id,
        authorityVersionId: authority.characterVersionId,
        authorityFingerprint: authority.characterFingerprint,
      });
    }),
    ...usedProductIds.map((id) => AiStoryScriptAuthorityReferenceSchema.parse({ authorityType: "PRODUCT", authorityId: id })),
  ];
  return { scenes, authorityReferences };
}
