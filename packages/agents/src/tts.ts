import { getOpenAI } from "./llm";
import type { CopyLocale } from "@ceo-agent/shared";

const VOICE_BY_LOCALE: Record<CopyLocale, "nova" | "shimmer"> = {
  en: "nova",
  zh: "shimmer",
};

export async function synthesizeSpeech(
  text: string,
  locale: CopyLocale = "zh"
): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("TTS text is empty");

  const openai = getOpenAI();
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: VOICE_BY_LOCALE[locale],
    input: trimmed.slice(0, 4096),
    response_format: "mp3",
  });

  return Buffer.from(await response.arrayBuffer());
}
