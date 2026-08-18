/**
 * Sprint 3 Phase 2B PR 2B.5 — Review & Assembly UI helpers / contracts.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import {
  canMutateReviewAssembly,
  canReadReviewAssembly,
  collectForbiddenPayloadKeys,
  formatExecutionLockLabel,
  formatExecutionReadiness,
  formatReviewStatus,
  isAssemblyCreateAvailable,
  isStoryApproveEligible,
  reviewAssemblyErrorMessage,
} from "../apps/web/src/lib/ai-story-review-assembly-ui";

function baseModel(overrides: Record<string, unknown> = {}) {
  return {
    review: {
      status: "UNDER_REVIEW",
      openedAt: "2026-08-04T12:00:00.000Z",
      openedBy: "30000000-0000-4000-8000-000000000040",
      scenes: [
        {
          sceneExecutionId: "30000000-0000-4000-8000-000000000010",
          sceneId: "scene-a",
          sceneOrder: 0,
          instructionHash: "hash-a",
          decision: "APPROVED",
          reviewedBy: "30000000-0000-4000-8000-000000000040",
          reviewedAt: "2026-08-04T12:01:00.000Z",
          qc: {
            status: "passed",
            resultHash: "qc-a",
            validatedAt: "2026-08-04T12:00:30.000Z",
            findingCount: 0,
            blockingFindingCount: 0,
            findings: [],
          },
        },
        {
          sceneExecutionId: "30000000-0000-4000-8000-000000000011",
          sceneId: "scene-b",
          sceneOrder: 1,
          instructionHash: "hash-b",
          decision: "APPROVED",
          reviewedBy: "30000000-0000-4000-8000-000000000040",
          reviewedAt: "2026-08-04T12:02:00.000Z",
          qc: {
            status: "passed",
            resultHash: "qc-b",
            validatedAt: "2026-08-04T12:00:30.000Z",
            findingCount: 0,
            blockingFindingCount: 0,
            findings: [],
          },
        },
      ],
      storyDecision: null,
    },
    assemblyDefinition: {
      status: "NOT_CREATED",
      id: null,
      sceneCount: 0,
      integrityHash: null,
      memberships: [],
      prerequisites: {
        hasDefinition: false,
        membershipComplete: false,
        reviewApproved: false,
        orderingDeterministic: false,
      },
    },
    ...overrides,
  } as never;
}

describe("Sprint 3 Phase 2B PR 2B.5 UI helpers", () => {
  it("renders status labels as three separate concepts", () => {
    expect(formatReviewStatus("APPROVED")).toBe("Approved");
    expect(formatReviewStatus("UNDER_REVIEW")).toBe("Under review");
    expect(formatReviewStatus("REJECTED")).toBe("Rejected");
    expect(formatExecutionReadiness("READY_FOR_EXECUTION")).toBe("Ready for execution");
    expect(formatExecutionReadiness("NOT_READY")).toBe("Not ready");
    expect(formatExecutionLockLabel(PHASE1_EXECUTION_LOCKED)).toBe("Locked until Phase 3");
  });

  it("gates mutation by role", () => {
    expect(canMutateReviewAssembly("operator")).toBe(true);
    expect(canMutateReviewAssembly("admin")).toBe(true);
    expect(canMutateReviewAssembly("client_viewer")).toBe(false);
    expect(canMutateReviewAssembly("editor")).toBe(false);
    expect(canReadReviewAssembly("client_viewer")).toBe(true);
    expect(canReadReviewAssembly(null)).toBe(false);
  });

  it("Story approve eligibility requires all scenes approved and not rejected", () => {
    expect(isStoryApproveEligible(baseModel())).toBe(true);
    expect(
      isStoryApproveEligible(
        baseModel({
          review: {
            ...baseModel().review,
            scenes: [
              { ...baseModel().review.scenes[0], decision: null },
              baseModel().review.scenes[1],
            ],
          },
        })
      )
    ).toBe(false);
    expect(
      isStoryApproveEligible(
        baseModel({
          review: { ...baseModel().review, status: "REJECTED" },
        })
      )
    ).toBe(false);
    expect(
      isStoryApproveEligible(
        baseModel({
          review: {
            ...baseModel().review,
            scenes: [
              {
                ...baseModel().review.scenes[0],
                qc: {
                  status: "failed",
                  resultHash: "x",
                  validatedAt: "2026-08-04T12:00:30.000Z",
                  findingCount: 1,
                  blockingFindingCount: 1,
                  findings: [{ code: "X", message: "block", severity: "blocking" }],
                },
              },
              baseModel().review.scenes[1],
            ],
          },
        })
      )
    ).toBe(false);
  });

  it("Assembly create only after Review APPROVED", () => {
    expect(isAssemblyCreateAvailable(baseModel())).toBe(false);
    expect(
      isAssemblyCreateAvailable(
        baseModel({
          review: { ...baseModel().review, status: "APPROVED" },
        })
      )
    ).toBe(true);
  });

  it("maps stable API errors to safe user messages", () => {
    expect(reviewAssemblyErrorMessage("STORY_REVIEW_NOT_ELIGIBLE")).toMatch(/Scene/i);
    expect(reviewAssemblyErrorMessage("FORBIDDEN")).toMatch(/permission/i);
    expect(reviewAssemblyErrorMessage("PHASE1_EXECUTION_LOCKED")).toMatch(/Phase 3/i);
    expect(reviewAssemblyErrorMessage("NOT_FOUND")).not.toMatch(/sql|stack|postgres/i);
  });

  it("detects forbidden sensitive payload keys", () => {
    const hits = collectForbiddenPayloadKeys({
      review: { status: "APPROVED" },
      nested: { prompt: "secret", negativePrompt: "x" },
    });
    expect(hits.some((h) => h.includes("prompt"))).toBe(true);
    expect(
      collectForbiddenPayloadKeys({
        review: { status: "APPROVED", scenes: [{ decision: "APPROVED" }] },
      })
    ).toEqual([]);
  });
});

describe("Sprint 3 Phase 2B PR 2B.5 UI source boundary", () => {
  const uiFiles = [
    "apps/web/src/components/ai-story-review/ExecutionPlanReviewPanel.tsx",
    "apps/web/src/lib/ai-story-review-assembly-client.ts",
    "apps/web/src/lib/ai-story-review-assembly-ui.ts",
  ];

  it("ships the Review panel under the AI Story surface", () => {
    for (const file of uiFiles) {
      expect(existsSync(resolve(file))).toBe(true);
    }
    const page = readFileSync(
      resolve("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx"),
      "utf8"
    );
    expect(page).toContain("ExecutionPlanReviewPanel");
    expect(page).not.toMatch(/Execute Story|Start Execution|Unlock Execution/i);
  });

  it("UI sources never touch Queue / Worker / Provider / unlock", () => {
    for (const file of uiFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source).not.toMatch(/from ["']@ceo-agent\/queue["']/);
      expect(source).not.toMatch(/from ["']@ceo-agent\/db["']/);
      expect(source).not.toMatch(/enqueueStoryExecution|startExecutionJob|ProviderRouter/);
      expect(source).not.toMatch(/seedance|minimax|upscale/i);
      expect(source).not.toMatch(/executionAllowed:\s*true/);
      expect(source).not.toMatch(/\bPATCH\b|\bPUT\b|\bDELETE\b/);
    }
  });

  it("client only calls approved PR 2B.4 path segments", () => {
    const client = readFileSync(
      resolve("apps/web/src/lib/ai-story-review-assembly-client.ts"),
      "utf8"
    );
    expect(client).toContain("/review");
    expect(client).toContain("/review/history");
    expect(client).toContain("/assembly-definition");
    expect(client).toContain("/decisions");
    expect(client).not.toContain("/execution/export");
    expect(client).not.toContain("/regenerate");
    expect(client).not.toContain("/retry");
  });
});
