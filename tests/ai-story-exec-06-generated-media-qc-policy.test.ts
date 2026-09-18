/**
 * EMBEROS-AI-STORY-EXEC-06 — generated-media QC policy freeze.
 * Deterministic fixtures only. No Seedance / MiniMax / PhotoRoom / paid calls.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AI_STORY_V1_QC_MAY_ENQUEUE_PROVIDER_RETRY,
  AI_STORY_V1_QC_POLICY,
  FUTURE_MEDIA_AWARE_QC_PIPELINE,
  GENERATED_MEDIA_ACCEPTANCE_AUTHORITY,
  PLAN_QC_SCOPE,
  deriveGeneratedMediaAssemblyEligibility,
  generatedMediaReviewAllowsAssembly,
  planQcPassApprovesGeneratedMedia,
  reconstructFinalStoryResultQcProvenance,
  rejectForgedGeneratedSceneReviewBody,
  resolveAiStorySceneMaxAttempts,
  selectAssemblyAuthoritativeSceneResults,
  type GeneratedSceneReviewFact,
} from "@ceo-agent/shared";
import {
  type AssemblySceneMediaMetadata,
  type AssemblySceneMembership,
  type AssemblyValidationExecutionPlan,
  type AssemblyValidationOwnershipExpectation,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import { WorkspaceAccessError, buildAssemblyDefinitionFingerprint } from "@ceo-agent/db";
import { authorizeAiStoryExecution } from "../packages/agents/src/ai-story/ai-story-execution-authorization";
import { qcAllowsExecution } from "../packages/agents/src/ai-story/ai-qc-validator";
import {
  createInMemoryAssemblyValidationRepository,
} from "../packages/agents/src/ai-story/assembly-validation-repository";
import {
  computeAssemblyValidationExecutionPlanIntegrityHash,
  validateAssemblyInputs,
} from "../packages/agents/src/ai-story/assembly-validator";
import { GeneratedSceneReviewService } from "../packages/agents/src/ai-story/generated-scene-review-service";

const ROOT = process.cwd();
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000002";
const WORKSPACE = "10000000-0000-4000-8000-000000000003";
const PLAN = "10000000-0000-4000-8000-000000000101";
const SCENE_EXEC_A = "10000000-0000-4000-8000-000000000201";
const SCENE_EXEC_B = "10000000-0000-4000-8000-000000000202";
const SCENE_EXEC_C = "10000000-0000-4000-8000-000000000203";
const SCENE_RESULT_A = "10000000-0000-5000-8000-000000000301";
const SCENE_RESULT_B = "10000000-0000-5000-8000-000000000302";
const SCENE_RESULT_C = "10000000-0000-5000-8000-000000000303";
const SCENE_RESULT_B2 = "10000000-0000-5000-8000-000000000312";
const DEF_ID = "10000000-0000-4000-8000-000000000401";
const HASH_A =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const OWNERSHIP: AssemblyValidationOwnershipExpectation = {
  orgId: ORG,
  workspaceId: WORKSPACE,
  campaignId: "10000000-0000-4000-8000-000000000004",
  storyId: "10000000-0000-4000-8000-000000000005",
  storyVersionId: "10000000-0000-4000-8000-000000000006",
  animationPackageId: "10000000-0000-4000-8000-000000000007",
  executionPlanId: PLAN,
};

function reviewFact(
  patch: Pick<
    GeneratedSceneReviewFact,
    "sceneExecutionId" | "sceneId" | "providerAttemptId" | "decision"
  > &
    Partial<GeneratedSceneReviewFact>
): GeneratedSceneReviewFact {
  return {
    generatedSceneReviewId: patch.generatedSceneReviewId ?? "10000000-0000-4000-8000-000000000801",
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    executionPlanId: PLAN,
    sceneResultId: patch.sceneResultId ?? null,
    decidedBy: patch.decision === "APPROVED" ? USER : null,
    decidedAt: patch.decision === "PENDING_REVIEW" ? null : "2026-08-19T12:00:00.000Z",
    rationale: null,
    contractVersion: "1",
    ...patch,
  };
}

function plan(): AssemblyValidationExecutionPlan {
  const base = {
    executionPlanId: PLAN,
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    storyVersionId: OWNERSHIP.storyVersionId,
    animationPackageId: OWNERSHIP.animationPackageId,
  };
  return {
    ...base,
    integrityHash: computeAssemblyValidationExecutionPlanIntegrityHash(base),
  };
}

function definition(
  orderedSceneExecutionIds: string[] = [SCENE_EXEC_A, SCENE_EXEC_B, SCENE_EXEC_C]
): StoryAssemblyDefinition {
  return {
    assemblyDefinitionId: DEF_ID,
    executionPlanId: PLAN,
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignId: OWNERSHIP.campaignId,
    storyId: OWNERSHIP.storyId,
    storyVersionId: OWNERSHIP.storyVersionId,
    animationPackageId: OWNERSHIP.animationPackageId,
    sceneCount: orderedSceneExecutionIds.length,
    orderedSceneExecutionIds,
    createdBy: USER,
    createdAt: "2026-08-19T04:00:00.000Z",
    contractVersion: "1",
    deterministicFingerprint: buildAssemblyDefinitionFingerprint({
      executionPlanId: PLAN,
      orderedSceneExecutionIds,
    }),
  };
}

function membership(
  sceneExecutionId: string,
  sceneId: string,
  sceneOrder: number,
  membershipId: string
): AssemblySceneMembership {
  return {
    membershipId,
    assemblyDefinitionId: DEF_ID,
    executionPlanId: PLAN,
    sceneExecutionId,
    sceneId,
    sceneOrder,
    contractVersion: "1",
    deterministicFingerprint: `sha256:membership-${sceneOrder}`,
  };
}

function sceneResult(input: {
  sceneResultId: string;
  sceneExecutionId: string;
  sceneId: string;
  sceneOrder: number;
  contentHash: string;
}): CanonicalSceneResult {
  return {
    sceneResultId: input.sceneResultId,
    sceneRuntimeId: "10000000-0000-5000-8000-000000000601",
    executionPlanId: PLAN,
    sceneExecutionId: input.sceneExecutionId,
    sceneId: input.sceneId,
    sceneOrder: input.sceneOrder,
    ownership: OWNERSHIP,
    status: "SUCCEEDED",
    failureClassification: null,
    durationMs: 4000,
    acceptedAt: "2026-08-19T04:10:00.000Z",
    integrityHash: `sha256:result-${input.sceneResultId}`,
    contractVersion: "1",
    mediaReference: {
      uri: `asset://scene/${input.sceneId}.mp4`,
      contentHash: input.contentHash,
      mediaType: "video/mp4",
    },
  };
}

function media(
  sceneResultId: string,
  contentHash: string
): AssemblySceneMediaMetadata {
  return {
    sceneResultId,
    contentHash,
    mediaType: "video/mp4",
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    durationMs: 4000,
    metadataReadable: true,
    videoStreamCount: 1,
  };
}

const THREE_SCENES = [
  sceneResult({
    sceneResultId: SCENE_RESULT_A,
    sceneExecutionId: SCENE_EXEC_A,
    sceneId: "scene-a",
    sceneOrder: 0,
    contentHash: HASH_A,
  }),
  sceneResult({
    sceneResultId: SCENE_RESULT_B,
    sceneExecutionId: SCENE_EXEC_B,
    sceneId: "scene-b",
    sceneOrder: 1,
    contentHash: HASH_B,
  }),
  sceneResult({
    sceneResultId: SCENE_RESULT_C,
    sceneExecutionId: SCENE_EXEC_C,
    sceneId: "scene-c",
    sceneOrder: 2,
    contentHash: HASH_C,
  }),
];

function threeSceneRepo(approvedSceneResultIds: readonly string[]) {
  return createInMemoryAssemblyValidationRepository({
    executionPlans: [plan()],
    assemblyDefinitions: [definition()],
    memberships: [
      membership(SCENE_EXEC_A, "scene-a", 0, "10000000-0000-4000-8000-000000000701"),
      membership(SCENE_EXEC_B, "scene-b", 1, "10000000-0000-4000-8000-000000000702"),
      membership(SCENE_EXEC_C, "scene-c", 2, "10000000-0000-4000-8000-000000000703"),
    ],
    sceneResults: THREE_SCENES,
    mediaMetadata: [
      media(SCENE_RESULT_A, HASH_A),
      media(SCENE_RESULT_B, HASH_B),
      media(SCENE_RESULT_C, HASH_C),
    ],
    approvedSceneResultIds,
  });
}

async function validateApproved(approvedSceneResultIds: readonly string[]) {
  return validateAssemblyInputs(
    { repository: threeSceneRepo(approvedSceneResultIds) },
    { executionPlanId: PLAN, ownership: OWNERSHIP }
  );
}

describe("EXEC-06 generated-media QC policy freeze", () => {
  it("A: Plan QC pass does not approve generated media", () => {
    expect(AI_STORY_V1_QC_POLICY).toBe("OPTION_B_PLAN_QC_PLUS_HUMAN_REVIEW");
    expect(PLAN_QC_SCOPE).toBe("planning_intent_structural_only");
    expect(planQcPassApprovesGeneratedMedia()).toBe(false);
    expect(
      qcAllowsExecution([
        {
          status: "passed",
          intentId: SCENE_EXEC_A,
          sceneId: "scene-a",
          validatedAt: "2026-08-19T00:00:00.000Z",
          contractVersion: "1",
          errors: [],
        },
      ])
    ).toBe(true);
    expect(generatedMediaReviewAllowsAssembly(null)).toBe(false);
    const eligibility = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: [],
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("UNREVIEWED_MEDIA");
  });

  it("B: successful provider output appears as pending human review", () => {
    const eligibility = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_A,
          decision: "PENDING_REVIEW",
        }),
      ],
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("UNREVIEWED_MEDIA");
    expect(generatedMediaReviewAllowsAssembly("PENDING_REVIEW")).toBe(false);
  });

  it("C: unreviewed Scene cannot assemble", async () => {
    const result = await validateApproved([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.classification === "SCENE_RESULT_MISSING")).toBe(
        true
      );
    }
  });

  it("D: approved Scene can assemble", async () => {
    const result = await validateApproved([SCENE_RESULT_A, SCENE_RESULT_B, SCENE_RESULT_C]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.orderedSceneResultIds).toEqual([
        SCENE_RESULT_A,
        SCENE_RESULT_B,
        SCENE_RESULT_C,
      ]);
    }
  });

  it("E: rejected Scene cannot assemble", () => {
    const eligibility = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_A,
          decision: "REJECTED_TERMINAL",
        }),
      ],
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("REJECTED_TERMINAL");
    expect(generatedMediaReviewAllowsAssembly("REJECTED_TERMINAL")).toBe(false);
  });

  it("F: retry-requested Scene cannot assemble", () => {
    const eligibility = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_A,
          decision: "RETRY_REQUESTED",
        }),
      ],
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("RETRY_REQUESTED");
  });

  it("G: exact approved attempt is assembly authority", () => {
    const approved = selectAssemblyAuthoritativeSceneResults({
      sceneResults: [
        THREE_SCENES[1]!,
        sceneResult({
          sceneResultId: SCENE_RESULT_B2,
          sceneExecutionId: SCENE_EXEC_B,
          sceneId: "scene-b",
          sceneOrder: 1,
          contentHash: HASH_B,
        }),
      ],
      approvedSceneResultIds: new Set([SCENE_RESULT_B2]),
    });
    expect(approved).toHaveLength(1);
    expect(approved[0]?.sceneResultId).toBe(SCENE_RESULT_B2);
  });

  it("H: old rejected/retried attempt cannot assemble", async () => {
    const result = await validateApproved([SCENE_RESULT_A, SCENE_RESULT_B2, SCENE_RESULT_C]);
    expect(result.ok).toBe(false);
    const eligibility = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_B],
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_B,
          sceneId: "scene-b",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_B,
          decision: "RETRY_REQUESTED",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000802",
          sceneExecutionId: SCENE_EXEC_B,
          sceneId: "scene-b",
          providerAttemptId: "attempt-2",
          sceneResultId: SCENE_RESULT_B2,
          decision: "APPROVED",
        }),
      ],
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.approvedBindings[0]?.sceneResultId).toBe(SCENE_RESULT_B2);
    expect(eligibility.approvedBindings[0]?.providerAttemptId).toBe("attempt-2");
  });

  it("I: 3-Scene partial approval blocks assembly", async () => {
    const result = await validateApproved([SCENE_RESULT_A, SCENE_RESULT_C]);
    expect(result.ok).toBe(false);
    const eligibility = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A, SCENE_EXEC_B, SCENE_EXEC_C],
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_A,
          decision: "APPROVED",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000802",
          sceneExecutionId: SCENE_EXEC_B,
          sceneId: "scene-b",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_B,
          decision: "PENDING_REVIEW",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000803",
          sceneExecutionId: SCENE_EXEC_C,
          sceneId: "scene-c",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_C,
          decision: "APPROVED",
        }),
      ],
    });
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe("PARTIAL_SCENE_APPROVAL");
  });

  it("J: all required Scenes approved enables assembly", async () => {
    const result = await validateApproved([SCENE_RESULT_A, SCENE_RESULT_B, SCENE_RESULT_C]);
    expect(result.ok).toBe(true);
    const eligibility = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A, SCENE_EXEC_B, SCENE_EXEC_C],
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_A,
          decision: "APPROVED",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000802",
          sceneExecutionId: SCENE_EXEC_B,
          sceneId: "scene-b",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_B,
          decision: "APPROVED",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000803",
          sceneExecutionId: SCENE_EXEC_C,
          sceneId: "scene-c",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_C,
          decision: "APPROVED",
        }),
      ],
    });
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reason).toBe("ALL_SCENES_APPROVED");
  });

  it("K: refresh preserves pending review", () => {
    const persisted = [
      reviewFact({
        sceneExecutionId: SCENE_EXEC_A,
        sceneId: "scene-a",
        providerAttemptId: "attempt-1",
        sceneResultId: SCENE_RESULT_A,
        decision: "PENDING_REVIEW",
      }),
    ];
    const first = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: persisted,
    });
    const refreshed = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: persisted,
    });
    expect(first.reason).toBe("UNREVIEWED_MEDIA");
    expect(refreshed).toEqual(first);
  });

  it("L: refresh preserves approval", () => {
    const persisted = [
      reviewFact({
        sceneExecutionId: SCENE_EXEC_A,
        sceneId: "scene-a",
        providerAttemptId: "attempt-1",
        sceneResultId: SCENE_RESULT_A,
        decision: "APPROVED",
      }),
    ];
    const first = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: persisted,
    });
    const refreshed = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_A],
      reviews: persisted,
    });
    expect(first.eligible).toBe(true);
    expect(refreshed).toEqual(first);
  });

  it("M: revisit preserves approval of the exact attempt", () => {
    const persisted = [
      reviewFact({
        sceneExecutionId: SCENE_EXEC_B,
        sceneId: "scene-b",
        providerAttemptId: "attempt-1",
        sceneResultId: SCENE_RESULT_B,
        decision: "RETRY_REQUESTED",
      }),
      reviewFact({
        generatedSceneReviewId: "10000000-0000-4000-8000-000000000802",
        sceneExecutionId: SCENE_EXEC_B,
        sceneId: "scene-b",
        providerAttemptId: "attempt-2",
        sceneResultId: SCENE_RESULT_B2,
        decision: "APPROVED",
      }),
    ];
    const revisited = deriveGeneratedMediaAssemblyEligibility({
      requiredSceneExecutionIds: [SCENE_EXEC_B],
      reviews: persisted,
    });
    expect(revisited.approvedBindings[0]).toEqual({
      sceneExecutionId: SCENE_EXEC_B,
      providerAttemptId: "attempt-2",
      sceneResultId: SCENE_RESULT_B2,
      generatedMediaReviewState: "APPROVED",
    });
  });

  it("N: Final Story Result preserves QC provenance", () => {
    const provenance = reconstructFinalStoryResultQcProvenance({
      orderedSceneResultIds: [SCENE_RESULT_A, SCENE_RESULT_B2, SCENE_RESULT_C],
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_A,
          decision: "APPROVED",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000802",
          sceneExecutionId: SCENE_EXEC_B,
          sceneId: "scene-b",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_B,
          decision: "RETRY_REQUESTED",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000812",
          sceneExecutionId: SCENE_EXEC_B,
          sceneId: "scene-b",
          providerAttemptId: "attempt-2",
          sceneResultId: SCENE_RESULT_B2,
          decision: "APPROVED",
        }),
        reviewFact({
          generatedSceneReviewId: "10000000-0000-4000-8000-000000000803",
          sceneExecutionId: SCENE_EXEC_C,
          sceneId: "scene-c",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_C,
          decision: "APPROVED",
        }),
      ],
    });
    expect(provenance.policy).toBe("OPTION_B_PLAN_QC_PLUS_HUMAN_REVIEW");
    expect(provenance.planQcScope).toBe("planning_intent_structural_only");
    expect(provenance.generatedMediaAcceptanceAuthority).toBe(
      "EXEC04_PERSISTED_SCENE_REVIEW"
    );
    expect(provenance.mediaAwareAiQcClaimed).toBe(false);
    expect(provenance.assemblyComplete).toBe(true);
    expect(provenance.allAssembledScenesHumanApproved).toBe(true);
    expect(provenance.assembledScenes.map((row) => row.sceneResultId)).toEqual([
      SCENE_RESULT_A,
      SCENE_RESULT_B2,
      SCENE_RESULT_C,
    ]);
    expect(provenance.assembledScenes[1]?.providerAttemptId).toBe("attempt-2");
  });

  it("O: QC does not trigger provider retry", () => {
    expect(AI_STORY_V1_QC_MAY_ENQUEUE_PROVIDER_RETRY).toBe(false);
    const qc = readFileSync(join(ROOT, "packages/agents/src/ai-story/ai-qc-validator.ts"), "utf8");
    expect(qc).not.toMatch(/scheduleAuthorizedScene/);
    expect(qc).not.toMatch(/Seedance|MiniMax|PhotoRoom/i);
    expect(qc).not.toMatch(/from ["']@ceo-agent\/queue/);
  });

  it("P: retry cap remains EXEC-04 authority", () => {
    expect(resolveAiStorySceneMaxAttempts({})).toBe(3);
    expect(resolveAiStorySceneMaxAttempts({ AI_STORY_SCENE_MAX_ATTEMPTS: "5" })).toBe(5);
  });

  it("preserves human acceptance authority while Post-QC evidence remains provider-neutral", () => {
    expect(GENERATED_MEDIA_ACCEPTANCE_AUTHORITY).toBe("EXEC04_PERSISTED_SCENE_REVIEW");
    expect(FUTURE_MEDIA_AWARE_QC_PIPELINE).toEqual([
      "generated_artifact",
      "optional_automated_media_qc_evidence",
      "human_review_policy",
      "approved_output",
    ]);
    expect(existsSync(join(ROOT, "packages/agents/src/ai-story/generated-media-vision-qc.ts"))).toBe(
      false
    );
    const policy = readFileSync(
      join(ROOT, "packages/shared/src/ai-story-generated-media-qc-policy.ts"),
      "utf8"
    );
    expect(policy).toMatch(/Post-Generation QC now contributes/);
    expect(policy).toMatch(/POST_GENERATION_QC_REPLACES_HUMAN_REVIEW = false/);
    expect(policy).not.toMatch(/openai\.|gemini\.|claude vision|video embedding|Seedance QC|MiniMax QC/i);
  });
});

describe("EXEC-06 human review authorization", () => {
  function member(role = "operator") {
    return { orgId: ORG, workspaceId: WORKSPACE, role };
  }
  function deps(input?: {
    platformAdminStatus?: "ACTIVE_GRANT" | "DENIED";
    plan?: string;
    membership?: ReturnType<typeof member> | "missing";
  }) {
    const membership = input?.membership ?? member();
    return {
      requireWorkspaceRole:
        membership === "missing"
          ? vi.fn().mockRejectedValue(new WorkspaceAccessError("Not a member", "FORBIDDEN"))
          : vi.fn().mockResolvedValue(membership),
      resolvePlatformAdmin: vi.fn().mockResolvedValue(
        input?.platformAdminStatus === "ACTIVE_GRANT"
          ? { status: "ACTIVE_GRANT", assignment: { platformAdminAssignmentId: "active" } }
          : { status: "DENIED", reason: "NO_ACTIVE_GRANT" }
      ),
      getOrganizationPlan: vi.fn().mockResolvedValue(input?.plan ?? "free"),
      entitlementRepository: {
        rebuildEffectiveProjection: vi.fn().mockResolvedValue({
          contractVersion: "1",
          orgId: ORG,
          workspaceId: WORKSPACE,
          entries: [],
          projectedAt: "2026-08-31T00:00:00.000Z",
          integrityHash: HASH_A,
        }),
      },
      now: () => "2026-08-31T00:00:00.000Z",
    };
  }
  const request = {
    user: { id: USER, email: "ops@example.com" },
    orgId: ORG,
    workspaceId: WORKSPACE,
    minRole: "operator" as const,
  };

  it("Q: Super Admin review allowed", async () => {
    await expect(
      authorizeAiStoryExecution(request, deps({ platformAdminStatus: "ACTIVE_GRANT" }))
    ).resolves.toMatchObject({ allowed: true, authorizedBy: "ACTIVE_PLATFORM_ADMIN" });
  });

  it("R: Agency review allowed", async () => {
    await expect(
      authorizeAiStoryExecution(request, deps({ plan: "agency" }))
    ).resolves.toMatchObject({ allowed: true, authorizedBy: "AGENCY_PLAN_CAPABILITY" });
  });

  it("S/T/U: Free, Pro, and Pro Plus are denied", async () => {
    for (const plan of ["free", "pro", "pro_plus"]) {
      await expect(authorizeAiStoryExecution(request, deps({ plan }))).rejects.toMatchObject({
        code: "AI_STORY_EXECUTION_DENIED",
      });
    }
  });

  it("V: cross-workspace review denied", async () => {
    await expect(
      authorizeAiStoryExecution(request, deps({ membership: "missing" }))
    ).rejects.toMatchObject({ code: "AI_STORY_EXECUTION_DENIED" });
  });

  it("W: forged client approval denied", () => {
    expect(rejectForgedGeneratedSceneReviewBody({ decision: "APPROVED", role: "admin" })).toBe(
      "role"
    );
    expect(rejectForgedGeneratedSceneReviewBody({ reviewedBy: USER })).toBe("reviewedBy");
    expect(rejectForgedGeneratedSceneReviewBody({ attemptId: "attempt-1" })).toBeNull();
  });

  it("QC service retry is human-triggered, not QC-triggered", async () => {
    const schedule = vi.fn();
    const snapshot = {
      sceneExecutionId: SCENE_EXEC_A,
      sceneId: "scene-a",
      executionPlanId: PLAN,
      orgId: ORG,
      workspaceId: WORKSPACE,
      campaignId: OWNERSHIP.campaignId,
      storyId: OWNERSHIP.storyId,
      reviews: [
        reviewFact({
          sceneExecutionId: SCENE_EXEC_A,
          sceneId: "scene-a",
          providerAttemptId: "attempt-1",
          sceneResultId: SCENE_RESULT_A,
          decision: "PENDING_REVIEW",
        }),
      ],
      results: [{ providerAttemptId: "attempt-1", status: "SUCCEEDED", sceneResultId: SCENE_RESULT_A }],
      correlations: [{ providerExecutionId: "exec-1" }],
      providerExecutions: new Map([["exec-1", { status: "SUCCEEDED" }]]),
      attemptCount: 3,
      maxAttempts: 3,
    };
    const service = new GeneratedSceneReviewService({
      reviewRepository: {
        transactDecision: async (
          _input: unknown,
          work: (tx: unknown, locked: unknown) => Promise<unknown>
        ) => work({}, snapshot),
        writeDecisionInTransaction: vi.fn(),
      } as never,
      schedulingCoordinator: { scheduleAuthorizedScene: schedule } as never,
    });
    await expect(
      service.retry({
        executionPlanId: PLAN,
        sceneExecutionId: SCENE_EXEC_A,
        actorUserId: USER,
        workspaceId: WORKSPACE,
        executionAuthorization: {
          allowed: true,
          accessMode: "ops",
          settlementMode: "none",
          authorizedBy: "ACTIVE_PLATFORM_ADMIN",
          policyVersion: "ai-story-exec-03.v1",
          reason: "ops",
          providerCostAccounting: "ALLOWED",
        } as never,
      })
    ).rejects.toMatchObject({ code: "GENERATED_SCENE_RETRY_NOT_ELIGIBLE" });
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe("EXEC-06 false media QC claims", () => {
  it("does not claim AI QC validated generated video", () => {
    const files = [
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
      "apps/web/src/components/ai-story-review/ExecutionPlanReviewPanel.tsx",
      "apps/web/src/components/ai-story/FinalStoryResultViewer.tsx",
      "apps/web/src/components/ai-story/StoryRuntimePanel.tsx",
      "packages/shared/src/i18n/locales/en.json",
      "packages/shared/src/ai-story-generated-media-qc-policy.ts",
    ];
    for (const relative of files) {
      const source = readFileSync(join(ROOT, relative), "utf8");
      expect(source).not.toMatch(/visual QC passed/i);
      expect(source).not.toMatch(/media verified/i);
      expect(source).not.toMatch(/AI QC passed the generated/i);
    }
    const page = readFileSync(
      join(ROOT, "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx"),
      "utf8"
    );
    expect(page).toMatch(/Plan QC/);
    expect(page).not.toMatch(/runs AI QC/);
  });
});
