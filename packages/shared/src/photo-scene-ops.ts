/**
 * Bounded Photo Scene operational evidence. Correlation only — not a logging platform.
 * Do not log secrets, signed URLs, image bytes, or Authorization headers.
 */

export const PHOTO_SCENE_OPS_FAILURE_CLASSES = [
  "INVALID_SOURCE",
  "SOURCE_IDENTITY_MISSING",
  "SOURCE_OBJECT_MISSING",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "INVALID_PROVIDER_OUTPUT",
  "STORAGE_WRITE_FAILED",
  "OUTPUT_FINALIZATION_FAILED",
  "AUTHORIZATION_DENIAL",
  "INVALID_EXTRACTED_PRODUCT",
  "SOURCE_IDENTITY_MISMATCH",
  "SCENE_NOT_FOUND",
  "SCENE_VERSION_NOT_AVAILABLE",
  "SCENE_IDENTITY_MISMATCH",
  "SCENE_PRESET_INCOMPATIBLE",
  "INVALID_PLACEMENT",
  "BRAND_ASSET_UNAVAILABLE",
  "COMPOSITION_FAILED",
] as const;

export type PhotoSceneOpsFailureClass = (typeof PHOTO_SCENE_OPS_FAILURE_CLASSES)[number];

export const PHOTO_SCENE_OPS_OUTCOMES = [
  "enqueued",
  "started",
  "completed",
  "failed",
  "reused",
  "retrying",
  "denied",
  "generated_again",
] as const;

export type PhotoSceneOpsOutcome = (typeof PHOTO_SCENE_OPS_OUTCOMES)[number];

export const PHOTO_SCENE_OPS_EVENT_KIND = "photo_scene.ops" as const;

const OPS_EVENT_KEYS = [
  "kind",
  "event",
  "stage",
  "outcome",
  "orgId",
  "workspaceId",
  "campaignId",
  "generationId",
  "sourceAssetId",
  "outputAssetId",
  "attempt",
  "providerKey",
  "durationMs",
  "failureClass",
  "message",
] as const;

const FORBIDDEN_OPS_KEYS = [
  "authorization",
  "Authorization",
  "apiKey",
  "token",
  "accessToken",
  "refreshToken",
  "cookie",
  "set-cookie",
  "signedUrl",
  "signedURL",
  "presignedUrl",
  "secret",
  "stack",
  "bytes",
  "imageBytes",
  "rawProvider",
  "providerResponse",
] as const;

export const PHOTO_SCENE_OPS_FORBIDDEN_KEYS: readonly string[] = FORBIDDEN_OPS_KEYS;

const MAX_OPS_MESSAGE = 200;

export type PhotoSceneOpsEvent = {
  kind: typeof PHOTO_SCENE_OPS_EVENT_KIND;
  event: string;
  stage: string;
  outcome: PhotoSceneOpsOutcome;
  orgId?: string;
  workspaceId?: string;
  campaignId?: string;
  generationId?: string;
  sourceAssetId?: string;
  outputAssetId?: string;
  attempt?: number;
  providerKey?: string;
  durationMs?: number;
  failureClass?: PhotoSceneOpsFailureClass;
  message?: string;
};

export type PhotoSceneOpsEventInput = Omit<PhotoSceneOpsEvent, "kind"> & Record<string, unknown>;

export function boundPhotoSceneOpsMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const redacted = firstLine
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/(signedUrl|accessToken|refreshToken|apiKey|Authorization)=[^\s&]+/gi, "$1=[redacted]");
  if (redacted.length <= MAX_OPS_MESSAGE) return redacted || "operation failed";
  return `${redacted.slice(0, MAX_OPS_MESSAGE - 3)}...`;
}

function isFailureClass(value: unknown): value is PhotoSceneOpsFailureClass {
  return (
    typeof value === "string" &&
    (PHOTO_SCENE_OPS_FAILURE_CLASSES as readonly string[]).includes(value)
  );
}

function isOutcome(value: unknown): value is PhotoSceneOpsOutcome {
  return typeof value === "string" && (PHOTO_SCENE_OPS_OUTCOMES as readonly string[]).includes(value);
}

function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function sanitizePhotoSceneOpsEvent(input: PhotoSceneOpsEventInput): PhotoSceneOpsEvent {
  const event: PhotoSceneOpsEvent = {
    kind: PHOTO_SCENE_OPS_EVENT_KIND,
    event: typeof input.event === "string" ? input.event : "photo_scene.unknown",
    stage: typeof input.stage === "string" ? input.stage : "unknown",
    outcome: isOutcome(input.outcome) ? input.outcome : "failed",
  };
  event.orgId = optionalId(input.orgId);
  event.workspaceId = optionalId(input.workspaceId);
  event.campaignId = optionalId(input.campaignId);
  event.generationId = optionalId(input.generationId);
  event.sourceAssetId = optionalId(input.sourceAssetId);
  event.outputAssetId = optionalId(input.outputAssetId);
  if (typeof input.attempt === "number" && Number.isFinite(input.attempt)) {
    event.attempt = input.attempt;
  }
  const providerKey = optionalId(input.providerKey);
  if (providerKey && providerKey !== "deterministic") {
    event.providerKey = providerKey;
  } else if (providerKey === "deterministic") {
    event.providerKey = "deterministic";
  }
  if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
    event.durationMs = input.durationMs;
  }
  if (isFailureClass(input.failureClass)) event.failureClass = input.failureClass;
  if (input.message !== undefined) {
    event.message = boundPhotoSceneOpsMessage(input.message);
  }

  const cleaned: PhotoSceneOpsEvent = { ...event };
  for (const key of Object.keys(cleaned) as Array<keyof PhotoSceneOpsEvent>) {
    if (cleaned[key] === undefined) delete cleaned[key];
  }
  for (const key of Object.keys(cleaned)) {
    if (!(OPS_EVENT_KEYS as readonly string[]).includes(key)) {
      delete (cleaned as Record<string, unknown>)[key];
    }
  }
  for (const forbidden of FORBIDDEN_OPS_KEYS) {
    delete (cleaned as Record<string, unknown>)[forbidden];
  }
  return cleaned;
}

export function emitPhotoSceneOpsEvent(input: PhotoSceneOpsEventInput): PhotoSceneOpsEvent {
  const event = sanitizePhotoSceneOpsEvent(input);
  const line = JSON.stringify(event);
  if (event.outcome === "failed" || event.outcome === "denied") console.error(line);
  else if (event.outcome === "retrying") console.warn(line);
  else console.info(line);
  return event;
}
