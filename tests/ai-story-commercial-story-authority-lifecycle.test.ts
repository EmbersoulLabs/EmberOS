import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryCanonicalSceneSchema,
  AiStoryOutlineVersionSchema,
  AiStoryScriptSemanticProposalV1Schema,
  AiStoryScriptVersionSchema,
  AuthoritativeAnimationPackagePayloadSchema,
  resolveExplicitAiStorySceneGenerationAuthority,
  type AiStoryCanonicalScene,
  type AiStoryOutlineVersion,
  type AiStoryScriptSemanticProposalV1,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  AiStoryScriptSemanticProposalAuthorityError,
  AiStoryScriptSemanticProposalAuthorityService,
  resolveCurrentFrozenOutlineForStoryVersion,
  resolveCurrentFrozenScriptForStoryVersion,
} from "@ceo-agent/db";
import {
  buildAiStoryAnimationPackageCanonicalSceneAuthorityV1,
  buildAiStoryScriptVersion,
  composeAiStoryCanonicalCommercialOutlineV1,
  composeAiStoryCanonicalSceneSetV1,
  computeAiStoryScriptSemanticInputFingerprint,
  promoteAiStoryScriptSemanticProposalV1,
  validateAiStoryCommercialStoryProfile,
} from "@ceo-agent/shared/server";
import { bindShotPlanAuthorityLineage } from "../packages/agents/src/ai-story/story-planning-service";
import { compileSceneExecutionIntents } from "../packages/agents/src/ai-story/scene-execution-compiler";
import {
  AiStoryCanonicalOutlineProducerError,
  ensureCurrentFrozenCanonicalOutline,
  type CanonicalOutlineProducerDependencies,
} from "../apps/web/src/lib/ai-story-canonical-outline-producer";
import {
  AiStoryCanonicalScriptProducerError,
  ensureCurrentFrozenCanonicalScript,
  produceAuthorizedCommercialStoryScriptProposal,
  type CanonicalScriptProducerDependencies,
} from "../apps/web/src/lib/ai-story-canonical-script-producer";
import {
  AiStoryCanonicalSceneProducerError,
  ensureCurrentFrozenCanonicalSceneSet,
  type CanonicalSceneProducerDependencies,
} from "../apps/web/src/lib/ai-story-canonical-scene-producer";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";

const id = (n: number) => `71000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const I = {
  org: id(1), workspace: id(2), otherWorkspace: id(3), campaign: id(4),
  story: id(5), storyVersion: id(6), otherVersion: id(7), actor: id(8),
  product: id(9), character: id(10), characterVersion: id(11), supporting: id(12),
  packageId: id(13), matching: id(14), binding: id(15), snapshot: id(16),
};
const PROFILE = {
  profileId: "COMMERCIAL_STORY" as const,
  profileVersion: 1 as const,
  policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
};
const STORY = {
  title: "Harbor Watch",
  summary: "A night watch becomes possible because a lantern is found",
  objective: "Can the harbor watch continue through the dark",
  targetAudience: "Harbor crews",
  tone: "Steady",
  estimatedDuration: "12s",
  story: {
    opening: "The harbor watch starts in the dark",
    development: "The watch finds a lantern",
    ending: "The harbor is lit for the rest of the watch",
  },
  keyMessages: ["The lantern keeps the watch going"],
  cta: "",
  assetReferences: [] as string[],
  warnings: [] as string[],
};
const BEATS = [
  { id: "watch-start", order: 0, name: "Dark watch", purpose: "Establish the unlit watch", summary: "The watch begins in the dark." },
  { id: "lantern-found", order: 1, name: "Lantern", purpose: "The lantern enters the watch", summary: "The lantern is found." },
  { id: "watch-continues", order: 2, name: "Lit watch", purpose: "The watch continues", summary: "The harbor stays lit." },
];
const T2V = { strategy: "TEXT_TO_VIDEO" as const, referenceSource: "REFERENCE_FREE_T2V" as const, referenceAssetIds: [] as string[], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" as const };
const I2V = { strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const, referenceSource: "SCENE_EXPLICIT" as const, referenceAssetIds: [I.product], firstFrameAssetId: I.product, productVisualIdentityRequirement: "REQUIRED" as const };
const PLAN = [
  { id: "scene-plan-0", beatIds: [BEATS[0]!.id], purpose: "Open on the dark watch", durationSec: 4, transition: "", continuityNotes: "", order: 0, generationAuthority: T2V },
  { id: "scene-plan-1", beatIds: [BEATS[1]!.id], purpose: "The lantern becomes visible", durationSec: 4, transition: "", continuityNotes: "", order: 1, generationAuthority: I2V },
  { id: "scene-plan-2", beatIds: [BEATS[2]!.id], purpose: "The watch continues in the light", durationSec: 4, transition: "", continuityNotes: "", order: 2, generationAuthority: T2V },
];
const CHARACTER = {
  characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: hash("c"),
  name: "Watch Keeper",
  canonicalFacts: { identity: "Night watch keeper", appearance: "Dark coat", personality: "Steady", emotionalArc: "Uncertainty to confidence", relationships: [] },
};
const CREATIVE = {
  storyContext: { title: STORY.title, summary: STORY.summary, objective: STORY.objective, targetAudience: STORY.targetAudience, tone: STORY.tone, estimatedDuration: STORY.estimatedDuration, keyMessages: STORY.keyMessages, cta: STORY.cta },
  characterContext: { characters: [], relationships: [] },
  productAuthorities: [],
  worldContext: { locations: [], visualStyle: "", lighting: "", environment: "", objects: [], timeline: "", worldRules: [] },
  narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [], dialogue: [] },
  directorContext: {},
};
const DIRECTOR = { coreMessage: "Keep the watch", hero: "Keeper", conflict: "Darkness", turningPoint: "Lantern", climax: "Light", takeaway: "The watch continues" };
const WORLD = { location: "Harbor", lighting: "Low", environment: "A working harbor at night", objects: ["Lantern"], timeline: "One night", worldRules: ["Weather stays calm"] };
const PRODUCT = { storyId: I.story, assetId: I.product, usageType: "product_source" as const, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, contentHash: hash("b"), status: "ready" as const };
const LEGACY_STORY_ID = "96ac1530-5cff-4579-8fdd-a6b86035c0b1";
const LEGACY_STORY_VERSION_ID = "27f5dfce-0f4d-4452-a5be-c576aab29f93";

function frozenOutline(story = STORY) {
  const draft = composeAiStoryCanonicalCommercialOutlineV1({
    storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign,
    version: 1, profile: PROFILE, storyDraft: story, proposedStoryBeats: BEATS, campaignObjective: "awareness",
    customObjective: null, productAuthorityIds: [I.product],
    characterAuthorities: [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: CHARACTER.characterFingerprint }],
    originalIdea: "Keep the harbor watch supplied with one lantern.", supersedesOutlineVersionId: null,
    createdBy: I.actor, createdAt: "2026-09-27T00:00:00.000Z",
  });
  return AiStoryOutlineVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-09-27T00:01:00.000Z", frozenAt: "2026-09-27T00:02:00.000Z" });
}

function proposal(): AiStoryScriptSemanticProposalV1 {
  const dark = { dimension: "KNOWLEDGE" as const, subjectId: I.character, value: "watch is dark" };
  const found = { dimension: "KNOWLEDGE" as const, subjectId: I.character, value: "lantern found" };
  const committed = { dimension: "COMMITMENT" as const, subjectId: I.character, value: "watch continues" };
  return AiStoryScriptSemanticProposalV1Schema.parse({
    contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
    scenes: [
      { scenePlanItemId: PLAN[0]!.id, sceneFunction: "INTRODUCE", sceneFunctionRegistryVersion: 1, narrativeFunction: "SETUP", storyConsequence: "The audience meets a watch that cannot see the harbor", sceneStateIn: [dark], sceneStateDeltas: [], sceneStateOut: [dark], entries: [{ type: "ACTION", subjectId: I.character, action: "The keeper looks across the unlit harbor.", storyEffect: "The watch starts without light." }], newInformation: ["The harbor watch has started in the dark."], newActionOutcomes: ["The watch is underway without light."] },
      { scenePlanItemId: PLAN[1]!.id, sceneFunction: "REVEAL", sceneFunctionRegistryVersion: 1, narrativeFunction: "PRODUCT_INTERVENTION", storyConsequence: "Finding the lantern changes what the watch can see", causalPreconditions: ["The harbor watch has started in the dark"], commercialContribution: { commercialRole: "PRODUCT", narrativeFunction: "PRODUCT_INTERVENTION", participationKind: "REVEAL", commercialAuthorityIds: [I.product], preState: "watch is dark", postState: "lantern found", storyConsequence: "The lantern gives the watch a way to continue" }, sceneStateIn: [dark], sceneStateDeltas: [{ ...found, fromValue: "watch is dark", reason: "The lantern is found during the watch" }], sceneStateOut: [found], entries: [{ type: "ACTION", subjectId: I.character, objectId: I.product, action: "The keeper raises the lantern.", storyEffect: "The harbor becomes visible." }], newInformation: ["The lantern is the light the watch needed."], newActionOutcomes: ["The watch can see the harbor."] },
      { scenePlanItemId: PLAN[2]!.id, sceneFunction: "PAYOFF", sceneFunctionRegistryVersion: 1, narrativeFunction: "BRAND_RESOLUTION", storyConsequence: "The lit watch is the commercial resolution", causalPreconditions: ["The lantern has been found"], commercialContribution: { commercialRole: "PRODUCT", narrativeFunction: "BRAND_RESOLUTION", participationKind: "RESOLVE", commercialAuthorityIds: [I.product], preState: "lantern found", postState: "watch continues", storyConsequence: "The lantern's meaning is that the watch continues" }, sceneStateIn: [found], sceneStateDeltas: [{ ...committed, fromValue: null, reason: "The lit harbor lets the watch continue" }], sceneStateOut: [found, committed], entries: [{ type: "ACTION", subjectId: I.character, action: "The keeper keeps the lantern raised through the rest of the watch.", storyEffect: "The watch finishes in the light." }], newInformation: ["The watch continues because the lantern was found."], newActionOutcomes: ["The harbor stays lit."] },
    ],
  });
}

function spokenProposal(speakerId: string): AiStoryScriptSemanticProposalV1 {
  const semantic = proposal();
  semantic.scenes[0]!.entries.push(
    { type: "DIALOGUE", speakerId, line: "The harbor is dark.", language: "en" },
    { type: "VO", voiceOwnerId: speakerId, line: "Keep the watch.", narrativePurpose: "Name the watch that has started.", language: "en" },
  );
  return AiStoryScriptSemanticProposalV1Schema.parse(semantic);
}

function fingerprint(outline: AiStoryOutlineVersion) {
  return computeAiStoryScriptSemanticInputFingerprint({
    storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: outline.outlineVersionId, outlineSourceHash: outline.sourceHash,
    story: STORY, storyBeats: BEATS, scenePlan: PLAN, creativeContext: CREATIVE, directorThinking: DIRECTOR,
    characterAuthorities: [CHARACTER], productAuthorityIds: [I.product],
  });
}

function scriptFor(outline = frozenOutline(), semantic = proposal()): AiStoryScriptVersion {
  const material = promoteAiStoryScriptSemanticProposalV1({
    storyId: I.story, storyVersionId: I.storyVersion, frozenOutline: outline, storyBeatProposals: BEATS,
    scenePlan: PLAN, characterAuthorities: [CHARACTER], semanticProposal: semantic,
  });
  const draft = buildScript(outline, material.scenes, material.authorityReferences, fingerprint(outline));
  return AiStoryScriptVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-09-27T00:11:00.000Z", frozenAt: "2026-09-27T00:12:00.000Z" });
}

function buildScript(outline: AiStoryOutlineVersion, scenes: AiStoryScriptVersion["scenes"], authorityReferences: AiStoryScriptVersion["authorityReferences"], semanticInputFingerprint: string) {
  return buildAiStoryScriptVersion({
    storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: outline.outlineVersionId,
    orgId: I.org, workspaceId: I.workspace, version: 1, profileId: "COMMERCIAL_STORY", profileVersion: 1,
    outlineSourceHash: outline.sourceHash, semanticInputFingerprint, scenes, authorityReferences,
    supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-09-27T00:10:00.000Z",
  });
}

const scope = { orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion };
const outlineRow = (outline: AiStoryOutlineVersion, workspaceId = I.workspace) => ({
  outlineVersionId: outline.outlineVersionId, orgId: I.org, workspaceId, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion,
  version: outline.version, contractVersion: outline.contractVersion, profileId: outline.profile.profileId, profileVersion: outline.profile.profileVersion,
  sourceHash: outline.sourceHash, status: "FROZEN" as const, outline, supersedesOutlineVersionId: null,
  createdBy: I.actor, createdAt: new Date("2026-09-27T00:00:00.000Z"), approvedBy: I.actor, approvedAt: new Date("2026-09-27T00:01:00.000Z"), frozenAt: new Date("2026-09-27T00:02:00.000Z"),
});

describe("COMMERCIAL_STORY authority lifecycle", () => {
  it("derives canonical outline and script from authorized story fields with zero model calls", () => {
    const outline = frozenOutline();
    expect(outline.profile.profileId).toBe("COMMERCIAL_STORY");
    expect(outline.upstreamAuthorityId).toBe(I.storyVersion);
    expect(outline.commercialStoryProfile?.productOrServiceAuthorityRefs).toEqual([I.product]);
    expect(validateAiStoryCommercialStoryProfile(outline).filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    const script = scriptFor(outline);
    expect(validateAiStoryCommercialStoryProfile(outline, script).filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    expect(script.profileId).toBe("COMMERCIAL_STORY");
    expect(script.storyVersionId).toBe(I.storyVersion);
    expect(script.scenes[1]?.productAuthorityRefs).toEqual([I.product]);
    expect(readFileSync("packages/shared/src/ai-story-canonical-outline-composer.server.ts", "utf8")).not.toContain("callStructuredJsonModel");
    expect(readFileSync("packages/shared/src/ai-story-commercial-story-outline-policy.server.ts", "utf8")).not.toContain("callStructuredJsonModel");
  });

  it("binds one idempotent authorized proposal to the exact story version and refuses stale, rejected, or replaced authority", async () => {
    const outline = frozenOutline();
    const semantic = proposal();
    const store = new Map<string, { proposal: AiStoryScriptSemanticProposalV1; fingerprint: string }>();
    let writerCalls = 0;
    let history: AiStoryScriptVersion[] = [];
    const keyOf = (storyVersionId: string, workspaceId: string) => `${workspaceId}:${I.story}:${storyVersionId}`;
    const transition = (status: "VALIDATED" | "APPROVED" | "FROZEN") => async (_db: never, _scope: never, scriptVersionId: string) => {
      const index = history.findIndex((item) => item.scriptVersionId === scriptVersionId);
      const prior = history[index]!;
      history[index] = AiStoryScriptVersionSchema.parse({ ...prior, status, approvedBy: I.actor, approvedAt: "2026-09-27T00:11:00.000Z", frozenAt: status === "FROZEN" ? "2026-09-27T00:12:00.000Z" : prior.frozenAt });
      return history[index]!;
    };
    const deps = (storyVersionId = I.storyVersion): CanonicalScriptProducerDependencies => ({
      resolveCurrentOutline: async () => outline,
      history: async () => history.filter((item) => item.storyVersionId === storyVersionId),
      generateSemanticProposal: async () => { writerCalls += 1; return { semanticProposal: semantic, usage: { input: 3, output: 2, costUsd: 0 } }; },
      promoteSemanticProposal: promoteAiStoryScriptSemanticProposalV1,
      propose: async (_db, _scope, script) => { history.push(script); return script; },
      validate: transition("VALIDATED"), approve: transition("APPROVED"), freeze: transition("FROZEN"),
      resolveAuthorizedProposal: async (_db, requested) => {
        if (requested.workspaceId !== I.workspace || requested.storyVersionId !== I.storyVersion) return null;
        const row = store.get(keyOf(requested.storyVersionId, requested.workspaceId));
        return row ? { proposal: row.proposal, semanticInputFingerprint: row.fingerprint, profileId: "COMMERCIAL_STORY" as const } : null;
      },
      persistAuthorizedProposal: async (_db, requested, value, semanticInputFingerprint) => {
        const key = keyOf(requested.storyVersionId, requested.workspaceId);
        const existing = store.get(key);
        if (existing && JSON.stringify(existing.proposal) !== JSON.stringify(value)) throw new Error("SCRIPT_SEMANTIC_PROPOSAL_IMMUTABLE");
        store.set(key, { proposal: value, fingerprint: semanticInputFingerprint });
      },
      now: () => "2026-09-27T00:10:00.000Z",
    });
    const input = {
      db: {} as never, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor,
      story: STORY, storyBeats: BEATS, scenePlan: PLAN, creativeContext: CREATIVE, directorThinking: DIRECTOR, characterAuthorities: [CHARACTER],
    };
    await expect(ensureCurrentFrozenCanonicalScript(input, deps())).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_REQUIRED" });
    expect(writerCalls).toBe(0);
    expect(history).toHaveLength(0);
    const authored = await produceAuthorizedCommercialStoryScriptProposal(input, deps());
    expect(authored.semanticWriterCalled).toBe(true);
    expect(writerCalls).toBe(1);
    expect(store.get(keyOf(I.storyVersion, I.workspace))?.proposal).toEqual(semantic);
    const authoredAgain = await produceAuthorizedCommercialStoryScriptProposal(input, deps());
    expect(authoredAgain.semanticWriterCalled).toBe(false);
    expect(writerCalls).toBe(1);
    const consumed = await ensureCurrentFrozenCanonicalScript(input, deps());
    expect(consumed.semanticWriterCalled).toBe(false);
    expect(consumed.script.status).toBe("FROZEN");
    expect(writerCalls).toBe(1);
    history = [];
    const fromStore = await ensureCurrentFrozenCanonicalScript(input, deps());
    expect(fromStore.semanticWriterCalled).toBe(false);
    expect(writerCalls).toBe(1);
    history = [];
    await expect(ensureCurrentFrozenCanonicalScript(input, {
      ...deps(),
      resolveAuthorizedProposal: async () => ({ proposal: semantic, semanticInputFingerprint: hash("e"), profileId: "COMMERCIAL_STORY" }),
    })).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "CANONICAL_SCRIPT_SEMANTIC_AUTHORITY_STALE" });
    await expect(produceAuthorizedCommercialStoryScriptProposal(input, {
      ...deps(),
      resolveAuthorizedProposal: async () => ({ proposal: semantic, semanticInputFingerprint: hash("e"), profileId: "COMMERCIAL_STORY" }),
    })).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "CANONICAL_SCRIPT_SEMANTIC_AUTHORITY_STALE" });
    expect(writerCalls).toBe(1);
    const other = await deps().resolveAuthorizedProposal!({} as never, { ...scope, workspaceId: I.otherWorkspace, storyVersionId: I.otherVersion, actorUserId: I.actor, requireCurrentFrozenStoryVersion: true });
    expect(other).toBeNull();
    await expect(new AiStoryScriptSemanticProposalAuthorityService({} as never).authorize({ acceptance: "REJECTED" } as never)).rejects.toBeInstanceOf(AiStoryScriptSemanticProposalAuthorityError);
    await expect(deps().persistAuthorizedProposal!({} as never, { ...scope, actorUserId: I.actor, requireCurrentFrozenStoryVersion: true }, { ...semantic, scenes: semantic.scenes.slice(0, 2) } as never, fingerprint(outline), "2026-09-27T00:12:00.000Z", "COMMERCIAL_STORY")).rejects.toThrow("SCRIPT_SEMANTIC_PROPOSAL_IMMUTABLE");
    history = [{ ...scriptFor(outline), status: "SUPERSEDED" }];
    await expect(ensureCurrentFrozenCanonicalScript(input, deps())).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "CANONICAL_SCRIPT_LINEAGE_INVALID" });
    expect(writerCalls).toBe(1);
    await expect(ensureCurrentFrozenCanonicalScript({ ...input, workspaceId: I.otherWorkspace }, deps())).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_REQUIRED" });
    await expect(ensureCurrentFrozenCanonicalScript({ ...input, storyVersionId: I.otherVersion }, deps())).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_REQUIRED" });
    await expect(ensureCurrentFrozenCanonicalScript(input, {
      ...deps(),
      resolveAuthorizedProposal: async () => ({ proposal: semantic, semanticInputFingerprint: fingerprint(outline), profileId: "PRODUCT_STORY" }),
    })).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_PROFILE_INVALID" });
    await expect(ensureCurrentFrozenCanonicalScript(input, {
      ...deps(),
      resolveAuthorizedProposal: async () => ({ proposal: { contractVersion: "not-a-proposal" } as never, semanticInputFingerprint: fingerprint(outline), profileId: "COMMERCIAL_STORY" }),
    })).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_INTEGRITY_INVALID" });
    const changedPlan = PLAN.map((scene, index) => index === 0 ? { ...scene, purpose: "A different opening purpose" } : scene);
    await expect(produceAuthorizedCommercialStoryScriptProposal({ ...input, scenePlan: changedPlan }, deps())).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "CANONICAL_SCRIPT_SEMANTIC_AUTHORITY_STALE" });
    expect(writerCalls).toBe(1);
    expect(readFileSync("apps/web/src/lib/ai-story-canonical-script-producer.ts", "utf8")).not.toContain("shotPlan");
  });

  it("rejects an unowned dialogue candidate before authorization and accepts the corrected candidate on the same story version", async () => {
    const outline = frozenOutline();
    const store = new Map<string, AiStoryScriptSemanticProposalV1>();
    const candidates = [
      spokenProposal(I.product),
      spokenProposal(I.character),
    ];
    let writerCalls = 0;
    let persistCalls = 0;
    const input = {
      db: {} as never, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor,
      story: STORY, storyBeats: BEATS, scenePlan: PLAN, creativeContext: CREATIVE, directorThinking: DIRECTOR, characterAuthorities: [CHARACTER],
    };
    const deps = (): CanonicalScriptProducerDependencies => ({
      resolveCurrentOutline: async () => outline,
      history: async () => [],
      generateSemanticProposal: async () => { writerCalls += 1; return { semanticProposal: candidates[writerCalls - 1]!, usage: { input: 1, output: 1, costUsd: 0 } }; },
      promoteSemanticProposal: promoteAiStoryScriptSemanticProposalV1,
      propose: async (_db, _scope, script) => script,
      validate: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      approve: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      freeze: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      resolveAuthorizedProposal: async () => {
        const row = store.get(I.storyVersion);
        return row ? { proposal: row, semanticInputFingerprint: fingerprint(outline), profileId: "COMMERCIAL_STORY" as const } : null;
      },
      persistAuthorizedProposal: async (_db, requested, value) => {
        persistCalls += 1;
        expect(requested.storyVersionId).toBe(I.storyVersion);
        store.set(requested.storyVersionId, value);
      },
      now: () => "2026-09-27T00:10:00.000Z",
    });
    await expect(produceAuthorizedCommercialStoryScriptProposal(input, deps())).rejects.toMatchObject({ code: "CANONICAL_SCRIPT_CHARACTER_ID_REQUIRED" });
    expect(store.size).toBe(0);
    expect(persistCalls).toBe(0);
    expect(writerCalls).toBe(1);
    const authored = await produceAuthorizedCommercialStoryScriptProposal(input, deps());
    expect(authored.semanticWriterCalled).toBe(true);
    expect(store.size).toBe(1);
    expect(persistCalls).toBe(1);
    expect(writerCalls).toBe(2);
    expect(store.get(I.storyVersion)?.scenes[0]?.entries.some((entry) => entry.type === "DIALOGUE" && entry.speakerId === I.character)).toBe(true);
    expect(store.get(I.storyVersion)?.scenes[0]?.entries.some((entry) => entry.type === "VO" && entry.voiceOwnerId === I.character)).toBe(true);
    const author = readFileSync("apps/web/src/lib/ai-story-canonical-script-producer.ts", "utf8");
    const body = author.slice(author.indexOf("function assertCommercialScriptCandidatePreAuthorization"), author.indexOf("export async function ensureCurrentFrozenCanonicalScript"));
    expect(body.indexOf("promoteSemanticProposal")).toBeGreaterThan(0);
    expect(body.indexOf("validateAiStoryScript")).toBeGreaterThan(body.indexOf("promoteSemanticProposal"));
    expect(body.indexOf("persistAuthorizedProposal")).toBeGreaterThan(body.indexOf("validateAiStoryScript"));
    expect(body).not.toContain("while (");
  });

  it("rejects an action subject outside accepted character and product authority before authorization", async () => {
    const outline = frozenOutline();
    const semantic = proposal();
    const action = semantic.scenes[0]!.entries[0]!;
    if (action.type !== "ACTION") throw new Error("fixture");
    action.subjectId = id(90);
    let persisted = 0;
    await expect(produceAuthorizedCommercialStoryScriptProposal({
      db: {} as never, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor,
      story: STORY, storyBeats: BEATS, scenePlan: PLAN, creativeContext: CREATIVE, directorThinking: DIRECTOR, characterAuthorities: [CHARACTER],
    }, {
      resolveCurrentOutline: async () => outline,
      history: async () => [],
      generateSemanticProposal: async () => ({ semanticProposal: semantic, usage: { input: 1, output: 1, costUsd: 0 } }),
      promoteSemanticProposal: promoteAiStoryScriptSemanticProposalV1,
      propose: async (_db, _scope, script) => script,
      validate: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      approve: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      freeze: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      resolveAuthorizedProposal: async () => null,
      persistAuthorizedProposal: async () => { persisted += 1; },
      now: () => "2026-09-27T00:10:00.000Z",
    })).rejects.toMatchObject({ code: "CANONICAL_SCRIPT_UNKNOWN_ENTITY_ID" });
    expect(persisted).toBe(0);
  });

  it("rejects a contradictory state candidate before authorization and accepts the corrected candidate on the same story version", async () => {
    const outline = frozenOutline();
    const store = new Map<string, AiStoryScriptSemanticProposalV1>();
    const contradicted = proposal();
    contradicted.scenes[1]!.sceneStateDeltas[0]!.fromValue = "lantern found";
    const candidates = [contradicted, proposal()];
    let writerCalls = 0;
    let persistCalls = 0;
    const input = {
      db: {} as never, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor,
      story: STORY, storyBeats: BEATS, scenePlan: PLAN, creativeContext: CREATIVE, directorThinking: DIRECTOR, characterAuthorities: [CHARACTER],
    };
    const deps = (): CanonicalScriptProducerDependencies => ({
      resolveCurrentOutline: async () => outline,
      history: async () => [],
      generateSemanticProposal: async () => { writerCalls += 1; return { semanticProposal: candidates[writerCalls - 1]!, usage: { input: 1, output: 1, costUsd: 0 } }; },
      promoteSemanticProposal: promoteAiStoryScriptSemanticProposalV1,
      propose: async (_db, _scope, script) => script,
      validate: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      approve: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      freeze: async (_db, _scope, scriptVersionId) => ({ ...scriptFor(), scriptVersionId }),
      resolveAuthorizedProposal: async () => {
        const row = store.get(I.storyVersion);
        return row ? { proposal: row, semanticInputFingerprint: fingerprint(outline), profileId: "COMMERCIAL_STORY" as const } : null;
      },
      persistAuthorizedProposal: async (_db, requested, value) => {
        persistCalls += 1;
        store.set(requested.storyVersionId, value);
      },
      now: () => "2026-09-27T00:10:00.000Z",
    });
    await expect(produceAuthorizedCommercialStoryScriptProposal(input, deps())).rejects.toMatchObject({ code: "CANONICAL_SCRIPT_STATE_CONTRADICTION" });
    expect(store.size).toBe(0);
    expect(persistCalls).toBe(0);
    const authored = await produceAuthorizedCommercialStoryScriptProposal(input, deps());
    expect(authored.proposal).toEqual(candidates[1]);
    expect(store.size).toBe(1);
    expect(persistCalls).toBe(1);
    expect(writerCalls).toBe(2);
    expect(authored.semanticWriterCalled).toBe(true);
  });

  it("fails closed for the unrecovered legacy story without calling the semantic writer", async () => {
    let writerCalls = 0;
    let proposed = 0;
    const outline = frozenOutline();
    await expect(ensureCurrentFrozenCanonicalScript({
      db: {} as never, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign,
      storyId: LEGACY_STORY_ID, storyVersionId: LEGACY_STORY_VERSION_ID, actorUserId: I.actor,
      story: STORY, storyBeats: BEATS, scenePlan: PLAN, creativeContext: CREATIVE, directorThinking: DIRECTOR, characterAuthorities: [CHARACTER],
    }, {
      resolveCurrentOutline: async () => ({ ...outline, storyId: LEGACY_STORY_ID, storyVersionId: LEGACY_STORY_VERSION_ID }),
      history: async () => [],
      generateSemanticProposal: async () => { writerCalls += 1; return { semanticProposal: proposal(), usage: { input: 1, output: 1, costUsd: 0 } }; },
      promoteSemanticProposal: promoteAiStoryScriptSemanticProposalV1,
      propose: async (_db, _scope, script) => { proposed += 1; return script; },
      validate: async (_db, _scope, id) => ({ ...scriptFor(), scriptVersionId: id }),
      approve: async (_db, _scope, id) => ({ ...scriptFor(), scriptVersionId: id }),
      freeze: async (_db, _scope, id) => ({ ...scriptFor(), scriptVersionId: id }),
      resolveAuthorizedProposal: async () => null,
      now: () => "2026-09-27T00:10:00.000Z",
    })).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "COMMERCIAL_STORY_SCRIPT_SEMANTIC_AUTHORITY_REQUIRED" });
    expect(writerCalls).toBe(0);
    expect(proposed).toBe(0);
  });

  it("keeps a frozen outline historical when the story revision creates the next version", async () => {
    const outlines: AiStoryOutlineVersion[] = [];
    const advance = (status: "VALIDATED" | "APPROVED" | "FROZEN") => async (_db: never, _scope: never, outlineVersionId: string) => {
      const index = outlines.findIndex((item) => item.outlineVersionId === outlineVersionId);
      outlines[index] = AiStoryOutlineVersionSchema.parse({ ...outlines[index], status, approvedBy: I.actor, approvedAt: "2026-09-27T00:01:00.000Z", frozenAt: status === "FROZEN" ? "2026-09-27T00:02:00.000Z" : outlines[index]!.frozenAt });
      return outlines[index]!;
    };
    let story = STORY;
    const deps: CanonicalOutlineProducerDependencies = {
      loadCurrentUpstream: async () => ({ orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, originalIdea: "Keep the harbor watch supplied with one lantern.", structuredContent: story, frozenAt: new Date("2026-09-27T00:00:00.000Z"), campaignObjective: "awareness", customObjective: null }),
      resolveProfile: async () => PROFILE,
      resolveProductAuthorityIds: async () => [I.product],
      resolveCharacterAuthorities: async () => [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: CHARACTER.characterFingerprint }],
      history: async () => [...outlines],
      propose: async (_db, _scope, outline) => { outlines.push(outline); return outline; },
      validate: advance("VALIDATED"), approve: advance("APPROVED"), freeze: advance("FROZEN"),
      now: () => "2026-09-27T00:00:00.000Z",
    };
    const input = { db: {} as never, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor, proposedStoryBeats: BEATS };
    const first = await ensureCurrentFrozenCanonicalOutline(input, deps);
    const repeat = await ensureCurrentFrozenCanonicalOutline(input, deps);
    expect(repeat.outlineVersionId).toBe(first.outlineVersionId);
    expect(outlines).toHaveLength(1);
    story = { ...STORY, story: { ...STORY.story, ending: "The harbor watch ends with the lantern still raised" } };
    const revised = await ensureCurrentFrozenCanonicalOutline(input, deps);
    expect(revised.version).toBe(2);
    expect(revised.supersedesOutlineVersionId).toBe(first.outlineVersionId);
    expect(outlines[0]?.status).toBe("FROZEN");
    expect(revised.outlineVersionId).not.toBe(first.outlineVersionId);
  });

  it("fails closed for missing, mismatched, stale, cross-workspace, and competing frozen authority", async () => {
    const outline = frozenOutline();
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, { loadCurrentStoryVersion: async () => true, loadFrozenRows: async () => [] })).resolves.toBeNull();
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, { loadCurrentStoryVersion: async () => true, loadFrozenRows: async () => [outlineRow(outline), outlineRow(outline)] as never })).rejects.toMatchObject({ code: "CURRENT_FROZEN_OUTLINE_AMBIGUOUS" });
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, { ...scope, workspaceId: I.otherWorkspace }, { loadCurrentStoryVersion: async () => true, loadFrozenRows: async () => [outlineRow(outline)] as never })).rejects.toMatchObject({ code: "CURRENT_FROZEN_OUTLINE_INVALID" });
    const stale = outlineRow(outline);
    stale.outline = { ...outline, premise: "A rewritten premise" };
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, { loadCurrentStoryVersion: async () => true, loadFrozenRows: async () => [stale] as never })).rejects.toMatchObject({ code: "OUTLINE_SOURCE_HASH_INVALID" });
    await expect(resolveCurrentFrozenScriptForStoryVersion({} as never, scope, { resolveCurrentOutline: async () => outline, loadFrozenRows: async () => [{}, {}] as never })).rejects.toMatchObject({ code: "CURRENT_FROZEN_SCRIPT_AMBIGUOUS" });
    const script = scriptFor(outline);
    expect(() => composeAiStoryCanonicalSceneSetV1({
      orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.otherVersion, actorUserId: I.actor,
      frozenOutline: outline, frozenScript: script, scenePlan: PLAN, worldContinuity: WORLD, characterAuthorities: [CHARACTER],
      productSources: [{ assetId: I.product, contentHash: hash("b") }], createdAt: "2026-09-27T02:00:00.000Z",
    })).toThrowError(expect.objectContaining({ code: "CANONICAL_SCENE_CURRENT_SCRIPT_REQUIRED" }));
    const wrongOutline = { ...script, outlineVersionId: I.otherVersion };
    expect(() => composeAiStoryCanonicalSceneSetV1({
      orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor,
      frozenOutline: outline, frozenScript: wrongOutline, scenePlan: PLAN, worldContinuity: WORLD, characterAuthorities: [CHARACTER],
      productSources: [{ assetId: I.product, contentHash: hash("b") }], createdAt: "2026-09-27T02:00:00.000Z",
    })).toThrowError(expect.objectContaining({ code: "CANONICAL_SCENE_CURRENT_SCRIPT_REQUIRED" }));
    const sceneInput = {
      db: {} as never, ...scope, actorUserId: I.actor, story: STORY, storyBeats: BEATS, scenePlan: PLAN,
      creativeContext: CREATIVE, directorThinking: DIRECTOR, worldContinuity: WORLD, characterAuthorities: [CHARACTER],
    };
    await expect(ensureCurrentFrozenCanonicalSceneSet(sceneInput, { resolveCurrentOutline: async () => null } as CanonicalSceneProducerDependencies)).rejects.toMatchObject<Partial<AiStoryCanonicalSceneProducerError>>({ code: "CURRENT_FROZEN_OUTLINE_REQUIRED" });
    await expect(ensureCurrentFrozenCanonicalSceneSet(sceneInput, { resolveCurrentOutline: async () => outline, resolveCurrentScript: async () => null } as CanonicalSceneProducerDependencies)).rejects.toMatchObject<Partial<AiStoryCanonicalSceneProducerError>>({ code: "CURRENT_FROZEN_SCRIPT_REQUIRED" });
    await expect(ensureCurrentFrozenCanonicalOutline({ db: {} as never, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor, proposedStoryBeats: BEATS }, {
      loadCurrentUpstream: async () => ({ orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, originalIdea: "Idea", structuredContent: STORY, frozenAt: new Date(), campaignObjective: "awareness", customObjective: null }),
      resolveProfile: async () => ({ profileId: "CORE", profileVersion: 1 }),
      resolveProductAuthorityIds: async () => [],
      resolveCharacterAuthorities: async () => [],
      history: async () => [],
    } as CanonicalOutlineProducerDependencies)).rejects.toMatchObject<Partial<AiStoryCanonicalOutlineProducerError>>({ code: "CANONICAL_OUTLINE_PROFILE_UNSUPPORTED" });
  });

  it("consumes the frozen set in animation package and prompt compilation without reconstructing authority", async () => {
    const outline = frozenOutline();
    const script = scriptFor(outline);
    let current: AiStoryCanonicalScene[] = [];
    const freeze = (scenes: AiStoryCanonicalScene[], status: "VALIDATED" | "APPROVED" | "FROZEN") => scenes.map((scene) => AiStoryCanonicalSceneSchema.parse({
      ...scene, status, approvedBy: status === "APPROVED" || status === "FROZEN" ? I.actor : null,
      approvedAt: status === "APPROVED" || status === "FROZEN" ? "2026-09-27T02:01:00.000Z" : null,
      frozenAt: status === "FROZEN" ? "2026-09-27T02:02:00.000Z" : null,
    }));
    const deps: CanonicalSceneProducerDependencies = {
      resolveCurrentOutline: async () => outline,
      resolveCurrentScript: async () => script,
      resolveProducts: async () => [PRODUCT],
      readCurrent: async () => current,
      compose: composeAiStoryCanonicalSceneSetV1,
      propose: async (_db, _scope, scenes) => { current = scenes; return current; },
      transition: async (_db, _scope, to) => { current = freeze(current, to); return current; },
      resolveFrozen: async () => current,
      now: () => "2026-09-27T02:00:00.000Z",
    };
    const frozen = await ensureCurrentFrozenCanonicalSceneSet({
      db: {} as never, ...scope, actorUserId: I.actor, story: STORY, storyBeats: BEATS, scenePlan: PLAN,
      creativeContext: CREATIVE, directorThinking: DIRECTOR, worldContinuity: WORLD, characterAuthorities: [CHARACTER],
    }, deps);
    expect(frozen.every((scene) => scene.status === "FROZEN")).toBe(true);
    expect(frozen[1]?.generationAuthority).toMatchObject({ firstFrameAssetId: I.product, referenceSource: "SCENE_EXPLICIT" });
    expect(frozen[0]?.productBindings).toEqual([]);
    expect(frozen[2]?.productBindings).toEqual([]);
    expect(resolveExplicitAiStorySceneGenerationAuthority(frozen[1]?.generationAuthority).firstFrameAssetId).toBe(I.product);
    for (const scene of [frozen[0]!, frozen[2]!]) {
      const resolved = resolveExplicitAiStorySceneGenerationAuthority(scene.generationAuthority);
      expect(resolved.effectiveReferenceIds).toEqual([]);
      expect(resolved.firstFrameAssetId).toBeNull();
    }
    const wrongAsset = { ...I2V, referenceAssetIds: [I.supporting], firstFrameAssetId: I.supporting };
    expect(() => composeAiStoryCanonicalSceneSetV1({
      orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor,
      frozenOutline: outline, frozenScript: script, scenePlan: PLAN.map((item, index) => index === 1 ? { ...item, generationAuthority: wrongAsset } : item),
      worldContinuity: WORLD, characterAuthorities: [CHARACTER], productSources: [{ assetId: I.product, contentHash: hash("b") }], createdAt: "2026-09-27T02:00:00.000Z",
    })).toThrowError(expect.objectContaining({ code: "CANONICAL_SCENE_GENERATION_MODE_MATERIAL_MISMATCH" }));

    const grounding = (order: number) => ({
      contractVersion: "ai-story-scene-grounding-lineage.v1" as const, storyId: I.story, storyVersionId: I.storyVersion, matchingResultId: I.matching,
      narrativeIntent: `Scene ${order} narrative`, visualIntent: `Scene ${order} visual`,
      evidence: [{ bindingId: I.binding, assetId: order === 1 ? I.product : I.supporting, role: order === 1 ? "PRODUCT_AUTHORITY" as const : "STORY_REFERENCE" as const, semanticSnapshotId: I.snapshot, groundedFacts: ["Observed lantern"] }],
      visualClaims: [{ subject: "Lantern", detail: "Raised lantern", evidenceLevel: "OBSERVED_APPEARANCE" as const }],
    });
    const scenePlan = PLAN.map((scene, order) => ({ ...scene, groundingLineage: grounding(order) }));
    const shots = scenePlan.map((scene) => ({ id: `shot-${scene.order}`, sceneId: scene.id, cameraType: "medium", cameraMovement: "hold", composition: "centered", framing: "vertical", lensSuggestion: "35mm", durationSec: 4, focus: "Watch", emotion: "Steady", information: scene.purpose, order: 0 }));
    expect(() => bindShotPlanAuthorityLineage({ planningPackageId: I.packageId, scenePlan, shotPlan: [{ ...shots[1]!, sceneId: "missing-scene" }] })).toThrow("SHOT_PLAN_SCENE_AUTHORITY_INVALID");
    const bound = bindShotPlanAuthorityLineage({ planningPackageId: I.packageId, scenePlan, shotPlan: shots });
    expect(bound[1]?.authorityLineage?.generationAuthority.firstFrameAssetId).toBe(I.product);
    const legacy = animationPackageFixture("ready_for_execution");
    const pkg = AuthoritativeAnimationPackagePayloadSchema.parse({
      ...legacy,
      story: { ...legacy.story, assetReferences: [I.supporting] },
      storyBeats: BEATS,
      scenePlan,
      shotPlan: bound,
      sourcePlanningPackageId: I.packageId,
      narrativeIntegration: { consistent: true, issues: [], links: BEATS.map((beat, index) => ({ beatId: beat.id, sceneIds: [scenePlan[index]!.id], shotIds: [bound[index]!.id] })) },
      canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({ storyId: I.story, storyVersionId: I.storyVersion, scenePlan, canonicalScenes: frozen }),
    });
    const compiled = compileSceneExecutionIntents(pkg, {
      orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion,
      storyVersionNumber: 1, storyVersionFrozenAt: "2026-09-27T00:00:00.000Z", animationPackageId: I.packageId, animationPackageStatus: "ready_for_execution", compiledAt: "2026-09-27T03:00:00.000Z",
    });
    const sceneTwo = compiled.intents.find((intent) => intent.identity.sceneOrder === 1)!;
    const sceneTwoInstructions = compiled.instructionsBySceneExecutionId[sceneTwo.identity.sceneExecutionId]!;
    expect(sceneTwoInstructions.generationAuthority?.firstFrameAssetId).toBe(I.product);
    expect(sceneTwoInstructions.referencedAssetIds).toEqual([I.product]);
    for (const order of [0, 2]) {
      const intent = compiled.intents.find((item) => item.identity.sceneOrder === order)!;
      const instructions = compiled.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!;
      expect(instructions.referencedAssetIds).toEqual([]);
      expect(instructions.generationAuthority?.firstFrameAssetId).toBeNull();
      expect(instructions.referencedAssetIds).not.toContain(I.supporting);
    }
    const runner = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    const sceneProducer = readFileSync("apps/web/src/lib/ai-story-canonical-scene-producer.ts", "utf8");
    const planner = readFileSync("packages/agents/src/ai-story/story-planning-service.ts", "utf8");
    expect(runner).toContain("ensureCurrentFrozenCanonicalSceneSet");
    expect(sceneProducer).not.toContain("generateAiStoryScriptSemanticProposalV1");
    expect(planner).not.toContain("generateAiStoryScriptSemanticProposalV1");
    expect(readFileSync("packages/db/src/queries/ai-story-script-semantic-proposal.ts", "utf8")).not.toContain("orderBy");
    for (const file of [
      "apps/web/src/lib/ai-story-canonical-outline-producer.ts",
      "apps/web/src/lib/ai-story-canonical-script-producer.ts",
      "packages/shared/src/ai-story-commercial-story-outline-policy.server.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toContain("Nasi Lemak");
      expect(source).not.toContain("Tapao Jom");
      expect(source).not.toContain("96ac1530-5cff-4579-8fdd-a6b86035c0b1");
      expect(source).not.toContain("70235a91-8f48-4f2d-a7fe-65cd2cc973f8");
    }
  });
});
