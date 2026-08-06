import { describe, expect, it, vi } from "vitest";
import type {
  CampaignAIContext,
  StepProgress,
  VisionAnalysis,
} from "@ceo-agent/shared";
import {
  runVideoUnderstandingPipeline,
  type VideoUnderstandingCheckpointEvent,
} from "../packages/agents/src/video-understanding-pipeline";
import { buildPipelineExecutionPlan } from "../packages/agents/src/pipeline-router";
import { executeCampaignPipelinePlan } from "../packages/agents/src/pipeline-executor";
import {
  createVideoPipelineResult,
  type VideoCheckpoint,
} from "../packages/agents/src/video-pipeline-contract";

const campaignContext: CampaignAIContext = {
  businessProfile: {},
  campaignObjective: "Promote a graduation bouquet",
  publishingPlatforms: ["instagram"],
  targetAudience: "Graduating students",
  campaignBrief: "Show the bouquet and celebrate the milestone.",
  workspaceLanguage: "en",
};

const vision: VisionAnalysis = {
  assetId: "asset-video-1",
  mediaType: "video",
  durationSec: 90,
  subjects: ["bouquet", "graduate"],
  scenes: [
    {
      startSec: 0,
      endSec: 25,
      description: "Graduate receives a bouquet",
    },
  ],
  products: [{ name: "Graduation bouquet" }],
  hooks: ["Celebrate the milestone"],
  transcriptSummary: "A graduation bouquet is presented.",
  suggestedMoments: [
    { startSec: 0, endSec: 25, reason: "Strong product reveal" },
  ],
  confidence: 0.91,
};

const source = {
  assetId: "asset-video-1",
  storagePath: "workspace/assets/video.mp4",
  mimeType: "video/mp4",
  status: "ready",
  durationSec: 90,
};

function visionExecution(analysis: VisionAnalysis = vision) {
  return {
    analysis: {
      ...analysis,
      diagnostics: {
        frameCount: 1,
        validFrameCount: 1,
        source: "model" as const,
      },
    },
    usage: { input: 120, output: 80, costUsd: 0.01 },
  };
}

function completedEvents(events: VideoUnderstandingCheckpointEvent[]) {
  return events
    .filter((event) => event.status === "completed")
    .map((event) => event.checkpoint);
}

describe("PR-3A.2 Video Understanding Pipeline", () => {
  it("executes the canonical Understanding boundary selected by the production Router", async () => {
    const plan = buildPipelineExecutionPlan({
      campaignId: "campaign-1",
      workspaceId: "workspace-1",
      campaignObjective: campaignContext.campaignObjective,
      selectedAssets: [
        {
          id: source.assetId,
          type: "video",
          mimeType: source.mimeType,
          storagePath: source.storagePath,
          durationSec: source.durationSec,
          status: "ready",
        },
      ],
      requestedOutputs: ["marketing_package"],
      enabledCapabilities: ["VIDEO", "IMAGE_UNDERSTANDING", "MARKETING"],
      dependencies: [
        {
          id: "campaign",
          kind: "campaign",
          required: true,
          state: "READY",
        },
        {
          id: "business_profile",
          kind: "business_profile",
          required: true,
          state: "READY",
        },
        {
          id: `asset-upload:${source.assetId}`,
          kind: "asset_upload",
          required: true,
          state: "READY",
          assetId: source.assetId,
        },
        {
          id: `asset-registration:${source.assetId}`,
          kind: "asset_registration",
          required: true,
          state: "READY",
          assetId: source.assetId,
        },
      ],
      completedResults: {},
      retryPipelineTypes: [],
    });
    const imageHandler = vi.fn();

    const execution = await executeCampaignPipelinePlan(plan, {
      VIDEO: () =>
        runVideoUnderstandingPipeline({
          source,
          campaignContext,
          dependencies: {
            prepareMedia: vi.fn().mockResolvedValue({
              frames: [],
              transcriptSummary: vision.transcriptSummary,
            }),
            analyzeVision: vi.fn().mockResolvedValue(visionExecution()),
          },
        }),
      IMAGE_UNDERSTANDING: imageHandler,
    });

    expect(imageHandler).not.toHaveBeenCalled();
    expect(execution.result).toMatchObject({
      phase: "READY_FOR_MARKETING",
      state: "PARTIALLY_COMPLETE",
    });
  });

  it("progresses through canonical checkpoints and reaches READY_FOR_MARKETING", async () => {
    const events: VideoUnderstandingCheckpointEvent[] = [];
    const result = await runVideoUnderstandingPipeline({
      source,
      campaignContext,
      highlightKeywords: ["bouquet"],
      dependencies: {
        prepareMedia: vi.fn().mockResolvedValue({
          frames: [{ atSec: 2, dataUrl: "data:image/jpeg;base64,frame" }],
          transcriptSummary: "A graduation bouquet is presented.",
          transcriptSegments: [
            {
              startSec: 0,
              endSec: 20,
              text: "Celebrate with a graduation bouquet.",
            },
          ],
        }),
        analyzeVision: vi.fn().mockResolvedValue(visionExecution()),
      },
      persistCheckpoint: async (event) => {
        events.push(event);
      },
    });

    expect(completedEvents(events)).toEqual([
      "VIDEO_VALIDATION_COMPLETE",
      "VIDEO_METADATA_COMPLETE",
      "VIDEO_TRANSCRIPT_COMPLETE",
      "VIDEO_SCENE_ANALYSIS_COMPLETE",
      "VIDEO_HIGHLIGHTS_COMPLETE",
      "VIDEO_UNDERSTANDING_COMPLETE",
      "VIDEO_READY_FOR_MARKETING",
    ]);
    expect(result.result).toMatchObject({
      pipelineType: "VIDEO",
      contractVersion: "1",
      state: "PARTIALLY_COMPLETE",
      phase: "READY_FOR_MARKETING",
      checkpoint: "VIDEO_READY_FOR_MARKETING",
    });
    expect(result.result.warnings.map((warning) => warning.code)).toEqual([
      "VIDEO_RENDER_PENDING",
    ]);
    expect(result.highlights.length).toBeGreaterThan(0);
  });

  it("normalizes provider output without leaking provider-specific payloads", async () => {
    const analyzeVision = vi.fn().mockResolvedValue({
      ...visionExecution(),
      rawProviderResponse: { vendor: "must-not-leak" },
    });
    const output = await runVideoUnderstandingPipeline({
      source,
      campaignContext,
      dependencies: {
        prepareMedia: vi.fn().mockResolvedValue({
          frames: [],
          transcriptSummary: vision.transcriptSummary,
        }),
        analyzeVision,
      },
    });

    expect(JSON.stringify(output.result)).not.toContain("must-not-leak");
    expect(output.result.provenance).toEqual([
      expect.objectContaining({
        source: "vision_analysis",
        pipelineType: "VIDEO",
        assetId: source.assetId,
      }),
    ]);
    expect(output.result.confidence).toEqual({ overall: 0.91 });
  });

  it("records a warning when transcript is unavailable without hiding readiness", async () => {
    const output = await runVideoUnderstandingPipeline({
      source,
      campaignContext,
      dependencies: {
        prepareMedia: vi.fn().mockResolvedValue({ frames: [] }),
        analyzeVision: vi
          .fn()
          .mockResolvedValue(
            visionExecution({ ...vision, transcriptSummary: undefined })
          ),
      },
    });

    expect(output.result.state).toBe("PARTIALLY_COMPLETE");
    expect(output.result.transcript).toBeUndefined();
    expect(output.result.warnings.map((warning) => warning.code)).toEqual([
      "VIDEO_TRANSCRIPT_UNAVAILABLE",
      "VIDEO_RENDER_PENDING",
    ]);
  });

  it("rejects an unready or unsupported source before provider execution", async () => {
    const analyzeVision = vi.fn();

    await expect(
      runVideoUnderstandingPipeline({
        source: { ...source, status: "processing" },
        campaignContext,
        dependencies: { analyzeVision },
      })
    ).rejects.toThrow("not ready");
    await expect(
      runVideoUnderstandingPipeline({
        source: { ...source, mimeType: "image/jpeg" },
        campaignContext,
        dependencies: { analyzeVision },
      })
    ).rejects.toThrow("Unsupported Video MIME type");
    expect(analyzeVision).not.toHaveBeenCalled();
  });

  it("reuses canonical checkpoints when resuming after interruption", async () => {
    const seedEvents: VideoUnderstandingCheckpointEvent[] = [];
    await runVideoUnderstandingPipeline({
      source,
      campaignContext,
      dependencies: {
        prepareMedia: vi.fn().mockResolvedValue({
          frames: [],
          transcriptSummary: vision.transcriptSummary,
        }),
        analyzeVision: vi.fn().mockResolvedValue(visionExecution()),
      },
      persistCheckpoint: async (event) => seedEvents.push(event),
    });
    const progress = Object.fromEntries(
      seedEvents
        .filter((event) => event.status === "completed")
        .map((event) => [
          event.checkpoint,
          { status: "completed" as const, output: event.output },
        ])
    ) as StepProgress;
    const prepareMedia = vi.fn();
    const analyzeVision = vi.fn();

    const resumed = await runVideoUnderstandingPipeline({
      source,
      campaignContext,
      progress,
      dependencies: { prepareMedia, analyzeVision },
    });

    expect(prepareMedia).not.toHaveBeenCalled();
    expect(analyzeVision).not.toHaveBeenCalled();
    expect(resumed.resumedCheckpoints).toEqual([
      "VIDEO_VALIDATION_COMPLETE",
      "VIDEO_METADATA_COMPLETE",
      "VIDEO_TRANSCRIPT_COMPLETE",
      "VIDEO_SCENE_ANALYSIS_COMPLETE",
      "VIDEO_HIGHLIGHTS_COMPLETE",
      "VIDEO_UNDERSTANDING_COMPLETE",
      "VIDEO_READY_FOR_MARKETING",
    ]);
    expect(resumed.result.deterministicKey).toHaveLength(64);
  });

  it("reuses a transcript checkpoint while preparing frames for resumed Vision", async () => {
    const prepareMedia = vi.fn().mockResolvedValue({
      frames: [{ atSec: 4, dataUrl: "data:image/jpeg;base64,resumed-frame" }],
      transcriptSummary: "This newer extraction must not replace the checkpoint.",
    });
    const analyzeVision = vi.fn().mockResolvedValue(visionExecution());

    await runVideoUnderstandingPipeline({
      source,
      campaignContext,
      progress: {
        VIDEO_VALIDATION_COMPLETE: {
          status: "completed",
          output: { valid: true },
        },
        VIDEO_METADATA_COMPLETE: {
          status: "completed",
          output: { durationSec: 90 },
        },
        VIDEO_TRANSCRIPT_COMPLETE: {
          status: "completed",
          output: {
            summary: "Persisted transcript",
            segments: [],
            available: true,
          },
        },
      },
      dependencies: { prepareMedia, analyzeVision },
    });

    expect(prepareMedia).toHaveBeenCalledOnce();
    expect(analyzeVision).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptSummary: "Persisted transcript",
        frames: [
          {
            atSec: 4,
            dataUrl: "data:image/jpeg;base64,resumed-frame",
          },
        ],
      })
    );
  });

  it("reuses legacy outputs and backfills canonical checkpoints", async () => {
    const legacyHighlights = [
      {
        startSec: 0,
        endSec: 25,
        attentionScore: 80,
        engagementScore: 75,
        conversionScore: 70,
        educationalScore: 45,
        brandScore: 85,
        deadAir: false,
        reason: "Legacy highlight",
      },
    ];
    const events: VideoUnderstandingCheckpointEvent[] = [];
    const analyzeVision = vi.fn();

    await runVideoUnderstandingPipeline({
      source,
      campaignContext,
      progress: {
        vision_analyze: { status: "completed", output: vision },
        highlight_index: {
          status: "completed",
          output: legacyHighlights,
        },
      },
      dependencies: { analyzeVision },
      persistCheckpoint: async (event) => events.push(event),
    });

    expect(analyzeVision).not.toHaveBeenCalled();
    expect(completedEvents(events)).toEqual(
      expect.arrayContaining([
        "VIDEO_TRANSCRIPT_COMPLETE",
        "VIDEO_SCENE_ANALYSIS_COMPLETE",
        "VIDEO_HIGHLIGHTS_COMPLETE",
        "VIDEO_READY_FOR_MARKETING",
      ])
    );
  });

  it("rejects an illegal PARTIALLY_COMPLETE checkpoint", () => {
    expect(() =>
      createVideoPipelineResult({
        state: "PARTIALLY_COMPLETE",
        phase: "UNDERSTANDING",
        checkpoint: "VIDEO_SCENE_ANALYSIS_COMPLETE" as VideoCheckpoint,
        sourceAssets: [{ assetId: source.assetId }],
        metadata: { durationSec: source.durationSec },
        sceneAnalysis: vision.scenes,
        selectedHighlights: vision.suggestedMoments,
        creativeReferences: [],
        renderReferences: [],
        warnings: [],
        confidence: { overall: 0.9 },
        provenance: [],
      })
    ).toThrow();
  });
});
