import { createHash } from "node:crypto";
import type {
  CampaignAIContext,
  CopyLocale,
  CopyVariant,
  EditPlan,
  Platform,
  PresetProfile,
  SubtitleTimelineSegment,
  VisionAnalysis,
  VoicePreset,
} from "@ceo-agent/shared";
import {
  getBgmTrackById,
  resolveBgmStartOffsetSec,
} from "@ceo-agent/shared";
import type { AutoClipSegment } from "./auto-clip";
import {
  attachAutoClipVoiceover,
  buildStandaloneClipEditPlan,
} from "./auto-clip";
import type { AutoClipVariantDef } from "./auto-clip-variants";
import type { BgmRecommendation } from "@ceo-agent/shared";
import {
  attachVoiceover,
  buildImageMontageEditPlan,
  buildMixedMontageEditPlan,
} from "./motion-compose";
import { runEditDirectorAgent } from "./edit";
import { applyVoicePreset } from "./voice-preset";
import type { VideoPipelineResult } from "./video-pipeline-contract";
import type {
  MergedCampaignContext,
  PipelineExecutionResult,
  PipelineProvenance,
  PipelineWarning,
} from "./workflow-contracts";

export const COMPOSITION_CONTRACT_VERSION = "1" as const;

export interface NormalizedTimelineEntry {
  readonly startSec: number;
  readonly endSec: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RenderSpecification {
  readonly contractVersion: typeof COMPOSITION_CONTRACT_VERSION;
  readonly assets: readonly {
    assetId: string;
    sourceStartSec: number;
    sourceEndSec: number;
    timelineStartSec: number;
    timelineEndSec: number;
  }[];
  readonly tracks: {
    video: readonly NormalizedTimelineEntry[];
    subtitle: readonly NormalizedTimelineEntry[];
    voiceover: readonly NormalizedTimelineEntry[];
    bgm: readonly NormalizedTimelineEntry[];
  };
  readonly effects: readonly Readonly<Record<string, unknown>>[];
  readonly transitions: readonly NormalizedTimelineEntry[];
  readonly timing: {
    timeBase: "seconds";
    durationSec: number;
  };
  readonly output: {
    format: "mp4";
    previewResolution: string;
    exportResolution: string;
    aspectRatio: string;
    frameRate: number;
    videoBitrateTargetsKbps: { preview: number; export: number };
    audio: {
      codec: "aac";
      sampleRateHz: number;
      channels: number;
      bitrateKbps: number;
    };
  };
  readonly deterministicKey: string;
}

export interface CompositionCreativeDraft {
  readonly stableKey: string;
  readonly creativeId: string;
  readonly status: "draft";
  readonly editPlan: EditPlan;
  readonly renderSpecification: RenderSpecification;
}

export interface CompositionResult {
  readonly contractVersion: typeof COMPOSITION_CONTRACT_VERSION;
  readonly pipelineType: "VIDEO_COMPOSITION";
  readonly state: "COMPLETED";
  readonly checkpoint: "VIDEO_COMPOSITION_COMPLETE";
  readonly creativeDrafts: readonly CompositionCreativeDraft[];
  readonly warnings: readonly PipelineWarning[];
  readonly provenance: readonly PipelineProvenance[];
  readonly deterministicKey: string;
}

export interface CreativeDraftRegistration {
  stableKey: string;
  index: number;
  editPlan: EditPlan;
  renderSpecification: RenderSpecification;
  copyVariants: CopyVariant[];
  selectedCopyId?: string;
  selectedHookId?: string;
}

export interface CompositionRegistry {
  registerDraft(input: CreativeDraftRegistration): Promise<{ creativeId: string }>;
}

interface CompositionBaseInput {
  videoResult?: VideoPipelineResult;
  mergedContext: MergedCampaignContext;
  marketingResult: PipelineExecutionResult;
  registry: CompositionRegistry;
  resumeResult?: CompositionResult;
  persistCheckpoint?: (
    checkpoint: "VIDEO_COMPOSITION_COMPLETE",
    result: CompositionResult
  ) => Promise<void>;
}

export interface AutoClipCompositionEntry {
  segment: AutoClipSegment;
  copyVariants: CopyVariant[];
  clipVariant: AutoClipVariantDef;
  platform: CopyVariant["platform"];
  bgmRecommendation: BgmRecommendation;
  voiceLocale: CopyLocale;
  subtitleTimeline?: SubtitleTimelineSegment[];
}

export interface AutoClipCompositionInput extends CompositionBaseInput {
  mode: "AUTO_CLIP";
  sourceAssetId: string;
  entries: AutoClipCompositionEntry[];
  vision: VisionAnalysis;
  voicePreset?: VoicePreset | null;
  bgmStartPreference?: "auto" | "start" | "middle" | null;
}

export interface GeneralCompositionInput extends CompositionBaseInput {
  mode: "GENERAL";
  campaignContext: CampaignAIContext;
  vision: VisionAnalysis;
  preset: PresetProfile;
  copyVariants: CopyVariant[];
  platforms: Platform[];
  campaignGoal: string;
  campaignName: string;
  videoAsset?: { id: string; durationSec: number };
  imageAssetIds: string[];
  subtitleTimeline?: SubtitleTimelineSegment[];
  voicePreset?: VoicePreset | null;
  selectedCopyId?: string;
  selectedHookId?: string;
}

export type CompositionPipelineInput =
  | AutoClipCompositionInput
  | GeneralCompositionInput;

interface BuiltCompositionPlan {
  editPlan: EditPlan;
  copyVariants: CopyVariant[];
  selectedCopyId?: string;
  selectedHookId?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function fingerprint(namespace: string, value: unknown): string {
  return createHash("sha256")
    .update(`${namespace}:`)
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function timelineEntry(
  startSec: number,
  endSec: number,
  type: string,
  payload: Record<string, unknown>
): NormalizedTimelineEntry {
  return {
    startSec: Math.max(0, startSec),
    endSec: Math.max(startSec, endSec),
    type,
    payload,
  };
}

export function buildRenderSpecification(editPlan: EditPlan): RenderSpecification {
  let timelineCursor = 0;
  const assets = editPlan.clips.map((clip) => {
    const duration =
      clip.outputDurationSec ?? Math.max(0, clip.endSec - clip.startSec);
    const entry = {
      assetId: clip.assetId,
      sourceStartSec: clip.startSec,
      sourceEndSec: clip.endSec,
      timelineStartSec: timelineCursor,
      timelineEndSec: timelineCursor + duration,
    };
    timelineCursor += duration;
    return entry;
  });
  const video = assets.map((asset, index) =>
    timelineEntry(asset.timelineStartSec, asset.timelineEndSec, "video", {
      ...asset,
      clip: editPlan.clips[index],
    })
  );
  const subtitle = editPlan.subtitles.map((item) =>
    timelineEntry(item.startSec, item.endSec, "subtitle", {
      text: item.text,
      style: item.style,
    })
  );
  const voiceover = (editPlan.audio.voiceover?.segments ?? []).map((item) =>
    timelineEntry(item.startSec, item.endSec, "voiceover", {
      text: item.text,
      locale: editPlan.audio.voiceover?.locale,
      voice: editPlan.audio.voiceover?.voice,
    })
  );
  const bgm = editPlan.audio.bgm
    ? [
        timelineEntry(0, editPlan.targetDurationSec, "bgm", {
          trackId: editPlan.audio.bgm,
          startOffsetSec: editPlan.audio.bgmStartOffsetSec ?? 0,
          normalize: editPlan.audio.normalize,
        }),
      ]
    : [];
  const effects = (editPlan.effects ?? []).map((effect) => ({
    ...(effect as unknown as Record<string, unknown>),
  }));
  const transitions = effects
    .filter((effect) =>
      String(effect.type ?? "").toLowerCase().includes("transition")
    )
    .map((effect, index) =>
      timelineEntry(
        Number(effect.startSec ?? index),
        Number(effect.endSec ?? Number(effect.startSec ?? index) + 0.3),
        "transition",
        effect
      )
    );
  const body = {
    contractVersion: COMPOSITION_CONTRACT_VERSION,
    assets,
    tracks: { video, subtitle, voiceover, bgm },
    effects,
    transitions,
    timing: {
      timeBase: "seconds" as const,
      durationSec: editPlan.targetDurationSec,
    },
    output: {
      format: "mp4" as const,
      previewResolution: editPlan.outputResolution.preview,
      exportResolution: editPlan.outputResolution.export,
      aspectRatio: editPlan.aspectRatio,
      frameRate: 30,
      videoBitrateTargetsKbps: { preview: 2_500, export: 8_000 },
      audio: {
        codec: "aac" as const,
        sampleRateHz: 48_000,
        channels: 2,
        bitrateKbps: 192,
      },
    },
  };
  return {
    ...body,
    deterministicKey: fingerprint("render-spec-v1", body),
  };
}

function assertInputs(input: CompositionPipelineInput): void {
  if (
    input.videoResult &&
    (input.videoResult.state !== "PARTIALLY_COMPLETE" ||
      input.videoResult.phase !== "READY_FOR_MARKETING" ||
      input.videoResult.checkpoint !== "VIDEO_READY_FOR_MARKETING")
  ) {
    throw new Error(
      "Composition requires a READY_FOR_MARKETING Video understanding result"
    );
  }
  if (input.marketingResult.pipelineType !== "MARKETING") {
    throw new Error("Composition requires a normalized Marketing result");
  }
  if (!input.mergedContext.deterministicKey) {
    throw new Error("Composition requires canonical Merge Context");
  }
}

async function buildAutoClipPlans(
  input: AutoClipCompositionInput
): Promise<BuiltCompositionPlan[]> {
  return input.entries.map((entry) => {
    let editPlan = buildStandaloneClipEditPlan({
      assetId: input.sourceAssetId,
      segment: entry.segment,
      copyVariants: entry.copyVariants,
      clipVariant: entry.clipVariant,
      platform: entry.platform,
      bgmKey: entry.bgmRecommendation.trackId,
      bgmRecommendation: entry.bgmRecommendation,
      vision: input.vision,
      subtitleTimeline: entry.subtitleTimeline,
    });
    editPlan = attachAutoClipVoiceover(
      editPlan,
      entry.copyVariants,
      entry.voiceLocale,
      entry.subtitleTimeline
    );
    editPlan = applyVoicePreset(editPlan, input.voicePreset ?? undefined);
    const bgmTrack = getBgmTrackById(entry.bgmRecommendation.trackId);
    editPlan = {
      ...editPlan,
      audio: {
        ...editPlan.audio,
        bgmStartOffsetSec: resolveBgmStartOffsetSec(
          bgmTrack?.durationSec ?? 120,
          editPlan.targetDurationSec,
          input.bgmStartPreference ?? "auto"
        ),
      },
    };
    const primary =
      entry.copyVariants.find(
        (variant) => variant.locale === entry.voiceLocale
      ) ?? entry.copyVariants[0];
    return {
      editPlan,
      copyVariants: entry.copyVariants,
      selectedCopyId: primary?.id,
    };
  });
}

async function buildGeneralPlan(
  input: GeneralCompositionInput
): Promise<BuiltCompositionPlan[]> {
  let editPlan: EditPlan;
  if (input.videoAsset && input.imageAssetIds.length > 0) {
    editPlan = buildMixedMontageEditPlan({
      vision: input.vision,
      preset: input.preset,
      copyVariants: input.copyVariants,
      videoAssetId: input.videoAsset.id,
      imageAssetIds: input.imageAssetIds,
      sourceDurationSec: input.videoAsset.durationSec,
    });
  } else if (input.videoAsset) {
    const execution = await runEditDirectorAgent({
      campaignContext: input.campaignContext,
      vision: input.vision,
      copyVariants: input.copyVariants,
      preset: input.preset,
      assetId: input.videoAsset.id,
      durationSec: input.videoAsset.durationSec,
      campaignName: input.campaignName,
    });
    editPlan = execution.editPlan;
  } else {
    editPlan = buildImageMontageEditPlan({
      vision: input.vision,
      preset: input.preset,
      copyVariants: input.copyVariants,
      imageAssetIds: input.imageAssetIds,
    });
  }
  editPlan = attachVoiceover(
    editPlan,
    input.copyVariants,
    input.platforms,
    input.campaignGoal,
    input.subtitleTimeline
  );
  editPlan = applyVoicePreset(editPlan, input.voicePreset ?? undefined);
  return [
    {
      editPlan,
      copyVariants: input.copyVariants,
      selectedCopyId: input.selectedCopyId,
      selectedHookId: input.selectedHookId,
    },
  ];
}

export async function runCompositionPipeline(
  input: CompositionPipelineInput
): Promise<CompositionResult> {
  assertInputs(input);
  if (input.resumeResult) return input.resumeResult;

  const plans: BuiltCompositionPlan[] =
    input.mode === "AUTO_CLIP"
      ? await buildAutoClipPlans(input)
      : await buildGeneralPlan(input);
  const creativeDrafts: CompositionCreativeDraft[] = [];

  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index]!;
    const renderSpecification = buildRenderSpecification(plan.editPlan);
    const stableKey = fingerprint("composition-draft-v1", {
      mode: input.mode,
      index,
      merge: input.mergedContext.deterministicKey,
      marketing: input.marketingResult.deterministicKey,
      render: renderSpecification.deterministicKey,
    });
    const registration = await input.registry.registerDraft({
      stableKey,
      index,
      editPlan: plan.editPlan,
      renderSpecification,
      copyVariants: plan.copyVariants,
      selectedCopyId: plan.selectedCopyId,
      selectedHookId: plan.selectedHookId,
    });
    creativeDrafts.push({
      stableKey,
      creativeId: registration.creativeId,
      status: "draft",
      editPlan: plan.editPlan,
      renderSpecification,
    });
  }

  const resultBody = {
    contractVersion: COMPOSITION_CONTRACT_VERSION,
    pipelineType: "VIDEO_COMPOSITION" as const,
    state: "COMPLETED" as const,
    checkpoint: "VIDEO_COMPOSITION_COMPLETE" as const,
    creativeDrafts,
    warnings: input.mergedContext.warnings,
    provenance: input.mergedContext.provenance,
  };
  const result: CompositionResult = {
    ...resultBody,
    deterministicKey: fingerprint("composition-result-v1", resultBody),
  };
  await input.persistCheckpoint?.("VIDEO_COMPOSITION_COMPLETE", result);
  return result;
}
