import { callJsonModel, callVisionJsonModel } from "./llm";
import { VisionAnalysisSchema, outputLanguagePrompt, isChineseText, type ContentLocale } from "@ceo-agent/shared";
import type { VisionAnalysis } from "@ceo-agent/shared";

export interface VisionFrameInput {
  atSec: number;
  dataUrl: string;
}

export interface VisionInput {
  assetId: string;
  mediaType: "video" | "image";
  durationSec?: number;
  frameDescriptions?: string[];
  /** Base64 data URLs from worker frame extraction */
  frames?: VisionFrameInput[];
  transcriptSummary?: string;
  campaignName?: string;
  goal?: string;
  videoAnalysis?: string | null;
  contentLocale?: ContentLocale;
}

function resolveVisionLocale(input: VisionInput): ContentLocale {
  if (input.contentLocale) return input.contentLocale;
  return isChineseText(`${input.campaignName ?? ""}${input.goal ?? ""}`) ? "zh" : "en";
}

function buildFallbackAnalysis(input: VisionInput): VisionAnalysis {
  const topic = input.campaignName?.trim() || (resolveVisionLocale(input) === "zh" ? "营销素材" : "marketing asset");
  const locale = resolveVisionLocale(input);
  const zh = locale === "zh";

  if (zh) {
    return {
      assetId: input.assetId,
      mediaType: input.mediaType,
      durationSec: input.durationSec,
      subjects: [topic, "产品展示", "场景氛围"],
      scenes: [
        {
          startSec: 0,
          endSec: Math.min(input.durationSec ?? 3, 3),
          description: `${topic}实拍画面，产品与环境展示`,
          emotion: "专业、吸引",
        },
      ],
      products: [{ name: topic, attributes: ["核心卖点", "使用场景"] }],
      hooks: ["第一眼惊艳", "真实体验", "值得入手"],
      primarySubject: { x: 0.5, y: 0.42, label: topic },
      transcriptSummary: input.transcriptSummary,
      suggestedMoments: [
        { startSec: 0, endSec: Math.min(input.durationSec ?? 3, 3), reason: "开场全景与产品特写" },
      ],
      confidence: 0.65,
    };
  }

  return {
    assetId: input.assetId,
    mediaType: input.mediaType,
    durationSec: input.durationSec,
    subjects: [topic, "product showcase", "brand scene"],
    scenes: [
      {
        startSec: 0,
        endSec: input.durationSec ?? 30,
        description: `${topic} showcase with product styling`,
      },
    ],
    products: [{ name: topic }],
    hooks: ["first impression", "real experience", "worth trying"],
    primarySubject: { x: 0.5, y: 0.42, label: topic },
    transcriptSummary: input.transcriptSummary,
    suggestedMoments: [{ startSec: 0, endSec: Math.min(input.durationSec ?? 3, 3), reason: "Opening hero shot" }],
    confidence: 0.65,
  };
}

export async function runVisionAgent(input: VisionInput): Promise<{
  analysis: VisionAnalysis;
  usage: { input: number; output: number; costUsd: number };
}> {
  const locale = resolveVisionLocale(input);
  const hasFrames = (input.frames?.length ?? 0) > 0;

  const system = `You are a Vision Agent analyzing marketing video/image assets for Singapore/SEA markets.
Identify subjects, scenes, products, emotional hooks, and suggested highlight moments for ad creation.
Estimate primarySubject as normalized x/y (0–1) center of the main product or person to keep in frame for vertical video cropping.
${outputLanguagePrompt(locale)}
${hasFrames ? "You are given real frames from the user's own upload — describe only what you see." : "Infer likely visual content from campaign context when frame data is sparse."}
For videos, align scene timestamps with the provided frame atSec values when possible.
Output JSON matching VisionAnalysis schema.`;

  const user = JSON.stringify({
    assetId: input.assetId,
    mediaType: input.mediaType,
    durationSec: input.durationSec,
    campaignName: input.campaignName,
    goal: input.goal,
    frameTimestamps: input.frames?.map((f) => f.atSec) ?? [],
    transcript: input.transcriptSummary,
    legacyFrameNotes: input.frameDescriptions ?? [],
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
  });

  const schemaHint = "VisionAnalysis";

  const { result, usage } = hasFrames
    ? await callVisionJsonModel<unknown>(
        system,
        user,
        input.frames!.map((f) => f.dataUrl),
        schemaHint
      )
    : await callJsonModel<unknown>(system, user, schemaHint);

  const parsed = VisionAnalysisSchema.safeParse(result);

  const analysis: VisionAnalysis = parsed.success
    ? {
        ...parsed.data,
        assetId: input.assetId,
        mediaType: input.mediaType,
        transcriptSummary: parsed.data.transcriptSummary ?? input.transcriptSummary,
      }
    : buildFallbackAnalysis(input);

  return { analysis, usage };
}

export interface WhisperSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export async function transcribeAudioDetailed(
  audioBuffer: Buffer
): Promise<{ text: string; segments: WhisperSegment[] }> {
  const { getOpenAI } = await import("./llm");
  const openai = getOpenAI();
  const file = new File([new Uint8Array(audioBuffer)], "audio.mp3", { type: "audio/mpeg" });
  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const raw = transcription as { text?: string; segments?: Array<{ start: number; end: number; text: string }> };
  const segments = (raw.segments ?? []).map((s) => ({
    startSec: s.start,
    endSec: s.end,
    text: s.text.trim(),
  }));

  return { text: raw.text ?? segments.map((s) => s.text).join(" "), segments };
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const { text } = await transcribeAudioDetailed(audioBuffer);
  return text;
}
