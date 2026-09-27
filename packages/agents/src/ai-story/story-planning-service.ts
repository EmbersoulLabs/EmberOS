/**
 * AI Story Sprint 2 planning pipeline.
 *
 * Ends at an Animation Package that is ready for human planning review; it does
 * not dispatch to video, provider execution, render, or billing systems.
 */
import { z } from "zod";
import { callJsonModel, callStructuredJsonModel } from "../llm";
import type { CertificationPlanningStage } from "@ceo-agent/db";
import {
  AnimationPackagePayloadSchema,
  AI_STORY_SHOT_AUTHORITY_LINEAGE_VERSION,
  AiStorySceneGenerationAuthoritySchema,
  AiStorySceneGroundingProposalSchema,
  AiStoryScriptVersionSchema,
  CharacterContinuityEntrySchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  ScenePlanItemSchema,
  ShotPlanItemSchema,
  StoryBeatSchema,
  validatePlanningConsistency,
  type AiStoryStructuredDraft,
  type AiStoryScriptVersion,
  type AnimationPackagePayload,
  type AiStoryCanonicalScene,
  type CharacterContinuityEntry,
  type CreativeContext,
  type DirectorThinking,
  type PlanningUsage,
  type PlanningCharacterAuthorityProjection,
  type PlanningProductAuthorityProjection,
  type ScenePlanItem,
  type ShotPlanItem,
  type StoryBeat,
  type WorldContinuity,
  WorldContinuitySchema,
  bindSceneGroundingLineage,
  type AiStoryScenePlanningGroundingContext,
} from "@ceo-agent/shared";
import { buildAiStoryAnimationPackageCanonicalSceneAuthorityV1 } from "@ceo-agent/shared/server";
import {
  bindCharacterContinuityToCharacterAuthority,
  bindCreativeContextToCharacterAuthority,
  planningCharacterAuthorityPrompt,
} from "./character-authority-planning";
import {
  bindCreativeContextToProductAuthority,
  planningProductAuthorityPrompt,
} from "./product-authority-planning";

type Usage = PlanningUsage;

export function normalizeExistenceOnlySceneGrounding(
  proposals: readonly z.infer<typeof AiStorySceneGroundingProposalSchema>[],
): z.infer<typeof AiStorySceneGroundingProposalSchema>[] {
  return proposals.map((proposal) => ({
    ...proposal,
    visualClaims: proposal.visualClaims.map((claim) => claim.evidenceLevel === "EXISTENCE_ONLY"
      ? { ...claim, detail: claim.subject }
      : claim),
  }));
}

export function bindSceneGroundingProposalIdsByPlanOrder(input: {
  sceneIds: readonly string[];
  proposals: readonly z.infer<typeof AiStorySceneGroundingProposalSchema>[];
}): z.infer<typeof AiStorySceneGroundingProposalSchema>[] {
  if (input.sceneIds.length !== input.proposals.length) return [...input.proposals];
  return input.proposals.map((proposal, index) => ({
    ...proposal,
    sceneId: input.sceneIds[index]!,
  }));
}

export function removeUnsupportedObservedAppearance(input: {
  context: AiStoryScenePlanningGroundingContext;
  proposals: readonly z.infer<typeof AiStorySceneGroundingProposalSchema>[];
}): z.infer<typeof AiStorySceneGroundingProposalSchema>[] {
  const bindingById = new Map(input.context.bindings.map((binding) => [binding.bindingId, binding]));
  const normalized = (value: string) => value.trim().toLocaleLowerCase();
  return input.proposals.map((proposal) => {
    const selected = proposal.evidence
      .map((selection) => bindingById.get(selection.bindingId))
      .filter((binding): binding is NonNullable<typeof binding> => Boolean(binding));
    return {
      ...proposal,
      visualClaims: proposal.visualClaims.map((claim) => {
        if (claim.evidenceLevel !== "OBSERVED_APPEARANCE") return claim;
        const supported = selected.some((binding) =>
          binding.role === "PRODUCT_AUTHORITY" &&
          binding.productCandidates.some((candidate) =>
            normalized(candidate.name) === normalized(claim.subject) &&
            candidate.relationship !== "CATALOG_CHOICE") &&
          binding.observedFacts.some((fact) => normalized(fact) === normalized(claim.detail)));
        return supported ? claim : {
          subject: claim.subject,
          detail: claim.subject,
          evidenceLevel: "EXISTENCE_ONLY" as const,
        };
      }),
    };
  });
}

function mentionsGroundedName(value: string, name: string): boolean {
  const escaped = name.trim().toLocaleLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.length > 0 && new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "u")
    .test(value.toLocaleLowerCase());
}

/**
 * Makes catalog/menu facts used in a Scene narrative explicit in its immutable
 * evidence lineage. This is a deterministic projection of accepted matching
 * authority: it neither infers a new item nor promotes a supporting reference
 * to Product authority.
 */
export function bindMentionedCatalogChoiceEvidence(input: {
  context: AiStoryScenePlanningGroundingContext;
  proposals: readonly z.infer<typeof AiStorySceneGroundingProposalSchema>[];
}): z.infer<typeof AiStorySceneGroundingProposalSchema>[] {
  return input.proposals.map((proposal) => {
    const text = `${proposal.narrativeIntent}\n${proposal.visualIntent}`;
    const mentions = input.context.bindings.flatMap((binding) =>
      binding.productCandidates
        .filter((candidate) =>
          candidate.relationship === "CATALOG_CHOICE" &&
          mentionsGroundedName(text, candidate.name))
        .map((candidate) => ({ bindingId: binding.bindingId, fact: candidate.name })),
    );
    if (mentions.length === 0) return proposal;

    const evidence = proposal.evidence.map((selection) => ({
      ...selection,
      groundedFacts: [...selection.groundedFacts],
    }));
    for (const mention of mentions) {
      const existing = evidence.find((selection) => selection.bindingId === mention.bindingId);
      if (!existing) {
        evidence.push({ bindingId: mention.bindingId, groundedFacts: [mention.fact] });
        continue;
      }
      if (!existing.groundedFacts.some((fact) =>
        fact.trim().toLocaleLowerCase() === mention.fact.trim().toLocaleLowerCase())) {
        existing.groundedFacts.push(mention.fact);
      }
    }
    return { ...proposal, evidence };
  });
}

export function retainSupportedSceneGroundingEvidence(input: {
  context: AiStoryScenePlanningGroundingContext;
  proposals: readonly z.infer<typeof AiStorySceneGroundingProposalSchema>[];
}): z.infer<typeof AiStorySceneGroundingProposalSchema>[] {
  const normalized = (value: string) => value.trim().toLocaleLowerCase();
  const bindingById = new Map(input.context.bindings.map((binding) => [binding.bindingId, binding]));
  return input.proposals.map((proposal) => ({
    ...proposal,
    evidence: proposal.evidence.flatMap((selection) => {
      const binding = bindingById.get(selection.bindingId);
      if (!binding) return [];
      const supported = new Set([
        ...binding.observedFacts,
        ...binding.namedItems,
        ...binding.productCandidates.flatMap((candidate) => candidate.evidence),
      ].map(normalized));
      const groundedFacts = selection.groundedFacts.filter((fact) => supported.has(normalized(fact)));
      return groundedFacts.length > 0 ? [{ ...selection, groundedFacts }] : [];
    }),
  }));
}

export function reconcileSupportingOnlySceneAuthority(input: {
  scene: z.infer<typeof ScenePlanItemSchema> & {
    generationAuthority: z.infer<typeof AiStorySceneGenerationAuthoritySchema>;
  };
  lineage: ReturnType<typeof bindSceneGroundingLineage> extends ReadonlyMap<string, infer T> ? T : never;
}): z.infer<typeof AiStorySceneGenerationAuthoritySchema> {
  const authority = input.scene.generationAuthority;
  if (
    authority.productVisualIdentityRequirement === "REQUIRED" &&
    !input.lineage.evidence.some((evidence) => evidence.role === "PRODUCT_AUTHORITY") &&
    input.lineage.visualClaims.every((claim) => claim.evidenceLevel === "EXISTENCE_ONLY")
  ) {
    return {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    };
  }
  return authority;
}

const ScenePlanProviderOutputSchema = z.object({
  scenePlan: z.array(z.object({
    id: z.string().trim().min(1),
    beatIds: z.array(z.string().trim().min(1)).min(1),
    purpose: z.string().trim().min(1),
    durationSec: z.number().positive(),
    transition: z.string(),
    continuityNotes: z.string(),
    order: z.number().int().nonnegative(),
    generationAuthority: AiStorySceneGenerationAuthoritySchema,
  }).strict()).min(1),
  groundingSelections: z.array(AiStorySceneGroundingProposalSchema).default([]),
}).strict();

export function buildScenePlanProviderOutputSchema(
  acceptedBindingIds: readonly string[],
) {
  if (acceptedBindingIds.length === 0) return ScenePlanProviderOutputSchema;
  const bindingIdSchema = z.enum(acceptedBindingIds as [string, ...string[]]);
  return ScenePlanProviderOutputSchema.extend({
    groundingSelections: z.array(AiStorySceneGroundingProposalSchema.extend({
      evidence: z.array(AiStorySceneGroundingProposalSchema.shape.evidence.element.extend({
        bindingId: bindingIdSchema,
      }).strict()),
    }).strict()).default([]),
  }).strict();
}

export type AiStoryPlanningCampaignContext = {
  id?: string;
  name: string;
  objective?: string | null;
  objectiveCustom?: string | null;
  targetAudienceOverride?: string | null;
  campaignBrief?: string | null;
  goal?: string | null;
  platforms?: readonly string[];
};

export type AiStoryPlanningBrandContext = {
  brandName?: string | null;
  brandTone?: string | null;
  targetAudience?: string | null;
  industry?: string | null;
  description?: string | null;
  values?: readonly string[];
  style?: readonly string[];
};

export type StoryPlanningPipelineInput = {
  storyDraft: AiStoryStructuredDraft;
  /** Legacy all-at-once compatibility only; normal runtime gates through runSinglePlanningStage. */
  canonicalScript?: AiStoryScriptVersion;
  campaign: AiStoryPlanningCampaignContext;
  brand?: AiStoryPlanningBrandContext | null;
  assetLabels?: readonly string[];
  characterAuthorities?: readonly PlanningCharacterAuthorityProjection[];
  productAuthorities?: readonly PlanningProductAuthorityProjection[];
};

function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    costUsd: a.costUsd + b.costUsd,
  };
}

async function callStage<T>(
  stage: string,
  system: string,
  user: string,
  schemaHint: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  pick: (result: Record<string, unknown>) => unknown
): Promise<{ value: T; usage: Usage }> {
  const certificationStageByLabel: Record<string, CertificationPlanningStage> = {
    "Creative context": "creative_context",
    "Director thinking": "director_thinking",
    "Story beats": "story_beats",
    "Scene plan": "scene_plan",
    "Shot plan": "shot_plan",
    "Character continuity": "character_continuity",
    "World continuity": "world_continuity",
  };
  const { result, usage } = await callJsonModel<Record<string, unknown>>(
    system,
    user,
    schemaHint,
    { certificationStage: certificationStageByLabel[stage] }
  );
  const parsed = schema.safeParse(pick(result));
  if (!parsed.success) {
    throw new Error(`${stage} returned malformed planning JSON`);
  }
  return { value: parsed.data, usage };
}

function storySummary(storyDraft: AiStoryStructuredDraft): string {
  return [
    `Title: ${storyDraft.title}`,
    `Summary: ${storyDraft.summary}`,
    `Objective: ${storyDraft.objective}`,
    `Audience: ${storyDraft.targetAudience}`,
    `Tone: ${storyDraft.tone}`,
    `Duration: ${storyDraft.estimatedDuration}`,
    `Opening: ${storyDraft.story.opening}`,
    `Development: ${storyDraft.story.development}`,
    `Ending: ${storyDraft.story.ending}`,
    `Key messages: ${storyDraft.keyMessages.join("; ")}`,
    `CTA: ${storyDraft.cta}`,
  ].join("\n");
}

function campaignSummary(
  campaign: AiStoryPlanningCampaignContext,
  brand?: AiStoryPlanningBrandContext | null,
  assetLabels: readonly string[] = []
): string {
  return [
    `Campaign: ${campaign.name}`,
    campaign.objectiveCustom?.trim()
      ? `Objective: ${campaign.objectiveCustom}`
      : campaign.objective?.trim()
        ? `Objective: ${campaign.objective}`
        : campaign.goal?.trim()
          ? `Goal: ${campaign.goal}`
          : "",
    campaign.targetAudienceOverride?.trim()
      ? `Campaign audience: ${campaign.targetAudienceOverride}`
      : "",
    campaign.campaignBrief?.trim() ? `Campaign brief: ${campaign.campaignBrief}` : "",
    campaign.platforms?.length ? `Platforms: ${campaign.platforms.join(", ")}` : "",
    brand?.brandName?.trim() ? `Brand: ${brand.brandName}` : "",
    brand?.brandTone?.trim() ? `Brand tone: ${brand.brandTone}` : "",
    brand?.targetAudience?.trim() ? `Brand audience: ${brand.targetAudience}` : "",
    brand?.industry?.trim() ? `Industry: ${brand.industry}` : "",
    brand?.description?.trim() ? `Brand description: ${brand.description}` : "",
    brand?.values?.length ? `Brand values: ${brand.values.join(", ")}` : "",
    brand?.style?.length ? `Brand style: ${brand.style.join(", ")}` : "",
    assetLabels.length ? `Referenced assets: ${assetLabels.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildEpisodeContinuityPlanningPromptSection(
  episodeContinuity?: import("@ceo-agent/shared").EpisodeContinuityPlanningContext | null
): string {
  return episodeContinuity
    ? `Previous Episode continuity authority (read-only):\n${JSON.stringify(episodeContinuity)}`
    : "Previous Episode continuity authority: none (first Episode).";
}

export async function generateCreativeContext(
  storyDraft: AiStoryStructuredDraft,
  campaign: AiStoryPlanningCampaignContext,
  brand?: AiStoryPlanningBrandContext | null,
  assetLabels: readonly string[] = [],
  characterAuthorities: readonly PlanningCharacterAuthorityProjection[] = [],
  productAuthorities: readonly PlanningProductAuthorityProjection[] = [],
  episodeContinuity?: import("@ceo-agent/shared").EpisodeContinuityPlanningContext | null
): Promise<{ creativeContext: CreativeContext; usage: Usage }> {
  const schemaHint = JSON.stringify({
    creativeContext: {
      storyContext: {
        title: "string",
        summary: "string",
        objective: "string",
        targetAudience: "string",
        tone: "string",
        estimatedDuration: "string",
        keyMessages: ["string"],
        cta: "string",
      },
      characterContext: {
        characters: [
          {
            id: "exact canonical characterId UUID when selecting accepted authority; otherwise stable proposal id",
            name: "string",
            role: "string",
            description: "string",
            motivation: "string",
            visualNotes: "string",
          },
        ],
        relationships: ["string"],
      },
      worldContext: {
        locations: ["string"],
        visualStyle: "string",
        lighting: "string",
        environment: "string",
        objects: ["string"],
        timeline: "string",
        worldRules: ["string"],
      },
      narrativeContext: {
        arc: "string",
        pacing: "string",
        emotionalJourney: "string",
        themes: ["string"],
        dialogue: [
          {
            speaker: "character name",
            line: "spoken line",
            beatHint: "opening | conflict | climax | ending | cta",
          },
        ],
      },
      directorContext: {},
    },
  });
  const { value, usage } = await callStage<CreativeContext>(
    "Creative context",
    [
      "You are a screenwriter preparing an AI Story for animation planning.",
      "Extract only durable creative context from the Story Draft, campaign, brand, and assets.",
      "Include story, character, world, and narrative context with concise dialogue lines when the story needs speech.",
      "Accepted canonical Character stable facts are read-only. Select them only by exact characterId; never rewrite identity or appearance. New Characters are proposals only.",
      "Accepted Product IDs and source content hashes are server-owned and read-only. Use exact productAuthorityId for Product narrative intent; labels, filenames, prose, and generic props never establish Product authority.",
      "Product authority availability does not require visual conditioning and must not select or change generation mode.",
      "Previous Episode continuity is immutable historical fact. Preserve canonical identity and frozen facts; apply only the explicitly approved current-Episode changes before proposing anything new. Continuity never selects generation mode or Provider.",
      "Keep directorContext as an empty object; the director stage fills Director Thinking later.",
      "Return ONLY JSON.",
    ].join(" "),
    [
      campaignSummary(campaign, brand, assetLabels),
      "",
      planningCharacterAuthorityPrompt(characterAuthorities),
      "",
      planningProductAuthorityPrompt(productAuthorities),
      "",
      buildEpisodeContinuityPlanningPromptSection(episodeContinuity),
      "",
      storySummary(storyDraft),
    ].join("\n"),
    schemaHint,
    CreativeContextSchema,
    (result) => ({
      ...(result.creativeContext as Record<string, unknown> | undefined),
      directorContext: {},
    })
  );
  return {
    creativeContext: bindCreativeContextToProductAuthority({
      creativeContext: bindCreativeContextToCharacterAuthority({
        creativeContext: value,
        characterAuthorities,
      }),
      productAuthorities,
    }),
    usage,
  };
}

export async function generateDirectorThinking(
  story: AiStoryStructuredDraft,
  creativeContext: CreativeContext
): Promise<{ directorThinking: DirectorThinking; usage: Usage }> {
  const schemaHint = JSON.stringify({
    directorThinking: {
      coreMessage: "string",
      hero: "string",
      conflict: "string",
      turningPoint: "string",
      climax: "string",
      takeaway: "string",
    },
  });
  const { value, usage } = await callStage<DirectorThinking>(
    "Director thinking",
    [
      "You are an animation director translating story context into clear dramatic intent.",
      "Do not write provider prompts, video render settings, or final execution details.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify({ story, creativeContext }, null, 2),
    schemaHint,
    DirectorThinkingSchema,
    (result) => result.directorThinking ?? result
  );
  return { directorThinking: value, usage };
}

export async function generateStoryBeats(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
}): Promise<{ storyBeats: StoryBeat[]; usage: Usage }> {
  const schemaHint = JSON.stringify({
    storyBeats: [
      {
        id: "beat-001",
        name: "Opening | Setup | Conflict | Development | Climax | Ending | CTA or custom",
        purpose: "string",
        order: 0,
        summary: "string",
      },
    ],
  });
  const { value, usage } = await callStage<StoryBeat[]>(
    "Story beats",
    [
      "You are structuring an animation-ready narrative beat sheet.",
      "Use sequential order values starting at 0 and stable beat ids.",
      "Every important story turn must have a beat.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    z.array(StoryBeatSchema).min(1),
    (result) => result.storyBeats
  );
  return { storyBeats: value, usage };
}

export async function generateScenePlan(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  /** Required by the normal staged runtime; optional for legacy all-at-once compatibility. */
  assetGrounding?: AiStoryScenePlanningGroundingContext;
}): Promise<{ scenePlan: ScenePlanItem[]; usage: Usage }> {
  const providerOutputSchema = buildScenePlanProviderOutputSchema(
    input.assetGrounding?.bindings.map((binding) => binding.bindingId) ?? [],
  );
  const completion = await callStructuredJsonModel({
    system: [
      "You are an animation scene planner.",
      "Create scenes that cover every story beat, merging beats only when continuityNotes explicitly say which beat was merged.",
      "Use sequential order values starting at 0 and stable scene ids.",
      "For EVERY Scene choose an explicit creative generationAuthority: TEXT_TO_VIDEO with REFERENCE_FREE_T2V and no reference Asset, or FIRST_FRAME_IMAGE_TO_VIDEO with SCENE_EXPLICIT and an exact input Asset UUID as firstFrameAssetId and referenceAssetIds. Never infer a mode from Product presence or Provider capability. If an exact required Asset ID is unavailable, do not invent one.",
      "FIRST_FRAME_IMAGE_TO_VIDEO and PRODUCT_GROUNDED_VIDEO always require productVisualIdentityRequirement REQUIRED. They may never use NONE. TEXT_TO_VIDEO may use REQUIRED only when the Scene still visually depicts a grounded Product.",
      "The supplied accepted Asset grounding authority is immutable. For every Scene return one groundingSelections entry using only exact accepted binding IDs and exact facts from those bindings. Copy bindingId verbatim; never invent or transform a UUID.",
      "A PRODUCT_AUTHORITY binding is required whenever a Scene visually depicts, introduces, highlights, sells, serves, consumes, or shows detail of that Product. SUPPORTING_REFERENCE never becomes PRODUCT_AUTHORITY.",
      "If a Scene has only SUPPORTING_REFERENCE evidence, use TEXT_TO_VIDEO with REFERENCE_FREE_T2V and productVisualIdentityRequirement NONE. Never select image-conditioned mode or REQUIRED product identity from a supporting-only binding.",
      "A menu/catalog item may be referenced as EXISTENCE_ONLY from exact visible text. Do not invent its appearance unless OBSERVED_APPEARANCE is supported by a selected PRODUCT_AUTHORITY and an exact observed fact.",
      "Every Product or catalog name used as a visual claim must appear in visualClaims. Never add unsupported Product names or attributes in purpose, narrativeIntent, visualIntent, continuityNotes, or visualClaims.",
      "Return JSON only and no extra fields.",
    ].join(" "),
    user: JSON.stringify(input, null, 2),
    schema: providerOutputSchema,
    schemaName: "ai_story_scene_plan_v1",
    certificationStage: "scene_plan",
  });
  if (completion.decodeIssue) {
    throw new Error(`SCENE_PLAN_${completion.decodeIssue}`);
  }
  const providerOutput = providerOutputSchema.parse(completion.result);
  const rawScenePlan = z.array(
    ScenePlanItemSchema.extend({ generationAuthority: AiStorySceneGenerationAuthoritySchema }),
  ).min(1).parse(providerOutput.scenePlan);
  if (!input.assetGrounding) return { scenePlan: rawScenePlan, usage: completion.usage };
  const sceneIds = rawScenePlan.map((scene) => scene.id);
  const orderedGrounding = bindSceneGroundingProposalIdsByPlanOrder({
    sceneIds,
    proposals: providerOutput.groundingSelections,
  });
  const lineageByScene = bindSceneGroundingLineage({
    context: input.assetGrounding,
    sceneIds,
    proposals: normalizeExistenceOnlySceneGrounding(removeUnsupportedObservedAppearance({
      context: input.assetGrounding,
      proposals: retainSupportedSceneGroundingEvidence({
        context: input.assetGrounding,
        proposals: bindMentionedCatalogChoiceEvidence({
          context: input.assetGrounding,
          proposals: orderedGrounding,
        }),
      }),
    })),
  });
  const acceptedAssetIds = new Set(input.assetGrounding.bindings.map((binding) => binding.assetId));
  const productBindingIds = new Set(
    input.assetGrounding.bindings
      .filter((binding) => binding.role === "PRODUCT_AUTHORITY")
      .map((binding) => binding.bindingId),
  );
  const scenePlan = rawScenePlan.map((scene) => {
    const lineage = lineageByScene.get(scene.id);
    if (!lineage) throw new Error(`SCENE_GROUNDING_AUTHORITY_REQUIRED:${scene.id}`);
    const generationAuthority = reconcileSupportingOnlySceneAuthority({ scene, lineage });
    const referenceIds = [
      ...(generationAuthority && "referenceAssetIds" in generationAuthority
        ? generationAuthority.referenceAssetIds
        : []),
      ...(generationAuthority && "firstFrameAssetId" in generationAuthority && generationAuthority.firstFrameAssetId
        ? [generationAuthority.firstFrameAssetId]
        : []),
    ];
    if (referenceIds.some((assetId) => !acceptedAssetIds.has(assetId))) {
      throw new Error(`SCENE_GENERATION_REFERENCE_OUTSIDE_ACCEPTED_BINDINGS:${scene.id}`);
    }
    if (
      generationAuthority.productVisualIdentityRequirement === "REQUIRED" &&
      !lineage.evidence.some((evidence) => productBindingIds.has(evidence.bindingId))
    ) {
      throw new Error(`SCENE_PRODUCT_AUTHORITY_REQUIRED:${scene.id}`);
    }
    return ScenePlanItemSchema.parse({ ...scene, generationAuthority, groundingLineage: lineage });
  });
  return { scenePlan, usage: completion.usage };
}

export function bindShotPlanAuthorityLineage(input: {
  planningPackageId?: string;
  scenePlan: ScenePlanItem[];
  shotPlan: ShotPlanItem[];
}): ShotPlanItem[] {
  const sceneById = new Map(input.scenePlan.map((scene) => [scene.id, scene]));
  const seenShotIds = new Set<string>();
  const shotPlan = input.shotPlan.map((shot) => {
    if (seenShotIds.has(shot.id)) throw new Error(`SHOT_PLAN_DUPLICATE_ID:${shot.id}`);
    seenShotIds.add(shot.id);
    const scene = sceneById.get(shot.sceneId);
    if (!scene) throw new Error(`SHOT_PLAN_SCENE_AUTHORITY_INVALID:${shot.sceneId}`);
    if (!scene.generationAuthority && !scene.groundingLineage) return shot;
    if (!scene.generationAuthority || !scene.groundingLineage) {
      throw new Error(`SHOT_PLAN_SCENE_AUTHORITY_REQUIRED:${scene.id}`);
    }
    if (!input.planningPackageId) {
      throw new Error("SHOT_PLAN_SOURCE_PACKAGE_AUTHORITY_REQUIRED");
    }
    return ShotPlanItemSchema.parse({
      ...shot,
      authorityLineage: {
        contractVersion: AI_STORY_SHOT_AUTHORITY_LINEAGE_VERSION,
        planningPackageId: input.planningPackageId,
        storyId: scene.groundingLineage.storyId,
        storyVersionId: scene.groundingLineage.storyVersionId,
        matchingResultId: scene.groundingLineage.matchingResultId,
        sceneId: scene.id,
        sceneOrder: scene.order,
        generationAuthority: scene.generationAuthority,
        groundingLineage: scene.groundingLineage,
      },
    });
  });
  for (const scene of input.scenePlan) {
    if (!shotPlan.some((shot) => shot.sceneId === scene.id)) {
      throw new Error(`SHOT_PLAN_SCENE_COVERAGE_REQUIRED:${scene.id}`);
    }
  }
  return shotPlan;
}

export async function generateShotPlan(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  /** Exact persisted planning package whose Scene Plan is being consumed. */
  planningPackageId?: string;
  /** Required by the normal staged runtime; optional only for legacy all-at-once compatibility. */
  canonicalScript?: AiStoryScriptVersion;
}): Promise<{ shotPlan: ShotPlanItem[]; usage: Usage }> {
  const canonicalScript = input.canonicalScript ? AiStoryScriptVersionSchema.parse(input.canonicalScript) : null;
  if (canonicalScript && canonicalScript.status !== "FROZEN") throw new Error("CANONICAL_FROZEN_SCRIPT_REQUIRED_FOR_SHOT_PLAN");
  if (canonicalScript && (canonicalScript.scenes.length !== input.scenePlan.length || canonicalScript.scenes.some((scene, index) => scene.order !== input.scenePlan[index]!.order))) {
    throw new Error("CANONICAL_SCRIPT_SCENE_PLAN_MAPPING_INVALID");
  }
  const schemaHint = JSON.stringify({
    shotPlan: [
      {
        id: "shot-001",
        sceneId: "scene-001",
        cameraType: "string",
        cameraMovement: "string",
        composition: "string",
        framing: "string",
        lensSuggestion: "string",
        durationSec: 2,
        focus: "string",
        emotion: "string",
        information: "string",
        order: 0,
      },
    ],
  });
  const { value, usage } = await callStage<ShotPlanItem[]>(
    "Shot plan",
    [
      "You are an animation shot planner.",
      ...(canonicalScript ? [
        "The supplied Canonical Script is authoritative. Map Scene Plan items to Canonical Script Scenes by their exact shared order and preserve Script semantics.",
        "Camera and shot choices must not change Script actions, Character IDs, Product authority, Outline Beat claims, dialogue, evidence, or action outcomes.",
        "Do not add unsupported dialogue, action, Product facts, claims, or evidence.",
      ] : []),
      "Every scene must receive at least one shot.",
      "Use sequential order values starting at 0 and stable shot ids.",
      "Preserve each Scene Plan generationAuthority exactly; Product or Asset presence never selects or changes generation mode. For image-conditioned Product Scenes, the exact approved Product Asset remains visual identity authority.",
      "For PRODUCT_GROUNDED_VIDEO use only identity-safe camera motion: static/locked framing, slow push-in, slow pull-back, minor lateral dolly, a small 10-20 degree arc, close-up detail, rack focus, or gentle parallax.",
      "Never request a 180/360-degree orbit, circle-around-product, unseen-backside reveal, dramatic perspective change, product morphing, or container/wrapping transformation.",
      "Return planning-only camera language; no provider execution fields.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify({ ...input, ...(canonicalScript ? { canonicalScript } : {}) }, null, 2),
    schemaHint,
    z.array(ShotPlanItemSchema).min(1),
    (result) => result.shotPlan
  );
  return {
    shotPlan: bindShotPlanAuthorityLineage({
      planningPackageId: input.planningPackageId,
      scenePlan: input.scenePlan,
      shotPlan: value,
    }),
    usage,
  };
}

export async function generateCharacterContinuity(input: {
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  shotPlan: ShotPlanItem[];
}): Promise<{ characterContinuity: CharacterContinuityEntry[]; usage: Usage }> {
  const schemaHint = JSON.stringify({
    characterContinuity: [
      {
        characterId: "same id from creativeContext when available",
        name: "same character name from creativeContext",
        appearance: "string",
        emotion: "string",
        costume: "string",
        accessories: "string",
        age: "string",
        pose: "string",
        identity: "string",
      },
    ],
  });
  const { value, usage } = await callStage<CharacterContinuityEntry[]>(
    "Character continuity",
    [
      "You are a character continuity supervisor.",
      "Only create entries for characters present in creativeContext.characterContext.characters.",
      "For canonical Characters, copy the exact characterId and treat canonical identity and appearance as immutable; generate only evolving emotion, costume, accessories, and pose state.",
      "Return stable identity, appearance, emotion, costume, accessories, age, and pose guidance.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    z.array(CharacterContinuityEntrySchema),
    (result) => result.characterContinuity
  );
  return {
    characterContinuity: bindCharacterContinuityToCharacterAuthority({
      creativeContext: input.creativeContext,
      characterContinuity: value,
    }),
    usage,
  };
}

export async function generateWorldContinuity(input: {
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  shotPlan: ShotPlanItem[];
}): Promise<{ worldContinuity: WorldContinuity; usage: Usage }> {
  const schemaHint = JSON.stringify({
    worldContinuity: {
      location: "string",
      lighting: "string",
      environment: "string",
      objects: ["string"],
      timeline: "string",
      worldRules: ["string"],
    },
  });
  const { value, usage } = await callStage<WorldContinuity>(
    "World continuity",
    [
      "You are a world continuity supervisor.",
      "Produce non-empty location, lighting, environment, objects, timeline, and world rules.",
      "Return ONLY JSON.",
    ].join(" "),
    JSON.stringify(input, null, 2),
    schemaHint,
    WorldContinuitySchema,
    (result) => result.worldContinuity ?? result
  );
  return { worldContinuity: value, usage };
}

export function buildAnimationPackage(input: {
  story: AiStoryStructuredDraft;
  creativeContext: CreativeContext;
  directorThinking: DirectorThinking;
  storyBeats: StoryBeat[];
  scenePlan: ScenePlanItem[];
  shotPlan: ShotPlanItem[];
  characterContinuity: CharacterContinuityEntry[];
  worldContinuity: WorldContinuity;
  canonicalScenes: AiStoryCanonicalScene[];
  storyId: string;
  storyVersionId: string;
  usage?: Usage;
  episodeContinuity?: import("@ceo-agent/shared").EpisodeContinuityPlanningContext;
}): AnimationPackagePayload {
  const sourcePlanningPackageIds = [...new Set(
    input.shotPlan
      .map((shot) => shot.authorityLineage?.planningPackageId)
      .filter((value): value is string => Boolean(value)),
  )];
  const groundedSceneCount = input.scenePlan.filter((scene) => scene.groundingLineage).length;
  if (groundedSceneCount > 0 && sourcePlanningPackageIds.length !== 1) {
    throw new Error("ANIMATION_PACKAGE_SOURCE_PLANNING_AUTHORITY_INVALID");
  }
  const creativeContext: CreativeContext = {
    ...input.creativeContext,
    directorContext: input.directorThinking,
  };
  const draftPackage = AnimationPackagePayloadSchema.parse({
    ...(sourcePlanningPackageIds[0]
      ? { sourcePlanningPackageId: sourcePlanningPackageIds[0] }
      : {}),
    story: input.story,
    characters: creativeContext.characterContext.characters,
    creativeContext,
    directorThinking: input.directorThinking,
    storyBeats: input.storyBeats,
    scenePlan: input.scenePlan,
    shotPlan: input.shotPlan,
    characterContinuity: input.characterContinuity,
    worldContinuity: input.worldContinuity,
    episodeContinuity: input.episodeContinuity,
    canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      scenePlan: input.scenePlan,
      canonicalScenes: input.canonicalScenes,
    }),
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: false, issues: [], links: [] },
    status: "review",
    usage: input.usage,
  });
  const narrativeIntegration = validatePlanningConsistency(draftPackage);
  return AnimationPackagePayloadSchema.parse({
    ...draftPackage,
    narrativeIntegration,
  });
}

export async function runFullStoryPlanningPipeline(
  input: StoryPlanningPipelineInput
): Promise<AnimationPackagePayload> {
  let usage: Usage = { input: 0, output: 0, costUsd: 0 };

  const creative = await generateCreativeContext(
    input.storyDraft,
    input.campaign,
    input.brand,
    input.assetLabels ?? [],
    input.characterAuthorities ?? [],
    input.productAuthorities ?? []
  );
  usage = addUsage(usage, creative.usage);

  const director = await generateDirectorThinking(input.storyDraft, creative.creativeContext);
  usage = addUsage(usage, director.usage);

  const beats = await generateStoryBeats({
    story: input.storyDraft,
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
  });
  usage = addUsage(usage, beats.usage);

  const scenes = await generateScenePlan({
    story: input.storyDraft,
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
  });
  usage = addUsage(usage, scenes.usage);

  const shots = await generateShotPlan({
    story: input.storyDraft,
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
    canonicalScript: input.canonicalScript,
  });
  usage = addUsage(usage, shots.usage);

  const characterContinuity = await generateCharacterContinuity({
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
    shotPlan: shots.shotPlan,
  });
  usage = addUsage(usage, characterContinuity.usage);

  const worldContinuity = await generateWorldContinuity({
    creativeContext: creative.creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
    shotPlan: shots.shotPlan,
  });
  usage = addUsage(usage, worldContinuity.usage);

  const creativeContext = {
    ...creative.creativeContext,
    directorContext: director.directorThinking,
  };
  const legacyPackage = AnimationPackagePayloadSchema.parse({
    story: input.storyDraft,
    characters: creativeContext.characterContext.characters,
    creativeContext,
    directorThinking: director.directorThinking,
    storyBeats: beats.storyBeats,
    scenePlan: scenes.scenePlan,
    shotPlan: shots.shotPlan,
    characterContinuity: characterContinuity.characterContinuity,
    worldContinuity: worldContinuity.worldContinuity,
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: false, issues: [], links: [] },
    status: "review",
    usage,
  });
  return AnimationPackagePayloadSchema.parse({
    ...legacyPackage,
    narrativeIntegration: validatePlanningConsistency(legacyPackage),
  });
}
