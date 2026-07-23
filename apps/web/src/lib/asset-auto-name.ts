import { callJsonModel } from "@ceo-agent/agents";
import { cleanOriginalFilename } from "@ceo-agent/shared";

/**
 * PD-040: suggest a readable display name from filename + asset type.
 * Falls back to cleaned original filename when AI is unavailable or fails.
 * Does not overwrite originalFilename.
 */
export async function suggestReadableAssetName(input: {
  originalFilename: string;
  type: string;
  mimeType?: string | null;
}): Promise<{ displayName: string; source: "ai" | "fallback" }> {
  const fallback = cleanOriginalFilename(input.originalFilename);
  try {
    const { result } = await callJsonModel<{ displayName?: string }>(
      "You name marketing media assets for a campaign library. Return a short human-readable display name (2–8 words). Do not invent brand claims. Prefer descriptive content cues from the filename. No file extensions. No quotes.",
      JSON.stringify({
        originalFilename: input.originalFilename,
        type: input.type,
        mimeType: input.mimeType ?? null,
      }),
      '{ "displayName": string }',
      { model: "gpt-4o-mini" }
    );
    const name = result.displayName?.trim().replace(/\.[a-z0-9]+$/i, "");
    if (!name || name.length < 2 || name.length > 120) {
      return { displayName: fallback, source: "fallback" };
    }
    return { displayName: name, source: "ai" };
  } catch {
    return { displayName: fallback, source: "fallback" };
  }
}
