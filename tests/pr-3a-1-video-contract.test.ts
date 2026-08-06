import { describe, expect, it } from "vitest";
import {
  UnsupportedVideoContractVersionError,
  VIDEO_CHECKPOINTS,
  VIDEO_PHASES,
  compareVideoCheckpoints,
  createVideoPipelineResult,
  deserializeVideoPipelineResult,
  fingerprintVideoCampaign,
  fingerprintVideoHighlights,
  fingerprintVideoMarketingOutput,
  fingerprintVideoOutput,
  fingerprintVideoRenderSpec,
  fingerprintVideoSourceAssets,
  isVideoCheckpointAtLeast,
  readCompatibleVideoPipelineResult,
  readVideoPipelineResultFromProgress,
  serializeVideoPipelineResult,
} from "../packages/agents/src/video-pipeline-contract";

function partialResult() {
  return createVideoPipelineResult({
    state: "PARTIALLY_COMPLETE",
    phase: "READY_FOR_MARKETING",
    checkpoint: "VIDEO_READY_FOR_MARKETING",
    sourceAssets: [{ assetId: "asset-1", mimeType: "video/mp4" }],
    metadata: { durationSec: 42 },
    transcript: { text: "Hello" },
    sceneAnalysis: { scenes: [{ id: "scene-1" }] },
    selectedHighlights: [{ startSec: 1, endSec: 8 }],
    creativeReferences: [],
    renderReferences: [],
    warnings: [
      {
        code: "VIDEO_RENDER_PENDING",
        message:
          "Marketing uses validated Video understanding while composition and rendering remain pending.",
        retryable: false,
      },
    ],
    confidence: { overall: 0.91 },
    provenance: [
      {
        source: "vision",
        pipelineType: "VIDEO",
        assetId: "asset-1",
        provider: "provider-a",
      },
    ],
  });
}

describe("PR-3A.1 VideoPipelineResult", () => {
  it("serializes and deserializes a validated V1 result", () => {
    const source = partialResult();
    const serialized = serializeVideoPipelineResult(source);
    const restored = deserializeVideoPipelineResult(serialized);

    expect(restored).toEqual(source);
    expect(restored.contractVersion).toBe("1");
    expect(restored.pipelineType).toBe("VIDEO");
    expect(restored.deterministicKey).toHaveLength(64);
  });

  it("creates deeply immutable results", () => {
    const result = partialResult();

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sourceAssets)).toBe(true);
    expect(Object.isFrozen(result.sourceAssets[0])).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(() => {
      (result.metadata as { durationSec: number }).durationSec = 99;
    }).toThrow();
  });

  it("preserves unknown top-level and nested fields through round-trip", () => {
    const raw = JSON.parse(serializeVideoPipelineResult(partialResult()));
    raw.futureTopLevel = { enabled: true };
    raw.sourceAssets[0].futureAssetField = "preserved";

    const restored = deserializeVideoPipelineResult(JSON.stringify(raw));
    const serializedAgain = JSON.parse(serializeVideoPipelineResult(restored));

    expect(restored.extensions.futureTopLevel).toEqual({ enabled: true });
    expect(
      (restored.sourceAssets[0] as unknown as Record<string, unknown>)
        .futureAssetField
    ).toBe("preserved");
    expect(serializedAgain.futureTopLevel).toEqual({ enabled: true });
  });

  it("rejects unsupported future contract versions explicitly", () => {
    const raw = JSON.parse(serializeVideoPipelineResult(partialResult()));
    raw.contractVersion = "2";

    expect(() =>
      deserializeVideoPipelineResult(JSON.stringify(raw))
    ).toThrow(UnsupportedVideoContractVersionError);
  });

  it("upgrades a legacy normalized result to V1", () => {
    const legacy = {
      pipelineType: "VIDEO",
      state: "COMPLETED",
      assetIds: ["asset-2", "asset-1"],
      creativeIds: ["creative-1"],
      output: {
        transcriptReference: "Legacy transcript",
        sceneAnalysis: [{ id: "scene-1" }],
        selectedHighlightSegments: [{ startSec: 4, endSec: 10 }],
        editPlanReferences: [{ creativeId: "creative-1", plan: "legacy" }],
        renderedCreativeReferences: [
          {
            creativeId: "creative-1",
            videoUrl: "https://example.test/video.mp4",
            coverUrl: "https://example.test/cover.jpg",
          },
        ],
      },
      warnings: [],
      confidence: { overall: 0.8 },
      provenance: [
        {
          source: "legacy",
          pipelineType: "VIDEO",
          assetId: "asset-1",
        },
      ],
      deterministicKey: "legacy-key",
    };

    const result = readCompatibleVideoPipelineResult(legacy);

    expect(result.contractVersion).toBe("1");
    expect(result.state).toBe("COMPLETED");
    expect(result.phase).toBe("COMPLETE");
    expect(result.checkpoint).toBe("VIDEO_COMPLETE");
    expect(result.sourceAssets.map((item) => item.assetId)).toEqual([
      "asset-1",
      "asset-2",
    ]);
    expect(result.creativeReferences).toEqual([
      { creativeId: "creative-1" },
    ]);
    expect(result.renderReferences[0]).toMatchObject({
      creativeId: "creative-1",
      videoUrl: "https://example.test/video.mp4",
      coverUrl: "https://example.test/cover.jpg",
    });
    expect(result.extensions.legacy).toBe(true);
  });

  it("reads legacy task progress and preserves checkpoint JSON", () => {
    const result = readVideoPipelineResultFromProgress({
      vision_analyze: {
        status: "completed",
        output: { transcriptSummary: "Legacy transcript" },
      },
      ffmpeg_render: {
        status: "running",
        output: { percent: 55 },
      },
      video_pipeline_output: {
        status: "completed",
        output: {
          pipelineType: "VIDEO",
          state: "RUNNING",
          assetIds: ["asset-1"],
          creativeIds: ["creative-1"],
          output: {
            transcriptReference: "Legacy transcript",
            sceneAnalysis: [{ id: "scene-1" }],
            editPlanReferences: [{ creativeId: "creative-1" }],
          },
          warnings: [],
          confidence: {},
          provenance: [],
          checkpoint: "legacy-render-step",
        },
      },
    });

    expect(result).toBeDefined();
    expect(result?.phase).toBe("RENDERING");
    expect(result?.checkpoint).toBe("VIDEO_RENDERING");
    expect(result?.creativeReferences[0]?.creativeId).toBe("creative-1");
    expect(result?.extensions.legacyCheckpoint).toBe("legacy-render-step");
  });

  it("normalizes legacy checkpoint and Creative reference JSON", () => {
    const result = readCompatibleVideoPipelineResult({
      pipelineType: "VIDEO",
      state: "RUNNING",
      checkpoint: "VIDEO_COMPOSITION_COMPLETE",
      sourceAssets: [
        {
          id: "asset-1",
          mimeType: "video/mp4",
          legacySourceFlag: true,
        },
      ],
      output: {
        creativeReferences: [
          {
            id: "creative-1",
            status: "processing",
            legacyCreativeFlag: true,
          },
        ],
      },
      warnings: [],
      confidence: {},
      provenance: [],
    });

    expect(result.phase).toBe("COMPOSITION");
    expect(result.checkpoint).toBe("VIDEO_COMPOSITION_COMPLETE");
    expect(result.sourceAssets[0]).toMatchObject({
      assetId: "asset-1",
      mimeType: "video/mp4",
    });
    expect(result.creativeReferences[0]).toMatchObject({
      creativeId: "creative-1",
      status: "processing",
    });
  });

  it("does not promote incomplete legacy completion to canonical COMPLETED", () => {
    const result = readCompatibleVideoPipelineResult({
      pipelineType: "VIDEO",
      state: "COMPLETED",
      assetIds: ["asset-1"],
      creativeIds: [],
      output: {
        transcriptReference: "Transcript only",
        sceneAnalysis: [{ id: "scene-1" }],
      },
      warnings: [],
      confidence: {},
      provenance: [],
    });

    expect(result.state).toBe("RUNNING");
    expect(result.phase).toBe("UNDERSTANDING");
    expect(result.checkpoint).toBe("VIDEO_SCENE_ANALYSIS_COMPLETE");
  });

  it("does not promote incomplete legacy partial output to READY_FOR_MARKETING", () => {
    const result = readCompatibleVideoPipelineResult({
      pipelineType: "VIDEO",
      state: "PARTIALLY_COMPLETE",
      checkpoint: "VIDEO_READY_FOR_MARKETING",
      assetIds: ["asset-1"],
      output: {
        sceneAnalysis: [{ id: "scene-1" }],
        selectedHighlightSegments: [{ startSec: 1, endSec: 3 }],
      },
      warnings: [
        {
          code: "VIDEO_RENDER_PENDING",
          message: "Render pending",
          retryable: false,
        },
      ],
      confidence: {},
      provenance: [],
    });

    expect(result.state).toBe("RUNNING");
    expect(result.phase).toBe("UNDERSTANDING");
    expect(result.checkpoint).toBe("VIDEO_UNDERSTANDING_COMPLETE");
  });

  it("validates PARTIALLY_COMPLETE semantics", () => {
    expect(() =>
      createVideoPipelineResult({
        state: "PARTIALLY_COMPLETE",
        phase: "UNDERSTANDING",
        checkpoint: "VIDEO_UNDERSTANDING_COMPLETE",
        sourceAssets: [{ assetId: "asset-1" }],
        metadata: {},
        creativeReferences: [],
        renderReferences: [],
        warnings: [],
        confidence: {},
        provenance: [],
      })
    ).toThrow(/READY_FOR_MARKETING/);
  });

  it("validates COMPLETED render requirements", () => {
    expect(() =>
      createVideoPipelineResult({
        state: "COMPLETED",
        phase: "COMPLETE",
        checkpoint: "VIDEO_COMPLETE",
        sourceAssets: [{ assetId: "asset-1" }],
        metadata: {},
        creativeReferences: [{ creativeId: "creative-1" }],
        renderReferences: [],
        warnings: [],
        confidence: {},
        provenance: [],
      })
    ).toThrow(/render reference/);
  });

  it("defines phases independently from PipelineState", () => {
    expect(VIDEO_PHASES).toEqual([
      "UNDERSTANDING",
      "READY_FOR_MARKETING",
      "COMPOSITION",
      "RENDERING",
      "FINALIZATION",
      "COMPLETE",
    ]);
    expect(VIDEO_PHASES).not.toContain("PARTIALLY_COMPLETE");
  });

  it("orders every approved checkpoint deterministically", () => {
    expect(VIDEO_CHECKPOINTS).toHaveLength(13);
    for (let index = 1; index < VIDEO_CHECKPOINTS.length; index++) {
      expect(
        compareVideoCheckpoints(
          VIDEO_CHECKPOINTS[index - 1]!,
          VIDEO_CHECKPOINTS[index]!
        )
      ).toBeLessThan(0);
    }
    expect(
      isVideoCheckpointAtLeast(
        "VIDEO_RENDER_COMPLETE",
        "VIDEO_READY_FOR_MARKETING"
      )
    ).toBe(true);
    expect(
      isVideoCheckpointAtLeast(
        "VIDEO_METADATA_COMPLETE",
        "VIDEO_TRANSCRIPT_COMPLETE"
      )
    ).toBe(false);
  });
});

describe("PR-3A.1 deterministic Video fingerprints", () => {
  it("is stable across object key and source asset ordering", () => {
    expect(fingerprintVideoCampaign({ objective: "sales", id: "campaign-1" })).toBe(
      fingerprintVideoCampaign({ id: "campaign-1", objective: "sales" })
    );
    expect(
      fingerprintVideoSourceAssets([
        { assetId: "asset-2" },
        { assetId: "asset-1" },
      ])
    ).toBe(
      fingerprintVideoSourceAssets([
        { assetId: "asset-1" },
        { assetId: "asset-2" },
      ])
    );
  });

  it("uses distinct namespaces for each dependency class", () => {
    const value = { id: "same-value" };
    const fingerprints = new Set([
      fingerprintVideoCampaign(value),
      fingerprintVideoHighlights(value),
      fingerprintVideoMarketingOutput(value),
      fingerprintVideoRenderSpec(value),
      fingerprintVideoOutput(value),
    ]);

    expect(fingerprints.size).toBe(5);
    for (const fingerprint of fingerprints) {
      expect(fingerprint).toHaveLength(64);
    }
  });
});
