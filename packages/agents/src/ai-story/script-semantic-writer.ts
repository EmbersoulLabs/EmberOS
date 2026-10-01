import { callStructuredJsonModel } from "../llm";
import { z } from "zod";
import {
  AI_STORY_SCENE_FUNCTION_REGISTRY,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  carryForwardUnchangedScriptSceneState,
  detachOffScreenSuppliedDialogue,
  dropUnchangedPhysicalScriptChanges,
  AiStoryNarrativeFunctionSchema,
  AiStoryOutlineVersionSchema,
  AiStoryScriptSemanticProposalV1Schema,
  resolveOutlineBoundProductAuthorityIds,
  AiStoryStructuredDraftSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  PlanningCharacterAuthorityProjectionSchema,
  AiStoryEpisodeIntentAuthoritySchema,
  evaluateNativeDialogueIntent,
  ScenePlanItemSchema,
  StoryBeatSchema,
  type AiStoryOutlineVersion,
  type AiStoryScriptSemanticProposalV1,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type DirectorThinking,
  type AiStoryEpisodeIntentAuthority,
  type PlanningCharacterAuthorityProjection,
  type PlanningUsage,
  type ScenePlanItem,
  type StoryBeat,
} from "@ceo-agent/shared";
import { buildCanonicalOutlineBeatBasis } from "@ceo-agent/shared/server";

const ProviderText = z.string().trim().min(1);
const ProviderSceneFunction = z.enum(Object.keys(AI_STORY_SCENE_FUNCTION_REGISTRY) as [
  keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY,
  ...(keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY)[],
]);
const StateDimension = z.enum([
  "KNOWLEDGE", "POSSESSION", "RELATIONSHIP", "LOCATION", "COMMITMENT",
  "PHYSICAL_CONDITION", "OPTION_SET", "DEADLINE", "COST", "PRODUCT_STATE",
]);

function exactAuthorityIdSchema(ids: readonly string[], errorCode: string) {
  const values = [...new Set(ids)].sort();
  if (values.length === 0) throw new Error(errorCode);
  return z.enum(values as [string, ...string[]]);
}

export type AiStoryScriptSemanticProviderSchemaInput = {
  commercial: boolean;
  sceneCount: number;
  stateChangeAnchorSceneIndex: number | null;
  commercialIntegrationAnchorSceneIndex?: number | null;
  physicalCommercialParticipationRequired?: boolean;
  commercialAuthorityIds?: readonly string[];
  characterIds: readonly string[];
  productAuthorityIds: readonly string[];
};

export function resolveCommercialStateChangeAnchorSceneIndex(input: {
  frozenOutline: AiStoryOutlineVersion;
  storyBeats: readonly StoryBeat[];
  scenePlan: readonly ScenePlanItem[];
}): number {
  const outline = AiStoryOutlineVersionSchema.parse(input.frozenOutline);
  const storyBeats = StoryBeatSchema.array().min(1).parse(input.storyBeats);
  const scenePlan = ScenePlanItemSchema.array().min(1).parse(input.scenePlan);
  scenePlan.forEach((scene, index) => {
    if (scene.order !== index) throw new Error("CANONICAL_SCRIPT_SCENE_PLAN_ORDER_INVALID");
  });
  const entryPoint = outline.commercialStoryProfile?.commercialIntegration?.entryPoint;
  if (!entryPoint) throw new Error("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
  if (entryPoint.kind === "SCENE_ORDER") {
    const index = scenePlan.findIndex((scene) => scene.order === entryPoint.sceneOrder);
    if (index < 0) throw new Error("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
    return index;
  }
  const canonicalBeatBasis = buildCanonicalOutlineBeatBasis({
    storyId: outline.storyId,
    storyVersionId: outline.storyVersionId,
    profile: outline.profile,
    proposedStoryBeats: storyBeats,
  });
  if (canonicalBeatBasis.length !== outline.beats.length
    || canonicalBeatBasis.some((beat, index) => beat.id !== outline.beats[index]?.id)) {
    throw new Error("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
  }
  const beatIndex = canonicalBeatBasis.findIndex((beat) => beat.id === entryPoint.beatId);
  const proposalBeatId = storyBeats[beatIndex]?.id;
  if (beatIndex < 0 || !proposalBeatId) throw new Error("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
  const matchingScenes = scenePlan
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.beatIds.includes(proposalBeatId));
  if (matchingScenes.length !== 1) throw new Error("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
  return matchingScenes[0]!.index;
}

/** The frozen commercial entry point owns both integration and state-change placement. */
export const resolveCommercialIntegrationAnchorSceneIndex = resolveCommercialStateChangeAnchorSceneIndex;

export function buildAiStoryScriptSemanticProviderOutputSchema(input: AiStoryScriptSemanticProviderSchemaInput) {
  const { commercial, sceneCount, stateChangeAnchorSceneIndex } = input;
  const commercialIntegrationAnchorSceneIndex = input.commercialIntegrationAnchorSceneIndex
    ?? stateChangeAnchorSceneIndex;
  if (!Number.isSafeInteger(sceneCount) || sceneCount < 1) {
    throw new Error("SCRIPT_SEMANTIC_WRITER_SCENE_COUNT_INVALID");
  }
  if (commercial && (stateChangeAnchorSceneIndex === null
    || stateChangeAnchorSceneIndex < 0
    || stateChangeAnchorSceneIndex >= sceneCount)) {
    throw new Error("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
  }
  if (commercial && (commercialIntegrationAnchorSceneIndex === null
    || commercialIntegrationAnchorSceneIndex === undefined
    || commercialIntegrationAnchorSceneIndex < 0
    || commercialIntegrationAnchorSceneIndex >= sceneCount)) {
    throw new Error("SCRIPT_COMMERCIAL_INTEGRATION_ANCHOR_REQUIRED");
  }
  const characterId = input.characterIds.length
    ? exactAuthorityIdSchema(input.characterIds, "SCRIPT_SEMANTIC_WRITER_CHARACTER_AUTHORITY_REQUIRED")
    : null;
  const allowedEntityId = exactAuthorityIdSchema(
    [...input.characterIds, ...input.productAuthorityIds],
    "SCRIPT_SEMANTIC_WRITER_ENTITY_AUTHORITY_REQUIRED",
  );
  // A commercial Product may enter ACTION authority only at the frozen
  // integration anchor. Ordinary Scenes still require a visible action, but
  // their action identities are limited to canonical Characters so the model
  // cannot manufacture a second, contribution-free Product insertion.
  const ordinaryActionEntityId = commercial
    ? exactAuthorityIdSchema(input.characterIds, "SCRIPT_SEMANTIC_WRITER_CHARACTER_AUTHORITY_REQUIRED")
    : allowedEntityId;
  const anchorCommercialAuthorityIds = input.commercialAuthorityIds ?? input.productAuthorityIds;
  const commercialObjectId = input.physicalCommercialParticipationRequired
    ? exactAuthorityIdSchema(anchorCommercialAuthorityIds, "SCRIPT_SEMANTIC_WRITER_COMMERCIAL_AUTHORITY_REQUIRED")
    : null;
  const stateFact = z.object({
    dimension: StateDimension,
    subjectId: allowedEntityId,
    value: ProviderText.max(1000),
  }).strict();
  const stateDelta = stateFact.extend({
    fromValue: ProviderText.max(1000).nullable(),
    reason: ProviderText.max(1000),
  }).strict();
  const commercialProductStateDelta = commercialObjectId
    ? z.object({
        dimension: z.literal("PRODUCT_STATE"),
        subjectId: commercialObjectId,
        value: ProviderText.max(1000),
        fromValue: ProviderText.max(1000),
        reason: ProviderText.max(1000),
      }).strict()
    : null;
  const action = z.object({
    type: z.literal("ACTION"),
    subjectId: allowedEntityId,
    action: ProviderText.max(2000),
    objectId: allowedEntityId.nullable(),
    storyEffect: ProviderText.max(1000),
    stateDelta: stateDelta.nullable(),
  }).strict();
  const ordinaryAction = z.object({
    type: z.literal("ACTION"),
    subjectId: ordinaryActionEntityId,
    action: ProviderText.max(2000),
    objectId: ordinaryActionEntityId.nullable(),
    storyEffect: ProviderText.max(1000),
    stateDelta: stateDelta.nullable(),
  }).strict();
  const entriesFor = (actionSchema: typeof action | typeof ordinaryAction) => z.array(characterId
    ? z.discriminatedUnion("type", [
        actionSchema,
        z.object({
          type: z.literal("DIALOGUE"),
          speakerId: characterId,
          line: ProviderText.max(4000),
          deliveryOrSubtext: ProviderText.max(1000).nullable(),
          language: ProviderText.max(50),
        }).strict(),
        z.object({
          type: z.literal("VO"),
          voiceOwnerId: characterId,
          line: ProviderText.max(4000),
          narrativePurpose: ProviderText.max(1000),
          language: ProviderText.max(50),
        }).strict(),
      ])
    : actionSchema).min(1);
  const followingEntries = characterId
    ? z.array(z.discriminatedUnion("type", [
        z.object({
          type: z.literal("DIALOGUE"),
          speakerId: characterId,
          line: ProviderText.max(4000),
          deliveryOrSubtext: ProviderText.max(1000).nullable(),
          language: ProviderText.max(50),
        }).strict(),
        z.object({
          type: z.literal("VO"),
          voiceOwnerId: characterId,
          line: ProviderText.max(4000),
          narrativePurpose: ProviderText.max(1000),
          language: ProviderText.max(50),
        }).strict(),
      ]))
    : z.array(z.never());
  const sceneSchemas = Array.from({ length: sceneCount }, (_, index) => {
    const integrationAnchor = index === commercialIntegrationAnchorSceneIndex;
    const visibleAction = integrationAnchor && commercialObjectId
      ? action.extend({ objectId: commercialObjectId }).strict()
      : commercial ? ordinaryAction : action;
    const entries = entriesFor(action);
    return z.object({
      sceneFunction: ProviderSceneFunction,
      sceneFunctionRegistryVersion: z.literal(1),
      sceneStateIn: z.array(stateFact),
      sceneStateDeltas: index === stateChangeAnchorSceneIndex
        ? commercialProductStateDelta
          ? z.array(commercialProductStateDelta).length(1)
          : z.array(stateDelta).min(1)
        : z.array(stateDelta),
      sceneStateOut: z.array(stateFact),
      newInformation: z.array(ProviderText.max(1000)),
      newActionOutcomes: z.array(ProviderText.max(1000)),
      ...(commercial
        ? {
            visibleAction,
            followingEntries,
            narrativeFunction: AiStoryNarrativeFunctionSchema,
            storyConsequence: ProviderText.max(1000),
          }
        : {
            entries,
            narrativeFunction: AiStoryNarrativeFunctionSchema.nullable().optional(),
            storyConsequence: ProviderText.max(1000).nullable().optional(),
          }),
      causalPreconditions: z.array(ProviderText.max(1000)).nullable().optional(),
    }).strict();
  });
  const scenesByOrder = Object.fromEntries(
    sceneSchemas.map((schema, index) => [`scene_${index}`, schema]),
  ) as Record<string, z.ZodTypeAny>;
  return z.object({
    contractVersion: z.literal(AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION),
    scenesByOrder: z.object(scenesByOrder).strict(),
  }).strict();
}

const VISIBLE_ACTION_SCENE_FUNCTIONS = Object.entries(AI_STORY_SCENE_FUNCTION_REGISTRY)
  .filter(([, value]) => value.visibleActionRequired)
  .map(([name]) => name)
  .join(", ");

type ProviderEntry = { type: string; [key: string]: unknown };

function providerSceneEntries(scene: {
  entries?: unknown;
  visibleAction?: unknown;
  followingEntries?: unknown;
}): ProviderEntry[] {
  if (scene.visibleAction) {
    return [scene.visibleAction, ...((scene.followingEntries ?? []) as unknown[])] as ProviderEntry[];
  }
  return (scene.entries ?? []) as ProviderEntry[];
}

function canonicalizeProviderProposal(
  value: z.infer<ReturnType<typeof buildAiStoryScriptSemanticProviderOutputSchema>>,
  scenePlan: readonly ScenePlanItem[],
  frozenOutline: AiStoryOutlineVersion,
  commercialIntegrationAnchorSceneIndex: number | null,
): AiStoryScriptSemanticProposalV1 {
  const scenes = scenePlan.map((_, index) => value.scenesByOrder[`scene_${index}`]);
  if (scenes.some((scene) => !scene)) {
    throw new Error("SCRIPT_SEMANTIC_WRITER_SCENE_COUNT_INVALID");
  }
  return AiStoryScriptSemanticProposalV1Schema.parse({
    contractVersion: value.contractVersion,
    scenes: scenes.map((scene, index) => ({
      scenePlanItemId: scenePlan[index]!.id,
      sceneFunction: scene.sceneFunction,
      sceneFunctionRegistryVersion: scene.sceneFunctionRegistryVersion,
      sceneStateIn: scene.sceneStateIn,
      sceneStateDeltas: scene.sceneStateDeltas,
      sceneStateOut: scene.sceneStateOut,
      newInformation: scene.newInformation,
      newActionOutcomes: scene.newActionOutcomes,
      ...(scene.narrativeFunction ? { narrativeFunction: scene.narrativeFunction } : {}),
      ...(scene.causalPreconditions?.length ? { causalPreconditions: scene.causalPreconditions } : {}),
      ...(scene.storyConsequence ? { storyConsequence: scene.storyConsequence } : {}),
      ...(commercialIntegrationAnchorSceneIndex === index && frozenOutline.commercialStoryProfile?.commercialIntegration
        ? {
            commercialContribution: {
              commercialRole: frozenOutline.commercialStoryProfile.commercialRole,
              narrativeFunction: frozenOutline.commercialStoryProfile.commercialIntegration.narrativeFunction,
              participationKind: frozenOutline.commercialStoryProfile.commercialIntegration.commercialActionOrParticipation,
              commercialAuthorityIds: frozenOutline.commercialStoryProfile.commercialIntegration.commercialAuthorityRefs,
              preState: frozenOutline.commercialStoryProfile.commercialIntegration.preIntegrationState,
              postState: frozenOutline.commercialStoryProfile.commercialIntegration.postIntegrationState,
              storyConsequence: frozenOutline.commercialStoryProfile.commercialIntegration.storyConsequence,
            },
          }
        : {}),
      entries: providerSceneEntries(scene).map((entry, entryIndex) => {
        if (entry.type === "ACTION") {
          const { objectId, stateDelta, ...required } = entry;
          const serverBoundProductDelta = commercialIntegrationAnchorSceneIndex === index
            && entryIndex === 0
            && frozenOutline.commercialStoryProfile
            && ["PRODUCT", "OFFER"].includes(frozenOutline.commercialStoryProfile.commercialRole)
            ? scene.sceneStateDeltas[0]
            : null;
          return {
            ...required,
            ...(objectId ? { objectId } : {}),
            ...(serverBoundProductDelta
              ? { stateDelta: serverBoundProductDelta }
              : stateDelta ? { stateDelta } : {}),
          };
        }
        if (entry.type === "DIALOGUE") {
          const { deliveryOrSubtext, ...required } = entry;
          return { ...required, ...(deliveryOrSubtext ? { deliveryOrSubtext } : {}) };
        }
        return entry;
      }),
    })),
  });
}

export type GenerateAiStoryScriptSemanticProposalV1Input = {
  frozenOutline: AiStoryOutlineVersion;
  story: AiStoryStructuredDraft;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  characterAuthorities: PlanningCharacterAuthorityProjection[];
  productAuthorityIds: string[];
  episodeIntent?: AiStoryEpisodeIntentAuthority;
};

/** One proposal-only structured planning call. Canonical identity is added downstream. */
export async function generateAiStoryScriptSemanticProposalV1(
  rawInput: GenerateAiStoryScriptSemanticProposalV1Input,
): Promise<{ semanticProposal: AiStoryScriptSemanticProposalV1; usage: PlanningUsage }> {
  const input = {
    frozenOutline: AiStoryOutlineVersionSchema.parse(rawInput.frozenOutline),
    story: AiStoryStructuredDraftSchema.parse(rawInput.story),
    storyBeats: StoryBeatSchema.array().min(1).parse(rawInput.storyBeats),
    scenePlan: ScenePlanItemSchema.array().min(1).parse(rawInput.scenePlan),
    creativeContext: CreativeContextSchema.parse(rawInput.creativeContext),
    directorThinking: DirectorThinkingSchema.parse(rawInput.directorThinking),
    characterAuthorities: PlanningCharacterAuthorityProjectionSchema.array().parse(rawInput.characterAuthorities),
    productAuthorityIds: z.array(z.string().uuid()).parse([...new Set(rawInput.productAuthorityIds)].sort()),
    ...(rawInput.episodeIntent
      ? { episodeIntent: AiStoryEpisodeIntentAuthoritySchema.parse(rawInput.episodeIntent) }
      : {}),
  };
  if (input.frozenOutline.status !== "FROZEN") throw new Error("CANONICAL_SCRIPT_FROZEN_OUTLINE_REQUIRED");
  input.scenePlan.forEach((scene, index) => {
    if (scene.order !== index) throw new Error("CANONICAL_SCRIPT_SCENE_PLAN_ORDER_INVALID");
  });
  if (new Set(input.scenePlan.map((scene) => scene.id)).size !== input.scenePlan.length) {
    throw new Error("CANONICAL_SCRIPT_SCENE_PLAN_ID_AMBIGUOUS");
  }
  const outlineProductIds = resolveOutlineBoundProductAuthorityIds(input.frozenOutline);
  if (JSON.stringify(input.productAuthorityIds) !== JSON.stringify(outlineProductIds)) {
    throw new Error("CANONICAL_SCRIPT_PRODUCT_AUTHORITY_MISMATCH");
  }
  const commercial = input.frozenOutline.profile.profileId === "COMMERCIAL_STORY";
  const stateChangeAnchorSceneIndex = commercial
    ? resolveCommercialStateChangeAnchorSceneIndex({
        frozenOutline: input.frozenOutline,
        storyBeats: input.storyBeats,
        scenePlan: input.scenePlan,
      })
    : null;
  const commercialPolicy = input.frozenOutline.commercialStoryProfile;
  const physicalCommercialParticipationRequired = commercial
    && ["PRODUCT", "OFFER"].includes(commercialPolicy?.commercialRole ?? "NONE");
  const providerSchema = buildAiStoryScriptSemanticProviderOutputSchema({
    commercial,
    sceneCount: input.scenePlan.length,
    stateChangeAnchorSceneIndex,
    commercialIntegrationAnchorSceneIndex: stateChangeAnchorSceneIndex,
    physicalCommercialParticipationRequired,
    commercialAuthorityIds: commercialPolicy?.commercialIntegration?.commercialAuthorityRefs ?? [],
    characterIds: input.characterAuthorities.map((authority) => authority.characterId),
    productAuthorityIds: input.productAuthorityIds,
  });
  const allowedCharacterIds = new Set(input.characterAuthorities.map((authority) => authority.characterId));
  const promptInput = {
    ...input,
    frozenOutline: {
      ...input.frozenOutline,
      authorityReferences: input.frozenOutline.authorityReferences.filter((reference) =>
        reference.authorityType !== "CHARACTER" || allowedCharacterIds.has(reference.authorityId),
      ),
    },
  };
  const completion = await callStructuredJsonModel({
    system: [
      "You are the AI Story V1 Script Semantic Writer. Produce semantic proposal data only.",
      `Return exactly ${input.scenePlan.length} semantic Scene objects inside scenesByOrder, using only the exact keys ${input.scenePlan.map((_, index) => `scene_${index}`).join(", ")}. Never add, remove, merge, duplicate, or reorder Scenes.`,
      "Do not return Scene Plan IDs. Scene identity and order are server-owned and will be attached from the fixed scene_N property order after exact-count validation.",
      "Use only exact supplied entity IDs. Never invent Character identity, Product identity, claims, or evidence.",
      "Speakers, ACTION subjects, and state subjects must be characterAuthorities characterId values or product authority IDs. A Character ID that is not in characterAuthorities is unavailable, including another campaign Character with the same name.",
      "Choose sceneFunction only from the supplied Script Scene Function registry represented by the schema.",
      `These scene functions require at least one ACTION entry: ${VISIBLE_ACTION_SCENE_FUNCTIONS}. Dialogue alone is not a visible action.`,
      "Scene state is story-world state, not camera state. Camera, framing, transition, and shot choices are not state facts and must not change POSSESSION, LOCATION, PHYSICAL_CONDITION, or PRODUCT_STATE.",
      "Order Scenes by the supplied Scene Plan. For every Scene after the first, sceneStateIn must copy every fact from the previous Scene sceneStateOut with the exact same dimension, subjectId, and value.",
      "A Scene boundary, dialogue beat, or reaction beat does not reset state. Change a fact only inside a Scene: sceneStateDelta.fromValue equals that Scene sceneStateIn value, and sceneStateOut equals the delta value.",
      "A change to POSSESSION, LOCATION, PHYSICAL_CONDITION, or PRODUCT_STATE must be caused by an ACTION entry. Copy an unchanged held object or product forward exactly. Do not drop it at a Scene boundary.",
      "Off-screen speech is not a new Character and does not add a physical state. Do not assign an off-screen line to a different Character ID. Keep the on-screen character's physical state unchanged when they only hear or react.",
      "Do not create canonical Script Scene IDs, Entry IDs, Script versions, provider prompts, shots, or video instructions.",
      ...(commercial ? [
        "This is COMMERCIAL_STORY. narrativeFunction and storyConsequence are required on every Scene.",
        `Scene array index ${stateChangeAnchorSceneIndex} is the frozen commercial-integration state-change anchor. For physical Product or Offer participation, that Scene must contain exactly one PRODUCT_STATE sceneStateDelta for the exact authorized commercial Product, with a non-null fromValue and a changed value. Other Scenes may have no state delta when nothing changes.`,
        "Every Scene has a required visibleAction. Ordinary Scenes may use objectId=null or another exact supplied entity. Only the frozen commercial-integration anchor must use the exact authorized commercial object when physical participation is required. Put dialogue in followingEntries. Dialogue that mentions the product is not commercial integration.",
        "Do not emit a POSSESSION, LOCATION, or PHYSICAL_CONDITION delta when that value stays the same. A spoken line is not a physical state change.",
        "If a supplied dialogue speaker name is not a characterAuthorities name, the line is off-screen. Put that exact line in visibleAction.storyEffect or newInformation. Do not assign it to the on-screen character.",
        "visibleAction.action must describe a visible physical action in at least four words. It must not be a single verb and must not copy a spoken line. Dialogue that mentions the product is not that action.",
        "PRODUCT PRESENCE is not PRODUCT PARTICIPATION. A product id, a visible prop, or dialogue that mentions the product does not integrate it.",
        `Scene array index ${stateChangeAnchorSceneIndex} is also the frozen commercial-integration anchor. Its visibleAction.objectId must be the exact authorized commercial authority when physical participation is required, and its action must describe genuine narrative participation. The server binds that ACTION to the exact PRODUCT_STATE delta; do not add another ACTION to followingEntries. Do not insert the Product into ordinary Scenes merely because its authority is available.`,
        "If commercialActionOrParticipation is ENABLE, perform the physical use and visible effect already written in userCreativeIntent. Do not replace that use with admiration, a price remark, or product presence.",
        "Do not return commercialContribution. The server projects its immutable role, participation kind, authority IDs, pre/post state, and consequence onto the frozen integration anchor from Outline authority.",
        "A later scene whose productVisualIdentityRequirement is NONE does not remove a product the character is already holding. Copy that held product forward. Off-screen speech does not remove it.",
        "Do not replace the narrative with a product showcase, catalog shot, or detached cutaway.",
        "When the product remains in use, keep its physical state fact identical across Scenes. Do not invent a new product state just to start the next Scene.",
      ] : []),
      ...(input.episodeIntent ? [
        "Episode intent is structured authority. Do not recover native dialogue, spoken language, visual text languages, or character continuity from originalIdea prose.",
        `spokenLanguage=${input.episodeIntent.spokenLanguage}; dialogueStyle=${input.episodeIntent.dialogueStyle}; nativeCharacterDialogue=${input.episodeIntent.nativeCharacterDialogue}; cta=${input.episodeIntent.cta ?? "none"}.`,
        ...(input.episodeIntent.nativeCharacterDialogue ? [
          "nativeCharacterDialogue is true. Include at least one visible DIALOGUE entry. The speakerId must be an exact supplied character ID. The line is the exact spoken text. The language must be the spokenLanguage locale. Do not satisfy this with voice-over.",
        ] : [
          "nativeCharacterDialogue is false. Do not require Native AV dialogue.",
        ]),
      ] : []),
      "Return JSON only and no extra fields.",
    ].join(" "),
    user: JSON.stringify(promptInput, null, 2),
    schema: providerSchema,
    schemaName: "ai_story_script_semantic_proposal_v1",
    certificationStage: "script_semantic_writer",
  });
  if (completion.decodeIssue) {
    throw new Error(`SCRIPT_SEMANTIC_WRITER_${completion.decodeIssue}`);
  }
  const parsed = providerSchema.parse(completion.result);
  const canonicalized = canonicalizeProviderProposal(
    parsed,
    input.scenePlan,
    input.frozenOutline,
    stateChangeAnchorSceneIndex,
  );
  const continued = dropUnchangedPhysicalScriptChanges(carryForwardUnchangedScriptSceneState(canonicalized.scenes));
  const semanticProposal = AiStoryScriptSemanticProposalV1Schema.parse({
    ...canonicalized,
    scenes: detachOffScreenSuppliedDialogue(continued, {
      characterNames: input.characterAuthorities.map((authority) => authority.name),
      suppliedDialogue: input.creativeContext.narrativeContext.dialogue,
    }),
  });
  if (input.episodeIntent?.nativeCharacterDialogue) {
    const dialogue = evaluateNativeDialogueIntent({
      requested: true,
      entries: semanticProposal.scenes.flatMap((scene) => scene.entries),
    });
    if (dialogue.status === "BLOCK") throw new Error("NATIVE_DIALOGUE_REQUEST_UNSATISFIED");
  }
  return { semanticProposal, usage: completion.usage };
}
