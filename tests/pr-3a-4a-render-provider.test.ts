import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditPlan } from "@ceo-agent/shared";

const {
  renderVideo,
  extractCover,
  extractCoverFromImage,
  probeVideo,
  extractBrandColorFromLogo,
} = vi.hoisted(() => ({
  renderVideo: vi.fn(),
  extractCover: vi.fn(),
  extractCoverFromImage: vi.fn(),
  probeVideo: vi.fn(),
  extractBrandColorFromLogo: vi.fn(),
}));

vi.mock("../apps/worker/src/ffmpeg/pipeline", () => ({
  renderVideo,
  extractCover,
  extractCoverFromImage,
  probeVideo,
}));
vi.mock("../apps/worker/src/ffmpeg/brand-color", () => ({
  extractBrandColorFromLogo,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, stat: vi.fn().mockResolvedValue({ size: 2048 }) };
});

import {
  RenderProviderRegistry,
  deserializeRenderRequest,
  deserializeRenderResult,
  renderFingerprint,
  serializeRenderRequest,
  serializeRenderResult,
  type RenderProvider,
  type RenderRequest,
  type RenderResult,
} from "../apps/worker/src/render-providers/contracts";
import { FFmpegRenderProvider } from "../apps/worker/src/render-providers/ffmpeg-render-provider";
import {
  renderProviderRegistry,
  selectRenderProvider,
} from "../apps/worker/src/render-providers";

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

function request(overrides: Partial<RenderRequest> = {}): RenderRequest {
  const renderSpecification: RenderRequest["renderSpecification"] = {
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
    deterministicKey: renderFingerprint(editPlan),
  };
  return {
    contractVersion: "1",
    renderSpecification,
    creativeDraftReferences: [
      { creativeId: "creative-1", stableKey: "draft-key" },
    ],
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
    retry: {
      attempt: 1,
      deterministicKey: renderFingerprint({
        creativeId: "creative-1",
        renderSpecification: renderSpecification.deterministicKey,
      }),
    },
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
      cacheOutputUri: "cache.mp4",
      coverOutputUri: "cover.jpg",
    },
    cover: { sourceAssetId: "asset-1", atSec: 1 },
    sourceDurationSec: 10,
    legacyEditPlan: editPlan,
    unknownFields: { futureFlag: true },
    ...overrides,
  };
}

describe("PR-3A.4A Render Provider Interface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderVideo.mockResolvedValue({ usedCache: false });
    probeVideo.mockResolvedValue({
      durationSec: 10,
      width: 720,
      height: 1280,
      codec: "h264",
    });
  });

  it("registers, selects, and validates provider capabilities", () => {
    const registry = new RenderProviderRegistry();
    const provider: RenderProvider = {
      id: "test",
      version: "1",
      capabilities: () => new Set(["VIDEO"]),
      execute: vi.fn(),
    };
    registry.register(provider, { makeDefault: true });

    expect(registry.get("test")).toBe(provider);
    expect(registry.select(["VIDEO"])).toBe(provider);
    expect(() => registry.select(["COVER"])).toThrow("lacks capabilities");
    expect(() => registry.register(provider)).toThrow("already registered");
  });

  it("serializes provider-independent requests and preserves unknown fields", () => {
    const input = request();
    const restored = deserializeRenderRequest(serializeRenderRequest(input));

    expect(restored).toEqual(input);
    expect(restored.unknownFields).toEqual({ futureFlag: true });
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.renderSpecification)).toBe(true);
    expect(JSON.stringify(restored)).not.toContain("ffmpeg");
  });

  it("serializes canonical results", () => {
    const result: RenderResult = {
      contractVersion: "1",
      status: "COMPLETED",
      outputReferences: [
        { uri: "output.mp4", mediaType: "video", role: "output" },
      ],
      previewReferences: [],
      coverReferences: [],
      durationSec: 10,
      resolution: { width: 720, height: 1280 },
      fingerprint: "fingerprint",
      providerMetadata: {
        providerId: "test",
        providerVersion: "1",
      },
      correlation: inputCorrelation(),
      warnings: [],
      provenance: [
        {
          providerId: "test",
          sourceAssetIds: ["asset-1"],
          renderSpecificationKey: "render-key",
          correlationId: "correlation-1",
          timestamp: "2026-07-25T00:00:00.000Z",
        },
      ],
      usedCache: false,
      unknownFields: { futureResult: true },
    };

    expect(deserializeRenderResult(serializeRenderResult(result))).toEqual(
      result
    );
  });

  it("adapts the unchanged legacy renderer behind RenderProvider", async () => {
    const provider = new FFmpegRenderProvider();
    const progress = vi.fn();
    const result = await provider.execute(request(), progress);

    expect(renderVideo).toHaveBeenCalledOnce();
    expect(renderVideo).toHaveBeenCalledWith(
      expect.any(Map),
      editPlan,
      "output.mp4",
      "preview",
      expect.objectContaining({
        cacheOutputPath: "cache.mp4",
        profileKey: "preview",
        onProgress: progress,
      })
    );
    expect(extractCover).toHaveBeenCalledWith(
      "source.mp4",
      1,
      "cover.jpg"
    );
    expect(result).toMatchObject({
      status: "COMPLETED",
      usedCache: false,
      providerMetadata: { providerId: "legacy-ffmpeg" },
      fileSizeBytes: 2048,
    });
  });

  it("selects the production provider through the registry", () => {
    expect(renderProviderRegistry.get("legacy-ffmpeg")).toBeInstanceOf(
      FFmpegRenderProvider
    );
    expect(selectRenderProvider(["VIDEO", "CACHE"]).id).toBe(
      "legacy-ffmpeg"
    );
  });

  it("keeps retry fingerprints deterministic without executing twice", () => {
    const first = request();
    const second = request({ retry: { ...first.retry, attempt: 2 } });

    expect(first.retry.deterministicKey).toBe(
      second.retry.deterministicKey
    );
    expect(renderFingerprint(first.renderSpecification)).toBe(
      renderFingerprint(second.renderSpecification)
    );
  });
});

function inputCorrelation(): RenderRequest["correlation"] {
  return {
    taskId: "task-1",
    creativeId: "creative-1",
    campaignId: "campaign-1",
    workspaceId: "workspace-1",
    orgId: "org-1",
    correlationId: "correlation-1",
  };
}
