import { describe, expect, it } from "vitest";
import { AiStoryOutlineBeatSchema, StoryBeatSchema } from "@ceo-agent/shared";
import {
  AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY_V1,
  buildCanonicalOutlineBeatBasis,
} from "@ceo-agent/shared/server";

const STORY_ID = "10000000-0000-4000-8000-000000000001";
const STORY_VERSION_ID = "10000000-0000-4000-8000-000000000002";
const OTHER_STORY_VERSION_ID = "10000000-0000-4000-8000-000000000003";
const PRODUCT_STORY_PROFILE = {
  profileId: "PRODUCT_STORY",
  profileVersion: 1,
  policyFingerprint: "sha256:26bb7055894e1a5374f4b617efd031bcc31bcd03c5e05bde378a798148fd9be1",
} as const;

const proposals = [
  {
    id: "model-opening",
    name: "Opening",
    purpose: "Establish the need",
    order: 0,
    summary: "A customer encounters a practical problem.",
  },
  {
    id: "model-proof",
    name: "Proof",
    purpose: "Demonstrate credible evidence",
    order: 1,
    summary: "The product resolves the problem through visible evidence.",
  },
];

function build(overrides: Partial<Parameters<typeof buildCanonicalOutlineBeatBasis>[0]> = {}) {
  return buildCanonicalOutlineBeatBasis({
    storyId: STORY_ID,
    storyVersionId: STORY_VERSION_ID,
    profile: PRODUCT_STORY_PROFILE,
    proposedStoryBeats: proposals,
    ...overrides,
  });
}

describe("AI Story canonical Outline Beat promotion policy V1", () => {
  it("publishes one fixed, non-configurable V1 policy", () => {
    expect(AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY_V1).toEqual({
      policyId: "AI_STORY_OUTLINE_BEAT_PROMOTION_POLICY",
      policyVersion: 1,
      contractVersion: "ai-story-outline-beat-promotion-policy.v1",
      classification: "MAJOR",
      required: true,
      ownershipPolicy: "EXCLUSIVE",
      storyUnitPolicy: "NONE",
      beatAuthorityReferencePolicy: "NONE_AT_BASIS",
    });
  });

  it("reuses both existing Beat schemas", () => {
    expect(StoryBeatSchema.safeParse(proposals[0]).success).toBe(true);
    expect(build().every((beat) => AiStoryOutlineBeatSchema.safeParse(beat).success)).toBe(true);
  });

  it("replaces proposal identity with deterministic canonical UUID identity", () => {
    const first = build();
    const renamedProposalIds = proposals.map((beat, index) => ({
      ...beat,
      id: `untrusted-${index}`,
    }));
    const second = build({ proposedStoryBeats: renamedProposalIds });

    expect(first).toEqual(second);
    expect(first[0]!.id).not.toBe(proposals[0]!.id);
    expect(first[0]!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("changes canonical identity when Story Version or semantic content changes", () => {
    const original = build();
    const nextVersion = build({ storyVersionId: OTHER_STORY_VERSION_ID });
    const changedMeaning = build({
      proposedStoryBeats: proposals.map((beat, index) =>
        index === 0 ? { ...beat, summary: "A different canonical opening." } : beat,
      ),
    });

    expect(nextVersion[0]!.id).not.toBe(original[0]!.id);
    expect(changedMeaning[0]!.id).not.toBe(original[0]!.id);
  });

  it("returns exactly the same output for exactly the same input", () => {
    expect(build()).toEqual(build());
  });

  it("preserves validated contiguous order without reordering", () => {
    expect(build().map((beat) => beat.order)).toEqual([0, 1]);
    expect(() => build({
      proposedStoryBeats: proposals.map((beat, index) => ({ ...beat, order: index + 1 })),
    })).toThrow("CANONICAL_OUTLINE_BEAT_ORDER_INVALID");
    expect(() => build({
      proposedStoryBeats: proposals.map((beat) => ({ ...beat, order: 0 })),
    })).toThrow("CANONICAL_OUTLINE_BEAT_ORDER_INVALID");
  });

  it("promotes exact normalized semantic text without rewriting it", () => {
    const [beat] = build({
      proposedStoryBeats: [{
        id: "model-beat",
        name: "  Exact name  ",
        purpose: "  Exact purpose  ",
        order: 0,
        summary: "  Exact summary  ",
      }],
    });
    expect(beat).toMatchObject({
      name: "Exact name",
      purpose: "Exact purpose",
      summary: "Exact summary",
    });
  });

  it("always applies MAJOR, required and EXCLUSIVE without text heuristics", () => {
    const beats = build({
      proposedStoryBeats: [{
        id: "model-minor-optional-splittable",
        name: "Minor optional splittable product aside",
        purpose: "Suggest a nonessential aside",
        order: 0,
        summary: "Text cannot select authority policy.",
      }],
    });
    expect(beats[0]).toMatchObject({
      classification: "MAJOR",
      required: true,
      ownershipPolicy: "EXCLUSIVE",
    });
  });

  it("creates neither Story Units nor authority references at the Beat basis", () => {
    for (const beat of build()) {
      expect(beat).not.toHaveProperty("storyUnitId");
      expect(beat.authorityReferences).toEqual([]);
    }
  });

  it("rejects caller-supplied Beat authority fields", () => {
    const injected = [{
      ...proposals[0],
      classification: "MINOR",
      required: false,
      ownershipPolicy: "SPLITTABLE",
      authorityReferences: [{ authorityType: "PRODUCT", authorityId: STORY_ID }],
    }];
    expect(() => build({ proposedStoryBeats: injected })).toThrow();
  });

  it("uses Profile as validated context without reselecting or changing policy", () => {
    const productStory = build();
    const core = build({ profile: { profileId: "CORE", profileVersion: 1 } });
    expect(core).toEqual(productStory);
    expect(core[0]).toMatchObject({
      classification: "MAJOR",
      required: true,
      ownershipPolicy: "EXCLUSIVE",
    });
  });

  it("returns only a Beat array and creates no Product policy or full Outline", () => {
    const result = build();
    expect(Array.isArray(result)).toBe(true);
    expect(result).not.toHaveProperty("productStoryProfile");
    expect(result).not.toHaveProperty("outlineVersionId");
    expect(JSON.stringify(result)).not.toContain("progressionGoals");
  });
});
