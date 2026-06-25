import { getOpenAI } from "./llm";
import type { CopyLocale } from "@ceo-agent/shared";

const VOICE_FEMALE: Record<CopyLocale, "nova" | "shimmer"> = {
  en: "nova",
  zh: "shimmer",
};

const VOICE_MALE: Record<CopyLocale, "onyx" | "echo"> = {
  en: "onyx",
  zh: "echo",
};

export async function synthesizeSpeech(
  text: string,
  locale: CopyLocale = "zh",
  gender: "female" | "male" = "female"
): Promise<Buffer> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("TTS text is empty");

  const voiceMap = gender === "male" ? VOICE_MALE : VOICE_FEMALE;
  const openai = getOpenAI();
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: voiceMap[locale],
    input: trimmed.slice(0, 4096),
    response_format: "mp3",
  });

  return Buffer.from(await response.arrayBuffer());
}
