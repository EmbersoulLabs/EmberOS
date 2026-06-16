import { callJsonModel } from "./llm";
import { VisionAnalysisSchema } from "@ceo-agent/shared";
import type { VisionAnalysis } from "@ceo-agent/shared";

export interface VisionInput {
  assetId: string;
  mediaType: "video" | "image";
  durationSec?: number;
  frameDescriptions?: string[];
  transcriptSummary?: string;
}

export async function runVisionAgent(input: VisionInput): Promise<{
  analysis: VisionAnalysis;
  usage: { input: number; output: number; costUsd: number };
}> {
  const system = `You are a Vision Agent analyzing marketing video/image assets for Singapore/SEA markets.
Identify subjects, scenes, products, emotional hooks, and suggested highlight moments.
For videos >60s, rely on transcript summary and key frames only. Output JSON.`;

  const user = JSON.stringify({
    assetId: input.assetId,
    mediaType: input.mediaType,
    durationSec: input.durationSec,
    frames: input.frameDescriptions ?? [],
    transcript: input.transcriptSummary,
  });

  const { result, usage } = await callJsonModel<unknown>(system, user, "VisionAnalysis");
  const parsed = VisionAnalysisSchema.safeParse(result);

  const analysis: VisionAnalysis = parsed.success
    ? parsed.data
    : {
        assetId: input.assetId,
        mediaType: input.mediaType,
        durationSec: input.durationSec,
        subjects: ["product"],
        scenes: [{ startSec: 0, endSec: input.durationSec ?? 30, description: "Main scene" }],
        products: [],
        hooks: ["problem-solution"],
        transcriptSummary: input.transcriptSummary,
        suggestedMoments: [{ startSec: 0, endSec: 3, reason: "Opening hook" }],
        confidence: 0.7,
      };

  return { analysis, usage };
}

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const { getOpenAI } = await import("./llm");
  const openai = getOpenAI();
  const file = new File([new Uint8Array(audioBuffer)], "audio.mp3", { type: "audio/mpeg" });
  const transcription = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
  });
  return transcription.text;
}
