import { callStructuredJsonModel } from "../llm";
import { z } from "zod";
import {
  AI_STORY_SCENE_FUNCTION_REGISTRY,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryScriptStateDeltaSchema,
  AiStoryScriptStateFactSchema,
  carryForwardUnchangedScriptSceneState,
  detachOffScreenSuppliedDialogue,
  dropUnchangedPhysicalScriptChanges,
  AiStoryCommercialSceneContributionSchema,
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

const ProviderId = z.string().uuid();
const ProviderText = z.string().trim().min(1);
const ProviderSceneFunction = z.enum(Object.keys(AI_STORY_SCENE_FUNCTION_REGISTRY) as [
  keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY,
  ...(keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY)[],
]);
const ProviderEntriesSchema = z.array(z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ACTION"),
    subjectId: ProviderId,
    action: ProviderText.max(2000),
    objectId: ProviderId.nullable(),
    storyEffect: ProviderText.max(1000),
    stateDelta: AiStoryScriptStateDeltaSchema.nullable(),
  }).strict(),
  z.object({
    type: z.literal("DIALOGUE"),
    speakerId: ProviderId,
    line: ProviderText.max(4000),
    deliveryOrSubtext: ProviderText.max(1000).nullable(),
    language: ProviderText.max(50),
  }).strict(),
  z.object({
    type: z.literal("VO"),
    voiceOwnerId: ProviderId,
    line: ProviderText.max(4000),
    narrativePurpose: ProviderText.max(1000),
    language: ProviderText.max(50),
  }).strict(),
])).min(1);

const ProviderVisibleActionSchema = z.object({
  type: z.literal("ACTION"),
  subjectId: ProviderId,
  action: ProviderText.max(2000),
  objectId: ProviderId,
  storyEffect: ProviderText.max(1000),
  stateDelta: AiStoryScriptStateDeltaSchema.nullable(),
}).strict();

export function buildAiStoryScriptSemanticProviderOutputSchema(commercial: boolean) {
  return z.object({
    contractVersion: z.literal(AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION),
    scenes: z.array(z.object({
      scenePlanItemId: ProviderText.max(500),
      sceneFunction: ProviderSceneFunction,
      sceneFunctionRegistryVersion: z.literal(1),
      sceneStateIn: z.array(AiStoryScriptStateFactSchema),
      sceneStateDeltas: z.array(AiStoryScriptStateDeltaSchema),
      sceneStateOut: z.array(AiStoryScriptStateFactSchema),
      newInformation: z.array(ProviderText.max(1000)),
      newActionOutcomes: z.array(ProviderText.max(1000)),
      ...(commercial
        ? {
            visibleAction: ProviderVisibleActionSchema,
            followingEntries: z.array(ProviderEntriesSchema.element).default([]),
            narrativeFunction: AiStoryNarrativeFunctionSchema,
            storyConsequence: ProviderText.max(1000),
          }
        : {
            entries: ProviderEntriesSchema,
            narrativeFunction: AiStoryNarrativeFunctionSchema.nullable().optional(),
            storyConsequence: ProviderText.max(1000).nullable().optional(),
          }),
      causalPreconditions: z.array(ProviderText.max(1000)).nullable().optional(),
      commercialContribution: AiStoryCommercialSceneContributionSchema.nullable().optional(),
    }).strict()).min(1),
  }).strict();
}

const VISIBLE_ACTION_SCENE_FUNCTIONS = Object.entries(AI_STORY_SCENE_FUNCTION_REGISTRY)
  .filter(([, value]) => value.visibleActionRequired)
  .map(([name]) => name)
  .join(", ");

function providerSceneEntries(scene: {
  entries?: unknown;
  visibleAction?: unknown;
  followingEntries?: unknown;
}) {
  if (scene.visibleAction) {
    const action = ProviderVisibleActionSchema.parse(scene.visibleAction);
    const following = z.array(ProviderEntriesSchema.element).parse(scene.followingEntries ?? []);
    return [action, ...following];
  }
  return ProviderEntriesSchema.parse(scene.entries ?? []);
}

function canonicalizeProviderProposal(
  value: z.infer<ReturnType<typeof buildAiStoryScriptSemanticProviderOutputSchema>>,
): AiStoryScriptSemanticProposalV1 {
  return AiStoryScriptSemanticProposalV1Schema.parse({
    ...value,
    scenes: value.scenes.map((scene) => ({
      scenePlanItemId: scene.scenePlanItemId,
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
      ...(scene.commercialContribution ? { commercialContribution: scene.commercialContribution } : {}),
      entries: providerSceneEntries(scene).map((entry) => {
        if (entry.type === "ACTION") {
          const { objectId, stateDelta, ...required } = entry;
          return {
            ...required,
            ...(objectId ? { objectId } : {}),
            ...(stateDelta ? { stateDelta } : {}),
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
  const outlineProductIds = resolveOutlineBoundProductAuthorityIds(input.frozenOutline);
  if (JSON.stringify(input.productAuthorityIds) !== JSON.stringify(outlineProductIds)) {
    throw new Error("CANONICAL_SCRIPT_PRODUCT_AUTHORITY_MISMATCH");
  }
  const commercial = input.frozenOutline.profile.profileId === "COMMERCIAL_STORY";
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
      "Cover every supplied Scene Plan item exactly once; never add, remove, merge, or duplicate Scenes.",
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
        "Every Scene has a required visibleAction. Its objectId is the product authority ID when a product is in use. Put dialogue in followingEntries. Dialogue that mentions the product is not commercial integration.",
        "Do not emit a POSSESSION, LOCATION, or PHYSICAL_CONDITION delta when that value stays the same. A spoken line is not a physical state change.",
        "If a supplied dialogue speaker name is not a characterAuthorities name, the line is off-screen. Put that exact line in visibleAction.storyEffect or newInformation. Do not assign it to the on-screen character.",
        "visibleAction.action must describe a visible physical action in at least four words. It must not be a single verb and must not copy a spoken line. Dialogue that mentions the product is not that action.",
        "PRODUCT PRESENCE is not PRODUCT PARTICIPATION. A product id, a visible prop, or dialogue that mentions the product does not integrate it.",
        "When product authority ids are supplied, at least one visibleAction.objectId must be one of those ids, and visibleAction.action must describe the character physically using that product.",
        "If commercialActionOrParticipation is ENABLE, perform the physical use and visible effect already written in userCreativeIntent. Do not replace that use with admiration, a price remark, or product presence.",
        "Put commercialContribution on that scene. participationKind is the product's narrative role and commercialAuthorityIds contains that product id. If the same product remains in use, preState and postState may match. Keep the contribution. Do not omit it and do not invent a replacement product to force a difference.",
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
    schema: buildAiStoryScriptSemanticProviderOutputSchema(commercial),
    schemaName: "ai_story_script_semantic_proposal_v1",
    certificationStage: "script_semantic_writer",
  });
  if (completion.decodeIssue) {
    throw new Error(`SCRIPT_SEMANTIC_WRITER_${completion.decodeIssue}`);
  }
  const parsed = buildAiStoryScriptSemanticProviderOutputSchema(commercial).parse(completion.result);
  const canonicalized = canonicalizeProviderProposal(parsed);
  const ordered = input.scenePlan.map((scene) =>
    canonicalized.scenes.find((item) => item.scenePlanItemId === scene.id),
  );
  const continued = ordered.every((scene) => scene)
    ? dropUnchangedPhysicalScriptChanges(carryForwardUnchangedScriptSceneState(ordered as NonNullable<(typeof ordered)[number]>[]))
    : canonicalized.scenes;
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
