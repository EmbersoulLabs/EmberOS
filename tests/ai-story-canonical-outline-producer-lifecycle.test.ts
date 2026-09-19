import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AiStoryOutlineVersionSchema,
  validateAiStoryOutline,
} from "@ceo-agent/shared";
import {
  AI_STORY_CANONICAL_OUTLINE_COMPOSER_V1,
  composeAiStoryCanonicalOutlineV1,
  computeAiStoryOutlineSourceHash,
  validateAiStoryProductStoryProfile,
} from "@ceo-agent/shared/server";
import {
  AiStoryOutlineAuthorityError,
  resolveCurrentFrozenOutlineForStoryVersion,
} from "@ceo-agent/db";
import {
  AiStoryCanonicalOutlineProducerError,
  ensureCurrentFrozenCanonicalOutline,
  type CanonicalOutlineProducerDependencies,
} from "../apps/web/src/lib/ai-story-canonical-outline-producer";

const id = (n: number) => `92000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = { org: id(1), workspace: id(2), campaign: id(3), story: id(4), storyVersion: id(5), actor: id(6), product: id(7), character: id(8), characterVersion: id(9) };
const PROFILE = { profileId: "PRODUCT_STORY" as const, profileVersion: 1 as const, policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT };
const STORY = { title: "Exact story", summary: "Exact frozen summary", objective: "Exact frozen narrative objective", targetAudience: "People", tone: "Clear", estimatedDuration: "30s", story: { opening: "Open", development: "Develop", ending: "End" }, keyMessages: [], cta: "Learn more", assetReferences: [], warnings: [] };
const BEATS = [
  { id: "proposal-a", order: 0, name: "Open", purpose: "Introduce", summary: "The Product enters." },
  { id: "proposal-b", order: 1, name: "Advance", purpose: "Develop", summary: "Understanding advances." },
];

function compose(overrides: Partial<Parameters<typeof composeAiStoryCanonicalOutlineV1>[0]> = {}) {
  return composeAiStoryCanonicalOutlineV1({
    storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace,
    campaignId: I.campaign, version: 1, profile: PROFILE, storyDraft: STORY,
    proposedStoryBeats: BEATS, campaignObjective: "sales", customObjective: null,
    productAuthorityIds: [I.product], characterAuthorities: [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: `sha256:${"a".repeat(64)}` }],
    originalIdea: "Exact persisted user intent", supersedesOutlineVersionId: null,
    createdBy: I.actor, createdAt: "2026-09-15T00:00:00.000Z", ...overrides,
  });
}

function frozen(outline = compose()) {
  return AiStoryOutlineVersionSchema.parse({ ...outline, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-09-15T00:01:00.000Z", frozenAt: "2026-09-15T00:02:00.000Z" });
}

function runtime(historySeed: ReturnType<typeof frozen>[] = []) {
  let history = [...historySeed];
  const calls: string[] = [];
  const transition = (status: "VALIDATED" | "APPROVED" | "FROZEN") => async (_db: never, _scope: never, outlineVersionId: string) => {
    calls.push(status);
    const index = history.findIndex((item) => item.outlineVersionId === outlineVersionId);
    const prior = history[index]!;
    const next = AiStoryOutlineVersionSchema.parse({
      ...prior, status,
      approvedBy: status === "APPROVED" || status === "FROZEN" ? I.actor : prior.approvedBy,
      approvedAt: status === "APPROVED" || status === "FROZEN" ? "2026-09-15T00:01:00.000Z" : prior.approvedAt,
      frozenAt: status === "FROZEN" ? "2026-09-15T00:02:00.000Z" : prior.frozenAt,
    });
    history[index] = next;
    return next;
  };
  const deps: CanonicalOutlineProducerDependencies = {
    loadCurrentUpstream: async () => ({ orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, originalIdea: "Exact persisted user intent", structuredContent: STORY, frozenAt: new Date(), campaignObjective: "sales", customObjective: null }),
    resolveProfile: async () => PROFILE,
    resolveProductAuthorityIds: async () => [I.product],
    resolveCharacterAuthorities: async () => [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: `sha256:${"a".repeat(64)}` }],
    history: async () => [...history],
    propose: async (_db, _scope, outline) => { calls.push("DRAFT"); history.push(outline); return outline; },
    validate: transition("VALIDATED") as never,
    approve: transition("APPROVED") as never,
    freeze: transition("FROZEN") as never,
    now: () => "2026-09-15T00:00:00.000Z",
  };
  return { deps, calls, getHistory: () => history };
}

const ensureInput = { db: {} as never, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor, proposedStoryBeats: BEATS };

describe("AI Story Canonical Outline producer lifecycle V1", () => {
  it("publishes immutable composition policy and projects exact frozen Story semantics", () => {
    expect(AI_STORY_CANONICAL_OUTLINE_COMPOSER_V1).toMatchObject({ policyVersion: 1, premiseSource: "FROZEN_STORY_DRAFT_SUMMARY", coreClaimSource: "FROZEN_STORY_DRAFT_OBJECTIVE" });
    const outline = compose();
    expect(outline).toMatchObject({ premise: STORY.summary, coreClaim: STORY.objective, storyUnits: [], hooks: [], setupPayoffs: [], requiredSceneOutcomes: [], upstreamAuthorityId: I.storyVersion });
  });

  it("consumes canonical Beats and Product Story policy without proposal identity", () => {
    const outline = compose();
    expect(outline.beats.map((beat) => beat.id)).not.toContain(BEATS[0]!.id);
    expect(outline.productStoryProfile?.progressionGoals).toHaveLength(2);
    expect(outline.productStoryProfile?.progressionGoals[0]!.beatIds).toEqual([outline.beats[0]!.id]);
    expect(outline.productStoryProfile?.progressionGoals[1]!.beatIds).toEqual([outline.beats[1]!.id]);
  });

  it("binds exact, deterministic Campaign, Product, and Character snapshot references", () => {
    const first = compose({ productAuthorityIds: [I.product] });
    const second = compose({ productAuthorityIds: [I.product] });
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.sourceHash).toBe(computeAiStoryOutlineSourceHash(first));
    expect(first.authorityReferences).toEqual([
      { authorityType: "CAMPAIGN", authorityId: I.campaign },
      { authorityType: "CHARACTER", authorityId: I.character, authorityVersionId: I.characterVersion, authorityFingerprint: `sha256:${"a".repeat(64)}` },
      { authorityType: "PRODUCT", authorityId: I.product },
    ]);
    expect(first.castReferences).toBeUndefined();
  });

  it("passes Outline and PRODUCT_STORY validators with exact known authority", () => {
    const outline = compose();
    expect(validateAiStoryOutline(outline, { knownAuthorityReferences: new Set([`CAMPAIGN:${I.campaign}`, `PRODUCT:${I.product}`, `CHARACTER:${I.character}`]) })).toEqual([]);
    expect(validateAiStoryProductStoryProfile(outline)).toEqual([]);
  });

  it("fails closed for missing premise or core-claim authority", () => {
    expect(() => compose({ storyDraft: { ...STORY, summary: "" } })).toThrow("CANONICAL_OUTLINE_PREMISE_AUTHORITY_MISSING");
    expect(() => compose({ storyDraft: { ...STORY, objective: "" } })).toThrow("CANONICAL_OUTLINE_CORE_CLAIM_AUTHORITY_MISSING");
  });

  it("runs the complete DRAFT to VALIDATED to APPROVED to FROZEN lifecycle", async () => {
    const state = runtime();
    const result = await ensureCurrentFrozenCanonicalOutline(ensureInput, state.deps);
    expect(result.status).toBe("FROZEN");
    expect(state.calls).toEqual(["DRAFT", "VALIDATED", "APPROVED", "FROZEN"]);
    expect(state.getHistory()).toHaveLength(1);
  });

  it("rechecks exact current frozen Story authority through every durable lifecycle operation", async () => {
    const state = runtime();
    await ensureCurrentFrozenCanonicalOutline(ensureInput, {
      ...state.deps,
      history: async (db, scope) => {
        expect(scope.requireCurrentFrozenStoryVersion).toBe(true);
        return state.deps.history(db, scope);
      },
    });
    const denied = runtime();
    await expect(ensureCurrentFrozenCanonicalOutline(ensureInput, {
      ...denied.deps,
      loadCurrentUpstream: async () => { throw new AiStoryCanonicalOutlineProducerError("CURRENT_STORY_VERSION_REQUIRED", "stale"); },
    })).rejects.toMatchObject({ code: "CURRENT_STORY_VERSION_REQUIRED" });
  });

  it("converges when an equivalent concurrent request advances the same durable authority", async () => {
    const state = runtime();
    let raced = false;
    const originalValidate = state.deps.validate;
    const deps: CanonicalOutlineProducerDependencies = {
      ...state.deps,
      validate: async (...args) => {
        if (!raced) {
          raced = true;
          await originalValidate(...args);
          throw new Error("Invalid Outline lifecycle transition: DRAFT -> VALIDATED");
        }
        return originalValidate(...args);
      },
    };
    await expect(ensureCurrentFrozenCanonicalOutline(ensureInput, deps)).resolves.toMatchObject({ status: "FROZEN" });
    expect(state.getHistory()).toHaveLength(1);
  });

  it.each(["DRAFT", "VALIDATED", "APPROVED", "FROZEN"] as const)("resumes or reuses same-source %s authority", async (status) => {
    const base = frozen();
    const existing = AiStoryOutlineVersionSchema.parse({ ...base, status, approvedBy: status === "DRAFT" || status === "VALIDATED" ? null : I.actor, approvedAt: status === "DRAFT" || status === "VALIDATED" ? null : base.approvedAt, frozenAt: status === "FROZEN" ? base.frozenAt : null });
    const state = runtime([existing]);
    const result = await ensureCurrentFrozenCanonicalOutline(ensureInput, state.deps);
    expect(result.outlineVersionId).toBe(existing.outlineVersionId);
    expect(result.status).toBe("FROZEN");
    expect(state.getHistory()).toHaveLength(1);
  });

  it("creates a new lineage version only after a different-source FROZEN Outline", async () => {
    const prior = frozen(compose({ storyDraft: { ...STORY, summary: "Prior frozen summary" } }));
    const state = runtime([prior]);
    const result = await ensureCurrentFrozenCanonicalOutline(ensureInput, state.deps);
    expect(result.version).toBe(2);
    expect(result.supersedesOutlineVersionId).toBe(prior.outlineVersionId);
  });

  it("fails closed rather than superseding a different-source incomplete Outline", async () => {
    const prior = AiStoryOutlineVersionSchema.parse({ ...compose({ storyDraft: { ...STORY, summary: "Incomplete source" } }), status: "DRAFT" });
    await expect(ensureCurrentFrozenCanonicalOutline(ensureInput, runtime([prior as never]).deps)).rejects.toMatchObject<Partial<AiStoryCanonicalOutlineProducerError>>({ code: "CANONICAL_OUTLINE_INCOMPLETE_LINEAGE_CONFLICT" });
  });

  it("resolves zero or one exact current FROZEN Outline and verifies its hash", async () => {
    const scope = { orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion };
    const none = { loadCurrentStoryVersion: async () => true, loadFrozenRows: async () => [] };
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, none as never)).resolves.toBeNull();
    const value = frozen();
    const row = { ...value, campaignId: I.campaign, outline: value, createdAt: new Date(value.createdAt), approvedAt: new Date(value.approvedAt!), frozenAt: new Date(value.frozenAt!) };
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, { ...none, loadFrozenRows: async () => [row] } as never)).resolves.toEqual(value);
  });

  it("fails closed for a stale Story pointer, ambiguous FROZEN rows, and invalid source hash", async () => {
    const scope = { orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion };
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, { loadCurrentStoryVersion: async () => false, loadFrozenRows: async () => [] } as never)).rejects.toMatchObject<Partial<AiStoryOutlineAuthorityError>>({ code: "CURRENT_FROZEN_STORY_VERSION_REQUIRED" });
    const value = frozen();
    const row = { ...value, campaignId: I.campaign, outline: value, createdAt: new Date(value.createdAt), approvedAt: new Date(value.approvedAt!), frozenAt: new Date(value.frozenAt!) };
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, { loadCurrentStoryVersion: async () => true, loadFrozenRows: async () => [row, row] } as never)).rejects.toMatchObject<Partial<AiStoryOutlineAuthorityError>>({ code: "CURRENT_FROZEN_OUTLINE_AMBIGUOUS" });
    const corrupted = { ...row, outline: { ...value, premise: "corrupted" } };
    await expect(resolveCurrentFrozenOutlineForStoryVersion({} as never, scope, { loadCurrentStoryVersion: async () => true, loadFrozenRows: async () => [corrupted] } as never)).rejects.toMatchObject<Partial<AiStoryOutlineAuthorityError>>({ code: "OUTLINE_SOURCE_HASH_INVALID" });
  });

  it("gates Scene Plan on persisted Story Beats and the frozen Outline without regeneration", () => {
    const source = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    const sceneCase = source.slice(source.indexOf('case "scene_plan"'), source.indexOf('case "shot_plan"'));
    expect(sceneCase.indexOf("ensureCurrentFrozenCanonicalOutline")).toBeLessThan(sceneCase.indexOf("generateScenePlan"));
    expect(sceneCase).toContain("proposedStoryBeats: draft.storyBeats!");
    expect(sceneCase).not.toContain("generateStoryBeats");
    expect(sceneCase).not.toContain("buildAiStoryScriptVersion");
  });

  it("introduces no Provider, queue, Script, migration, or new persistence model", () => {
    const producer = readFileSync("apps/web/src/lib/ai-story-canonical-outline-producer.ts", "utf8");
    for (const forbidden of ["generateScenePlan(", "generateStoryBeats(", "buildAiStoryScriptVersion", "enqueue", "OpenAI", "Seedance", "PhotoRoom", "MiniMax"]) expect(producer).not.toContain(forbidden);
    expect(producer).toContain("AiStoryOutlineAuthorityService");
  });
});
