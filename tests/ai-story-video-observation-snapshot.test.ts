import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_STORY_RETRY_PROVIDER_MODES,
  AI_STORY_SCENE_EXECUTION_MODES,
  AI_STORY_SCENE_GENERATION_STRATEGIES,
  AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
  AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
  AI_STORY_VIDEO_OBSERVATION_PROMPT,
  DIRECTOR_INTEGRATION,
  RAW_VIDEO_OBSERVATION_EXTRACTION,
  RAW_VIDEO_OBSERVATION_EXTRACTOR,
  SOURCE_PHOTO_EXCLUDED_FROM_VIDEO_PROVIDER,
  AiStoryVideoAssetObservationSchema,
  classifyAiStoryVideoAssetAnalysis,
  mergeTrustedVideoObservation,
  routeAiStoryVideoPlanningStrategy,
  sourcePhotoSentToVideoProviderForDna,
  videoObservationInputFingerprint,
  type AiStoryVideoAnalysisReuseKey,
  type AiStoryVideoAnalysisSnapshotRecord,
  type AiStoryVideoAnalysisSnapshotRepository,
} from "@ceo-agent/shared";
import {
  AiStoryVideoAnalysisServiceError,
  ensureAiStoryVideoAssetAnalysis,
  extractOpenAiVideoObservation,
  type AuthorizedVideoAsset,
  type PreparedVideoObservationMedia,
  type VideoObservationExtractorResult,
} from "../packages/agents/src/ai-story/video-observation-service";

const id = (n: number) => `d5000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `sha256:${"ab".repeat(32)}`;
const otherHash = `sha256:${"cd".repeat(32)}`;

function asset(overrides?: Partial<AuthorizedVideoAsset>): AuthorizedVideoAsset {
  return {
    assetId: id(1),
    orgId: id(2),
    workspaceId: id(3),
    storagePath: `${id(3)}/clip.mp4`,
    contentHash: hash,
    mimeType: "video/mp4",
    mediaType: "video",
    durationSec: 4,
    width: 720,
    height: 1280,
    fps: null,
    deletedAt: null,
    ...overrides,
  };
}

function modelFacts(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    shotCountEstimate: 1,
    dominantShotType: "MEDIUM",
    cameraMotion: "STATIC",
    compositionStability: "STABLE",
    framingSummary: "Hands writing on a notebook.",
    oneContinuousShot: true,
    abruptCuts: false,
    primaryActionSummary: "A person writes an invoice by hand.",
    actionTags: ["WRITING"],
    actionReferenceStrength: true,
    handMotionImportant: true,
    bodyPostureImportant: true,
    interactionTimingImportant: false,
    environmentSummary: "A plain desk without a distinctive place.",
    environmentTags: ["OFFICE_DESK"],
    environmentReferenceStrength: false,
    layoutImportant: false,
    lightingMoodImportant: false,
    signageIdentityVisible: false,
    backgroundClutterImportant: false,
    visiblePeopleEstimate: 1,
    primaryPersonPresent: true,
    personCentric: true,
    humanIsReplaceableActionReference: true,
    identityFidelityImportant: false,
    strictMotionPreservationMatters: false,
    strictTimelinePreservationMatters: false,
    strictShotStructureMatters: false,
    subjectReplacementLikely: false,
    canUseAsExistingVideo: false,
    existingVideoSuitabilityReason: "The clip is source material for a new generation.",
    requiresGenerationToBeUseful: true,
    qualityRiskFlags: [],
    ...overrides,
  };
}

class MemoryVideoAnalysisRepository implements AiStoryVideoAnalysisSnapshotRepository {
  readonly snapshots = new Map<string, AiStoryVideoAnalysisSnapshotRecord>();
  private readonly claims = new Map<string, {
    claimId: string;
    status: "CLAIMED" | "SUCCEEDED" | "FAILED";
    snapshot: AiStoryVideoAnalysisSnapshotRecord | null;
    waiters: Array<(value: { snapshot: AiStoryVideoAnalysisSnapshotRecord | null; failed: boolean }) => void>;
  }>();

  async findSucceededSnapshot(key: AiStoryVideoAnalysisReuseKey) {
    return this.snapshots.get(videoObservationInputFingerprint(key)) ?? null;
  }

  async tryClaim(input: AiStoryVideoAnalysisReuseKey & { readonly orgId: string }) {
    const key = videoObservationInputFingerprint(input);
    const current = this.claims.get(key);
    if (this.snapshots.has(key) || current?.status === "CLAIMED" || current?.status === "SUCCEEDED") {
      return { acquired: false as const };
    }
    const claimId = randomUUID();
    this.claims.set(key, { claimId, status: "CLAIMED", snapshot: null, waiters: [] });
    return { acquired: true as const, claimId };
  }

  async waitForSettlement(key: AiStoryVideoAnalysisReuseKey) {
    const fingerprint = videoObservationInputFingerprint(key);
    const stored = this.snapshots.get(fingerprint);
    if (stored) return { snapshot: stored, failed: false };
    const current = this.claims.get(fingerprint);
    if (!current || current.status === "FAILED") return { snapshot: null, failed: true };
    if (current.status === "SUCCEEDED") return { snapshot: current.snapshot, failed: false };
    return new Promise<{ snapshot: AiStoryVideoAnalysisSnapshotRecord | null; failed: boolean }>((resolve) => {
      current.waiters.push(resolve);
    });
  }

  async insertSnapshot(row: AiStoryVideoAnalysisSnapshotRecord) {
    const key = videoObservationInputFingerprint(row);
    const existing = this.snapshots.get(key);
    if (existing) return existing;
    this.snapshots.set(key, row);
    return row;
  }

  async completeClaim(claimId: string, snapshotId: string) {
    for (const claim of this.claims.values()) {
      if (claim.claimId !== claimId) continue;
      claim.status = "SUCCEEDED";
      claim.snapshot = [...this.snapshots.values()].find((row) => row.id === snapshotId) ?? null;
      const waiters = claim.waiters.splice(0);
      for (const waiter of waiters) waiter({ snapshot: claim.snapshot, failed: false });
    }
  }

  async failClaim(claimId: string) {
    for (const claim of this.claims.values()) {
      if (claim.claimId !== claimId) continue;
      claim.status = "FAILED";
      const waiters = claim.waiters.splice(0);
      for (const waiter of waiters) waiter({ snapshot: null, failed: true });
    }
  }
}

function harness(current = asset()) {
  const repository = new MemoryVideoAnalysisRepository();
  const library = new Map<string, AuthorizedVideoAsset>([[`${current.workspaceId}:${current.assetId}`, current]]);
  let providerCalls = 0;
  const prepare = vi.fn(async (): Promise<PreparedVideoObservationMedia> => ({
    frames: [{ atSec: 0.5, dataUrl: "data:image/jpeg;base64,frame" }],
    transcriptSummary: "A person mentions an invoice.",
  }));
  const extract = vi.fn(async (): Promise<VideoObservationExtractorResult> => {
    providerCalls += 1;
    return {
      raw: modelFacts(),
      providerId: "openai",
      modelId: "gpt-4o",
      providerRequestId: null,
      costUsd: 0,
    };
  });
  const ensure = (input?: {
    readonly campaignId?: string;
    readonly episodeId?: string;
    readonly workspaceId?: string;
    readonly contentHash?: string;
  }) => ensureAiStoryVideoAssetAnalysis({
    orgId: current.orgId,
    workspaceId: input?.workspaceId ?? current.workspaceId,
    assetId: current.assetId,
    contentHash: input?.contentHash ?? current.contentHash,
    planningContext: { campaignId: input?.campaignId, episodeId: input?.episodeId },
    findAsset: async (requested) => {
      const found = library.get(`${requested.workspaceId}:${requested.assetId}`);
      if (!found || found.orgId !== requested.orgId || found.deletedAt) return null;
      return found;
    },
    repository,
    prepareVision: prepare,
    extractObservation: extract,
    now: () => "2026-09-24T00:00:00.000Z",
  });
  return { repository, library, current, prepare, extract, ensure, providerCalls: () => providerCalls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("video observation extraction and durable snapshots", () => {
  it("reuses a valid snapshot without calling the observation provider", async () => {
    const run = harness();
    const first = await run.ensure();
    const second = await run.ensure();
    expect(first.reused).toBe(false);
    expect(first.providerCalls).toBe(1);
    expect(second.reused).toBe(true);
    expect(second.providerCalls).toBe(0);
    expect(second.providerCostUsd).toBe(0);
    expect(run.providerCalls()).toBe(1);
    expect(second.snapshot.id).toBe(first.snapshot.id);
  });

  it("calls the extractor once when the snapshot is missing and stores an immutable snapshot", async () => {
    const run = harness();
    const result = await run.ensure({ campaignId: id(4), episodeId: id(11) });
    expect(run.providerCalls()).toBe(1);
    expect(result.snapshot.analysisType).toBe("AI_STORY_VIDEO");
    expect(result.snapshot.analysis.recommendedReferenceUse).toBe("ACTION_REFERENCE");
    expect(result.snapshot.inputFingerprint).toBe(videoObservationInputFingerprint({
      workspaceId: id(3),
      assetId: id(1),
      assetContentHash: hash,
      analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
      extractorVersion: AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
    }));
    expect(result.snapshot.inputFingerprint).not.toContain(id(4));
    expect(result.snapshot.inputFingerprint).not.toContain(id(11));
    expect(run.repository.snapshots.size).toBe(1);
  });

  it("keeps one paid observation across episodes and campaigns", async () => {
    const run = harness();
    await run.ensure({ campaignId: id(4), episodeId: id(11) });
    await run.ensure({ campaignId: id(4), episodeId: id(12) });
    await run.ensure({ campaignId: id(5), episodeId: id(13) });
    expect(run.providerCalls()).toBe(1);
    expect(run.repository.snapshots.size).toBe(1);
  });

  it("requires a new analysis when the content hash or analysis version changes", async () => {
    const run = harness();
    const first = await run.ensure();
    run.current.contentHash = otherHash;
    const second = await run.ensure();
    expect(run.providerCalls()).toBe(2);
    expect(second.snapshot.assetContentHash).toBe(otherHash);
    expect(first.snapshot.assetContentHash).toBe(hash);
    expect(run.repository.snapshots.size).toBe(2);
    expect(await run.repository.findSucceededSnapshot({
      workspaceId: id(9),
      assetId: id(1),
      assetContentHash: otherHash,
      analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
      extractorVersion: AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
    })).toBeNull();
  });

  it("requires a new analysis when only an older analysis version is stored", async () => {
    const run = harness();
    const staleKey = videoObservationInputFingerprint({
      workspaceId: id(3),
      assetId: id(1),
      assetContentHash: hash,
      analysisVersion: "ai-story-video-asset-analysis.v0",
      extractorVersion: AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
    });
    run.repository.snapshots.set(staleKey, { id: "stale" } as AiStoryVideoAnalysisSnapshotRecord);
    const result = await run.ensure();
    expect(result.reused).toBe(false);
    expect(result.snapshot.analysisVersion).toBe(AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION);
    expect(run.providerCalls()).toBe(1);
    expect(run.repository.snapshots.has(staleKey)).toBe(true);
    expect(run.repository.snapshots.size).toBe(2);
  });

  it("rejects another workspace and does not reuse its analysis", async () => {
    const run = harness();
    await run.ensure();
    await expect(run.ensure({ workspaceId: id(9) })).rejects.toMatchObject({
      code: "VIDEO_ASSET_OUT_OF_SCOPE",
    });
    expect(run.providerCalls()).toBe(1);
  });

  it("takes asset identity from canonical metadata when the model tries to override it", async () => {
    const current = asset();
    const merged = mergeTrustedVideoObservation({
      videoAssetId: current.assetId,
      contentHash: current.contentHash,
      durationMs: 4000,
      durationSec: 4,
      width: current.width!,
      height: current.height!,
      fps: current.fps,
      orgId: current.orgId,
      workspaceId: current.workspaceId,
      analyzedAt: "2026-09-24T00:00:00.000Z",
    }, modelFacts({
      videoAssetId: id(99),
      contentHash: otherHash,
      workspaceId: id(88),
      orgId: id(77),
      width: 2,
      height: 2,
      durationMs: 9000,
      durationSec: 9,
      fps: 60,
      recommendedReferenceUse: "STRICT_V2V_CANDIDATE",
      provider: "runway",
    }));
    expect(merged.videoAssetId).toBe(current.assetId);
    expect(merged.contentHash).toBe(current.contentHash);
    expect(merged.workspaceId).toBe(current.workspaceId);
    expect(merged.orgId).toBe(current.orgId);
    expect(merged.width).toBe(720);
    expect(merged.height).toBe(1280);
    expect(merged.durationMs).toBe(4000);
    expect(merged.durationSec).toBe(4);
    expect(merged.fps).toBeNull();
    expect(AiStoryVideoAssetObservationSchema.parse(merged).videoAssetId).toBe(id(1));
  });

  it("does not persist a successful snapshot for invalid model output or preprocessing failure", async () => {
    const invalidJson = harness();
    invalidJson.extract.mockResolvedValue({
      raw: "not-json",
      providerId: "openai",
      modelId: "gpt-4o",
      providerRequestId: null,
      costUsd: 0,
    });
    await expect(invalidJson.ensure()).rejects.toBeInstanceOf(AiStoryVideoAnalysisServiceError);
    expect(invalidJson.repository.snapshots.size).toBe(0);

    const invalidObservation = harness();
    invalidObservation.extract.mockResolvedValue({
      raw: { shotCountEstimate: 0, inventedStrategy: "V2V" },
      providerId: "openai",
      modelId: "gpt-4o",
      providerRequestId: null,
      costUsd: 0,
    });
    await expect(invalidObservation.ensure()).rejects.toMatchObject({ code: "VIDEO_OBSERVATION_INVALID" });
    expect(invalidObservation.repository.snapshots.size).toBe(0);

    const preparation = harness();
    preparation.prepare.mockRejectedValue(new Error("ffmpeg failed"));
    await expect(preparation.ensure()).rejects.toBeInstanceOf(Error);
    expect(preparation.providerCalls()).toBe(0);
    expect(preparation.repository.snapshots.size).toBe(0);
  });

  it("lets one of two simultaneous requests perform the only observation", async () => {
    const run = harness();
    const [first, second] = await Promise.all([run.ensure(), run.ensure()]);
    expect(run.providerCalls()).toBe(1);
    expect(run.repository.snapshots.size).toBe(1);
    expect(new Set([first.snapshot.id, second.snapshot.id]).size).toBe(1);
    expect([first.reused, second.reused].filter((value) => value === false)).toHaveLength(1);
  });

  it("keeps classification deterministic, including existing-video precedence and strict override", async () => {
    const run = harness();
    run.extract.mockResolvedValue({
      raw: modelFacts({
        canUseAsExistingVideo: true,
        requiresGenerationToBeUseful: false,
        existingVideoSuitabilityReason: "The sampled clip is already usable.",
        strictMotionPreservationMatters: true,
        strictTimelinePreservationMatters: true,
        strictShotStructureMatters: true,
        subjectReplacementLikely: true,
      }),
      providerId: "openai",
      modelId: "gpt-4o",
      providerRequestId: null,
      costUsd: 0,
    });
    const existing = await run.ensure();
    expect(existing.snapshot.analysis.recommendedReferenceUse).toBe("EXISTING_VIDEO");
    const again = classifyAiStoryVideoAssetAnalysis(existing.snapshot.observation);
    expect(again).toEqual(existing.snapshot.analysis);

    const action = classifyAiStoryVideoAssetAnalysis(mergeTrustedVideoObservation({
      videoAssetId: id(1),
      contentHash: hash,
      durationMs: 4000,
      durationSec: 4,
      width: 720,
      height: 1280,
      fps: null,
      orgId: id(2),
      workspaceId: id(3),
      analyzedAt: "2026-09-24T00:00:00.000Z",
    }, modelFacts()));
    expect(routeAiStoryVideoPlanningStrategy({
      analysis: action,
      userIntent: "same video, just replace person",
    }).strategy).toBe("REQUEST_STRICT_V2V_IF_PROVIDER_AVAILABLE");
  });

  it("uses conservative defaults and describes media without choosing a provider strategy", async () => {
    const merged = mergeTrustedVideoObservation({
      videoAssetId: id(1),
      contentHash: hash,
      durationMs: 4000,
      durationSec: 4,
      width: 720,
      height: 1280,
      fps: null,
      orgId: id(2),
      workspaceId: id(3),
      analyzedAt: "2026-09-24T00:00:00.000Z",
    }, {});
    expect(merged.actionReferenceStrength).toBe(false);
    expect(merged.environmentReferenceStrength).toBe(false);
    expect(merged.strictMotionPreservationMatters).toBe(false);
    expect(merged.canUseAsExistingVideo).toBe(false);
    expect(merged.requiresGenerationToBeUseful).toBe(true);
    const seen: { system: string; userText: string; hint: string }[] = [];
    const extracted = await extractOpenAiVideoObservation({
      prepared: {
        frames: [{ atSec: 1.25, dataUrl: "data:image/jpeg;base64,frame" }],
        transcriptSummary: "A short spoken line.",
      },
      callVision: async (system, userText, _images, hint) => {
        seen.push({ system, userText, hint });
        return { result: modelFacts(), usage: { costUsd: 0 }, providerRequestId: null };
      },
    });
    expect(extracted.providerId).toBe("openai");
    expect(extracted.modelId).toBe("gpt-4o");
    expect(extracted.costUsd).toBe(0);
    expect(seen[0]?.system).toBe(AI_STORY_VIDEO_OBSERVATION_PROMPT);
    expect(seen[0]?.userText).toContain("1.25s");
    expect(seen[0]?.userText.toLowerCase()).not.toContain("seedance");
    expect(seen[0]?.userText.toLowerCase()).not.toContain("runway");
    expect(seen[0]?.hint).not.toContain("recommendedReferenceUse");
  });

  it("leaves T2V, I2V, and Character DNA unchanged and makes no provider call", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const files = [
      "packages/shared/src/ai-story-video-observation-extraction.ts",
      "packages/agents/src/ai-story/video-observation-service.ts",
      "apps/worker/src/media/ai-story-video-analysis-runtime.ts",
      "apps/web/src/app/api/campaigns/[id]/assets/upload-url/route.ts",
    ].map((path) => readFileSync(path, "utf8"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(AI_STORY_SCENE_EXECUTION_MODES).toEqual(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]);
    expect(AI_STORY_SCENE_GENERATION_STRATEGIES).toEqual([
      "TEXT_TO_VIDEO",
      "FIRST_FRAME_IMAGE_TO_VIDEO",
      "PRODUCT_GROUNDED_VIDEO",
    ]);
    expect(AI_STORY_RETRY_PROVIDER_MODES).toEqual(["REFERENCE_FREE_T2V", "FIRST_FRAME_I2V"]);
    expect(SOURCE_PHOTO_EXCLUDED_FROM_VIDEO_PROVIDER).toBe("CERTIFIED");
    expect(sourcePhotoSentToVideoProviderForDna()).toBe(false);
    expect(RAW_VIDEO_OBSERVATION_EXTRACTION).toBe("NOT_IMPLEMENTED");
    expect(RAW_VIDEO_OBSERVATION_EXTRACTOR).toBe("IMPLEMENTED");
    expect(DIRECTOR_INTEGRATION).toBe("NOT_IMPLEMENTED");
    expect(files[2]).toContain("prepareVisionFromStorage");
    expect(files[2]).not.toContain("extractFrameAt");
    expect(files[3]).not.toContain("ensureAiStoryVideoAssetAnalysis");
    for (const source of files) {
      expect(source.toLowerCase()).not.toContain("seedance");
      expect(source.toLowerCase()).not.toContain("runway");
    }
  });
});
