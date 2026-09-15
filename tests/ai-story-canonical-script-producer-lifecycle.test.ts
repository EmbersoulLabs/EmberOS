import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryOutlineVersionSchema,
  AiStoryScriptVersionSchema,
  type AiStoryScriptSemanticProposalV1,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  buildAiStoryScriptVersion,
  composeAiStoryCanonicalOutlineV1,
  computeAiStoryScriptSemanticInputFingerprint,
  computeAiStoryScriptSourceHash,
  promoteAiStoryScriptSemanticProposalV1,
} from "@ceo-agent/shared/server";
import {
  AiStoryScriptAuthorityError,
  resolveCurrentFrozenScriptForStoryVersion,
} from "@ceo-agent/db";
import {
  AiStoryCanonicalScriptProducerError,
  ensureCurrentFrozenCanonicalScript,
  type CanonicalScriptProducerDependencies,
  type EnsureCurrentFrozenCanonicalScriptInput,
} from "../apps/web/src/lib/ai-story-canonical-script-producer";

const id = (n: number) => `97000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const I = { org: id(1), workspace: id(2), campaign: id(3), story: id(4), storyVersion: id(5), actor: id(6), product: id(7), character: id(8), characterVersion: id(9) };
const PROFILE = { profileId: "PRODUCT_STORY" as const, profileVersion: 1 as const, policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT };
const STORY = { title: "Story", summary: "Exact summary", objective: "Build awareness", targetAudience: "People", tone: "Clear", estimatedDuration: "8s", story: { opening: "Open", development: "Advance", ending: "End" }, keyMessages: [], cta: "Learn", assetReferences: [], warnings: [] };
const BEATS = [
  { id: "proposal-beat-a", order: 0, name: "Introduce", purpose: "Introduce the Product", summary: "The Product enters." },
  { id: "proposal-beat-b", order: 1, name: "Detail", purpose: "Reveal detail", summary: "More context appears." },
];
const SCENES = [
  { id: "scene-plan-a", beatIds: [BEATS[0]!.id], purpose: "Introduction", durationSec: 4, transition: "", continuityNotes: "", order: 0 },
  { id: "scene-plan-b", beatIds: [BEATS[1]!.id], purpose: "Detail", durationSec: 4, transition: "", continuityNotes: "", order: 1 },
];
const CHARACTER = { characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: hash("a"), name: "Exact Character", canonicalFacts: { identity: "Identity", appearance: "Appearance", personality: "Personality", emotionalArc: "Arc", relationships: [] } };
const CREATIVE = { storyContext: { title: "Story", summary: "Summary", objective: "Awareness", targetAudience: "People", tone: "Clear", estimatedDuration: "8s", keyMessages: [], cta: "Learn" }, characterContext: { characters: [], relationships: [] }, productAuthorities: [], worldContext: { locations: [], visualStyle: "", lighting: "", environment: "", objects: [], timeline: "", worldRules: [] }, narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [], dialogue: [] }, directorContext: {} };
const DIRECTOR = { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" };

function outline() {
  const draft = composeAiStoryCanonicalOutlineV1({ storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, version: 1, profile: PROFILE, storyDraft: STORY, proposedStoryBeats: BEATS, campaignObjective: "awareness", customObjective: null, productAuthorityIds: [I.product], characterAuthorities: [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: CHARACTER.characterFingerprint }], originalIdea: "Intent", supersedesOutlineVersionId: null, createdBy: I.actor, createdAt: "2026-09-15T00:00:00.000Z" });
  return AiStoryOutlineVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-09-15T00:01:00.000Z", frozenAt: "2026-09-15T00:02:00.000Z" });
}

function proposal(): AiStoryScriptSemanticProposalV1 {
  return { contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION, scenes: [
    { scenePlanItemId: SCENES[0]!.id, sceneFunction: "PRODUCT_INTRODUCTION", sceneFunctionRegistryVersion: 1, sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [], entries: [{ type: "ACTION", subjectId: I.character, objectId: I.product, action: "The Character presents the Product.", storyEffect: "The Product enters." }], newInformation: ["The Product is present."], newActionOutcomes: ["The Product is introduced."] },
    { scenePlanItemId: SCENES[1]!.id, sceneFunction: "PRODUCT_DETAIL_REVEAL", sceneFunctionRegistryVersion: 1, sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [], entries: [{ type: "ACTION", subjectId: I.product, action: "The Product remains visible.", storyEffect: "Context advances." }], newInformation: ["More context is available."], newActionOutcomes: ["The story advances."] },
  ] };
}

const ensureInput: EnsureCurrentFrozenCanonicalScriptInput = { db: {} as never, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor, story: STORY, storyBeats: BEATS, scenePlan: SCENES, creativeContext: CREATIVE, directorThinking: DIRECTOR, characterAuthorities: [CHARACTER] };

function fingerprint(input: EnsureCurrentFrozenCanonicalScriptInput = ensureInput) {
  const source = outline();
  return computeAiStoryScriptSemanticInputFingerprint({ storyId: input.storyId, storyVersionId: input.storyVersionId, outlineVersionId: source.outlineVersionId, outlineSourceHash: source.sourceHash, story: input.story, storyBeats: input.storyBeats, scenePlan: input.scenePlan, creativeContext: input.creativeContext, directorThinking: input.directorThinking, characterAuthorities: input.characterAuthorities, productAuthorityIds: [I.product] });
}

function scriptFor(input: EnsureCurrentFrozenCanonicalScriptInput = ensureInput, status: AiStoryScriptVersion["status"] = "FROZEN", includeFingerprint = true) {
  const source = outline();
  const material = promoteAiStoryScriptSemanticProposalV1({ storyId: I.story, storyVersionId: I.storyVersion, frozenOutline: source, storyBeatProposals: BEATS, scenePlan: SCENES, characterAuthorities: [CHARACTER], semanticProposal: proposal() });
  const draft = buildAiStoryScriptVersion({ storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: source.outlineVersionId, orgId: I.org, workspaceId: I.workspace, version: 1, profileId: "PRODUCT_STORY", profileVersion: 1, outlineSourceHash: source.sourceHash, ...(includeFingerprint ? { semanticInputFingerprint: fingerprint(input) } : {}), scenes: material.scenes, authorityReferences: material.authorityReferences, supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-09-15T01:00:00.000Z" });
  return AiStoryScriptVersionSchema.parse({ ...draft, status, approvedBy: status === "APPROVED" || status === "FROZEN" ? I.actor : null, approvedAt: status === "APPROVED" || status === "FROZEN" ? "2026-09-15T01:01:00.000Z" : null, frozenAt: status === "FROZEN" ? "2026-09-15T01:02:00.000Z" : null });
}

function runtime(seed: AiStoryScriptVersion[] = []) {
  let history = [...seed];
  let writerCalls = 0;
  const lifecycle: string[] = [];
  const transition = (status: "VALIDATED" | "APPROVED" | "FROZEN") => async (_db: never, _scope: never, scriptVersionId: string) => {
    lifecycle.push(status);
    const index = history.findIndex((item) => item.scriptVersionId === scriptVersionId);
    const prior = history[index]!;
    const next = AiStoryScriptVersionSchema.parse({ ...prior, status, approvedBy: status === "APPROVED" || status === "FROZEN" ? I.actor : prior.approvedBy, approvedAt: status === "APPROVED" || status === "FROZEN" ? "2026-09-15T01:01:00.000Z" : prior.approvedAt, frozenAt: status === "FROZEN" ? "2026-09-15T01:02:00.000Z" : prior.frozenAt });
    history[index] = next;
    return next;
  };
  const deps: CanonicalScriptProducerDependencies = {
    resolveCurrentOutline: async (_db, scope) => { expect(scope).toEqual({ orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion }); return outline(); },
    history: async (_db, scope) => { expect(scope.requireCurrentFrozenStoryVersion).toBe(true); return [...history]; },
    generateSemanticProposal: async () => { writerCalls += 1; return { semanticProposal: proposal(), usage: { input: 11, output: 7, costUsd: 0.02 } }; },
    promoteSemanticProposal: promoteAiStoryScriptSemanticProposalV1,
    propose: async (_db, _scope, script) => { lifecycle.push("DRAFT"); if (script.supersedesScriptVersionId) history = history.map((item) => item.scriptVersionId === script.supersedesScriptVersionId ? AiStoryScriptVersionSchema.parse({ ...item, status: "SUPERSEDED" }) : item); history.push(script); return script; },
    validate: transition("VALIDATED") as never,
    approve: transition("APPROVED") as never,
    freeze: transition("FROZEN") as never,
    now: () => "2026-09-15T01:00:00.000Z",
  };
  return { deps, lifecycle, writerCalls: () => writerCalls, history: () => history };
}

describe("AI Story Canonical Script producer lifecycle V1", () => {
  it("computes deterministic pre-model provenance and changes for every governed semantic boundary", () => {
    const base = fingerprint();
    expect(base).toBe(fingerprint());
    expect(fingerprint({ ...ensureInput, scenePlan: [{ ...SCENES[0]!, durationSec: 5 }, SCENES[1]!] })).not.toBe(base);
    expect(fingerprint({ ...ensureInput, directorThinking: { ...DIRECTOR, climax: "Changed" } })).not.toBe(base);
    expect(fingerprint({ ...ensureInput, characterAuthorities: [{ ...CHARACTER, characterFingerprint: hash("b") }] })).not.toBe(base);
    const source = outline();
    expect(computeAiStoryScriptSemanticInputFingerprint({ storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: source.outlineVersionId, outlineSourceHash: hash("c"), story: STORY, storyBeats: BEATS, scenePlan: SCENES, creativeContext: CREATIVE, directorThinking: DIRECTOR, characterAuthorities: [CHARACTER], productAuthorityIds: [I.product] })).not.toBe(base);
  });

  it("binds new Script source hashes to the input fingerprint while preserving legacy hashing", () => {
    const current = scriptFor();
    const legacy = scriptFor(ensureInput, "DRAFT", false);
    expect(current.sourceHash).toBe(computeAiStoryScriptSourceHash(current));
    expect(legacy.sourceHash).toBe(computeAiStoryScriptSourceHash(legacy));
    expect(current.sourceHash).not.toBe(legacy.sourceHash);
  });

  it("calls the writer once only before first persistence and completes the full lifecycle", async () => {
    const state = runtime();
    const result = await ensureCurrentFrozenCanonicalScript(ensureInput, state.deps);
    expect(result).toMatchObject({ semanticWriterCalled: true, usage: { input: 11, output: 7, costUsd: 0.02 }, script: { status: "FROZEN", semanticInputFingerprint: fingerprint() } });
    expect(state.writerCalls()).toBe(1);
    expect(state.lifecycle).toEqual(["DRAFT", "VALIDATED", "APPROVED", "FROZEN"]);
  });

  it("persists nothing when semantic generation or server promotion fails", async () => {
    const writerFailure = runtime();
    await expect(ensureCurrentFrozenCanonicalScript(ensureInput, { ...writerFailure.deps, generateSemanticProposal: async () => { throw new Error("writer failed"); } })).rejects.toThrow("writer failed");
    expect(writerFailure.lifecycle).toEqual([]);
    const promotionFailure = runtime();
    await expect(ensureCurrentFrozenCanonicalScript(ensureInput, { ...promotionFailure.deps, promoteSemanticProposal: () => { throw new Error("promotion failed"); } })).rejects.toThrow("promotion failed");
    expect(promotionFailure.lifecycle).toEqual([]);
  });

  it.each(["DRAFT", "VALIDATED", "APPROVED", "FROZEN"] as const)("resumes same-input %s authority with zero writer usage", async (status) => {
    const existing = scriptFor(ensureInput, status);
    const state = runtime([existing]);
    const result = await ensureCurrentFrozenCanonicalScript(ensureInput, state.deps);
    expect(result.script.scriptVersionId).toBe(existing.scriptVersionId);
    expect(result.script.status).toBe("FROZEN");
    expect(result.semanticWriterCalled).toBe(false);
    expect(result.usage).toEqual({ input: 0, output: 0, costUsd: 0 });
    expect(state.writerCalls()).toBe(0);
  });

  it("supersedes a different-input frozen or legacy frozen Script through exact lineage", async () => {
    for (const prior of [scriptFor({ ...ensureInput, directorThinking: { ...DIRECTOR, climax: "Prior" } }), scriptFor(ensureInput, "FROZEN", false)]) {
      const state = runtime([prior]);
      const result = await ensureCurrentFrozenCanonicalScript(ensureInput, state.deps);
      expect(result.script).toMatchObject({ version: 2, supersedesScriptVersionId: prior.scriptVersionId, status: "FROZEN" });
      expect(state.writerCalls()).toBe(1);
    }
  });

  it.each(["DRAFT", "VALIDATED", "APPROVED"] as const)("fails closed for different-input or legacy incomplete %s authority", async (status) => {
    const changed = scriptFor({ ...ensureInput, directorThinking: { ...DIRECTOR, climax: "Prior" } }, status);
    await expect(ensureCurrentFrozenCanonicalScript(ensureInput, runtime([changed]).deps)).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "CANONICAL_SCRIPT_INCOMPLETE_LINEAGE_CONFLICT" });
    await expect(ensureCurrentFrozenCanonicalScript(ensureInput, runtime([scriptFor(ensureInput, status, false)]).deps)).rejects.toMatchObject<Partial<AiStoryCanonicalScriptProducerError>>({ code: "CANONICAL_SCRIPT_INCOMPLETE_LINEAGE_CONFLICT" });
  });

  it("fails closed for unsupported Profile and absent frozen Outline before writer execution", async () => {
    const state = runtime();
    await expect(ensureCurrentFrozenCanonicalScript(ensureInput, { ...state.deps, resolveCurrentOutline: async () => null })).rejects.toMatchObject({ code: "CURRENT_FROZEN_OUTLINE_REQUIRED" });
    const core = { ...outline(), profile: { profileId: "CORE" as const, profileVersion: 1 as const }, productStoryProfile: undefined };
    await expect(ensureCurrentFrozenCanonicalScript(ensureInput, { ...state.deps, resolveCurrentOutline: async () => AiStoryOutlineVersionSchema.parse(core) })).rejects.toMatchObject({ code: "CANONICAL_SCRIPT_PROFILE_UNSUPPORTED" });
    await expect(ensureCurrentFrozenCanonicalScript({ ...ensureInput, characterAuthorities: [{ ...CHARACTER, characterFingerprint: hash("b") }] }, state.deps)).rejects.toMatchObject({ code: "CANONICAL_SCRIPT_CHARACTER_AUTHORITY_STALE" });
    expect(state.writerCalls()).toBe(0);
  });

  it("resolves zero or one exact current FROZEN Script with exact Outline lineage", async () => {
    const scope = { orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion };
    const source = outline();
    const none = { resolveCurrentOutline: async () => source, loadFrozenRows: async () => [] };
    await expect(resolveCurrentFrozenScriptForStoryVersion({} as never, scope, none as never)).resolves.toBeNull();
    const value = scriptFor();
    const row = { ...value, campaignId: I.campaign, script: value, createdAt: new Date(value.createdAt), approvedAt: new Date(value.approvedAt!), frozenAt: new Date(value.frozenAt!) };
    await expect(resolveCurrentFrozenScriptForStoryVersion({} as never, scope, { ...none, loadFrozenRows: async () => [row] } as never)).resolves.toEqual(value);
  });

  it("fails closed for ambiguous rows, stale Outline lineage, and bad source hash without timestamp selection", async () => {
    const scope = { orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion };
    const source = outline(); const value = scriptFor();
    const row = { ...value, campaignId: I.campaign, script: value, createdAt: new Date(value.createdAt), approvedAt: new Date(value.approvedAt!), frozenAt: new Date(value.frozenAt!) };
    await expect(resolveCurrentFrozenScriptForStoryVersion({} as never, scope, { resolveCurrentOutline: async () => source, loadFrozenRows: async () => [row, row] } as never)).rejects.toMatchObject<Partial<AiStoryScriptAuthorityError>>({ code: "CURRENT_FROZEN_SCRIPT_AMBIGUOUS" });
    await expect(resolveCurrentFrozenScriptForStoryVersion({} as never, scope, { resolveCurrentOutline: async () => ({ ...source, outlineVersionId: id(99) }), loadFrozenRows: async () => [row] } as never)).rejects.toMatchObject({ code: "CURRENT_FROZEN_SCRIPT_INVALID" });
    const bad = { ...value, sourceHash: hash("f") }; const badRow = { ...row, sourceHash: bad.sourceHash, script: bad };
    await expect(resolveCurrentFrozenScriptForStoryVersion({} as never, scope, { resolveCurrentOutline: async () => source, loadFrozenRows: async () => [badRow] } as never)).rejects.toMatchObject({ code: "SCRIPT_SOURCE_HASH_INVALID" });
    expect(readFileSync("packages/db/src/queries/ai-story-script.ts", "utf8").slice(0, 6000)).not.toMatch(/orderBy\([^)]*(createdAt|frozenAt)/);
  });

  it("gates normal Shot Plan generation on the Script and passes exact FROZEN authority with usage once", () => {
    const runner = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    const shot = runner.slice(runner.indexOf('case "shot_plan"'), runner.indexOf('case "character_continuity"'));
    expect(shot.indexOf("ensureCurrentFrozenCanonicalScript")).toBeLessThan(shot.indexOf("generateShotPlan"));
    expect(shot).toContain("canonicalScript: canonical.script");
    expect(shot).toContain("usage = addUsage(usage, canonical.usage)");
    const planner = readFileSync("packages/agents/src/ai-story/story-planning-service.ts", "utf8");
    expect(planner).toContain("The supplied Canonical Script is authoritative");
    expect(planner).toContain("must not change Script actions, Character IDs, Product authority, Outline Beat claims");
  });

  it("introduces no Director handoff, Canonical Scene, queue, migration, or certification Provider call", () => {
    const producer = readFileSync("apps/web/src/lib/ai-story-canonical-script-producer.ts", "utf8");
    for (const forbidden of ["DirectorHandoff", "CanonicalScene", "enqueue", "Seedance", "PhotoRoom", "MiniMax"]) expect(producer).not.toContain(forbidden);
    expect(producer).toContain("generateAiStoryScriptSemanticProposalV1");
    expect(producer).toContain("AiStoryScriptAuthorityService");
  });
});
