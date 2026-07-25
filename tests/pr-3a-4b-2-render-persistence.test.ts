import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CompositionResult } from "@ceo-agent/agents";
import type { EditPlan } from "@ceo-agent/shared";
import {
  RenderPersistence,
  type RenderPersistenceEnvelope,
  type RenderPersistenceStore,
} from "../apps/worker/src/render-persistence";
import { runRenderOrchestrator } from "../apps/worker/src/render-orchestrator";
import type {
  RenderProvider,
  RenderResult,
} from "../apps/worker/src/render-providers/contracts";

const correlation = {
  taskId: "task-1",
  creativeId: "creative-1",
  campaignId: "campaign-1",
  workspaceId: "workspace-1",
  orgId: "org-1",
  correlationId: "correlation-1",
};

function memoryStore(initial: unknown = null) {
  let value = structuredClone(initial);
  const store: RenderPersistenceStore = {
    load: vi.fn(async () => structuredClone(value)),
    transact: vi.fn(async (operation) => {
      const mutation = operation(
        (structuredClone(value) ?? {
          contractVersion: "1",
          checkpoints: {},
          resultsByRequestFingerprint: {},
          fingerprintIndex: {},
          artifactsById: {},
          idempotencyRecords: {},
        }) as RenderPersistenceEnvelope
      );
      value = structuredClone(mutation.envelope);
      return mutation.value;
    }),
  };
  return {
    store,
    read: () => structuredClone(value) as RenderPersistenceEnvelope,
  };
}

function result(overrides: Partial<RenderResult> = {}): RenderResult {
  return {
    contractVersion: "1",
    status: "COMPLETED",
    outputReferences: [
      { uri: "output.mp4", mediaType: "video", role: "output" },
    ],
    previewReferences: [
      { uri: "preview.mp4", mediaType: "video", role: "preview" },
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
    correlation,
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

describe("PR-3A.4B-2 Render Persistence", () => {
  it("saves and loads a canonical RenderResult by request fingerprint", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);

    await persistence.saveRenderResult("request-fingerprint", result());
    const loaded = await persistence.loadRenderResult("request-fingerprint");

    expect(loaded).toMatchObject({
      contractVersion: "1",
      providerId: "test-provider",
      correlationId: "correlation-1",
      requestFingerprint: "request-fingerprint",
      resultFingerprint: "result-fingerprint",
    });
    expect(loaded?.result).toEqual(result());
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded?.result)).toBe(true);
  });

  it("does not persist provider-private fields", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);
    await persistence.saveRenderResult(
      "request-fingerprint",
      result({
        providerMetadata: {
          providerId: "test-provider",
          providerVersion: "1",
          details: { privateHandle: "provider-private" },
        },
        unknownFields: { rawProviderResponse: "private" },
      })
    );

    const stored = memory
      .read()
      .resultsByRequestFingerprint["request-fingerprint"]!.result;
    expect(stored.providerMetadata).not.toHaveProperty("details");
    expect(stored).not.toHaveProperty("unknownFields");
  });

  it("persists only Render-owned checkpoints and resumes them", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);

    await persistence.saveCheckpoint(
      "VIDEO_RENDER_PENDING",
      "WAITING_FOR_DEPENDENCY"
    );
    expect(await persistence.loadResume("unknown")).toEqual({
      resumeFrom: "VIDEO_RENDER_PENDING",
    });

    await persistence.saveCheckpoint("VIDEO_RENDERING", "RUNNING");
    expect(await persistence.loadResume("unknown")).toEqual({
      resumeFrom: "VIDEO_RENDERING",
    });
    expect(Object.keys(memory.read().checkpoints)).toEqual([
      "VIDEO_RENDER_PENDING",
      "VIDEO_RENDERING",
    ]);
  });

  it("registers final, preview, and cover artifacts", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);

    const saved = await persistence.saveRenderResult(
      "request-fingerprint",
      result()
    );
    expect(saved.artifactIds).toHaveLength(3);
    const artifacts = await Promise.all(
      saved.artifactIds.map((id) => persistence.resolveArtifact(id))
    );
    expect(artifacts.map((artifact) => artifact?.role).sort()).toEqual([
      "cover",
      "output",
      "preview",
    ]);
    expect(artifacts[0]).toMatchObject({
      requestFingerprint: "request-fingerprint",
      durationSec: 10,
      resolution: { width: 720, height: 1280 },
    });
  });

  it("maintains an exact request-to-result fingerprint index", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);
    await persistence.saveRenderResult("request-fingerprint", result());

    expect(memory.read().fingerprintIndex).toEqual({
      "request-fingerprint": "result-fingerprint",
    });
    expect(await persistence.loadRenderResult("different")).toBeUndefined();
  });

  it.each([
    ["output reference", { outputReferences: [] }],
    ["result fingerprint", { fingerprint: "" }],
    [
      "provider",
      { providerMetadata: { providerId: "", providerVersion: "1" } },
    ],
    ["provenance", { provenance: [] }],
    [
      "correlation",
      { correlation: { ...correlation, correlationId: "" } },
    ],
    ["contract version", { contractVersion: "2" }],
  ])("rejects invalid persistence without %s", async (_label, override) => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);
    await expect(
      persistence.saveRenderResult(
        "request-fingerprint",
        result(override as Partial<RenderResult>)
      )
    ).rejects.toThrow();
    expect(memory.store.transact).not.toHaveBeenCalled();
  });

  it("rejects a corrupted fingerprint index on load", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);
    await persistence.saveRenderResult("request-fingerprint", result());
    const corrupted = memory.read();
    const corruptStore = memoryStore({
      ...corrupted,
      fingerprintIndex: { "request-fingerprint": "wrong" },
    });

    await expect(
      new RenderPersistence(
        corruptStore.store,
        correlation
      ).loadRenderResult("request-fingerprint")
    ).rejects.toThrow("fingerprint");
  });

  it("reuses persisted canonical results without executing a provider", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);
    const provider: RenderProvider = {
      id: "test-provider",
      version: "1",
      capabilities: () => new Set(["VIDEO"]),
      execute: vi.fn(async () => result()),
    };
    const input = {
      compositionResult: composition(),
      creativeDraftId: "creative-1",
      requestContext: {
        sourceAssets: [
          { assetId: "asset-1", uri: "source.mp4", mediaType: "video" as const },
        ],
        outputProfile: { mode: "preview" as const, profileKey: "preview" },
        qualityProfile: {
          width: 720,
          height: 1280,
          frameRate: 30,
          videoBitrateKbps: 2500,
          audioBitrateKbps: 192,
        },
        retry: { attempt: 1 },
        correlation,
        destinations: {
          outputUri: "output.mp4",
          coverOutputUri: "cover.jpg",
        },
        cover: { sourceAssetId: "asset-1", atSec: 1 },
        legacyEditPlan: editPlan,
      },
      requiredCapabilities: ["VIDEO"] as const,
      persistence,
      selectProvider: () => provider,
    };

    const first = await runRenderOrchestrator(input);
    const second = await runRenderOrchestrator({
      ...input,
      requestContext: {
        ...input.requestContext,
        retry: { attempt: 2 },
      },
    });

    expect(first.renderResult).toEqual(second.renderResult);
    expect(provider.execute).toHaveBeenCalledOnce();
  });

  it("production orchestration rejects a concurrent duplicate provider execution", async () => {
    const memory = memoryStore();
    const persistence = new RenderPersistence(memory.store, correlation);
    let completeProvider!: (value: RenderResult) => void;
    const provider: RenderProvider = {
      id: "test-provider",
      version: "1",
      capabilities: () => new Set(["VIDEO"]),
      execute: vi.fn(
        () =>
          new Promise<RenderResult>((resolve) => {
            completeProvider = resolve;
          })
      ),
    };
    const input = {
      compositionResult: composition(),
      creativeDraftId: "creative-1",
      requestContext: {
        sourceAssets: [
          { assetId: "asset-1", uri: "source.mp4", mediaType: "video" as const },
        ],
        outputProfile: { mode: "preview" as const, profileKey: "preview" },
        qualityProfile: {
          width: 720,
          height: 1280,
          frameRate: 30,
          videoBitrateKbps: 2500,
          audioBitrateKbps: 192,
        },
        retry: { attempt: 1 },
        correlation,
        destinations: {
          outputUri: "output.mp4",
          coverOutputUri: "cover.jpg",
        },
        cover: { sourceAssetId: "asset-1", atSec: 1 },
        legacyEditPlan: editPlan,
      },
      requiredCapabilities: ["VIDEO"] as const,
      persistence,
      selectProvider: () => provider,
    };

    const first = runRenderOrchestrator(input);
    await vi.waitFor(() => expect(provider.execute).toHaveBeenCalledOnce());
    await expect(runRenderOrchestrator(input)).rejects.toThrow(
      "already running"
    );
    expect(provider.execute).toHaveBeenCalledOnce();
    completeProvider(result());
    await first;
  });

  it("keeps persistence outside rendering and downstream lifecycles", () => {
    const source = readFileSync(
      "apps/worker/src/render-persistence.ts",
      "utf8"
    );
    expect(source).not.toContain("renderVideo");
    expect(source).not.toContain("FFmpeg");
    expect(source).not.toContain("createReview");
    expect(source).not.toContain("runCompliance");
    expect(source).not.toContain("MarketingScore");
    expect(source).not.toContain("VIDEO_COMPLETE");
    expect(source).not.toContain("VIDEO_GATES_COMPLETE");
    expect(source).not.toContain("PRODUCT_IMAGE");
  });

  it("production handler delegates canonical persistence creation", () => {
    const source = readFileSync(
      "apps/worker/src/processors/render-handler.ts",
      "utf8"
    );
    expect(source).toContain("createTaskRenderPersistence");
    expect(source).toContain("persistence:");
    expect(source).not.toContain("persistVideoRenderCheckpoint");
  });
});
