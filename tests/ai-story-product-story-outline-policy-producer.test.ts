import { describe, expect, it } from "vitest";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AiStoryProductStoryOutlinePolicySchema,
} from "@ceo-agent/shared";
import {
  AI_STORY_PRODUCT_STORY_OUTLINE_POLICY_PRODUCER_V1,
  buildAiStoryOutlineVersion,
  buildAiStoryProductStoryOutlinePolicyV1,
  buildCanonicalOutlineBeatBasis,
  validateAiStoryProductStoryProfile,
} from "@ceo-agent/shared/server";

const id = (n: number) => `91000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const STORY_ID = id(1);
const STORY_VERSION_ID = id(2);
const PRODUCT_A = id(3);
const PRODUCT_B = id(4);
const PROFILE = {
  profileId: "PRODUCT_STORY",
  profileVersion: 1,
  policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
} as const;
const PROPOSALS = [
  { id: "model-intro", order: 0, name: "Opening", purpose: "Introduce the subject", summary: "The Product enters the story." },
  { id: "model-advance", order: 1, name: "Advance", purpose: "Advance understanding", summary: "The story develops Product understanding." },
];

function beats() {
  return buildCanonicalOutlineBeatBasis({
    storyId: STORY_ID,
    storyVersionId: STORY_VERSION_ID,
    profile: PROFILE,
    proposedStoryBeats: PROPOSALS,
  });
}

function build(overrides: Partial<Parameters<typeof buildAiStoryProductStoryOutlinePolicyV1>[0]> = {}) {
  return buildAiStoryProductStoryOutlinePolicyV1({
    storyId: STORY_ID,
    storyVersionId: STORY_VERSION_ID,
    profile: PROFILE,
    campaignObjective: "awareness",
    customObjective: null,
    productAuthorityIds: [PRODUCT_B, PRODUCT_A],
    canonicalBeats: beats(),
    originalIdea: "Keep the user-authored Product story exact.",
    ...overrides,
  });
}

describe("AI Story Product Story Outline policy producer V1", () => {
  it("publishes one immutable server-owned V1 producer policy", () => {
    expect(AI_STORY_PRODUCT_STORY_OUTLINE_POLICY_PRODUCER_V1).toMatchObject({
      policyId: "AI_STORY_PRODUCT_STORY_OUTLINE_POLICY_PRODUCER",
      policyVersion: 1,
      contractVersion: "ai-story-product-story-outline-policy-producer.v1",
      progressionGoalCount: 2,
      packshotPolicy: "OPTIONAL",
      claimEvidencePolicy: "NONE_UNTIL_CANONICAL_CLAIM_AUTHORITY",
    });
  });

  it("requires the exact registered PRODUCT_STORY profile and rejects CORE", () => {
    expect(() => build({ profile: { profileId: "CORE", profileVersion: 1 } as never })).toThrow();
    expect(() => build({ profile: { ...PROFILE, policyFingerprint: "sha256:deadbeef" } as never })).toThrow();
  });

  it.each([
    ["awareness", "PRODUCT_DETAIL_REVEAL", "OPTIONAL"],
    ["engagement", "PRODUCT_RELATIONSHIP", "OPTIONAL"],
    ["sales", "PRODUCT_EVIDENCE", "REQUIRED"],
    ["lead_generation", "PRODUCT_EVIDENCE", "REQUIRED"],
    ["other", "PRODUCT_CONTEXT", "OPTIONAL"],
  ] as const)("maps %s to certified progression and CTA authority", (campaignObjective, advance, cta) => {
    const policy = build({
      campaignObjective,
      customObjective: campaignObjective === "other" ? "Support a custom launch objective" : "ignored canonical residue",
    });
    expect(policy.campaignObjective).toBe(campaignObjective);
    expect(policy.customObjective).toBe(campaignObjective === "other" ? "Support a custom launch objective" : null);
    expect(policy.progressionGoals.map((goal) => goal.semanticFunction)).toEqual(["PRODUCT_INTRODUCTION", advance]);
    expect(policy.ctaPolicy).toBe(cta);
  });

  it("fails closed when the other objective lacks canonical custom intent", () => {
    expect(() => build({ campaignObjective: "other", customObjective: null })).toThrow(
      "PRODUCT_STORY_CUSTOM_OBJECTIVE_AUTHORITY_MISSING",
    );
  });

  it("requires unique source Product authority IDs and returns deterministic ordering", () => {
    expect(build().productAuthorityIds).toEqual([PRODUCT_A, PRODUCT_B]);
    expect(() => build({ productAuthorityIds: [] })).toThrow();
    expect(() => build({ productAuthorityIds: [PRODUCT_A, PRODUCT_A] })).toThrow();
  });

  it("accepts only the exact canonical Beat basis, never proposal identity", () => {
    const policy = build();
    expect(policy.progressionGoals[0]!.beatIds).toEqual([beats()[0]!.id]);
    expect(policy.progressionGoals[1]!.beatIds).toEqual([beats()[1]!.id]);
    expect(() => build({ canonicalBeats: PROPOSALS as never })).toThrow();
    expect(() => build({ canonicalBeats: [{ ...beats()[0]!, id: id(99) }] })).toThrow(
      "PRODUCT_STORY_CANONICAL_BEAT_AUTHORITY_INVALID",
    );
  });

  it("binds both required goals to one canonical Beat when the basis has one Beat", () => {
    const single = buildCanonicalOutlineBeatBasis({
      storyId: STORY_ID,
      storyVersionId: STORY_VERSION_ID,
      profile: PROFILE,
      proposedStoryBeats: [PROPOSALS[0]!],
    });
    const policy = build({ canonicalBeats: single });
    expect(policy.progressionGoals).toHaveLength(2);
    expect(policy.progressionGoals.every((goal) => goal.required)).toBe(true);
    expect(policy.progressionGoals.map((goal) => goal.beatIds)).toEqual([[single[0]!.id], [single[0]!.id]]);
    expect(policy.progressionGoals.every((goal) => goal.requiredSceneOutcomeIds.length === 0)).toBe(true);
  });

  it("produces deterministic UUID goal identity without proposal IDs, randomness or timestamps", () => {
    expect(build()).toEqual(build());
    for (const goal of build().progressionGoals) {
      expect(goal.goalId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(PROPOSALS.some((proposal) => proposal.id === goal.goalId)).toBe(false);
    }
  });

  it("emits no claims, keeps packshot optional, and uses fixed policy intent", () => {
    const policy = build({ campaignObjective: "sales" });
    expect(policy.claimEvidence).toEqual([]);
    expect(policy.packshotPolicy).toBe("OPTIONAL");
    expect(policy.progressionGoals.map((goal) => goal.intent)).toEqual([
      "Establish the selected Product as a canonical subject of the story.",
      "Use only authority-supported Product evidence.",
    ]);
  });

  it("preserves normalized originalIdea exactly and losslessly chunks Unicode text", () => {
    expect(build({ originalIdea: "  Exact user intent.  " }).userCreativeIntent.join("")).toBe("Exact user intent.");
    const longIdea = `${"😀".repeat(490)}AB${"z".repeat(1200)} final`;
    const policy = build({ originalIdea: longIdea });
    expect(policy.userCreativeIntent.join("")).toBe(longIdea);
    expect(policy.userCreativeIntent.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(policy.userCreativeIntent.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    expect(policy.userCreativeIntent.every((chunk) => !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true);
  });

  it("passes the existing schema and Product Story profile validator when composed by Outline authority", () => {
    const canonicalBeats = beats();
    const policy = build({ canonicalBeats, productAuthorityIds: [PRODUCT_A] });
    expect(AiStoryProductStoryOutlinePolicySchema.parse(policy)).toEqual(policy);
    const outline = buildAiStoryOutlineVersion({
      storyId: STORY_ID,
      storyVersionId: STORY_VERSION_ID,
      orgId: id(10),
      workspaceId: id(11),
      version: 1,
      profile: PROFILE,
      productStoryProfile: policy,
      premise: "Canonical Product story premise",
      coreClaim: "Only authority-supported Product information is used",
      storyUnits: [],
      beats: canonicalBeats,
      hooks: [],
      setupPayoffs: [],
      requiredSceneOutcomes: [],
      authorityReferences: [{ authorityType: "PRODUCT", authorityId: PRODUCT_A }],
      upstreamAuthorityId: STORY_VERSION_ID,
      supersedesOutlineVersionId: null,
      createdBy: id(12),
      createdAt: "2026-09-13T00:00:00.000Z",
    });
    expect(validateAiStoryProductStoryProfile(outline)).toEqual([]);
  });
});
