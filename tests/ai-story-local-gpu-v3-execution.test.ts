import { describe, expect, it } from "vitest";
import { InMemoryLocalGpuReleaseLedger, claimPreparedLocalGpuRelease } from "@ceo-agent/db";
import {
  planLocalGpuRoute,
  planLocalGpuHttp,
  runLocalGpuReleaseCycle,
} from "../packages/agents/src/ai-story/local-gpu-execution";
import { localGpuAssemblyHandoff, resolveLocalGpuReviewState } from "../packages/agents/src/ai-story/local-gpu-review-handoff";
import { planLocalGpuCompletion } from "../packages/agents/src/ai-story/local-gpu-result-finalization";
import {
  LOCAL_GPU_T2V_WORKFLOW,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuGenerationInputAuthoritySchema,
  localGpuPersistedAudioSeparation,
} from "@ceo-agent/shared/server";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const stagingEnv = {
  LOCAL_GPU_PROVIDER_ENABLED: "true",
  LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
  LOCAL_GPU_ENVIRONMENT: "staging",
};
const capabilities = {
  contracts: {
    v3: {
      workflows: {
        MINIMAX_H3_T2V: {
          execution: "enabled",
          textToVideo: true,
          placeholderImage: false,
          missingModels: [],
          e2eCertified: false,
        },
      },
    },
  },
};

function zeroAsset(overrides: Record<string, unknown> = {}) {
  return {
    assetMode: "WITHOUT_ASSET" as const,
    assetRecommendationStatus: "CONFIRMED_NO_ASSETS" as const,
    referenceCount: 0,
    preQc: "DISPATCH_ELIGIBLE" as const,
    runtimeAuthorizationId: id(70),
    capabilities,
    generateAudio: true,
    audioBlocked: false,
    qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO" as const,
    ...overrides,
  };
}

describe("LOCAL_GPU V3 execution integration", () => {
  it("routes a confirmed zero-asset scene to T2V and keeps native audio separate from the QC expectation", () => {
    const route = planLocalGpuRoute(zeroAsset());
    expect(route).toMatchObject({
      eligible: true,
      contractVersion: 3,
      assetMode: "WITHOUT_ASSET",
      workflow: LOCAL_GPU_T2V_WORKFLOW,
      desktopAudioPolicy: "NATIVE",
      qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      speechContent: "HUMAN_REVIEW_REQUIRED",
      hasAudio: true,
    });
    expect(route.speechContent).not.toBe("PASS");
    const separated = localGpuPersistedAudioSeparation({
      qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      generateAudio: true,
      audioBlocked: false,
    });
    expect(separated.desktopAudioPolicy).toBe("NATIVE");
    expect(LocalGpuGenerationInputAuthoritySchema.safeParse({
      localGpuEnvironment: "staging",
      localGpuJobId: id(90),
      localGpuWorkflow: LOCAL_GPU_T2V_WORKFLOW,
      workspaceId: id(3),
      storyId: id(5),
      storyVersionId: id(6),
      sceneExecutionId: id(40),
      audioPolicy: separated.desktopAudioPolicy,
      plannedDurationMs: 6000,
      actualDurationMs: 6000,
      fps: 24,
      hasAudio: true,
      localPackageId: id(30),
      localPackageFingerprint: `sha256:${"a".repeat(64)}`,
      characterAuthority: null,
      productAuthority: null,
      references: [],
      generationMode: "TEXT_TO_VIDEO",
      generateAudio: true,
      audioBlocked: false,
      sourceAuthority: {},
      planningAuthority: {},
    }).success).toBe(true);
    expect(LocalGpuGenerationInputAuthoritySchema.safeParse({
      localGpuEnvironment: "staging",
      localGpuJobId: id(90),
      localGpuWorkflow: LOCAL_GPU_T2V_WORKFLOW,
      workspaceId: id(3),
      storyId: id(5),
      storyVersionId: id(6),
      sceneExecutionId: id(40),
      audioPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      plannedDurationMs: 6000,
      actualDurationMs: 6000,
      fps: 24,
      hasAudio: true,
      localPackageId: id(30),
      localPackageFingerprint: `sha256:${"a".repeat(64)}`,
      characterAuthority: null,
      productAuthority: null,
      references: [],
      generationMode: "TEXT_TO_VIDEO",
      generateAudio: true,
      audioBlocked: false,
      sourceAuthority: {},
      planningAuthority: {},
    }).success).toBe(false);
  });

  it("fails closed before a GPU call when authority, references, dialogue, or capabilities do not match", () => {
    expect(planLocalGpuRoute(zeroAsset({ assetRecommendationStatus: "ASSET_RECOMMENDATION_REQUIRED" })).blocked).toBe("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
    expect(planLocalGpuRoute(zeroAsset({ referenceCount: 1, imageReferenceCount: 1 })).blocked).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
    expect(planLocalGpuRoute(zeroAsset({ dialogueRequired: true })).blocked).toBe("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
    expect(planLocalGpuRoute(zeroAsset({ voiceDnaRequired: true })).blocked).toBe("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
    expect(planLocalGpuRoute(zeroAsset({ capabilities: { contractVersion: 3 } })).blocked).toBe("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
    expect(planLocalGpuRoute(zeroAsset({ preQc: "DISPATCH_BLOCKED" })).blocked).toBe("LOCAL_GPU_PRE_QC_REQUIRED");
    expect(planLocalGpuRoute(zeroAsset({ runtimeAuthorizationId: null })).blocked).toBe("LOCAL_GPU_RUNTIME_AUTHORIZATION_REQUIRED");
    expect(planLocalGpuRoute(zeroAsset({
      assetMode: "WITH_ASSET",
      assetRecommendationStatus: "SATISFIED",
      referenceCount: 1,
      recommendedWorkflow: "MINIMAX_H3_T2V",
    })).blocked).toBe("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(planLocalGpuRoute(zeroAsset({
      assetMode: "WITH_ASSET",
      assetRecommendationStatus: "CONFIRMED_NO_ASSETS",
      referenceCount: 1,
      recommendedWorkflow: LOCAL_GPU_WORKER_WORKFLOW,
    })).blocked).toBe("LOCAL_GPU_ASSET_MODE_CONFLICT");
    expect(planLocalGpuRoute(zeroAsset({
      assetMode: "WITH_ASSET",
      assetRecommendationStatus: "SATISFIED",
      referenceCount: 1,
      recommendedWorkflow: "MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1",
    })).blocked).toBe("LOCAL_GPU_DISPATCH_DISABLED");
  });

  it("keeps an authorized reference scene on the supported R2V workflow", () => {
    const route = planLocalGpuRoute(zeroAsset({
      assetMode: "WITH_ASSET",
      assetRecommendationStatus: "SATISFIED",
      referenceCount: 1,
      recommendedWorkflow: LOCAL_GPU_WORKER_WORKFLOW,
      qcExpectation: "SILENT_OUTPUT",
      generateAudio: false,
      audioBlocked: true,
    }));
    expect(route).toMatchObject({
      eligible: true,
      contractVersion: 2,
      assetMode: "WITH_ASSET",
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      desktopAudioPolicy: "REMOVE_AUDIO",
      qcExpectation: "SILENT_OUTPUT",
      speechContent: "NOT_APPLICABLE",
      hasAudio: false,
    });
  });

  it("posts once for an authorized staging release and reconciles ambiguity without a second POST", async () => {
    let posts = 0;
    const post = async () => {
      posts += 1;
      return "ambiguous" as const;
    };
    const status = async () => "found" as const;
    const first = await runLocalGpuReleaseCycle(stagingEnv, {
      jobId: id(90),
      existingGate: null,
      route: zeroAsset(),
      post,
      status,
    });
    expect(first).toMatchObject({ posts: 1, gets: 0, submit: false, code: "poll" });
    const second = await runLocalGpuReleaseCycle(stagingEnv, {
      jobId: id(90),
      existingGate: id(90),
      route: zeroAsset(),
      post,
      status,
    });
    expect(second).toMatchObject({ posts: 0, gets: 1, submit: false });
    expect(posts).toBe(1);
    expect(planLocalGpuHttp({ dispatchAuthorized: true, existingGate: id(90), eligible: true }).http).toBe("status_only");
  });

  it("does not post when dispatch is disabled or the environment is production", async () => {
    let posts = 0;
    const attempt = {
      jobId: id(90),
      existingGate: null,
      route: zeroAsset(),
      post: async () => {
        posts += 1;
        return "accepted" as const;
      },
      status: async () => "found" as const,
    };
    expect(await runLocalGpuReleaseCycle({}, attempt)).toMatchObject({ code: "DISABLED", posts: 0 });
    expect(await runLocalGpuReleaseCycle({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
      LOCAL_GPU_ENVIRONMENT: "production",
    }, attempt)).toMatchObject({ code: "LOCAL_GPU_PRODUCTION_DENIED", posts: 0 });
    expect(posts).toBe(0);
  });

  it("lets only one worker claim a release, then reviews and assembles without another dispatch", () => {
    const row = {
      sceneExecutionId: id(40),
      releasedAt: new Date("2026-10-11T00:00:00.000Z"),
      gateProviderAttemptId: null,
      executionMode: "LOCAL_GPU",
      releaseState: "RELEASED",
    };
    const shared = [{ ...row }];
    const workerA = new InMemoryLocalGpuReleaseLedger(shared);
    const workerB = new InMemoryLocalGpuReleaseLedger(shared);
    expect(claimPreparedLocalGpuRelease(workerA, workerA.selectNext(), id(90))?.sceneExecutionId).toBe(id(40));
    expect(claimPreparedLocalGpuRelease(workerB, workerB.selectNext(), id(91))).toBeNull();
    const audio = { hasAudio: true as const, speechContent: "HUMAN_REVIEW_REQUIRED" as const };
    expect(resolveLocalGpuReviewState({ decision: null, aggregateStatus: "POST_QC_REQUIRES_HUMAN_CONFIRMATION", audio })).toMatchObject({
      runtime: "PENDING_REVIEW",
      dispatch: false,
      regenerate: false,
      remoteProviderFallback: 0,
    });
    expect(localGpuAssemblyHandoff({ decision: "APPROVED", aggregateStatus: "POST_QC_PASS", audio })).toMatchObject({
      assemblyEligible: true,
      dispatch: false,
      remoteProviderFallback: 0,
    });
    expect(planLocalGpuCompletion({
      jobId: id(90),
      existingResultId: id(40),
      contentHash: `sha256:${"b".repeat(64)}`,
    })).toMatchObject({ action: "reuse", submit: false });
  });
});
