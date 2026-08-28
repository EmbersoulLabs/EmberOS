import { describe, expect, it } from "vitest";
import {
  AiStoryOutlineVersionSchema,
  assertAiStoryOutlineLifecycleTransition,
  projectLegacyStoryToOutlineCompatibility,
  validateAiStoryOutline,
  type AiStoryOutlineVersion,
} from "@ceo-agent/shared";
import { buildAiStoryOutlineVersion, computeAiStoryOutlineSourceHash } from "@ceo-agent/shared/server";

const IDS = {
  outline: "10000000-0000-4000-8000-000000000001",
  org: "10000000-0000-4000-8000-000000000002",
  workspace: "10000000-0000-4000-8000-000000000003",
  campaign: "10000000-0000-4000-8000-000000000004",
  story: "10000000-0000-4000-8000-000000000005",
  version: "10000000-0000-4000-8000-000000000006",
  actor: "10000000-0000-4000-8000-000000000007",
  unit: "10000000-0000-4000-8000-000000000008",
  setup: "10000000-0000-4000-8000-000000000009",
  payoff: "10000000-0000-4000-8000-000000000010",
  hook: "10000000-0000-4000-8000-000000000011",
  relation: "10000000-0000-4000-8000-000000000012",
  outcome: "10000000-0000-4000-8000-000000000013",
  product: "10000000-0000-4000-8000-000000000014",
};

function outline(): AiStoryOutlineVersion {
  return buildAiStoryOutlineVersion({
    storyId: IDS.story,
    storyVersionId: IDS.version,
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    version: 1,
    profile: { profileId: "CORE", profileVersion: 1 },
    premise: "A founder proves that reliable craft earns trust.",
    coreClaim: "Verified product evidence changes the customer's decision.",
    storyUnits: [{
      storyUnitId: IDS.unit, order: 0, purpose: "Complete non-episodic story",
      summary: "Setup and payoff", requiredBeatIds: [IDS.setup, IDS.payoff], hookId: IDS.hook,
      terminalPayoffId: IDS.relation,
    }],
    beats: [
      { id: IDS.setup, storyUnitId: IDS.unit, order: 0, classification: "MAJOR", name: "Question", purpose: "Establish doubt", summary: "The customer needs proof", required: true, ownershipPolicy: "EXCLUSIVE", authorityReferences: [] },
      { id: IDS.payoff, storyUnitId: IDS.unit, order: 1, classification: "MINOR", name: "Proof", purpose: "Resolve doubt", summary: "Product evidence resolves the question", required: true, ownershipPolicy: "SPLITTABLE", authorityReferences: [{ authorityType: "PRODUCT", authorityId: IDS.product }] },
    ],
    hooks: [{ hookId: IDS.hook, semantics: "OPEN_QUESTION", promiseOrQuestion: "Will the evidence hold?", beatId: IDS.setup, requiredByProfile: false }],
    setupPayoffs: [{ relationshipId: IDS.relation, setupBeatId: IDS.setup, payoffBeatId: IDS.payoff, relationshipType: "QUESTION_ANSWER", required: true, intent: "Resolve the declared question" }],
    requiredSceneOutcomes: [{ outcomeId: IDS.outcome, order: 0, outcomeType: "DELIVER_PRODUCT_EVIDENCE", description: "Show authoritative product evidence", beatIds: [IDS.payoff], authorityReferences: [{ authorityType: "PRODUCT", authorityId: IDS.product }] }],
    authorityReferences: [{ authorityType: "PRODUCT", authorityId: IDS.product }],
    upstreamAuthorityId: `${IDS.campaign}:${IDS.version}`,
    supersedesOutlineVersionId: null,
    createdBy: IDS.actor,
    createdAt: "2026-08-28T00:00:00.000Z",
  });
}

describe("AI Story Writer/Outline authority", () => {
  it("builds deterministic provider-neutral lineage", () => {
    const first = outline();
    const second = outline();
    expect(first.outlineVersionId).toBe(second.outlineVersionId);
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.sourceHash).toBe(computeAiStoryOutlineSourceHash(first));
    expect(first.status).toBe("DRAFT");
    const serialized = JSON.stringify(first).toLowerCase();
    for (const forbidden of ["camera", "lens", "shotpurpose", "providerrequest", "retrypolicy", "motionplanner"]) expect(serialized).not.toContain(forbidden);
  });

  it("validates Beat, Hook, setup/payoff, unit, profile and authority references", () => {
    expect(validateAiStoryOutline(outline(), { knownAuthorityReferences: new Set([`PRODUCT:${IDS.product}`]) })).toEqual([]);
    const broken = structuredClone(outline());
    broken.beats[1]!.id = IDS.setup;
    broken.setupPayoffs[0]!.payoffBeatId = "20000000-0000-4000-8000-000000000001";
    broken.hooks[0]!.beatId = "20000000-0000-4000-8000-000000000002";
    const gates = new Set(validateAiStoryOutline(broken).map((issue) => issue.gate));
    expect(gates).toContain("BEAT_ID_UNIQUENESS_GATE");
    expect(gates).toContain("HOOK_BINDING_GATE");
    expect(gates).toContain("SETUP_PAYOFF_REFERENCE_GATE");
  });

  it("supports non-episodic stories and optional Hooks", () => {
    const value = { ...outline(), storyUnits: [], hooks: [] };
    value.beats = value.beats.map(({ storyUnitId: _ignored, ...beat }) => beat);
    expect(AiStoryOutlineVersionSchema.safeParse(value).success).toBe(true);
    expect(validateAiStoryOutline(value as AiStoryOutlineVersion)).toEqual([]);
  });

  it("enforces validated -> approved -> frozen and requires a new version for changes", () => {
    expect(() => assertAiStoryOutlineLifecycleTransition("DRAFT", "APPROVED")).toThrow();
    expect(() => assertAiStoryOutlineLifecycleTransition("DRAFT", "VALIDATED")).not.toThrow();
    expect(() => assertAiStoryOutlineLifecycleTransition("VALIDATED", "APPROVED")).not.toThrow();
    expect(() => assertAiStoryOutlineLifecycleTransition("APPROVED", "FROZEN")).not.toThrow();
    expect(() => assertAiStoryOutlineLifecycleTransition("FROZEN", "VALIDATED")).toThrow();
  });

  it("keeps historical Stories readable without materializing an Outline", () => {
    expect(projectLegacyStoryToOutlineCompatibility({ storyId: IDS.story, storyVersionId: IDS.version, structuredContent: { title: "Legacy" } })).toMatchObject({ kind: "LEGACY_STORY_COMPATIBILITY", outlineVersion: null });
  });
});
