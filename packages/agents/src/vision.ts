import { z } from "zod";
import { callJsonModel, callVisionJsonModel } from "./llm";
import { outputLanguagePrompt, isChineseText, resolveContentSubject, type ContentLocale } from "@ceo-agent/shared";
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
  campaignBrief?: string;
  userNotes?: string;
  videoAnalysis?: string | null;
  contentLocale?: ContentLocale;
}

function resolveVisionLocale(input: VisionInput): ContentLocale {
  if (input.contentLocale) return input.contentLocale;
  const blob = [input.goal, input.campaignBrief, input.userNotes, input.videoAnalysis]
    .filter(Boolean)
    .join("");
  return isChineseText(blob) ? "zh" : "en";
}

const EMPTY_VISION: Pick<VisionAnalysis, "products" | "subjects" | "scenes"> = {
  products: [],
  subjects: [],
  scenes: [],
};

function buildFallbackAnalysis(input: VisionInput): VisionAnalysis {
  const locale = resolveVisionLocale(input);
  const zh = locale === "zh";
  const topic = resolveContentSubject(EMPTY_VISION, {
    goal: input.goal,
    userNotes: input.userNotes,
    campaignBrief: input.campaignBrief,
    videoAnalysis: input.videoAnalysis ?? undefined,
    campaignName: input.campaignName,
    locale,
  });

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

const num = z.coerce.number();
const str = z.coerce.string();

/**
 * Lenient mirror of VisionAnalysisSchema for parsing raw model output.
 * The vision LLM reliably returns the visual fields but routinely omits input
 * metadata (assetId/mediaType) or leaves out suggestedMoments — the strict
 * schema would reject the whole (good) analysis and force the templated
 * fallback. Here every field defaults/coerces so real signal is never lost; we
 * inject assetId/mediaType ourselves afterwards.
 */
const LenientVisionSchema = z
  .object({
    subjects: z.array(str).optional().default([]),
    scenes: z
      .array(
        z.object({
          startSec: num.optional().default(0),
          endSec: num.optional().default(0),
          description: str.optional().default(""),
          emotion: str.optional(),
        })
      )
      .optional()
      .default([]),
    products: z
      .array(
        z.object({
          name: str.optional().default(""),
          attributes: z.array(str).optional(),
        })
      )
      .optional()
      .default([]),
    hooks: z.array(str).optional().default([]),
    transcriptSummary: str.optional(),
    suggestedMoments: z
      .array(
        z.object({
          startSec: num.optional().default(0),
          endSec: num.optional().default(0),
          reason: str.optional().default(""),
        })
      )
      .optional()
      .default([]),
    primarySubject: z
      .object({ x: num.optional(), y: num.optional(), label: str.optional() })
      .optional(),
    confidence: num.optional(),
  })
  .passthrough();

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Unwrap a single nested envelope like { analysis: {...} } the model sometimes adds. */
function unwrapVisionResult(result: unknown): unknown {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    if (!("subjects" in obj) && !("products" in obj) && !("scenes" in obj)) {
      const nested = obj.analysis ?? obj.visionAnalysis ?? obj.result ?? obj.data;
      if (nested && typeof nested === "object") return nested;
    }
  }
  return result;
}

/** Coerce raw model output into a VisionAnalysis, or null when it carries no real visual signal. */
function coerceVisionResult(result: unknown, input: VisionInput): VisionAnalysis | null {
  const parsed = LenientVisionSchema.safeParse(unwrapVisionResult(result));
  if (!parsed.success) return null;
  const d = parsed.data;

  const subjects = d.subjects.map((s) => s.trim()).filter(Boolean);
  const products = d.products
    .map((p) => ({
      name: p.name.trim(),
      attributes: p.attributes?.map((a) => a.trim()).filter(Boolean),
    }))
    .filter((p) => p.name.length > 0);
  const scenes = d.scenes
    .map((s) => ({
      startSec: s.startSec,
      endSec: s.endSec > s.startSec ? s.endSec : s.startSec + 3,
      description: s.description.trim(),
      emotion: s.emotion?.trim() || undefined,
    }))
    .filter((s) => s.description.length > 0);

  // No usable visual signal at all → let the caller use the templated fallback.
  if (subjects.length === 0 && products.length === 0 && scenes.length === 0) {
    return null;
  }

  const suggestedMoments = d.suggestedMoments
    .map((m) => ({
      startSec: m.startSec,
      endSec: m.endSec > m.startSec ? m.endSec : m.startSec + 3,
      reason: m.reason.trim(),
    }))
    .filter((m) => m.reason.length > 0);

  const primarySubject =
    d.primarySubject && d.primarySubject.x != null && d.primarySubject.y != null
      ? {
          x: clamp01(d.primarySubject.x),
          y: clamp01(d.primarySubject.y),
          label: d.primarySubject.label?.trim() || undefined,
        }
      : undefined;

  return {
    assetId: input.assetId,
    mediaType: input.mediaType,
    durationSec: input.durationSec,
    subjects,
    scenes,
    products,
    hooks: d.hooks.map((h) => h.trim()).filter(Boolean),
    transcriptSummary: d.transcriptSummary?.trim() || input.transcriptSummary,
    suggestedMoments,
    primarySubject,
    confidence: d.confidence ?? 0.82,
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
    goal: input.goal,
    ...(input.campaignBrief ? { campaignBrief: input.campaignBrief } : {}),
    ...(input.userNotes ? { userNotes: input.userNotes } : {}),
    frameTimestamps: input.frames?.map((f) => f.atSec) ?? [],
    transcript: input.transcriptSummary,
    legacyFrameNotes: input.frameDescriptions ?? [],
    ...(input.videoAnalysis ? { videoAnalysis: input.videoAnalysis } : {}),
    ...(input.campaignName && !input.goal && !input.campaignBrief && !input.userNotes && !input.videoAnalysis
      ? { campaignLabel: input.campaignName }
      : {}),
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

  const coerced = coerceVisionResult(result, input);
  if (!coerced) {
    console.warn(
      `[vision] model output had no usable visual signal (hasFrames=${hasFrames}, asset=${input.assetId}) — using templated fallback`
    );
  }
  const analysis: VisionAnalysis = coerced ?? buildFallbackAnalysis(input);

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
