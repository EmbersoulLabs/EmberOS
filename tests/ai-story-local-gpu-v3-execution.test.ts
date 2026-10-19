import { describe, expect, it } from "vitest";
import { InMemoryLocalGpuReleaseLedger, claimPreparedLocalGpuRelease } from "@ceo-agent/db";
import { localGpuDispatchExecutionIdentity } from "@ceo-agent/db";
import {
  planLocalGpuRoute,
  planLocalGpuHttp,
  runEnabledLocalGpuDispatch,
  runInstalledLocalGpuReleaseCycle,
  runLocalGpuReleaseCycle,
} from "../packages/agents/src/ai-story/local-gpu-execution";
import { localGpuOutputAssetId } from "../packages/agents/src/ai-story/local-gpu-dispatch-authorization";
import { localGpuAssemblyHandoff, resolveLocalGpuReviewState } from "../packages/agents/src/ai-story/local-gpu-review-handoff";
import { planLocalGpuCompletion } from "../packages/agents/src/ai-story/local-gpu-result-finalization";
import {
  LOCAL_GPU_T2V_WORKFLOW,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuGenerationInputAuthoritySchema,
  localGpuPersistedAudioSeparation,
} from "@ceo-agent/shared/server";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const scope = {
  workspaceId: id(3),
  storyId: id(5),
  sceneExecutionId: id(40),
};
const stagingEnv = {
  LOCAL_GPU_PROVIDER_ENABLED: "true",
  LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
  LOCAL_GPU_ENVIRONMENT: "staging",
  LOCAL_GPU_SCOPE_WORKSPACE_ID: scope.workspaceId,
  LOCAL_GPU_SCOPE_STORY_ID: scope.storyId,
  LOCAL_GPU_SCOPE_SCENE_EXECUTION_ID: scope.sceneExecutionId,
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
const nativeDialogueCapabilities = (e2eCertified: boolean) => ({
  contractVersion: 2,
  acceptedContractVersions: [1, 2, 3],
  contracts: { v3: { workflows: { MINIMAX_H3_NATIVE_DIALOGUE: {
    execution: "enabled",
    implemented: true,
    modelInstalled: true,
    buildExecutable: true,
    nativeDialogue: "PROMPT_CONDITIONED",
    e2eCertified,
  } } } },
});

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
    expect(planLocalGpuRoute(zeroAsset({ dialogueRequired: true })).blocked).toBe("LOCAL_GPU_REFERENCES_REQUIRED");
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

  it("keeps native dialogue closed until Desktop certification and then preserves native audio review", () => {
    const native = {
      ...zeroAsset(),
      assetMode: "WITH_ASSET" as const,
      assetRecommendationStatus: "SATISFIED" as const,
      referenceCount: 2,
      imageReferenceCount: 2,
      dialogueRequired: true,
      recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      qcExpectation: "NATIVE_CHARACTER_DIALOGUE" as const,
      capabilities: nativeDialogueCapabilities(false),
    };
    expect(planLocalGpuRoute(native).blocked).toBe("LOCAL_GPU_NATIVE_DIALOGUE_NOT_CERTIFIED");
    expect(planLocalGpuRoute({ ...native, capabilities: nativeDialogueCapabilities(true) })).toMatchObject({
      eligible: true,
      contractVersion: 3,
      workflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      desktopAudioPolicy: "NATIVE",
      qcExpectation: "NATIVE_CHARACTER_DIALOGUE",
      speechContent: "HUMAN_REVIEW_REQUIRED",
      hasAudio: true,
    });
    expect(planLocalGpuRoute({ ...native, generateAudio: false, audioBlocked: true }).blocked).toBe("LOCAL_GPU_AUDIO_POLICY_INVALID");
    expect(planLocalGpuRoute({ ...native, referenceCount: 4 }).blocked).toBe("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  });

  it("submits one certified native-dialogue V3 request without falling through to T2V", async () => {
    let nativePosts = 0;
    let t2vPosts = 0;
    const nativeRoute = {
      ...zeroAsset(),
      assetMode: "WITH_ASSET" as const,
      assetRecommendationStatus: "SATISFIED" as const,
      referenceCount: 1,
      imageReferenceCount: 1,
      dialogueRequired: true,
      recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      qcExpectation: "NATIVE_CHARACTER_DIALOGUE" as const,
      capabilities: nativeDialogueCapabilities(true),
    };
    const adapter = {
      jobIdFor: () => id(90),
      submitZeroAssetT2V: async () => { t2vPosts += 1; return { jobId: id(90) }; },
      submitNativeDialogueV3: async (input: { creativeBinding: string }) => {
        nativePosts += 1;
        expect(input.creativeBinding).toBe("binding");
        return { jobId: id(90) };
      },
      status: async () => ({ found: false }),
      result: async () => ({ contentHash: `sha256:${"b".repeat(64)}` }),
    };
    const step = await runEnabledLocalGpuDispatch({
      scope,
      candidate: { ...scope, packageId: id(30), runtimeAuthorizationId: id(70), existingGate: null, route: nativeRoute },
      claim: () => true,
      adapter,
      actor: { userId: id(1), workspaceId: scope.workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" },
      request: { body: {} as never, creativeBinding: "binding" },
      capabilities: nativeDialogueCapabilities(true),
      existingResultId: null,
    });
    expect(step).toMatchObject({ code: "accepted", posts: 1, gets: 0 });
    expect(nativePosts).toBe(1);
    expect(t2vPosts).toBe(0);
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

  it("posts once for the scoped staging scene and reconciles ambiguity without a second POST", async () => {
    let posts = 0;
    const postedJobs: string[] = [];
    const claimed: string[] = [];
    const port = {
      jobIdFor: () => id(90),
      claim: (sceneExecutionId: string, jobId: string) => {
        claimed.push(`${sceneExecutionId}:${jobId}`);
        return true;
      },
      post: async (jobId: string) => {
        posts += 1;
        postedJobs.push(jobId);
        return "ambiguous" as const;
      },
      status: async () => "found" as const,
    };
    const candidate = {
      ...scope,
      packageId: id(30),
      runtimeAuthorizationId: id(70),
      existingGate: null as string | null,
      route: zeroAsset(),
    };
    const first = await runLocalGpuReleaseCycle(stagingEnv, { candidate, port });
    expect(first).toMatchObject({ posts: 1, gets: 0, submit: false, code: "poll" });
    expect(postedJobs).toEqual([id(90)]);
    expect(claimed).toEqual([`${scope.sceneExecutionId}:${id(90)}`]);
    const second = await runLocalGpuReleaseCycle(stagingEnv, {
      candidate: { ...candidate, existingGate: id(90) },
      port,
    });
    expect(second).toMatchObject({ posts: 0, gets: 1, submit: false });
    expect(posts).toBe(1);
    expect(claimed).toHaveLength(1);
    expect(planLocalGpuHttp({ dispatchAuthorized: true, existingGate: id(90), eligible: true }).http).toBe("status_only");
  });

  it("signs status and result reads with the job's own workflow so a T2V job can deliver its result", async () => {
    const observed: { call: string; workflow: string }[] = [];
    const adapter = {
      jobIdFor: () => id(90),
      submitZeroAssetT2V: async () => { throw new Error("no submit expected"); },
      status: async (_jobId: string, read: { workflow: string }) => {
        observed.push({ call: "status", workflow: read.workflow });
        return { found: true, state: "COMPLETED" };
      },
      result: async (_jobId: string, read: { workflow: string }) => {
        observed.push({ call: "result", workflow: read.workflow });
        return { contentHash: `sha256:${"b".repeat(64)}` };
      },
    };
    const step = await runEnabledLocalGpuDispatch({
      scope: { ...scope },
      candidate: { ...scope, packageId: id(30), runtimeAuthorizationId: id(70), existingGate: id(90), route: zeroAsset() },
      claim: () => { throw new Error("no claim expected"); },
      adapter,
      actor: { userId: id(1), workspaceId: scope.workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" },
      request: {} as never,
      capabilities,
      existingResultId: null,
    });
    expect(step).toMatchObject({ code: "materialize_once", posts: 0, gets: 2 });
    expect(observed).toEqual([
      { call: "status", workflow: LOCAL_GPU_T2V_WORKFLOW },
      { call: "result", workflow: LOCAL_GPU_T2V_WORKFLOW },
    ]);
  });

  it("derives the reserved output asset from package and runtime authority only, whatever row the caller holds", () => {
    const identity = { packageId: id(30), runtimeAuthorizationId: id(70) };
    const reserved = localGpuOutputAssetId(identity);
    expect(localGpuOutputAssetId({ ...identity, dispatchAuthorityId: id(80), orgId: id(2), expiresAt: new Date() } as typeof identity)).toBe(reserved);
    expect(localGpuOutputAssetId({ ...identity, runtimeAuthorizationId: id(71) })).not.toBe(reserved);
  });

  it("stays disabled unless staging, both flags, and the exact scene scope are all present", async () => {
    let posts = 0;
    const port = {
      jobIdFor: () => id(90),
      claim: () => true,
      post: async () => {
        posts += 1;
        return "accepted" as const;
      },
      status: async () => "found" as const,
    };
    const candidate = {
      ...scope,
      packageId: id(30),
      runtimeAuthorizationId: id(70),
      existingGate: null,
      route: zeroAsset(),
    };
    expect(await runLocalGpuReleaseCycle({}, { candidate, port })).toMatchObject({ code: "DISABLED", posts: 0 });
    expect(await runLocalGpuReleaseCycle({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
      LOCAL_GPU_ENVIRONMENT: "production",
      ...{
        LOCAL_GPU_SCOPE_WORKSPACE_ID: scope.workspaceId,
        LOCAL_GPU_SCOPE_STORY_ID: scope.storyId,
        LOCAL_GPU_SCOPE_SCENE_EXECUTION_ID: scope.sceneExecutionId,
      },
    }, { candidate, port })).toMatchObject({ code: "LOCAL_GPU_PRODUCTION_DENIED", posts: 0 });
    expect(await runLocalGpuReleaseCycle({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_SINGLE_RUN_AUTHORIZED: "true",
      LOCAL_GPU_ENVIRONMENT: "staging",
    }, { candidate, port })).toMatchObject({ code: "LOCAL_GPU_SCENE_SCOPE_REQUIRED", posts: 0 });
    expect(await runLocalGpuReleaseCycle(stagingEnv)).toMatchObject({ code: "AUTHORIZED_UNBOUND", posts: 0 });
    expect(await runLocalGpuReleaseCycle(stagingEnv, {
      candidate: { ...candidate, sceneExecutionId: id(41), route: zeroAsset() },
      port,
    })).toMatchObject({ code: "LOCAL_GPU_SCENE_SCOPE_MISMATCH", posts: 0 });
    expect(posts).toBe(0);
  });

  it("opens production only behind the explicit production flag and exact scope", async () => {
    const production = { ...stagingEnv, LOCAL_GPU_ENVIRONMENT: "production", LOCAL_GPU_PRODUCTION_DISPATCH_ENABLED: "true" };
    expect(await runLocalGpuReleaseCycle(production)).toMatchObject({ code: "AUTHORIZED_UNBOUND", posts: 0 });
    expect(await runLocalGpuReleaseCycle({ ...production, LOCAL_GPU_SCOPE_STORY_ID: id(41) })).toMatchObject({ code: "AUTHORIZED_UNBOUND", posts: 0 });
  });

  it("binds immutable dispatch identity to workspace, story, scene, package, and runtime authorization", () => {
    const identity = localGpuDispatchExecutionIdentity({ ...scope, packageId: id(30), runtimeAuthorizationId: id(70) });
    expect(identity).toHaveLength(64);
    expect(localGpuDispatchExecutionIdentity({ ...scope, packageId: id(31), runtimeAuthorizationId: id(70) })).not.toBe(identity);
    expect(localGpuDispatchExecutionIdentity({ ...scope, packageId: id(30), runtimeAuthorizationId: id(71) })).not.toBe(identity);
  });

  it("claims only the scoped scene when an earlier release is also waiting", async () => {
    const rows = [
      {
        sceneExecutionId: id(39),
        releasedAt: new Date("2026-10-10T00:00:00.000Z"),
        gateProviderAttemptId: null as string | null,
        executionMode: "LOCAL_GPU",
        releaseState: "RELEASED",
      },
      {
        sceneExecutionId: id(40),
        releasedAt: new Date("2026-10-11T00:00:00.000Z"),
        gateProviderAttemptId: null as string | null,
        executionMode: "LOCAL_GPU",
        releaseState: "RELEASED",
      },
    ];
    const ledger = new InMemoryLocalGpuReleaseLedger(rows);
    const result = await runLocalGpuReleaseCycle(stagingEnv, {
      candidate: {
        ...scope,
        packageId: id(30),
        runtimeAuthorizationId: id(70),
        existingGate: null,
        route: zeroAsset(),
      },
      port: {
        jobIdFor: () => id(90),
        claim: (sceneExecutionId, jobId) => ledger.claim(sceneExecutionId, jobId),
        post: async () => "accepted" as const,
        status: async () => "found" as const,
      },
    });
    expect(result).toMatchObject({ posts: 1, submit: false });
    expect(rows[0]?.gateProviderAttemptId).toBeNull();
    expect(rows[1]?.gateProviderAttemptId).toBe(id(90));
    const lost = await runLocalGpuReleaseCycle(stagingEnv, {
      candidate: {
        ...scope,
        packageId: id(30),
        runtimeAuthorizationId: id(70),
        existingGate: null,
        route: zeroAsset(),
      },
      port: {
        jobIdFor: () => id(90),
        claim: (sceneExecutionId, jobId) => ledger.claim(sceneExecutionId, jobId),
        post: async () => "accepted" as const,
        status: async () => "found" as const,
      },
    });
    expect(lost).toMatchObject({ code: "LOCAL_GPU_CLAIM_LOST", posts: 0, submit: false });
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

  it("loads only the scoped scene and does not construct a dispatch port until submit authority exists", async () => {
    let loads = 0;
    let ports = 0;
    const load = async () => {
      loads += 1;
      return {
        submitReady: false,
        candidate: {
          ...scope,
          packageId: id(30),
          runtimeAuthorizationId: id(70),
          existingGate: null,
          route: zeroAsset(),
        },
      };
    };
    expect(await runInstalledLocalGpuReleaseCycle({}, { load, createPort: () => { ports += 1; throw new Error("port"); } }))
      .toMatchObject({ code: "DISABLED", posts: 0 });
    expect(loads).toBe(0);
    expect(await runInstalledLocalGpuReleaseCycle(stagingEnv, {
      load,
      createPort: () => { ports += 1; throw new Error("port"); },
    })).toMatchObject({ code: "LOCAL_GPU_SUBMIT_AUTHORITY_REQUIRED", posts: 0, submit: false });
    expect(loads).toBe(1);
    expect(ports).toBe(0);
    const posted: string[] = [];
    const ready = await runInstalledLocalGpuReleaseCycle(stagingEnv, {
      load: async (requested) => {
        expect(requested).toEqual(scope);
        return {
          submitReady: true,
          candidate: {
            ...scope,
            packageId: id(30),
            runtimeAuthorizationId: id(70),
            existingGate: null,
            route: zeroAsset(),
          },
        };
      },
      createPort: () => ({
        jobIdFor: () => id(90),
        claim: () => true,
        post: async (jobId: string) => {
          posted.push(jobId);
          return "accepted" as const;
        },
        status: async () => "found" as const,
      }),
    });
    expect(ready).toMatchObject({ posts: 1, submit: false });
    expect(posted).toEqual([id(90)]);
  });
});
