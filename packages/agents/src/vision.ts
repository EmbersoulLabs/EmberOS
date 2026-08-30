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

function ensureStringArray(val: unknown): string[] {
  if (typeof val === "string") {
    return val
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(val)) return [];
  return val.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : [];
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const text = o.name ?? o.label ?? o.description ?? o.text;
      if (typeof text === "string" && text.trim()) return [text.trim()];
    }
    return [];
  });
}

function normalizeSceneArray(val: unknown): unknown[] {
  if (typeof val === "string" && val.trim()) {
    return [{ startSec: 0, endSec: 3, description: val.trim() }];
  }
  if (!Array.isArray(val)) return [];
  return val.map((item) => {
    if (typeof item === "string") return { startSec: 0, endSec: 3, description: item.trim() };
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      return {
        startSec: o.startSec ?? o.start ?? 0,
        endSec: o.endSec ?? o.end ?? 3,
        description: o.description ?? o.label ?? o.name ?? "",
        emotion: o.emotion,
      };
    }
    return item;
  });
}

function normalizeProductArray(val: unknown): unknown[] {
  if (typeof val === "string" && val.trim()) return [{ name: val.trim() }];
  if (!Array.isArray(val)) return [];
  return val.map((item) => {
    if (typeof item === "string") return { name: item.trim() };
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const attrs = o.attributes;
      return {
        name: typeof o.name === "string" ? o.name : typeof o.label === "string" ? o.label : "",
        attributes:
          typeof attrs === "string"
            ? attrs.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
            : Array.isArray(attrs)
              ? attrs
              : undefined,
      };
    }
    return { name: "" };
  });
}

/** Coerce common LLM output quirks (string instead of array, nested objects) before Zod. */
function normalizeVisionPayload(raw: unknown): unknown {
  const unwrapped = unwrapVisionResult(raw);
  if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) return unwrapped;
  const obj = { ...(unwrapped as Record<string, unknown>) };
  if ("subjects" in obj) obj.subjects = ensureStringArray(obj.subjects);
  if ("hooks" in obj) obj.hooks = ensureStringArray(obj.hooks);
  if ("products" in obj) obj.products = normalizeProductArray(obj.products);
  if ("scenes" in obj) obj.scenes = normalizeSceneArray(obj.scenes);
  if ("suggestedMoments" in obj && typeof obj.suggestedMoments === "object") {
    obj.suggestedMoments = normalizeSceneArray(obj.suggestedMoments).map((s) => {
      const scene = s as Record<string, unknown>;
      return {
        startSec: scene.startSec ?? 0,
        endSec: scene.endSec ?? 3,
        reason: scene.reason ?? scene.description ?? "",
      };
    });
  }
  return obj;
}

/** Coerce raw model output into a VisionAnalysis, or null when it carries no real visual signal. */
function coerceVisionResult(result: unknown, input: VisionInput): VisionAnalysis | null {
  const normalized = normalizeVisionPayload(result);
  const parsed = LenientVisionSchema.safeParse(normalized);
  if (!parsed.success) {
    console.warn(
      `[vision] lenient parse failed asset=${input.assetId}:`,
      parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`)
    );
    return null;
  }
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
  analysis: VisionAnalysis & {
    diagnostics?: { frameCount: number; validFrameCount: number; source: "model" | "fallback" };
  };
  usage: { input: number; output: number; costUsd: number };
}> {
  const locale = resolveVisionLocale(input);
  const validFrames = (input.frames ?? []).filter((f) => f.dataUrl.length > 200);
  const hasFrames = validFrames.length > 0;
  console.log(
    `[vision] start asset=${input.assetId} media=${input.mediaType} frames=${input.frames?.length ?? 0} valid=${validFrames.length}`
  );

  const system = `You are a Vision Agent analyzing marketing video/image assets for Singapore/SEA markets.
Identify subjects, scenes, products, emotional hooks, and suggested highlight moments for ad creation.
Estimate primarySubject as normalized x/y (0–1) center of the main product or person to keep in frame for vertical video cropping.
${outputLanguagePrompt(locale)}
${hasFrames ? "You are given real frames from the user's own upload — describe ONLY what you see in the images. Name specific visible items (e.g. rose bouquet, latte art, leather wallet). NEVER use the campaign project name or marketing goal as a product/subject name." : "Infer likely visual content from campaign context when frame data is sparse."}
For videos, align scene timestamps with the provided frame atSec values when possible.
Output JSON with arrays for subjects, products, scenes, hooks, suggestedMoments.`;

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
        validFrames.map((f) => f.dataUrl),
        schemaHint
      )
    : await callJsonModel<unknown>(system, user, schemaHint);

  const coerced = coerceVisionResult(result, input);
  const source = coerced ? ("model" as const) : ("fallback" as const);
  if (!coerced) {
    console.warn(
      `[vision] no usable visual signal (hasFrames=${hasFrames}, asset=${input.assetId}) — templated fallback`
    );
  } else {
    console.log(
      `[vision] ok asset=${input.assetId} confidence=${coerced.confidence} subjects=${coerced.subjects.slice(0, 3).join(", ")}`
    );
  }
  const analysis: VisionAnalysis & {
    diagnostics?: { frameCount: number; validFrameCount: number; source: "model" | "fallback" };
  } = {
    ...(coerced ?? buildFallbackAnalysis(input)),
    diagnostics: {
      frameCount: input.frames?.length ?? 0,
      validFrameCount: validFrames.length,
      source,
    },
  };

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
