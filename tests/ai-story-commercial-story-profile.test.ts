import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE,
  AI_STORY_COMMERCIAL_STORY_PROFILE_ID,
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_MARKETING_INTENT_BRIDGE_CONTRACT_VERSION,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  CAUSAL_STORY_PROGRESSION,
  COMMERCIAL_INTEGRATION_CAUSALITY,
  COMMERCIAL_PAYOFF_AUTHORITY,
  MARKETING_INTENT_TO_STORY_BRIDGE,
  PRODUCT_NOT_REQUIRED_EVERY_SCENE,
  PRODUCT_STORY_PROFILE_SEPARATION,
  STORY_FIRST_NARRATIVE_AUTHORITY,
  consumeMarketingIntentSnapshot,
  type AiStoryOutlineVersion,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  computeAiStoryCommercialStoryProfilePolicyFingerprint,
  validateAiStoryCommercialStoryProfile,
  validateAiStoryProductStoryProfile,
} from "@ceo-agent/shared/server";
import { resolveAiStoryWriterProfileGuidance } from "../packages/agents/src/ai-story/product-story-writer-profile";

const id = (n: number) => `86000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  org: id(1), workspace: id(2), story: id(3), storyVersion: id(4), unit: id(5),
  beatA: id(6), beatB: id(7), beatC: id(8), beatD: id(9), beatE: id(10),
  sceneA: id(11), sceneB: id(12), sceneC: id(13), sceneD: id(14), sceneE: id(15),
  entryA: id(16), entryB: id(17), entryC: id(18), entryD: id(19), entryE: id(20),
  actor: id(21), character: id(22), product: id(23), hook: id(24), relation: id(25), outcome: id(26),
};
const frozen = <T extends { status: string; approvedBy: string | null; approvedAt: string | null; frozenAt: string | null }>(value: T): T => ({
  ...value, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-09-21T06:00:00.000Z", frozenAt: "2026-09-21T06:01:00.000Z",
});

const beats = [
  { id: I.beatA, name: "Setup", purpose: "Establish the opening situation", summary: "The audience meets the initial state" },
  { id: I.beatB, name: "Need", purpose: "Make the want or problem felt", summary: "A want or obstacle becomes clear" },
  { id: I.beatC, name: "Turn", purpose: "Commercial subject participates", summary: "The commercial subject changes the situation" },
  { id: I.beatD, name: "Consequence", purpose: "Show the resulting change", summary: "The world is different because of the turn" },
  { id: I.beatE, name: "Payoff", purpose: "Resolve story and advertising", summary: "Story meaning and brand resolution complete together" },
];

function commercialPolicy(overrides: Record<string, unknown> = {}) {
  return {
    campaignObjective: "awareness",
    storyIntent: "A forgotten day becomes remembered through a gift that arrives because of the story",
    audienceIntent: "people who gift under time pressure",
    desiredEmotion: "warmth",
    commercialRole: "PRODUCT",
    productOrServiceAuthorityRefs: [I.product],
    integrationPolicy: "CAUSAL_REQUIRED",
    ctaPolicy: "OPTIONAL",
    brandResolutionPolicy: "REQUIRED",
    userCreativeIntent: ["Keep the opening human and do not force Product into every Scene"],
    storyCausality: {
      storyQuestion: "Will the exhausted closer realize the day was not forgotten?",
      protagonistOrFocus: "late-night florist",
      protagonistKind: "PERSON",
      initialState: "exhausted and believes the day was forgotten",
      wantOrNeed: "to feel that someone remembered",
      obstacleOrTension: "the shop is closing and the day feels empty",
      actions: ["closes the shop", "notices an unexpected delivery", "opens the package", "reads the card"],
      turningPoint: "flowers and a card are discovered",
      resolution: "the closer realizes someone remembered",
      finalState: "emotionally connected and remembered",
      audienceTakeaway: "the gift changed the meaning of the day",
    },
    commercialIntegration: {
      commercialAuthorityRefs: [I.product],
      integrationType: "PRODUCT",
      entryPoint: { kind: "SCENE_ORDER", sceneOrder: 2 },
      narrativeFunction: "PRODUCT_INTERVENTION",
      preIntegrationState: "character believes the day was forgotten",
      commercialActionOrParticipation: "REVEAL",
      postIntegrationState: "character realizes someone remembered",
      storyConsequence: "emotional state changes because the gift arrived",
      audienceUnderstanding: "the bouquet matters because of the story, not as a glamour insert",
      naturalnessRationale: "the bouquet enters as the discovered delivery that answers the opening need",
    },
    commercialPayoff: {
      payoffType: "EMOTIONAL_ASSOCIATION",
      brandMeaning: "remembered, not forgotten",
      benefitOrOutcome: "the gift restored emotional connection",
      productOrServiceResolution: "the bouquet is the discovered proof that someone remembered",
      ctaStrategy: "BRAND_RESOLUTION",
      ctaTiming: "ENDING",
      packshotPolicy: "OPTIONAL",
      brandVisibilityPolicy: "OPTIONAL",
    },
    marketingIntentKind: "MARKETING_INTENT_ABSENT_LEGACY",
    ...overrides,
  };
}

function commercialOutline(overrides: Record<string, unknown> = {}): AiStoryOutlineVersion {
  const policy = commercialPolicy(overrides.commercialStoryProfile as Record<string, unknown> | undefined);
  const { commercialStoryProfile: _ignored, ...rest } = overrides;
  return frozen(buildAiStoryOutlineVersion({
    storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, version: 1,
    profile: { profileId: AI_STORY_COMMERCIAL_STORY_PROFILE_ID, profileVersion: 1, policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT },
    commercialStoryProfile: policy,
    premise: "A person experiences an emotionally meaningful situation in which a gift participates naturally",
    coreClaim: "The bouquet enters because of the Story and resolves both the Story and the advertising intent",
    storyUnits: [{ storyUnitId: I.unit, order: 0, purpose: "Complete commercial narrative", summary: "Setup, discovery, participation, consequence, brand resolution", requiredBeatIds: beats.map((beat) => beat.id), hookId: I.hook, terminalPayoffId: I.relation }],
    beats: beats.map((beat, order) => ({
      id: beat.id, storyUnitId: I.unit, order, classification: "MAJOR" as const, name: beat.name, purpose: beat.purpose, summary: beat.summary, required: true, ownershipPolicy: "EXCLUSIVE" as const,
      authorityReferences: order === 2 ? [{ authorityType: "PRODUCT" as const, authorityId: I.product }] : [],
    })),
    hooks: [{ hookId: I.hook, semantics: "SITUATIONAL", promiseOrQuestion: "Will the forgotten day be remembered?", beatId: I.beatA, requiredByProfile: true }],
    setupPayoffs: [{ relationshipId: I.relation, setupBeatId: I.beatA, payoffBeatId: I.beatE, relationshipType: "NEED_RESOLUTION", required: true, intent: "Opening exhaustion resolves as remembered connection" }],
    requiredSceneOutcomes: [{ outcomeId: I.outcome, order: 0, outcomeType: "CREATE_DECISION_OR_CHANGE", description: "Emotional state changes because the gift participates", beatIds: [I.beatC, I.beatD], authorityReferences: [{ authorityType: "PRODUCT", authorityId: I.product }] }],
    authorityReferences: [{ authorityType: "CHARACTER", authorityId: I.character }, { authorityType: "PRODUCT", authorityId: I.product }],
    upstreamAuthorityId: `campaign:${I.storyVersion}`, supersedesOutlineVersionId: null, createdBy: I.actor, createdAt: "2026-09-21T05:00:00.000Z",
    ...rest,
  }));
}

type SceneSpec = {
  id: string; beatId: string; entryId: string; order: number; sceneFunction: AiStoryScriptVersion["scenes"][number]["sceneFunction"];
  narrativeFunction: string; action: string; effect: string; information: string;
  product?: boolean; contribution?: NonNullable<AiStoryScriptVersion["scenes"][number]["commercialContribution"]>;
  preconditions?: string[]; consequence?: string;
  stateIn?: AiStoryScriptVersion["scenes"][number]["sceneStateIn"];
  deltas?: AiStoryScriptVersion["scenes"][number]["sceneStateDeltas"];
  stateOut?: AiStoryScriptVersion["scenes"][number]["sceneStateOut"];
};

function sceneFrom(spec: SceneSpec): AiStoryScriptVersion["scenes"][number] {
  return {
    scriptSceneId: spec.id, order: spec.order, outlineBeatClaims: [{ outlineBeatId: spec.beatId, claim: spec.effect }],
    sceneFunction: spec.sceneFunction, sceneFunctionRegistryVersion: 1,
    sceneStateIn: spec.stateIn ?? [], sceneStateDeltas: spec.deltas ?? [], sceneStateOut: spec.stateOut ?? spec.stateIn ?? [],
    entries: [{ entryId: spec.entryId, order: 0, type: "ACTION", subjectId: I.character, ...(spec.product ? { objectId: I.product } : {}), action: spec.action, storyEffect: spec.effect, durationRange: { minSeconds: 2, maxSeconds: 4 } }],
    characterIds: [I.character], locationIds: [], propIds: [], assetIds: spec.product ? [I.product] : [], productAuthorityRefs: spec.product ? [I.product] : [],
    targetDurationRange: { minSeconds: 3, maxSeconds: 7 }, mustKeep: ["Story causality"], mustAvoid: ["Unsupported claims"],
    newInformation: [spec.information], newEvidence: spec.product ? ["Commercial subject participates"] : [], newActionOutcomes: [spec.effect], productEvidence: spec.product ? ["Canonical commercial subject"] : [],
    narrativeFunction: spec.narrativeFunction, causalPreconditions: spec.preconditions ?? [], storyConsequence: spec.consequence ?? spec.effect,
    ...(spec.contribution ? { commercialContribution: spec.contribution } : {}),
  };
}

const flowerScenes = (): SceneSpec[] => [
  {
    id: I.sceneA, beatId: I.beatA, entryId: I.entryA, order: 0, sceneFunction: "INTRODUCE", narrativeFunction: "SETUP",
    action: "The florist locks the door, visibly exhausted at closing.", effect: "The audience meets an exhausted closer whose day feels forgotten",
    information: "The shop is closing and the closer is exhausted",
    stateIn: [{ dimension: "PHYSICAL_CONDITION", subjectId: I.character, value: "exhausted" }, { dimension: "KNOWLEDGE", subjectId: I.character, value: "unaware" }],
    stateOut: [{ dimension: "PHYSICAL_CONDITION", subjectId: I.character, value: "exhausted" }, { dimension: "KNOWLEDGE", subjectId: I.character, value: "unaware" }],
    consequence: "The audience understands the forgotten-day need",
  },
  {
    id: I.sceneB, beatId: I.beatB, entryId: I.entryB, order: 1, sceneFunction: "REVEAL", narrativeFunction: "DISCOVERY",
    action: "An unexpected delivery waits where none was expected.", effect: "The closer notices a package that should not be there",
    information: "An unexpected delivery appears",
    preconditions: ["The closer is exhausted and believes the day was forgotten"],
    stateIn: [{ dimension: "PHYSICAL_CONDITION", subjectId: I.character, value: "exhausted" }, { dimension: "KNOWLEDGE", subjectId: I.character, value: "unaware" }],
    deltas: [{ dimension: "KNOWLEDGE", subjectId: I.character, fromValue: "unaware", value: "notices package", reason: "Unexpected delivery is discovered" }],
    stateOut: [{ dimension: "PHYSICAL_CONDITION", subjectId: I.character, value: "exhausted" }, { dimension: "KNOWLEDGE", subjectId: I.character, value: "notices package" }],
    consequence: "Curiosity replaces emptiness",
  },
  {
    id: I.sceneC, beatId: I.beatC, entryId: I.entryC, order: 2, sceneFunction: "REVEAL", narrativeFunction: "PRODUCT_INTERVENTION", product: true,
    action: "The closer opens the delivery and finds flowers with a card.", effect: "The bouquet reveals that someone remembered",
    information: "The flowers become narratively important",
    preconditions: ["An unexpected package has been noticed"],
    stateIn: [{ dimension: "PHYSICAL_CONDITION", subjectId: I.character, value: "exhausted" }, { dimension: "KNOWLEDGE", subjectId: I.character, value: "notices package" }],
    deltas: [{ dimension: "KNOWLEDGE", subjectId: I.character, fromValue: "notices package", value: "discovers remembered gift", reason: "Flowers and card answer the forgotten-day need" }],
    stateOut: [{ dimension: "PHYSICAL_CONDITION", subjectId: I.character, value: "exhausted" }, { dimension: "KNOWLEDGE", subjectId: I.character, value: "discovers remembered gift" }],
    contribution: { commercialRole: "PRODUCT", narrativeFunction: "PRODUCT_INTERVENTION", participationKind: "REVEAL", commercialAuthorityIds: [I.product], preState: "believes the day was forgotten", postState: "realizes someone remembered", storyConsequence: "emotional meaning of the day changes" },
    consequence: "The gift participates by revealing remembrance",
  },
  {
    id: I.sceneD, beatId: I.beatD, entryId: I.entryD, order: 3, sceneFunction: "DEMONSTRATE", narrativeFunction: "REACTION",
    action: "The closer holds the card and the exhaustion gives way to connection.", effect: "Emotional state changes because the gift arrived",
    information: "The closer feels remembered",
    preconditions: ["The bouquet has revealed that someone remembered"],
    stateIn: [{ dimension: "KNOWLEDGE", subjectId: I.character, value: "discovers remembered gift" }, { dimension: "RELATIONSHIP", subjectId: I.character, value: "forgotten" }],
    deltas: [{ dimension: "RELATIONSHIP", subjectId: I.character, fromValue: "forgotten", value: "remembered", reason: "The discovered gift changes emotional relation" }],
    stateOut: [{ dimension: "KNOWLEDGE", subjectId: I.character, value: "discovers remembered gift" }, { dimension: "RELATIONSHIP", subjectId: I.character, value: "remembered" }],
    consequence: "Emotional consequence of the gift is visible",
  },
  {
    id: I.sceneE, beatId: I.beatE, entryId: I.entryE, order: 4, sceneFunction: "PAYOFF", narrativeFunction: "BRAND_RESOLUTION",
    action: "The remembered closer keeps the flowers as the day resolves.", effect: "Story resolution and brand meaning complete together",
    information: "Brand meaning becomes the interpretation of what the audience watched",
    preconditions: ["Emotional state has changed because the gift participated"],
    stateIn: [{ dimension: "RELATIONSHIP", subjectId: I.character, value: "remembered" }],
    deltas: [{ dimension: "COMMITMENT", subjectId: I.character, fromValue: "none", value: "brand-associated remembrance", reason: "Advertising payoff interprets the story consequence" }],
    stateOut: [{ dimension: "RELATIONSHIP", subjectId: I.character, value: "remembered" }, { dimension: "COMMITMENT", subjectId: I.character, value: "brand-associated remembrance" }],
    contribution: { commercialRole: "PRODUCT", narrativeFunction: "BRAND_RESOLUTION", participationKind: "RESOLVE", commercialAuthorityIds: [I.product], preState: "emotional change has occurred", postState: "brand meaning is the consequence of the story", storyConsequence: "advertising completes without replacing causality" },
    consequence: "Commercial payoff is the interpretation of the story",
    product: true,
  },
];

function commercialScript(source: AiStoryOutlineVersion, specs = flowerScenes()): AiStoryScriptVersion {
  const scenes = specs.map(sceneFrom);
  const productUsed = scenes.some((scene) => scene.productAuthorityRefs.length > 0);
  return frozen(buildAiStoryScriptVersion({
    storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: source.outlineVersionId, orgId: I.org, workspaceId: I.workspace, version: 1,
    profileId: "COMMERCIAL_STORY", profileVersion: 1, outlineSourceHash: source.sourceHash, scenes,
    authorityReferences: [
      { authorityType: "CHARACTER", authorityId: I.character },
      ...(productUsed ? [{ authorityType: "PRODUCT" as const, authorityId: I.product }, { authorityType: "ASSET" as const, authorityId: I.product }] : []),
    ],
    supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-09-21T05:10:00.000Z",
  }));
}

const blocks = (outline = commercialOutline(), script = commercialScript(outline), marketing?: unknown | null) =>
  validateAiStoryCommercialStoryProfile(outline, script, marketing).filter((issue) => issue.severity === "BLOCK");

const marketingSnapshot = {
  contractVersion: AI_STORY_MARKETING_INTENT_BRIDGE_CONTRACT_VERSION,
  campaignJob: "EMOTIONAL_STORY" as const,
  storyPlusAdvertising: true as const,
  source: "UPSTREAM_READ_ONLY" as const,
  regeneratesMarketingPlan: false as const,
  sceneIntents: [{ sceneOrder: 0, narrativeFunction: "SETUP", advertisingFunction: "EMOTION" as const }],
  primaryGoal: "awareness" as const,
  targetAudience: "people who gift under time pressure",
  desiredEmotion: "warmth",
  ctaStrategy: "OPTIONAL" as const,
  keyMessage: "Remembered, not forgotten",
};

function serviceOutline() {
  return commercialOutline({
    commercialStoryProfile: commercialPolicy({
      commercialRole: "SERVICE",
      productOrServiceAuthorityRefs: [],
      storyIntent: "An unusable home becomes ready because a cleaning service participates",
      storyCausality: {
        storyQuestion: "Can the home be made usable before guests arrive?",
        protagonistOrFocus: "the unusable home",
        protagonistKind: "PLACE",
        initialState: "home is unusable before guests arrive",
        wantOrNeed: "a usable space to welcome guests",
        obstacleOrTension: "mess makes hosting impossible",
        actions: ["recognize the unusable space", "cleaning service works", "space becomes usable"],
        turningPoint: "cleaning action restores the room",
        resolution: "the host can welcome guests",
        finalState: "usable clean environment and host relief",
        audienceTakeaway: "the service solved the hosting problem",
      },
      commercialIntegration: {
        commercialAuthorityRefs: [],
        integrationType: "SERVICE",
        entryPoint: { kind: "SCENE_ORDER", sceneOrder: 2 },
        narrativeFunction: "SERVICE_INTERVENTION",
        preIntegrationState: "home is unusable",
        commercialActionOrParticipation: "SOLVE",
        postIntegrationState: "space is usable",
        storyConsequence: "host can welcome guests",
        audienceUnderstanding: "the service caused the usable result",
        naturalnessRationale: "cleaning is the action that changes the home",
      },
      commercialPayoff: {
        payoffType: "CONVERSION",
        brandMeaning: "the home is ready because the service acted",
        benefitOrOutcome: "customer relief and usable space",
        productOrServiceResolution: "cleaning restored function",
        ctaStrategy: "REQUIRED",
        ctaTiming: "ENDING",
        packshotPolicy: "NOT_REQUIRED",
        brandVisibilityPolicy: "OPTIONAL",
      },
      campaignObjective: "lead_generation",
      ctaPolicy: "REQUIRED",
    }),
    authorityReferences: [{ authorityType: "CHARACTER", authorityId: I.character }],
    requiredSceneOutcomes: [{ outcomeId: I.outcome, order: 0, outcomeType: "DEMONSTRATE_CONSEQUENCE", description: "Service restores a usable home", beatIds: [I.beatC, I.beatD], authorityReferences: [] }],
  });
}

function retarget(specs: SceneSpec[], patch: Partial<SceneSpec> & { order: number }) {
  return specs.map((spec) => spec.order === patch.order ? { ...spec, ...patch } : spec);
}

describe("AI Story COMMERCIAL_STORY profile", () => {
  it("COMMERCIAL_STORY PROFILE SCHEMA PASS and PROFILE REGISTRY COMPATIBILITY PASS", () => {
    expect(computeAiStoryCommercialStoryProfilePolicyFingerprint()).toBe(AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT);
    const outline = commercialOutline();
    expect(outline.profile).toMatchObject({ profileId: "COMMERCIAL_STORY", profileVersion: 1, policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT });
    expect(blocks(outline, commercialScript(outline))).toEqual([]);
    expect(AI_STORY_COMMERCIAL_STORY_PROFILE).toBe("CERTIFIED");
    expect(STORY_FIRST_NARRATIVE_AUTHORITY).toBe("CERTIFIED");
    expect(CAUSAL_STORY_PROGRESSION).toBe("CERTIFIED");
    expect(COMMERCIAL_INTEGRATION_CAUSALITY).toBe("CERTIFIED");
    expect(COMMERCIAL_PAYOFF_AUTHORITY).toBe("CERTIFIED");
    expect(PRODUCT_NOT_REQUIRED_EVERY_SCENE).toBe("CERTIFIED");
    expect(PRODUCT_STORY_PROFILE_SEPARATION).toBe("CERTIFIED");
    expect(MARKETING_INTENT_TO_STORY_BRIDGE).toBe("CERTIFIED");
  });

  it("CORE LEGACY PASS and PRODUCT_STORY LEGACY PASS", () => {
    const core = frozen(buildAiStoryOutlineVersion({
      storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, version: 1,
      profile: { profileId: "CORE", profileVersion: 1 }, premise: "Generic narrative", coreClaim: "A change occurs",
      storyUnits: [], beats: [{ id: I.beatA, order: 0, classification: "MAJOR", name: "Beat", purpose: "Happen", summary: "A beat", required: true, ownershipPolicy: "EXCLUSIVE", authorityReferences: [] }],
      hooks: [], setupPayoffs: [], requiredSceneOutcomes: [], authorityReferences: [], upstreamAuthorityId: "legacy", supersedesOutlineVersionId: null, createdBy: I.actor, createdAt: "2026-09-21T05:00:00.000Z",
    }));
    expect(validateAiStoryCommercialStoryProfile(core)).toEqual([]);
    const product = frozen(buildAiStoryOutlineVersion({
      storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, version: 1,
      profile: { profileId: "PRODUCT_STORY", profileVersion: 1, policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT },
      productStoryProfile: {
        campaignObjective: "awareness", customObjective: null, productAuthorityIds: [I.product],
        progressionGoals: [{ goalId: id(40), semanticFunction: "PRODUCT_INTRODUCTION", required: true, beatIds: [I.beatA], requiredSceneOutcomeIds: [], intent: "Introduce" }],
        claimEvidence: [], ctaPolicy: "OPTIONAL", packshotPolicy: "OPTIONAL", userCreativeIntent: [],
      },
      premise: "Product progression", coreClaim: "Evidence earns trust", storyUnits: [],
      beats: [{ id: I.beatA, order: 0, classification: "MAJOR", name: "Intro", purpose: "Show Product", summary: "Identity", required: true, ownershipPolicy: "EXCLUSIVE", authorityReferences: [{ authorityType: "PRODUCT", authorityId: I.product }] }],
      hooks: [], setupPayoffs: [], requiredSceneOutcomes: [], authorityReferences: [{ authorityType: "PRODUCT", authorityId: I.product }],
      upstreamAuthorityId: "legacy-product", supersedesOutlineVersionId: null, createdBy: I.actor, createdAt: "2026-09-21T05:00:00.000Z",
    }));
    expect(validateAiStoryCommercialStoryProfile(product)).toEqual([]);
  });

  it("MARKETING INTENT SNAPSHOT CONSUMPTION PASS and MARKETING_INTENT_ABSENT_LEGACY PASS", () => {
    const absent = commercialOutline();
    expect(absent.commercialStoryProfile!.marketingIntentKind).toBe("MARKETING_INTENT_ABSENT_LEGACY");
    expect(consumeMarketingIntentSnapshot(null).kind).toBe("MARKETING_INTENT_ABSENT_LEGACY");
    expect(blocks(absent, commercialScript(absent), null)).toEqual([]);
    const present = commercialOutline({
      commercialStoryProfile: commercialPolicy({ marketingIntentKind: "MARKETING_INTENT_SNAPSHOT", ctaPolicy: "OPTIONAL" }),
    });
    expect(consumeMarketingIntentSnapshot(marketingSnapshot)).toMatchObject({ kind: "MARKETING_INTENT_SNAPSHOT", regeneratesMarketingPlan: false, campaignObjective: "awareness", audienceIntent: "people who gift under time pressure", desiredEmotion: "warmth" });
    expect(blocks(present, commercialScript(present), marketingSnapshot)).toEqual([]);
    const drifted = commercialOutline({
      commercialStoryProfile: commercialPolicy({ marketingIntentKind: "MARKETING_INTENT_SNAPSHOT", campaignObjective: "sales", ctaPolicy: "REQUIRED" }),
    });
    expect(validateAiStoryCommercialStoryProfile(drifted, commercialScript(drifted), marketingSnapshot)).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "MARKETING_INTENT_CONSUMPTION_GATE", reasonCode: "MARKETING_INTENT_OBJECTIVE_DRIFT" })]));
  });

  it("NARRATIVE_HOOK_GATE PASS, CAUSAL_PROGRESSION_GATE PASS, STATE_CHANGE_GATE PASS, SCENE_PURPOSE_PROGRESSION_GATE PASS, COMMERCIAL_INTEGRATION_GATE PASS, COMMERCIAL_PAYOFF_GATE PASS", () => {
    const outline = commercialOutline();
    const issues = validateAiStoryCommercialStoryProfile(outline, commercialScript(outline));
    for (const gate of ["NARRATIVE_HOOK_GATE", "CAUSAL_PROGRESSION_GATE", "STATE_CHANGE_GATE", "SCENE_PURPOSE_PROGRESSION_GATE", "COMMERCIAL_INTEGRATION_GATE", "COMMERCIAL_PAYOFF_GATE"]) {
      expect(issues.filter((issue) => issue.gate === gate && issue.severity === "BLOCK")).toEqual([]);
    }
  });

  it("PRODUCT NOT REQUIRED IN EVERY SCENE PASS and PRODUCT NOT REQUIRED IN OPENING PASS", () => {
    const script = commercialScript(commercialOutline());
    expect(script.scenes[0]!.productAuthorityRefs).toEqual([]);
    expect(script.scenes.some((scene) => scene.productAuthorityRefs.length === 0)).toBe(true);
    expect(script.scenes.some((scene) => scene.productAuthorityRefs.length > 0)).toBe(true);
    expect(blocks()).toEqual([]);
  });

  it("FLOWER ORIGINAL-VISION FIXTURE PASS", () => {
    const outline = commercialOutline();
    const script = commercialScript(outline);
    const issues = blocks(outline, script);
    expect(issues).toEqual([]);
    expect(script.scenes[0]!.productAuthorityRefs).toEqual([]);
    expect(script.scenes[2]!.commercialContribution?.participationKind).toBe("REVEAL");
  });

  it("Flower / Gift Product broken random bouquet insert BLOCK", () => {
    const outline = commercialOutline();
    const specs = retarget(flowerScenes(), {
      order: 2, sceneFunction: "PRODUCT_DETAIL_REVEAL", narrativeFunction: "PRODUCT_DETAIL_REVEAL", product: true,
      action: "A bouquet glamour shot appears without relation to closing the shop.", effect: "Product is displayed",
      information: "Bouquet close-up", preconditions: [], contribution: undefined, deltas: [],
      stateIn: [{ dimension: "KNOWLEDGE", subjectId: I.character, value: "notices package" }],
      stateOut: [{ dimension: "KNOWLEDGE", subjectId: I.character, value: "notices package" }],
      consequence: "Product is shown",
    });
    expect(validateAiStoryCommercialStoryProfile(outline, commercialScript(outline, specs))).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "COMMERCIAL_INTEGRATION_GATE" })]));
  });

  it("SERVICE STORY WITHOUT PRODUCT PASS", () => {
    const outline = serviceOutline();
    const specs = flowerScenes().map((spec, index) => ({
      ...spec,
      product: false,
      contribution: index === 2 ? { commercialRole: "SERVICE" as const, narrativeFunction: "SERVICE_INTERVENTION", participationKind: "SOLVE" as const, commercialAuthorityIds: [], preState: "home unusable", postState: "home usable", storyConsequence: "host can welcome guests" } : spec.order === 4 ? { commercialRole: "SERVICE" as const, narrativeFunction: "CTA", participationKind: "RESOLVE" as const, commercialAuthorityIds: [], preState: "relief", postState: "service brand payoff", storyConsequence: "CTA completes the service story" } : undefined,
      narrativeFunction: index === 2 ? "SERVICE_INTERVENTION" : spec.narrativeFunction,
    }));
    expect(blocks(outline, commercialScript(outline, specs))).toEqual([]);
    expect(commercialScript(outline, specs).scenes.every((scene) => scene.productAuthorityRefs.length === 0)).toBe(true);
  });

  it("Food / Restaurant PASS and Repair / Technical Service PASS and Emotional Brand Story PASS", () => {
    const food = commercialOutline({
      commercialStoryProfile: commercialPolicy({
        commercialRole: "EXPERIENCE",
        productOrServiceAuthorityRefs: [],
        storyCausality: {
          storyQuestion: "Will unfinished ingredients become a plated experience?",
          protagonistOrFocus: "the dish",
          protagonistKind: "MEAL",
          initialState: "ingredients unfinished",
          wantOrNeed: "a finished plated dish",
          obstacleOrTension: "the dish is incomplete",
          actions: ["prepare", "transform", "plate"],
          turningPoint: "plating completes the dish",
          resolution: "customer experience becomes available",
          finalState: "finished plated dish ready for experience",
          audienceTakeaway: "the restaurant process created the payoff",
        },
        commercialIntegration: {
          commercialAuthorityRefs: [], integrationType: "EXPERIENCE", entryPoint: { kind: "SCENE_ORDER", sceneOrder: 2 },
          narrativeFunction: "TRANSFORMATION", preIntegrationState: "ingredients unfinished", commercialActionOrParticipation: "ENABLE",
          postIntegrationState: "dish is plated", storyConsequence: "experience becomes available", audienceUnderstanding: "process created the meal",
          naturalnessRationale: "preparation is the story",
        },
        commercialPayoff: {
          payoffType: "EXPERIENCE_CLOSE", brandMeaning: "the restaurant made the experience possible", benefitOrOutcome: "plated dish ready",
          productOrServiceResolution: "kitchen process completed", ctaStrategy: "BRAND_RESOLUTION", ctaTiming: "ENDING", packshotPolicy: "NOT_REQUIRED", brandVisibilityPolicy: "OPTIONAL",
        },
      }),
      authorityReferences: [{ authorityType: "CHARACTER", authorityId: I.character }],
    });
    const foodSpecs = flowerScenes().map((spec, index) => ({
      ...spec, product: false,
      narrativeFunction: index === 2 ? "TRANSFORMATION" : spec.narrativeFunction,
      contribution: index === 2 || index === 4 ? { commercialRole: "EXPERIENCE" as const, narrativeFunction: index === 2 ? "TRANSFORMATION" : "BRAND_RESOLUTION", participationKind: index === 2 ? "ENABLE" as const : "RESOLVE" as const, commercialAuthorityIds: [], preState: "unfinished", postState: "plated", storyConsequence: "experience available" } : undefined,
    }));
    expect(blocks(food, commercialScript(food, foodSpecs))).toEqual([]);

    const repair = commercialOutline({
      commercialStoryProfile: commercialPolicy({
        commercialRole: "SERVICE", productOrServiceAuthorityRefs: [],
        storyCausality: {
          storyQuestion: "Will the failed appliance work again?",
          protagonistOrFocus: "the failed appliance",
          protagonistKind: "OBJECT",
          initialState: "appliance failed",
          wantOrNeed: "restored function",
          obstacleOrTension: "the device does not work",
          actions: ["diagnose", "repair", "verify"],
          turningPoint: "repair action restores function",
          resolution: "the appliance works",
          finalState: "restored function",
          audienceTakeaway: "the service repaired the failure",
        },
        commercialIntegration: {
          commercialAuthorityRefs: [], integrationType: "SERVICE", entryPoint: { kind: "SCENE_ORDER", sceneOrder: 2 },
          narrativeFunction: "SERVICE_INTERVENTION", preIntegrationState: "failed", commercialActionOrParticipation: "SOLVE",
          postIntegrationState: "restored", storyConsequence: "function returns", audienceUnderstanding: "repair caused restoration",
          naturalnessRationale: "diagnosis then repair",
        },
        commercialPayoff: {
          payoffType: "BRAND_RESOLUTION", brandMeaning: "function restored by the service", benefitOrOutcome: "working appliance",
          productOrServiceResolution: "repair completed", ctaStrategy: "OPTIONAL", ctaTiming: "ENDING", packshotPolicy: "NOT_REQUIRED", brandVisibilityPolicy: "OPTIONAL",
        },
      }),
      authorityReferences: [{ authorityType: "CHARACTER", authorityId: I.character }],
    });
    const repairSpecs = flowerScenes().map((spec, index) => ({
      ...spec, product: false,
      narrativeFunction: index === 2 ? "SERVICE_INTERVENTION" : spec.narrativeFunction,
      contribution: index === 2 || index === 4 ? { commercialRole: "SERVICE" as const, narrativeFunction: index === 2 ? "SERVICE_INTERVENTION" : "BRAND_RESOLUTION", participationKind: index === 2 ? "SOLVE" as const : "RESOLVE" as const, commercialAuthorityIds: [], preState: "failed", postState: "restored", storyConsequence: "function returns" } : undefined,
    }));
    expect(blocks(repair, commercialScript(repair, repairSpecs))).toEqual([]);

    const brand = commercialOutline({
      commercialStoryProfile: commercialPolicy({
        commercialRole: "BRAND_ONLY", productOrServiceAuthorityRefs: [],
        storyCausality: {
          storyQuestion: "Will isolation become connection?",
          protagonistOrFocus: "a person alone at night",
          protagonistKind: "PERSON",
          initialState: "alone",
          wantOrNeed: "emotional connection",
          obstacleOrTension: "isolation",
          actions: ["endure isolation", "receive brand-associated intervention", "reconnect"],
          turningPoint: "brand-associated intervention occurs late",
          resolution: "emotional connection returns",
          finalState: "emotionally connected",
          audienceTakeaway: "brand meaning is associated with reconnection",
        },
        commercialIntegration: {
          commercialAuthorityRefs: [], integrationType: "BRAND_ONLY", entryPoint: { kind: "SCENE_ORDER", sceneOrder: 3 },
          narrativeFunction: "TURN", preIntegrationState: "alone", commercialActionOrParticipation: "SYMBOLIZE",
          postIntegrationState: "connected", storyConsequence: "isolation resolves", audienceUnderstanding: "brand is associated not dominant",
          naturalnessRationale: "brand arrives as interpretation of reconnection",
        },
        commercialPayoff: {
          payoffType: "EMOTIONAL_ASSOCIATION", brandMeaning: "connection", benefitOrOutcome: "no longer alone",
          productOrServiceResolution: "brand associated late", ctaStrategy: "BRAND_RESOLUTION", ctaTiming: "ENDING", packshotPolicy: "NOT_REQUIRED", brandVisibilityPolicy: "OPTIONAL",
        },
      }),
      authorityReferences: [{ authorityType: "CHARACTER", authorityId: I.character }],
    });
    const brandSpecs = flowerScenes().map((spec, index) => ({
      ...spec, product: false,
      contribution: index === 3 || index === 4 ? { commercialRole: "BRAND_ONLY" as const, narrativeFunction: index === 3 ? "TURN" : "BRAND_RESOLUTION", participationKind: index === 3 ? "SYMBOLIZE" as const : "RESOLVE" as const, commercialAuthorityIds: [], preState: "alone", postState: "connected", storyConsequence: "isolation resolves" } : undefined,
    }));
    expect(blocks(brand, commercialScript(brand, brandSpecs))).toEqual([]);
    expect(commercialScript(brand, brandSpecs).scenes.filter((scene) => scene.productAuthorityRefs.length > 0)).toHaveLength(0);
  });

  it("GOOD STORY + NO COMMERCIAL RESOLUTION BLOCKED", () => {
    const outline = commercialOutline({
      commercialStoryProfile: commercialPolicy({ commercialIntegration: undefined, productOrServiceAuthorityRefs: [I.product] }),
    });
    const specs = flowerScenes().map((spec) => ({ ...spec, product: false, contribution: undefined }));
    expect(validateAiStoryCommercialStoryProfile(outline, commercialScript(outline, specs))).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "COMMERCIAL_INTEGRATION_GATE", reasonCode: "COMMERCIAL_AUTHORITY_NEVER_PARTICIPATES" })]));
  });

  it("PRODUCT SHOWCASE MISLABELED AS COMMERCIAL_STORY BLOCKED and SAME SHOWCASE UNDER PRODUCT_STORY PASS", () => {
    const showcaseBeats = [
      { id: I.beatA, semantic: "PRODUCT_INTRODUCTION" as const, function: "PRODUCT_INTRODUCTION" as const, claim: "Introduce Product" },
      { id: I.beatB, semantic: "PRODUCT_DETAIL_REVEAL" as const, function: "PRODUCT_DETAIL_REVEAL" as const, claim: "Show detail" },
      { id: I.beatC, semantic: "PRODUCT_PAYOFF" as const, function: "PRODUCT_PAYOFF" as const, claim: "Hero Product" },
      { id: I.beatD, semantic: "CTA" as const, function: "PACKSHOT" as const, claim: "CTA" },
    ];
    const productOutline = frozen(buildAiStoryOutlineVersion({
      storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, version: 1,
      profile: { profileId: "PRODUCT_STORY", profileVersion: 1, policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT },
      productStoryProfile: {
        campaignObjective: "awareness", customObjective: null, productAuthorityIds: [I.product],
        progressionGoals: showcaseBeats.map((beat, index) => ({ goalId: id(50 + index), semanticFunction: beat.semantic, required: true, beatIds: [beat.id], requiredSceneOutcomeIds: [], intent: beat.claim })),
        claimEvidence: [], ctaPolicy: "OPTIONAL", packshotPolicy: "OPTIONAL", userCreativeIntent: [],
      },
      premise: "Product information progression", coreClaim: "Show the Product clearly",
      storyUnits: [{ storyUnitId: I.unit, order: 0, purpose: "Showcase", summary: "Information progression", requiredBeatIds: showcaseBeats.map((beat) => beat.id) }],
      beats: showcaseBeats.map((beat, order) => ({ id: beat.id, storyUnitId: I.unit, order, classification: "MAJOR" as const, name: beat.claim, purpose: beat.claim, summary: beat.claim, required: true, ownershipPolicy: "EXCLUSIVE" as const, authorityReferences: [{ authorityType: "PRODUCT" as const, authorityId: I.product }] })),
      hooks: [], setupPayoffs: [], requiredSceneOutcomes: [], authorityReferences: [{ authorityType: "PRODUCT", authorityId: I.product }, { authorityType: "CHARACTER", authorityId: I.character }],
      upstreamAuthorityId: "showcase", supersedesOutlineVersionId: null, createdBy: I.actor, createdAt: "2026-09-21T05:00:00.000Z",
    }));
    const productScenes = showcaseBeats.map((beat, order) => ({
      scriptSceneId: [I.sceneA, I.sceneB, I.sceneC, I.sceneD][order]!, order, outlineBeatClaims: [{ outlineBeatId: beat.id, claim: beat.claim }],
      sceneFunction: beat.function, sceneFunctionRegistryVersion: 1 as const, sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [],
      entries: [{ entryId: [I.entryA, I.entryB, I.entryC, I.entryD][order]!, order: 0, type: "ACTION" as const, subjectId: I.character, objectId: I.product, action: beat.claim, storyEffect: beat.claim, durationRange: { minSeconds: 2, maxSeconds: 4 } }],
      characterIds: [I.character], locationIds: [], propIds: [], assetIds: [I.product], productAuthorityRefs: [I.product],
      targetDurationRange: { minSeconds: 3, maxSeconds: 7 }, mustKeep: ["Product identity"], mustAvoid: ["Unsupported claims"],
      newInformation: [beat.claim], newEvidence: [], newActionOutcomes: [beat.claim], productEvidence: [beat.claim],
      productStoryContributions: [{ semanticFunction: beat.semantic, contributionTypes: ["NEW_PRODUCT_INFORMATION" as const], productAuthorityIds: [I.product], claimIds: [], summary: beat.claim }],
    }));
    const productScript = frozen(buildAiStoryScriptVersion({
      storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: productOutline.outlineVersionId, orgId: I.org, workspaceId: I.workspace, version: 1,
      profileId: "PRODUCT_STORY", profileVersion: 1, outlineSourceHash: productOutline.sourceHash, scenes: productScenes,
      authorityReferences: [{ authorityType: "CHARACTER", authorityId: I.character }, { authorityType: "PRODUCT", authorityId: I.product }, { authorityType: "ASSET", authorityId: I.product }],
      supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-09-21T05:10:00.000Z",
    }));
    expect(validateAiStoryProductStoryProfile(productOutline, productScript).filter((issue) => issue.severity === "BLOCK")).toEqual([]);

    const mislabeled = commercialOutline({
      commercialStoryProfile: commercialPolicy({
        storyCausality: {
          ...commercialPolicy().storyCausality,
          initialState: "product unknown",
          finalState: "product displayed",
          actions: ["introduce", "detail", "hero", "cta"],
          turningPoint: "hero display",
          resolution: "cta",
        },
      }),
    });
    const commercialShowcase = showcaseBeats.map((beat, order) => ({
      id: [I.sceneA, I.sceneB, I.sceneC, I.sceneD][order]!, beatId: [I.beatA, I.beatB, I.beatC, I.beatD][order]!, entryId: [I.entryA, I.entryB, I.entryC, I.entryD][order]!,
      order, sceneFunction: beat.function, narrativeFunction: beat.semantic, action: beat.claim, effect: beat.claim, information: beat.claim, product: true,
    }));
    expect(validateAiStoryCommercialStoryProfile(mislabeled, commercialScript(mislabeled, commercialShowcase))).toEqual(expect.arrayContaining([
      expect.objectContaining({ gate: "CAUSAL_PROGRESSION_GATE" }),
    ]));
  });

  it("Disconnected slides BLOCK and Writer guidance remains provider-neutral", () => {
    const outline = commercialOutline();
    const slides: SceneSpec[] = [
      { id: I.sceneA, beatId: I.beatA, entryId: I.entryA, order: 0, sceneFunction: "INTRODUCE", narrativeFunction: "SETUP", action: "A woman walking", effect: "Walking", information: "woman walking" },
      { id: I.sceneB, beatId: I.beatB, entryId: I.entryB, order: 1, sceneFunction: "PRODUCT_DETAIL_REVEAL", narrativeFunction: "PRODUCT_DETAIL_REVEAL", action: "Product on a table", effect: "Product display", information: "Product on table", product: true },
      { id: I.sceneC, beatId: I.beatC, entryId: I.entryC, order: 2, sceneFunction: "PRODUCT_PAYOFF", narrativeFunction: "PAYOFF", action: "Product hero", effect: "Hero", information: "Product hero", product: true },
    ];
    expect(validateAiStoryCommercialStoryProfile(outline, commercialScript(outline, slides))).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "CAUSAL_PROGRESSION_GATE", reasonCode: "DISCONNECTED_SLIDE_SEQUENCE" })]));
    const guidance = resolveAiStoryWriterProfileGuidance(outline);
    expect(guidance).toMatchObject({ kind: "COMMERCIAL_STORY" });
    expect(guidance.kind === "COMMERCIAL_STORY" ? guidance.creativeGuidance : []).toEqual(expect.arrayContaining([
      "Write a coherent narrative first.",
      "Do not turn every Scene into a Product showcase.",
      "The Product/service may enter only where narratively justified.",
      "Commercial authority must have a meaningful role by the end.",
      "Preserve Marketing Intent.",
      "Do not invent unsupported Product facts or claims.",
      "Do not force Product presence into Scenes that work better without it.",
    ]));
    const source = readFileSync("packages/shared/src/ai-story-commercial-story-profile.server.ts", "utf8").toLowerCase();
    for (const forbidden of ["seedance", "scene 1 must", "interesting", "viral", "beautiful", "funny enough"]) expect(source).not.toContain(forbidden);
  });

  it("does not encode a rigid Scene-order template and allows namespaced narrative functions", () => {
    const outline = commercialOutline();
    const nonlinear = flowerScenes().map((spec) => ({ ...spec }));
    nonlinear[0]!.narrativeFunction = "HOOK";
    nonlinear[2]!.narrativeFunction = "EXT:example.future:NONLINEAR_REVEAL";
    expect(blocks(outline, commercialScript(outline, nonlinear))).toEqual([]);
    expect(blocks(outline, commercialScript(outline, flowerScenes().slice(0, 4).concat(flowerScenes().slice(4))))).toEqual([]);
  });
});
