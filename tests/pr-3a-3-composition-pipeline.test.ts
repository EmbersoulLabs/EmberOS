import { describe, expect, it, vi } from "vitest";
import {
  buildCampaignAIContext,
  getPresetProfile,
  type CopyVariant,
  type EditPlan,
  type VisionAnalysis,
} from "@ceo-agent/shared";
import {
  buildRenderSpecification,
  runCompositionPipeline,
} from "../packages/agents/src/composition-pipeline";
import { createVideoPipelineResult } from "../packages/agents/src/video-pipeline-contract";
import { videoUnderstandingAsPipelineResult } from "../packages/agents/src/video-understanding-pipeline";
import { mergePipelineContext } from "../packages/agents/src/merge-context";
import { adaptMarketingPipelineResult } from "../packages/agents/src/pipeline-adapters";
import { AUTO_CLIP_VARIANTS } from "../packages/agents/src/auto-clip-variants";

const context = buildCampaignAIContext({
  campaignObjective: "Promote a graduation bouquet",
  publishingPlatforms: ["tiktok"],
  targetAudience: "Graduating students",
  campaignBrief: "Celebrate the milestone with flowers.",
  workspaceLanguage: "en",
});

const vision: VisionAnalysis = {
  assetId: "asset-video-1",
  mediaType: "video",
  durationSec: 45,
  subjects: ["graduate"],
  scenes: [
    {
      startSec: 0,
      endSec: 15,
      description: "Graduate receives flowers",
    },
  ],
  products: [{ name: "Graduation bouquet" }],
  hooks: ["Celebrate the milestone"],
  transcriptSummary: "Celebrate graduation with flowers.",
  suggestedMoments: [
    { startSec: 0, endSec: 15, reason: "Product reveal" },
  ],
  confidence: 0.9,
};

const copy: CopyVariant = {
  id: "copy-en",
  template: "story",
  hook: "Celebrate every milestone",
  body: "A graduation bouquet made for the moment.",
  cta: "Order today",
  title: "Graduation Flowers",
  tags: ["graduation", "flowers"],
  platform: "tiktok",
  locale: "en",
};

const videoResult = createVideoPipelineResult({
  state: "PARTIALLY_COMPLETE",
  phase: "READY_FOR_MARKETING",
  checkpoint: "VIDEO_READY_FOR_MARKETING",
  sourceAssets: [
    {
      assetId: "asset-video-1",
      mimeType: "video/mp4",
      storagePath: "workspace/video.mp4",
    },
  ],
  metadata: { durationSec: 45 },
  transcript: { summary: vision.transcriptSummary },
  sceneAnalysis: vision.scenes,
  selectedHighlights: [
    {
      startSec: 0,
      endSec: 15,
      attentionScore: 80,
      engagementScore: 75,
      conversionScore: 70,
      educationalScore: 40,
      brandScore: 85,
      deadAir: false,
      reason: "Product reveal",
    },
  ],
  creativeReferences: [],
  renderReferences: [],
  warnings: [
    {
      code: "VIDEO_RENDER_PENDING",
      message: "Rendering remains pending.",
      retryable: false,
    },
  ],
  confidence: { overall: 0.9 },
  provenance: [
    {
      source: "vision_analysis",
      pipelineType: "VIDEO",
      assetId: "asset-video-1",
    },
  ],
});

const mergedContext = mergePipelineContext(context, [
  videoUnderstandingAsPipelineResult(videoResult),
]);
const marketingResult = adaptMarketingPipelineResult({
  hook: copy.hook,
  caption: copy.body,
  cta: copy.cta,
});

const bgmRecommendation = {
  trackId: "uplifting-corporate",
  trackName: "Uplifting Corporate",
  category: "uplifting" as const,
  confidenceScore: 0.9,
  reason: "Matches a celebratory campaign",
  benefits: ["Positive energy"],
  alternatives: [],
  analysis: {
    energyLevel: "medium" as const,
    emotionalTone: "uplifting" as const,
    contentType: "sales" as const,
    industry: "florist",
    pacing: "medium" as const,
    platformFit: "tiktok",
  },
  license: "royalty_free" as const,
};

describe("PR-3A.3 Composition Pipeline", () => {
  it("normalizes EditPlan tracks into a provider-agnostic Render Specification", () => {
    const editPlan: EditPlan = {
      aspectRatio: "9:16",
      targetDurationSec: 10,
      outputResolution: { preview: "720x1280", export: "1080x1920" },
      clips: [
        {
          assetId: "asset-video-1",
          startSec: 2,
          endSec: 12,
          speed: 1,
          outputDurationSec: 10,
        },
      ],
      subtitles: [
        { startSec: 0, endSec: 4, text: "Celebrate", style: "bold_center" },
      ],
      cover: { atSec: 0.5 },
      audio: {
        keepOriginal: false,
        normalize: true,
        bgm: "uplifting-corporate",
        voiceover: {
          enabled: true,
          locale: "en",
          segments: [
            { startSec: 0, endSec: 8, text: "Celebrate graduation." },
          ],
        },
      },
      effects: [],
    };

    const spec = buildRenderSpecification(editPlan);

    expect(spec.timing).toEqual({ timeBase: "seconds", durationSec: 10 });
    expect(spec.assets[0]).toMatchObject({
      assetId: "asset-video-1",
      timelineStartSec: 0,
      timelineEndSec: 10,
    });
    expect(spec.tracks.subtitle).toHaveLength(1);
    expect(spec.tracks.voiceover).toHaveLength(1);
    expect(spec.tracks.bgm).toHaveLength(1);
    expect(spec.output).toMatchObject({
      format: "mp4",
      aspectRatio: "9:16",
      frameRate: 30,
    });
    expect(JSON.stringify(spec).toLowerCase()).not.toContain("ffmpeg");
    expect(spec.deterministicKey).toHaveLength(64);
  });

  it("builds Auto Clip plans, registers stable drafts, and persists the checkpoint", async () => {
    const registrations: Array<{ stableKey: string; index: number }> = [];
    const persistCheckpoint = vi.fn();
    const result = await runCompositionPipeline({
      mode: "AUTO_CLIP",
      videoResult,
      mergedContext,
      marketingResult,
      sourceAssetId: "asset-video-1",
      vision,
      entries: [
        {
          segment: { startSec: 0, endSec: 15, reason: "Product reveal" },
          copyVariants: [copy],
          clipVariant: AUTO_CLIP_VARIANTS[0]!,
          platform: "tiktok",
          bgmRecommendation,
          voiceLocale: "en",
        },
      ],
      registry: {
        registerDraft: async ({ stableKey, index }) => {
          registrations.push({ stableKey, index });
          return { creativeId: "creative-draft-1" };
        },
      },
      persistCheckpoint,
    });

    expect(result).toMatchObject({
      pipelineType: "VIDEO_COMPOSITION",
      state: "COMPLETED",
      checkpoint: "VIDEO_COMPOSITION_COMPLETE",
    });
    expect(result.creativeDrafts[0]).toMatchObject({
      creativeId: "creative-draft-1",
      status: "draft",
    });
    expect(result.creativeDrafts[0]?.editPlan.clips.length).toBeGreaterThan(0);
    expect(result.creativeDrafts[0]?.renderSpecification.tracks.video.length).toBeGreaterThan(0);
    expect(registrations[0]?.stableKey).toHaveLength(64);
    expect(persistCheckpoint).toHaveBeenCalledWith(
      "VIDEO_COMPOSITION_COMPLETE",
      result
    );
  });

  it("produces deterministic draft keys across retry-safe executions", async () => {
    const keys: string[] = [];
    const execute = () =>
      runCompositionPipeline({
        mode: "AUTO_CLIP",
        videoResult,
        mergedContext,
        marketingResult,
        sourceAssetId: "asset-video-1",
        vision,
        entries: [
          {
            segment: { startSec: 0, endSec: 15, reason: "Product reveal" },
            copyVariants: [copy],
            clipVariant: AUTO_CLIP_VARIANTS[0]!,
            platform: "tiktok",
            bgmRecommendation,
            voiceLocale: "en",
          },
        ],
        registry: {
          registerDraft: async ({ stableKey }) => {
            keys.push(stableKey);
            return { creativeId: "creative-draft-1" };
          },
        },
      });

    const first = await execute();
    const second = await execute();

    expect(keys[0]).toBe(keys[1]);
    expect(first.deterministicKey).toBe(second.deterministicKey);
  });

  it("resumes from VIDEO_COMPOSITION_COMPLETE without rebuilding drafts", async () => {
    const registry = { registerDraft: vi.fn() };
    const initial = await runCompositionPipeline({
      mode: "AUTO_CLIP",
      videoResult,
      mergedContext,
      marketingResult,
      sourceAssetId: "asset-video-1",
      vision,
      entries: [
        {
          segment: { startSec: 0, endSec: 15, reason: "Product reveal" },
          copyVariants: [copy],
          clipVariant: AUTO_CLIP_VARIANTS[0]!,
          platform: "tiktok",
          bgmRecommendation,
          voiceLocale: "en",
        },
      ],
      registry: {
        registerDraft: async () => ({ creativeId: "creative-draft-1" }),
      },
    });

    const resumed = await runCompositionPipeline({
      mode: "AUTO_CLIP",
      videoResult,
      mergedContext,
      marketingResult,
      sourceAssetId: "asset-video-1",
      vision,
      entries: [],
      registry,
      resumeResult: initial,
    });

    expect(resumed).toBe(initial);
    expect(registry.registerDraft).not.toHaveBeenCalled();
  });

  it("supports the General production mode through the same Composition boundary", async () => {
    const result = await runCompositionPipeline({
      mode: "GENERAL",
      mergedContext,
      marketingResult,
      campaignContext: context,
      vision,
      preset: getPresetProfile("marketing"),
      copyVariants: [copy],
      platforms: ["tiktok"],
      campaignGoal: context.campaignObjective,
      campaignName: "Graduation Campaign",
      imageAssetIds: ["asset-image-1"],
      selectedCopyId: copy.id,
      registry: {
        registerDraft: async () => ({ creativeId: "creative-general-1" }),
      },
    });

    expect(result.creativeDrafts).toHaveLength(1);
    expect(result.creativeDrafts[0]).toMatchObject({
      creativeId: "creative-general-1",
      status: "draft",
    });
  });

  it("rejects Composition before canonical Marketing output exists", async () => {
    await expect(
      runCompositionPipeline({
        mode: "AUTO_CLIP",
        videoResult,
        mergedContext,
        marketingResult: {
          ...marketingResult,
          pipelineType: "VIDEO",
        },
        sourceAssetId: "asset-video-1",
        vision,
        entries: [],
        registry: {
          registerDraft: async () => ({ creativeId: "never" }),
        },
      })
    ).rejects.toThrow("normalized Marketing result");
  });
});
