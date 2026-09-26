import { callStructuredJsonModel } from "../llm";
import { z } from "zod";
import {
  AI_STORY_SCENE_FUNCTION_REGISTRY,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryScriptStateDeltaSchema,
  AiStoryScriptStateFactSchema,
  AiStoryOutlineVersionSchema,
  AiStoryScriptSemanticProposalV1Schema,
  AiStoryStructuredDraftSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  PlanningCharacterAuthorityProjectionSchema,
  ScenePlanItemSchema,
  StoryBeatSchema,
  type AiStoryOutlineVersion,
  type AiStoryScriptSemanticProposalV1,
  type AiStoryStructuredDraft,
  type CreativeContext,
  type DirectorThinking,
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
const AiStoryScriptSemanticProviderOutputV1Schema = z.object({
  contractVersion: z.literal(AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION),
  scenes: z.array(z.object({
    scenePlanItemId: ProviderText.max(500),
    sceneFunction: ProviderSceneFunction,
    sceneFunctionRegistryVersion: z.literal(1),
    sceneStateIn: z.array(AiStoryScriptStateFactSchema),
    sceneStateDeltas: z.array(AiStoryScriptStateDeltaSchema),
    sceneStateOut: z.array(AiStoryScriptStateFactSchema),
    entries: z.array(z.discriminatedUnion("type", [
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
    ])).min(1),
    newInformation: z.array(ProviderText.max(1000)),
    newActionOutcomes: z.array(ProviderText.max(1000)),
  }).strict()).min(1),
}).strict();

function canonicalizeProviderProposal(
  value: z.infer<typeof AiStoryScriptSemanticProviderOutputV1Schema>,
): AiStoryScriptSemanticProposalV1 {
  return AiStoryScriptSemanticProposalV1Schema.parse({
    ...value,
    scenes: value.scenes.map((scene) => ({
      ...scene,
      entries: scene.entries.map((entry) => {
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
    productAuthorityIds: z.array(z.string().uuid()).min(1).parse([...new Set(rawInput.productAuthorityIds)].sort()),
  };
  if (input.frozenOutline.status !== "FROZEN") throw new Error("CANONICAL_SCRIPT_FROZEN_OUTLINE_REQUIRED");
  const outlineProductIds = [...(input.frozenOutline.productStoryProfile?.productAuthorityIds ?? [])].sort();
  if (JSON.stringify(input.productAuthorityIds) !== JSON.stringify(outlineProductIds)) {
    throw new Error("CANONICAL_SCRIPT_PRODUCT_AUTHORITY_MISMATCH");
  }
  const completion = await callStructuredJsonModel({
    system: [
      "You are the AI Story V1 Script Semantic Writer. Produce semantic proposal data only.",
      "Cover every supplied Scene Plan item exactly once; never add, remove, merge, or duplicate Scenes.",
      "Use only exact supplied entity IDs. Never invent Character identity, Product identity, claims, or evidence.",
      "Choose sceneFunction only from the supplied Script Scene Function registry represented by the schema.",
      "Do not create canonical Script Scene IDs, Entry IDs, Script versions, provider prompts, shots, or video instructions.",
      "Return JSON only and no extra fields.",
    ].join(" "),
    user: JSON.stringify(input, null, 2),
    schema: AiStoryScriptSemanticProviderOutputV1Schema,
    schemaName: "ai_story_script_semantic_proposal_v1",
    certificationStage: "script_semantic_writer",
  });
  if (completion.decodeIssue) {
    throw new Error(`SCRIPT_SEMANTIC_WRITER_${completion.decodeIssue}`);
  }
  return {
    semanticProposal: canonicalizeProviderProposal(
      AiStoryScriptSemanticProviderOutputV1Schema.parse(completion.result),
    ),
    usage: completion.usage,
  };
}
