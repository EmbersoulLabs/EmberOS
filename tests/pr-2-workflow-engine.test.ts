import { describe, expect, it, vi } from "vitest";
import {
  assertMarketingDependenciesReady,
  dependenciesForRoute,
  evaluateDependencies,
} from "../packages/agents/src/dependency-engine";
import {
  buildPipelineExecutionPlan,
  getPipelineRoute,
} from "../packages/agents/src/pipeline-router";
import {
  executeCampaignPipelinePlan,
  executePipelinePlan,
} from "../packages/agents/src/pipeline-executor";
import { mergePipelineContext } from "../packages/agents/src/merge-context";
import { runMarketingPipeline } from "../packages/agents/src/marketing-pipeline";
import {
  adaptImageUnderstandingResult,
  adaptVideoPipelineResult,
  preRenderVideoWarning,
  productImageNotRequiredResult,
} from "../packages/agents/src/pipeline-adapters";
import {
  assertMandatoryGatesComplete,
  evaluateMandatoryGates,
} from "../packages/agents/src/mandatory-gates";
import type {
  PipelineDependency,
  PipelineExecutionRequest,
  PipelineExecutionResult,
  RoutableAsset,
} from "../packages/agents/src/workflow-contracts";
import {
  assertPipelineStateTransition,
  buildCampaignAIContext,
} from "../packages/shared/src/index";
import { readCompletedPipelineResults } from "../packages/agents/src/pipeline-checkpoints";
import { finalizeReviewAfterGates } from "../packages/agents/src/review-finalization";
import { delayPipelineJobForDependencies } from "../apps/worker/src/processors/dependency-delay";

const baseDependencies: PipelineDependency[] = [
  { id: "campaign", kind: "campaign", required: true, state: "READY" },
  { id: "business_profile", kind: "business_profile", required: true, state: "READY" },
  {
    id: "asset-upload:image-1",
    kind: "asset_upload",
    required: true,
    state: "READY",
    assetId: "image-1",
  },
  {
    id: "asset-registration:image-1",
    kind: "asset_registration",
    required: true,
    state: "READY",
    assetId: "image-1",
  },
  {
    id: "asset-upload:video-1",
    kind: "asset_upload",
    required: true,
    state: "READY",
    assetId: "video-1",
  },
  {
    id: "asset-registration:video-1",
    kind: "asset_registration",
    required: true,
    state: "READY",
    assetId: "video-1",
  },
];

const image: RoutableAsset = {
  id: "image-1",
  type: "image",
  mimeType: "image/jpeg",
  storagePath: "image.jpg",
  status: "ready",
};

const video: RoutableAsset = {
  id: "video-1",
  type: "video",
  mimeType: "video/mp4",
  storagePath: "video.mp4",
  durationSec: 20,
  status: "ready",
};

function request(
  selectedAssets: RoutableAsset[],
  patch: Partial<PipelineExecutionRequest> = {}
): PipelineExecutionRequest {
  return {
    campaignId: "campaign-1",
    workspaceId: "workspace-1",
    campaignObjective: "awareness",
    selectedAssets,
    requestedOutputs: ["marketing_package"],
    enabledCapabilities: ["VIDEO", "IMAGE_UNDERSTANDING", "MARKETING"],
    dependencies: baseDependencies,
    completedResults: {},
    retryPipelineTypes: [],
    ...patch,
  };
}

function videoResult(
  patch: Partial<PipelineExecutionResult> = {}
): PipelineExecutionResult {
  return {
    ...adaptVideoPipelineResult({
      assetIds: ["video-1"],
      transcript: "hello",
      sceneAnalysis: [{ description: "bouquet" }],
      complete: true,
      confidence: { overall: 0.9 },
    }),
    ...patch,
  };
}

describe("PR-2 canonical Pipeline Router", () => {
  it("routes a video-only Campaign", () => {
    const plan = buildPipelineExecutionPlan(request([video]));
    expect(getPipelineRoute(plan, "VIDEO").state).toBe("QUEUED");
    expect(getPipelineRoute(plan, "IMAGE_UNDERSTANDING").state).toBe("NOT_REQUIRED");
    expect(getPipelineRoute(plan, "PRODUCT_IMAGE").state).toBe("NOT_REQUIRED");
    expect(getPipelineRoute(plan, "MARKETING").state).toBe("WAITING_FOR_DEPENDENCY");
  });

  it("routes an image-only Campaign", () => {
    const plan = buildPipelineExecutionPlan(request([image]));
    expect(getPipelineRoute(plan, "VIDEO").state).toBe("NOT_REQUIRED");
    expect(getPipelineRoute(plan, "IMAGE_UNDERSTANDING").state).toBe("QUEUED");
  });

  it("routes image and video deterministically without claiming production concurrency", () => {
    const first = buildPipelineExecutionPlan(request([video, image]));
    const second = buildPipelineExecutionPlan(request([image, video]));
    expect(first.deterministicKey).toBe(second.deterministicKey);
    expect(first.concurrencyGroups).toEqual([["VIDEO", "IMAGE_UNDERSTANDING"]]);
  });

  it("returns explicit NOT_REQUIRED routes when no media is supported", () => {
    const plan = buildPipelineExecutionPlan(
      request([{
        id: "pdf-1",
        type: "pdf",
        mimeType: "application/pdf",
        storagePath: "file.pdf",
      }])
    );
    expect(getPipelineRoute(plan, "VIDEO").state).toBe("NOT_REQUIRED");
    expect(getPipelineRoute(plan, "IMAGE_UNDERSTANDING").state).toBe("NOT_REQUIRED");
    expect(getPipelineRoute(plan, "PRODUCT_IMAGE").state).toBe("NOT_REQUIRED");
    expect(getPipelineRoute(plan, "MARKETING").state).toBe("WAITING_FOR_DEPENDENCY");
  });

  it("waits for upload or registration dependencies", () => {
    const dependencies = baseDependencies.map((dependency) =>
      dependency.id === "asset-registration:video-1"
        ? { ...dependency, state: "WAITING" as const }
        : dependency
    );
    const plan = buildPipelineExecutionPlan(request([video], { dependencies }));
    const route = getPipelineRoute(plan, "VIDEO");
    expect(route.state).toBe("WAITING_FOR_DEPENDENCY");
    expect(dependenciesForRoute(route, dependencies).state).toBe("WAITING");
  });

  it("reuses a completed upstream result without rerunning it", () => {
    const completed = videoResult();
    const plan = buildPipelineExecutionPlan(
      request([video], { completedResults: { VIDEO: completed } })
    );
    expect(getPipelineRoute(plan, "VIDEO").state).toBe("COMPLETED");
    expect(plan.concurrencyGroups).toEqual([]);
    expect(plan.reusedResults.VIDEO).toBe(completed);
    expect(getPipelineRoute(plan, "MARKETING").state).toBe("QUEUED");
  });

  it("distinguishes retryable and terminal dependency failures", () => {
    const retryable = evaluateDependencies([{
      id: "pipeline:VIDEO",
      kind: "pipeline_output",
      required: true,
      state: "FAILED_RETRYABLE",
    }]);
    const terminal = evaluateDependencies([{
      id: "pipeline:VIDEO",
      kind: "pipeline_output",
      required: true,
      state: "FAILED_TERMINAL",
    }]);
    expect(retryable.state).toBe("FAILED_RETRYABLE");
    expect(terminal.state).toBe("FAILED_TERMINAL");

    const retryPlan = buildPipelineExecutionPlan(
      request([video], {
        dependencies: baseDependencies.map((dependency) =>
          dependency.id === "asset-upload:video-1"
            ? { ...dependency, state: "FAILED_RETRYABLE" as const }
            : dependency
        ),
      })
    );
    const terminalPlan = buildPipelineExecutionPlan(
      request([video], {
        dependencies: baseDependencies.map((dependency) =>
          dependency.id === "asset-upload:video-1"
            ? { ...dependency, state: "FAILED_TERMINAL" as const }
            : dependency
        ),
      })
    );
    expect(getPipelineRoute(retryPlan, "VIDEO").state).toBe("FAILED_RETRYABLE");
    expect(getPipelineRoute(terminalPlan, "VIDEO").state).toBe("FAILED_TERMINAL");
  });

  it("resumes the requested pipeline while preserving completed siblings", () => {
    const imageResult = adaptImageUnderstandingResult({
      assetIds: ["image-1"],
      subjectDetection: ["bouquet"],
    });
    const plan = buildPipelineExecutionPlan(
      request([video, image], {
        completedResults: { IMAGE_UNDERSTANDING: imageResult },
        retryPipelineTypes: ["VIDEO"],
      })
    );
    expect(getPipelineRoute(plan, "VIDEO").state).toBe("FAILED_RETRYABLE");
    expect(getPipelineRoute(plan, "IMAGE_UNDERSTANDING").state).toBe("COMPLETED");
    expect(plan.concurrencyGroups).toEqual([["VIDEO"]]);
  });

  it("production executor follows the Router plan instead of re-inspecting assets", async () => {
    const plan = buildPipelineExecutionPlan(request([video, image]));
    const videoHandler = vi.fn(async () => "video-runtime");
    const imageHandler = vi.fn(async () => "image-runtime");
    await expect(
      executeCampaignPipelinePlan(plan, {
        VIDEO: videoHandler,
        IMAGE_UNDERSTANDING: imageHandler,
      })
    ).resolves.toBe("video-runtime");
    expect(videoHandler).toHaveBeenCalledOnce();
    expect(imageHandler).not.toHaveBeenCalled();
  });

  it("production executor reuses a completed sibling and runs only incomplete work", async () => {
    const imageResult = adaptImageUnderstandingResult({
      assetIds: ["image-1"],
      subjectDetection: ["bouquet"],
    });
    const plan = buildPipelineExecutionPlan(
      request([video, image], {
        completedResults: { IMAGE_UNDERSTANDING: imageResult },
        retryPipelineTypes: ["VIDEO"],
      })
    );
    const videoHandler = vi.fn(async () => "video-resume");
    const imageHandler = vi.fn(async () => "image-duplicate");
    await expect(
      executeCampaignPipelinePlan(plan, {
        VIDEO: videoHandler,
        IMAGE_UNDERSTANDING: imageHandler,
      })
    ).resolves.toBe("video-resume");
    expect(videoHandler).toHaveBeenCalledOnce();
    expect(imageHandler).not.toHaveBeenCalled();
  });
});

describe("PR-2 normalized media adapters", () => {
  it("preserves Video source, transcript, scenes, highlights, creative and provenance refs", () => {
    const result = adaptVideoPipelineResult({
      assetIds: ["video-1"],
      creativeIds: ["creative-1"],
      transcript: "spoken words",
      sceneAnalysis: ["scene"],
      suggestedMoments: ["moment"],
      selectedHighlights: ["highlight"],
      editPlanReferences: ["edit-1"],
      renderedCreativeReferences: ["creative-1"],
      subtitleReferences: ["subtitle-1"],
      complete: true,
    });
    expect(result.state).toBe("COMPLETED");
    expect(result.assetIds).toEqual(["video-1"]);
    expect(result.creativeIds).toEqual(["creative-1"]);
    expect(result.output).toMatchObject({
      transcriptReference: "spoken words",
      sceneAnalysis: ["scene"],
      selectedHighlightSegments: ["highlight"],
    });
    expect(result.provenance[0]).toMatchObject({
      pipelineType: "VIDEO",
      assetId: "video-1",
    });
  });

  it("normalizes existing Image understanding without creating Product Image output", () => {
    const result = adaptImageUnderstandingResult({
      assetIds: ["image-1"],
      classification: "product_photo",
      productDetection: ["bouquet"],
      subjectDetection: ["flowers"],
      sceneDetection: ["studio"],
      confidence: { overall: 0.8 },
    });
    expect(result.pipelineType).toBe("IMAGE_UNDERSTANDING");
    expect(result.output.productDetection).toEqual(["bouquet"]);
    expect(result.creativeIds).toEqual([]);
    expect(productImageNotRequiredResult().state).toBe("NOT_REQUIRED");
  });
});

describe("PR-2 Merge Context and Marketing boundary", () => {
  const base = buildCampaignAIContext({
    campaignObjective: "awareness",
    publishingPlatforms: ["tiktok"],
    targetAudience: "local buyers",
    campaignBrief: "Launch flowers",
    workspaceLanguage: "en",
    assets: [
      { id: "video-1", type: "video" },
      { id: "image-1", type: "image" },
    ],
  });

  it("is deterministic and preserves provenance, asset IDs, creative IDs and warnings", () => {
    const warning = {
      code: "LOW_LIGHT",
      message: "Low light",
      retryable: false,
      assetId: "image-1",
    };
    const results = [
      videoResult({ creativeIds: ["creative-1"] }),
      adaptImageUnderstandingResult({
        assetIds: ["image-1"],
        subjectDetection: ["bouquet"],
        warnings: [warning],
      }),
    ];
    const first = mergePipelineContext(base, results);
    const second = mergePipelineContext(base, [...results].reverse());
    expect(first.deterministicKey).toBe(second.deterministicKey);
    expect(first.assetIds).toEqual(["image-1", "video-1"]);
    expect(first.creativeIds).toEqual(["creative-1"]);
    expect(first.warnings).toEqual([warning]);
    expect(first.provenance).toHaveLength(2);
    expect(first.campaignContext.transcript).toBe("hello");
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it("prevents Marketing from running before required dependencies are ready", async () => {
    expect(() =>
      assertMarketingDependenciesReady([{
        id: "pipeline:VIDEO",
        kind: "pipeline_output",
        required: true,
        state: "WAITING",
      }])
    ).toThrow(/waiting/);

    const emptyMerged = mergePipelineContext(base, []);
    await expect(
      runMarketingPipeline(emptyMerged, async () => "should not run")
    ).rejects.toThrow(/ready normalized upstream results/);
  });

  it("requires an explicit warning before Marketing accepts partial Video output", async () => {
    const partial = adaptVideoPipelineResult({
      assetIds: ["video-1"],
      transcript: "ready transcript",
      complete: false,
    });
    await expect(
      runMarketingPipeline(
        mergePipelineContext(base, [partial]),
        async () => "should not run"
      )
    ).rejects.toThrow(/ready normalized upstream results/);

    const warned = {
      ...partial,
      warnings: [preRenderVideoWarning()],
    };
    await expect(
      runMarketingPipeline(
        mergePipelineContext(base, [warned]),
        async () => "degraded"
      )
    ).resolves.toMatchObject({ output: "degraded" });
  });

  it("passes only canonical merged CampaignAIContext into Marketing", async () => {
    const merged = mergePipelineContext(base, [videoResult()]);
    const execute = vi.fn(async (context) => context.campaignBrief);
    const marketing = await runMarketingPipeline(merged, execute);
    expect(marketing.output).toBe("Launch flowers");
    expect(execute).toHaveBeenCalledWith(merged.campaignContext);
  });
});

describe("PR-2 state, gates and executable concurrency foundation", () => {
  it("rejects terminal restart and permits retry resume", () => {
    expect(() => assertPipelineStateTransition("COMPLETED", "RUNNING")).toThrow();
    expect(() =>
      assertPipelineStateTransition("FAILED_RETRYABLE", "RUNNING")
    ).not.toThrow();
  });

  it("does not enter Review without Creative registration and output readiness", () => {
    const progress = {
      ffmpeg_render: { status: "completed" as const },
      compliance_check: { status: "completed" as const },
      marketing_score: { status: "completed" as const },
    };
    expect(evaluateMandatoryGates({
      progress,
      creativeRegistered: false,
      outputReady: false,
    }).missing).toEqual(["creative_registration", "output_readiness"]);
    expect(() =>
      assertMandatoryGatesComplete({
        progress,
        creativeRegistered: true,
        outputReady: true,
      })
    ).not.toThrow();
  });

  it("can execute approved independent runners concurrently when registered", async () => {
    const plan = buildPipelineExecutionPlan(request([video, image]));
    const order: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const videoRunner = vi.fn(async () => {
      order.push("video-start");
      await barrier;
      return videoResult();
    });
    const imageRunner = vi.fn(async () => {
      order.push("image-start");
      release();
      return adaptImageUnderstandingResult({ assetIds: ["image-1"] });
    });
    const results = await executePipelinePlan(plan, {
      VIDEO: videoRunner,
      IMAGE_UNDERSTANDING: imageRunner,
    });
    expect(order.slice(0, 2).sort()).toEqual(["image-start", "video-start"]);
    expect(results.map((result) => result.pipelineType)).toEqual([
      "IMAGE_UNDERSTANDING",
      "VIDEO",
    ]);
  });

  it("reloads only completed normalized pipeline checkpoints", () => {
    const complete = videoResult();
    const partial = adaptVideoPipelineResult({
      assetIds: ["video-2"],
      complete: false,
      warnings: [preRenderVideoWarning()],
    });
    const results = readCompletedPipelineResults({
      video_pipeline_output: { status: "completed", output: complete },
      image_understanding_output: { status: "completed", output: partial },
    });
    expect(results.VIDEO).toEqual(complete);
    expect(results.IMAGE_UNDERSTANDING).toBeUndefined();
  });

  it("does not commit Review state until every mandatory gate passes", async () => {
    const commit = vi.fn(async () => undefined);
    const input = {
      taskId: "task-1",
      campaignId: "campaign-1",
      orgId: "org-1",
      workspaceId: "workspace-1",
      creativeIds: ["creative-1"],
      progress: {
        ffmpeg_render: { status: "completed" as const },
        compliance_check: { status: "completed" as const },
        marketing_score: { status: "failed" as const },
      },
    };
    await expect(
      finalizeReviewAfterGates(
        [{
          progress: input.progress,
          creativeRegistered: true,
          outputReady: true,
        }],
        input,
        commit
      )
    ).rejects.toThrow(/marketing_score/);
    expect(commit).not.toHaveBeenCalled();

    const completedInput = {
      ...input,
      progress: {
        ...input.progress,
        marketing_score: { status: "completed" as const },
      },
    };
    await finalizeReviewAfterGates(
      [{
        progress: completedInput.progress,
        creativeRegistered: true,
        outputReady: true,
      }],
      completedInput,
      commit
    );
    expect(commit).toHaveBeenCalledOnce();
  });

  it("delays the same BullMQ job while dependencies are waiting", async () => {
    const moveToDelayed = vi.fn(async () => undefined);
    await expect(
      delayPipelineJobForDependencies(
        { moveToDelayed, token: "worker-token" } as never,
        500,
        () => 10_000
      )
    ).rejects.toThrow();
    expect(moveToDelayed).toHaveBeenCalledWith(11_000, "worker-token");
  });
});
