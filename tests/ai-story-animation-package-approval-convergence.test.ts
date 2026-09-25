import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AnimationPackageApprovalConvergenceError,
  certifyAnimationPackageApprovalProjection,
} from "@ceo-agent/db";
import {
  readAnimationPackageContinuityFacts,
  resolveEpisodeContinuityMutableFacts,
} from "@ceo-agent/db";
import { buildEpisodeContinuityPlanningPromptSection } from "@ceo-agent/agents";
import type { StoryReviewDecision } from "@ceo-agent/shared";

const id = (n: number) =>
  `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;

const approvedDecision: StoryReviewDecision = {
  factId: id(1),
  executionPlanId: id(2),
  decision: "APPROVED",
  reviewedBy: id(3),
  reviewedAt: "2026-09-24T16:04:31.876Z",
  requiredSceneExecutionIds: [id(4)],
  approvedSceneExecutionIds: [id(4)],
  contractVersion: "ai-story-execution-contract.v1",
  deterministicFingerprint: hash("a"),
};

const base = {
  packageStatus: "ready_for_execution",
  packagePayload: {
    contractVersion: "ai-story-execution-materialization.v1",
    authority: { contractVersion: "ai-story-execution-materialization.v1" },
  },
  reviewStatus: "APPROVED",
  storyDecision: approvedDecision,
};

describe("Animation Package approval authority convergence", () => {
  it("accepts an approved Review with a complete package approval projection", () => {
    expect(
      certifyAnimationPackageApprovalProjection({
        ...base,
        approvedBy: approvedDecision.reviewedBy,
        approvedAt: new Date(approvedDecision.reviewedAt),
      })
    ).toBe("CURRENT");
  });

  it("classifies a completely missing historical projection as recoverable", () => {
    expect(
      certifyAnimationPackageApprovalProjection({
        ...base,
        approvedBy: null,
        approvedAt: null,
      })
    ).toBe("MISSING_RECOVERABLE");
  });

  it.each([
    [approvedDecision.reviewedBy, null],
    [null, new Date(approvedDecision.reviewedAt)],
  ])("fails closed for partial package approval metadata", (approvedBy, approvedAt) => {
    expect(() =>
      certifyAnimationPackageApprovalProjection({
        ...base,
        approvedBy,
        approvedAt,
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ANIMATION_PACKAGE_APPROVAL_PROJECTION_CONFLICT",
      })
    );
  });

  it.each([
    [id(99), new Date(approvedDecision.reviewedAt)],
    [approvedDecision.reviewedBy, new Date("2026-09-24T16:05:00.000Z")],
  ])("fails closed for a conflicting recovered approver or timestamp", (approvedBy, approvedAt) => {
    expect(() =>
      certifyAnimationPackageApprovalProjection({
        ...base,
        approvedBy,
        approvedAt,
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ANIMATION_PACKAGE_APPROVAL_PROJECTION_CONFLICT",
      })
    );
  });

  it("rejects package readiness without an approved canonical Review", () => {
    expect(() =>
      certifyAnimationPackageApprovalProjection({
        ...base,
        approvedBy: approvedDecision.reviewedBy,
        approvedAt: new Date(approvedDecision.reviewedAt),
        reviewStatus: "UNDER_REVIEW",
        storyDecision: { ...approvedDecision, decision: "REJECTED" },
      })
    ).toThrowError(
      expect.objectContaining({ code: "CANONICAL_EXECUTION_REVIEW_NOT_APPROVED" })
    );
  });

  it("recovers only persisted facts from a historical materialization payload", () => {
    const facts = readAnimationPackageContinuityFacts({
      contractVersion: "ai-story-execution-materialization.v1",
      authority: {
        contractVersion: "ai-story-execution-materialization.v1",
        characterId: id(10),
        characterVersionId: id(11),
        characterFingerprint: hash("b"),
        outfit: "blue jacket",
        location: "flower shop",
        action: "arranging flowers naturally",
        dialogue: "These flowers are ready for today.",
      },
    });
    expect(facts.historicalCharacterAuthority).toMatchObject({
      characterId: id(10),
      outfit: "blue jacket",
      location: "flower shop",
    });
    expect(facts.completedBeatIds).toEqual([]);
    expect(facts.timeOfDay).toBeNull();
    expect(facts.composition).toBeNull();
    expect(facts.cameraMovement).toBeNull();
  });

  it("uses Final Story Result package facts ahead of a stale Story-wide Episode look", () => {
    expect(
      resolveEpisodeContinuityMutableFacts({
        episodeLook: {
          wardrobe: "white blouse",
          location: "warm café",
          action: "drinking coffee",
          dialogue: "A quiet coffee.",
          pose: "relaxed café interaction",
          expression: "gentle smile",
        },
        historicalCharacterAuthority: {
          characterId: id(10),
          characterVersionId: id(11),
          characterFingerprint: hash("b"),
          outfit: "blue jacket",
          location: "flower shop",
          action: "arranging flowers naturally",
          dialogue: "These flowers are ready for today.",
        },
      })
    ).toEqual({
      outfit: "blue jacket",
      location: "flower shop",
      action: "arranging flowers naturally",
      dialogue: "These flowers are ready for today.",
      physicalState: null,
      emotionalState: null,
    });
  });

  it("uses the pinned Episode look when a full package has no historical authority capsule", () => {
    expect(
      resolveEpisodeContinuityMutableFacts({
        episodeLook: {
          wardrobe: "blue jacket",
          location: "flower shop",
          action: "checking an order",
          dialogue: "A new order.",
          pose: "holding phone",
          expression: "attentive",
        },
        historicalCharacterAuthority: null,
      })
    ).toEqual({
      outfit: "blue jacket",
      location: "flower shop",
      action: "checking an order",
      dialogue: "A new order.",
      physicalState: "holding phone",
      emotionalState: "attentive",
    });
  });

  it("documents historical Character identity as reusable/DNA authority, not Campaign projection identity", () => {
    const runtime = readFileSync(
      "packages/db/src/queries/ai-story-episode-continuity-runtime.ts",
      "utf8"
    );
    expect(runtime).toContain(
      "historicalCharacterAuthority.characterId !== dna.reusableCharacterId"
    );
    expect(runtime).toContain(
      "historicalCharacterAuthority.characterVersionId !== dna.reusableCharacterVersionId"
    );
    expect(runtime).toContain(
      "historicalCharacterAuthority.characterFingerprint !== dna.characterDnaFingerprint"
    );
  });

  it("rejects an unknown historical payload instead of inventing authority", () => {
    expect(() => readAnimationPackageContinuityFacts({ authority: {} })).toThrowError(
      expect.objectContaining({ code: "CONTINUITY_SOURCE_NOT_CANONICAL" })
    );
  });

  it("injects the exact loaded continuity context without changing mode authority", () => {
    const context = {
      contractVersion: "ai-story-episode-continuity-planning-context.v1",
      authorityId: id(20),
      authorityFingerprint: hash("c"),
      previousEpisodeFacts: {
        characterStates: [],
        locationState: null,
        objectStates: [],
        narrativeState: null,
        visualState: null,
        audioState: null,
      },
      approvedCurrentEpisodeChanges: { outfit: "blue jacket", location: "flower shop" },
      generationMode: null,
      provider: null,
    } as const;
    const prompt = buildEpisodeContinuityPlanningPromptSection(context as never);
    expect(prompt).toContain(context.authorityId);
    expect(prompt).toContain('"generationMode":null');
    expect(prompt).toContain('"provider":null');
  });
});
