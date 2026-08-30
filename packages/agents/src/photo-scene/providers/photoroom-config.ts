import type { ExtractionErrorCategory } from "@ceo-agent/shared";

export const PHOTO_SCENE_PROVIDER_TIMEOUT_MS_DEFAULT = 30_000;
export const PHOTOROOM_DEFAULT_COST_USD = 0.02;
export const PHOTOROOM_SEGMENT_URL = "https://sdk.photoroom.com/v1/segment";

export function providerTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PHOTO_SCENE_PROVIDER_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 120_000) return Math.floor(raw);
  return PHOTO_SCENE_PROVIDER_TIMEOUT_MS_DEFAULT;
}

export function photoroomConfiguredCostUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.PHOTO_SCENE_PHOTOROOM_COST_USD);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 10) return raw;
  return PHOTOROOM_DEFAULT_COST_USD;
}

export function mapPhotoroomHttpStatus(status: number): ExtractionErrorCategory {
  if (status === 400 || status === 401 || status === 403 || status === 413 || status === 415) {
    return "PROVIDER_REJECTED";
  }
  if (status === 408 || status === 429 || status === 402 || status >= 500) {
    return "PROVIDER_UNAVAILABLE";
  }
  return "PROVIDER_UNAVAILABLE";
}

export function isAbortTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  const message = err instanceof Error ? err.message : String(err);
  return name === "AbortError" || name === "TimeoutError" || /timeout|aborted/i.test(message);
}
