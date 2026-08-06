import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CompositionResult } from "@ceo-agent/agents";
import type { EditPlan, RenderPhase } from "@ceo-agent/shared";

vi.mock("../apps/worker/src/render-providers", () => ({
  selectRenderProvider: vi.fn(() => {
    throw new Error("Test must inject a provider selector");
  }),
}));

import {
  buildRenderRequest,
  runRenderOrchestrator,
  validateCompletedRenderResult,
  type NormalizedRenderProgress,
  type RenderCheckpointEvent,
  type RenderOrchestrationResult,
  type RenderRequestContext,
} from "../apps/worker/src/render-orchestrator";
import {
  RenderProviderRegistry,
  renderFingerprint,
  type RenderProvider,
  type RenderResult,
} from "../apps/worker/src/render-providers/contracts";

const editPlan: EditPlan = {
  aspectRatio: "9:16",
  targetDurationSec: 10,
  outputResolution: { preview: "720x1280", export: "1080x1920" },
  clips: [
    {
      assetId: "asset-1",
      startSec: 0,
      endSec: 10,
      speed: 1,
      outputDurationSec: 10,
    },
  ],
  subtitles: [],
  cover: { atSec: 1 },
  audio: { keepOriginal: true, normalize: true, bgm: "none" },
  effects: [],
};

function composition(): CompositionResult {
  return {
    contractVersion: "1",
    pipelineType: "VIDEO_COMPOSITION",
    state: "COMPLETED",
    checkpoint: "VIDEO_COMPOSITION_COMPLETE",
    creativeDrafts: [
      {
        stableKey: "draft-key",
        creativeId: "creative-1",
        status: "draft",
        editPlan,
        renderSpecification: {
          contractVersion: "1",
          assets: [
            {
              assetId: "asset-1",
              sourceStartSec: 0,
              sourceEndSec: 10,
              timelineStartSec: 0,
              timelineEndSec: 10,
            },
          ],
          tracks: { video: [], subtitle: [], voiceover: [], bgm: [] },
          effects: [],
          transitions: [],
          timing: { timeBase: "seconds", durationSec: 10 },
          output: {
            format: "mp4",
            previewResolution: "720x1280",
            exportResolution: "1080x1920",
            aspectRatio: "9:16",
            frameRate: 30,
            videoBitrateTargetsKbps: { preview: 2500, export: 8000 },
            audio: {
              codec: "aac",
              sampleRateHz: 48000,
              channels: 2,
              bitrateKbps: 192,
            },
          },
          deterministicKey: "render-spec-key",
        },
      },
    ],
    warnings: [],
    provenance: [],
    deterministicKey: "composition-key",
  };
}

function requestContext(
  overrides: Partial<RenderRequestContext> = {}
): RenderRequestContext {
  return {
    sourceAssets: [
      { assetId: "asset-1", uri: "source.mp4", mediaType: "video" },
    ],
    outputProfile: { mode: "preview", profileKey: "preview" },
    qualityProfile: {
      width: 720,
      height: 1280,
      frameRate: 30,
      videoBitrateKbps: 2500,
      audioBitrateKbps: 192,
    },
    retry: { attempt: 1 },
    correlation: {
      taskId: "task-1",
      creativeId: "creative-1",
      campaignId: "campaign-1",
      workspaceId: "workspace-1",
      orgId: "org-1",
      correlationId: "correlation-1",
    },
    destinations: {
      outputUri: "output.mp4",
      coverOutputUri: "cover.jpg",
    },
    cover: { sourceAssetId: "asset-1", atSec: 1 },
    legacyEditPlan: editPlan,
    ...overrides,
  };
}

function completedResult(
  overrides: Partial<RenderResult> = {}
): RenderResult {
  return {
    contractVersion: "1",
    status: "COMPLETED",
    outputReferences: [
      { uri: "output.mp4", mediaType: "video", role: "output" },
    ],
    previewReferences: [
      { uri: "output.mp4", mediaType: "video", role: "preview" },
    ],
    coverReferences: [
      { uri: "cover.jpg", mediaType: "image", role: "cover" },
    ],
    durationSec: 10,
    resolution: { width: 720, height: 1280 },
    fileSizeBytes: 2048,
    fingerprint: "result-fingerprint",
    providerMetadata: {
      providerId: "test-provider",
      providerVersion: "1",
    },
    correlation: requestContext().correlation,
    warnings: [],
    provenance: [
      {
        providerId: "test-provider",
        sourceAssetIds: ["asset-1"],
        renderSpecificationKey: "render-spec-key",
        correlationId: "correlation-1",
        timestamp: "2026-07-25T00:00:00.000Z",
      },
    ],
    usedCache: false,
    ...overrides,
  };
}

function provider(result: RenderResult = completedResult()) {
  const execute = vi.fn(
    async (
      _request: Parameters<RenderProvider["execute"]>[0],
      progress?: (percent: number, phase: RenderPhase) => void | Promise<void>
    ) => {
      await progress?.(10, "queued");
      await progress?.(25, "downloading");
      await progress?.(60, "base_clip");
      await progress?.(90, "upload");
      return result;
    }
  );
  const value: RenderProvider = {
    id: "test-provider",
    version: "1",
    capabilities: () => new Set(["VIDEO", "COVER"]),
    execute,
  };
  return { value, execute };
}

describe("PR-3A.4B-1 Render Orchestrator", () => {
  it("constructs a deterministic immutable request from Composition", () => {
    const upstream = composition();
    const original = JSON.stringify(upstream);
    const first = buildRenderRequest(
      upstream,
      "creative-1",
      requestContext()
    );
    const second = buildRenderRequest(
      upstream,
      "creative-1",
      requestContext({
        retry: { attempt: 2 },
        sourceAssets: [
          {
            assetId: "asset-1",
            uri: "different-temporary-path.mp4",
            mediaType: "video",
          },
        ],
      })
    );

    expect(first.retry.deterministicKey).toBe(
      second.retry.deterministicKey
    );
    expect(first.creativeDraftReferences).toEqual([
      { creativeId: "creative-1", stableKey: "draft-key" },
    ]);
    expect(first.renderSpecification.deterministicKey).toBe(
      "render-spec-key"
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.renderSpecification)).toBe(true);
    expect(Object.isFrozen(upstream)).toBe(false);
    expect(
      Object.isFrozen(
        upstream.creativeDrafts[0]!.renderSpecification
      )
    ).toBe(false);
    expect(JSON.stringify(upstream)).toBe(original);
    expect(JSON.stringify(first).toLowerCase()).not.toContain(
      "ffmpeg command"
    );
  });

  it("selects, executes once, normalizes progress, and completes Render", async () => {
    const selected = provider();
    const selectProvider = vi.fn(() => selected.value);
    const checkpoints: RenderCheckpointEvent[] = [];
    const progress: NormalizedRenderProgress[] = [];

    const result = await runRenderOrchestrator({
      compositionResult: composition(),
      creativeDraftId: "creative-1",
      requestContext: requestContext(),
      requiredCapabilities: ["VIDEO", "COVER"],
      selectProvider,
      persistCheckpoint: async (event) => checkpoints.push(event),
      onProgress: async (event) => progress.push(event),
    });

    expect(selectProvider).toHaveBeenCalledWith(["VIDEO", "COVER"]);
    expect(selected.execute).toHaveBeenCalledOnce();
    expect(progress.map((event) => event.stage)).toEqual([
      "QUEUED",
      "ACCEPTED",
      "PREPARING",
      "RENDERING",
      "UPLOADING",
      "COMPLETED",
    ]);
    expect(
      progress.every(
        (event) =>
          event.correlationId === "correlation-1" &&
          event.providerId === "test-provider" &&
          Boolean(event.timestamp)
      )
    ).toBe(true);
    expect(checkpoints[0]?.checkpoint).toBe("VIDEO_RENDER_PENDING");
    expect(
      checkpoints.some(
        (event) => event.checkpoint === "VIDEO_RENDERING"
      )
    ).toBe(true);
    expect(checkpoints.at(-1)?.checkpoint).toBe(
      "VIDEO_RENDER_COMPLETE"
    );
    expect(result).toMatchObject({
      pipelineType: "VIDEO_RENDER",
      state: "PARTIALLY_COMPLETE",
      checkpoint: "VIDEO_RENDER_COMPLETE",
      providerId: "test-provider",
      renderRequestFingerprint: expect.any(String),
      progress: {
        lastStage: "COMPLETED",
        lastPercent: 100,
        eventCount: 6,
      },
    });
    expect(result).not.toHaveProperty("review");
    expect(result).not.toHaveProperty("creativeReady");
    expect(result).not.toHaveProperty("compliance");
    expect(result).not.toHaveProperty("marketingScore");
  });

  it("uses registry capability validation", async () => {
    const registry = new RenderProviderRegistry();
    registry.register(provider().value, { makeDefault: true });

    await expect(
      runRenderOrchestrator({
        compositionResult: composition(),
        creativeDraftId: "creative-1",
        requestContext: requestContext(),
        requiredCapabilities: ["IMAGE"],
        selectProvider: (required) => registry.select(required),
      })
    ).rejects.toThrow("lacks capabilities");
  });

  it.each([
    ["final output references", { outputReferences: [] }],
    ["preview references", { previewReferences: [] }],
    ["cover references", { coverReferences: [] }],
    ["positive duration", { durationSec: 0 }],
    ["valid resolution", { resolution: { width: 0, height: 1280 } }],
    ["fingerprint", { fingerprint: "" }],
    ["provider identity", { providerMetadata: { providerId: "", providerVersion: "1" } }],
    ["traceable provenance", { provenance: [] }],
  ])("rejects an incomplete result without %s", async (_label, override) => {
    const selected = provider(
      completedResult(override as Partial<RenderResult>)
    );

    await expect(
      runRenderOrchestrator({
        compositionResult: composition(),
        creativeDraftId: "creative-1",
        requestContext: requestContext(),
        requiredCapabilities: ["VIDEO"],
        selectProvider: () => selected.value,
      })
    ).rejects.toThrow();
  });

  it("rejects a provider result with mismatched correlation", () => {
    const request = buildRenderRequest(
      composition(),
      "creative-1",
      requestContext()
    );
    expect(() =>
      validateCompletedRenderResult(
        request,
        completedResult({
          correlation: {
            ...request.correlation,
            correlationId: "wrong-correlation",
          },
        })
      )
    ).toThrow("correlation");
  });

  it("allows omitted optional preview and cover references", () => {
    const context = requestContext({
      outputProfile: { mode: "final", profileKey: "final" },
      destinations: { outputUri: "output.mp4" },
      cover: undefined,
    });
    const request = buildRenderRequest(
      composition(),
      "creative-1",
      context
    );
    expect(
      validateCompletedRenderResult(
        request,
        completedResult({
          previewReferences: [],
          coverReferences: [],
        })
      )
    ).toMatchObject({ status: "COMPLETED" });
  });

  it("normalizes provider failure without completing Render", async () => {
    const progress: NormalizedRenderProgress[] = [];
    const failedProvider: RenderProvider = {
      id: "failed-provider",
      version: "1",
      capabilities: () => new Set(["VIDEO"]),
      execute: vi.fn(async () => {
        throw new Error("render unavailable");
      }),
    };

    await expect(
      runRenderOrchestrator({
        compositionResult: composition(),
        creativeDraftId: "creative-1",
        requestContext: requestContext(),
        requiredCapabilities: ["VIDEO"],
        selectProvider: () => failedProvider,
        onProgress: async (event) => progress.push(event),
      })
    ).rejects.toThrow("render unavailable");
    expect(progress.at(-1)).toMatchObject({
      stage: "FAILED",
      providerId: "failed-provider",
      correlationId: "correlation-1",
    });
  });

  it.each(["VIDEO_RENDER_PENDING", "VIDEO_RENDERING"] as const)(
    "resumes from %s without rebuilding Composition",
    async (resumeFrom) => {
      const upstream = composition();
      const original = JSON.stringify(upstream);
      const selected = provider();
      const checkpoints: RenderCheckpointEvent[] = [];

      await runRenderOrchestrator({
        compositionResult: upstream,
        creativeDraftId: "creative-1",
        requestContext: requestContext(),
        requiredCapabilities: ["VIDEO"],
        resumeFrom,
        selectProvider: () => selected.value,
        persistCheckpoint: async (event) => checkpoints.push(event),
      });

      expect(checkpoints[0]?.checkpoint).toBe("VIDEO_RENDERING");
      expect(
        checkpoints.some(
          (event) => event.checkpoint === "VIDEO_RENDER_PENDING"
        )
      ).toBe(false);
      expect(JSON.stringify(upstream)).toBe(original);
      expect(selected.execute).toHaveBeenCalledOnce();
    }
  );

  it("reuses a completed result when the request fingerprint matches", async () => {
    const selected = provider();
    const first = await runRenderOrchestrator({
      compositionResult: composition(),
      creativeDraftId: "creative-1",
      requestContext: requestContext(),
      requiredCapabilities: ["VIDEO"],
      selectProvider: () => selected.value,
    });
    selected.execute.mockClear();

    const reused = await runRenderOrchestrator({
      compositionResult: composition(),
      creativeDraftId: "creative-1",
      requestContext: requestContext({ retry: { attempt: 2 } }),
      requiredCapabilities: ["VIDEO"],
      completedResult: first,
      selectProvider: () => selected.value,
    });

    expect(reused).toBe(first);
    expect(selected.execute).not.toHaveBeenCalled();
  });

  it("reruns when a matching completed result is no longer reusable", async () => {
    const selected = provider();
    const first = await runRenderOrchestrator({
      compositionResult: composition(),
      creativeDraftId: "creative-1",
      requestContext: requestContext(),
      requiredCapabilities: ["VIDEO"],
      selectProvider: () => selected.value,
    });
    selected.execute.mockClear();

    await runRenderOrchestrator({
      compositionResult: composition(),
      creativeDraftId: "creative-1",
      requestContext: requestContext({ retry: { attempt: 2 } }),
      requiredCapabilities: ["VIDEO"],
      completedResult: first,
      canReuseCompletedResult: () => false,
      selectProvider: () => selected.value,
    });

    expect(selected.execute).toHaveBeenCalledOnce();
  });

  it("production handler enters rendering only through RenderOrchestrator", () => {
    const source = readFileSync(
      "apps/worker/src/processors/render-handler.ts",
      "utf8"
    );
    expect(source).toContain("runRenderOrchestrator({");
    expect(source).not.toContain("selectRenderProvider(");
    expect(source).not.toMatch(/\.execute\(/);
    expect(source).not.toContain("PRODUCT_IMAGE");
  });

  it("stops at VIDEO_RENDER_COMPLETE without Finalization side effects", () => {
    const source = readFileSync(
      "apps/worker/src/render-orchestrator.ts",
      "utf8"
    );
    expect(source).not.toContain("runCompliance");
    expect(source).not.toContain("MarketingScore");
    expect(source).not.toContain("createReview");
    expect(source).not.toContain("VIDEO_COMPLETE");
    expect(source).not.toContain("VIDEO_GATES_COMPLETE");
    expect(source).not.toContain("status: \"ready\"");
    expect(source).not.toContain("PRODUCT_IMAGE");
  });
});
