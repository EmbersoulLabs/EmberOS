/**
 * Bounded Video Studio operational evidence (VS-RC-OBS-01).
 * Correlation IDs and failure classification only — not a logging platform.
 */

export const VIDEO_STUDIO_OPS_FAILURE_CLASSES = [
  "PIPELINE_FAILURE",
  "RENDITION_FAILURE",
  "PREVIEW_DELIVERY_FAILURE",
  "EXPORT_FAILURE",
  "AUTHORIZATION_DENIAL",
  "WRONG_CAMPAIGN_TASK",
] as const;

export type VideoStudioOpsFailureClass =
  (typeof VIDEO_STUDIO_OPS_FAILURE_CLASSES)[number];

export const VIDEO_STUDIO_OPS_OUTCOMES = [
  "enqueued",
  "started",
  "completed",
  "failed",
  "retrying",
  "denied",
] as const;

export type VideoStudioOpsOutcome = (typeof VIDEO_STUDIO_OPS_OUTCOMES)[number];

export const VIDEO_STUDIO_OPS_RECOVERY_KINDS = [
  "pipeline_resume",
  "queue_attempt",
  "retry_render",
  "new_generation",
] as const;

export type VideoStudioOpsRecoveryKind =
  (typeof VIDEO_STUDIO_OPS_RECOVERY_KINDS)[number];

export const VIDEO_STUDIO_OPS_EVENT_KIND = "video_studio.ops" as const;

const OPS_EVENT_KEYS = [
  "kind",
  "event",
  "stage",
  "outcome",
  "orgId",
  "workspaceId",
  "campaignId",
  "taskId",
  "creativeId",
  "jobId",
  "attempt",
  "step",
  "failureClass",
  "retryCount",
  "recoveryKind",
  "resolution",
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
  "rawPrompt",
  "prompt",
] as const;

export const VIDEO_STUDIO_OPS_FORBIDDEN_KEYS: readonly string[] = FORBIDDEN_OPS_KEYS;

const MAX_OPS_MESSAGE = 200;

export type VideoStudioOpsEvent = {
  kind: typeof VIDEO_STUDIO_OPS_EVENT_KIND;
  event: string;
  stage: string;
  outcome: VideoStudioOpsOutcome;
  orgId?: string;
  workspaceId?: string;
  campaignId?: string;
  taskId?: string;
  creativeId?: string;
  jobId?: string;
  attempt?: number;
  step?: string;
  failureClass?: VideoStudioOpsFailureClass;
  retryCount?: number;
  recoveryKind?: VideoStudioOpsRecoveryKind;
  resolution?: string;
  message?: string;
};

export type VideoStudioOpsEventInput = Omit<VideoStudioOpsEvent, "kind"> &
  Record<string, unknown>;

export function boundOpsDiagnosticMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  const firstLine = raw.split("\n")[0]?.trim() ?? "";
  const redacted = firstLine
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/(signedUrl|accessToken|refreshToken|apiKey|Authorization)=[^\s&]+/gi, "$1=[redacted]");
  if (redacted.length <= MAX_OPS_MESSAGE) return redacted || "operation failed";
  return `${redacted.slice(0, MAX_OPS_MESSAGE - 3)}...`;
}

function isFailureClass(value: unknown): value is VideoStudioOpsFailureClass {
  return (
    typeof value === "string" &&
    (VIDEO_STUDIO_OPS_FAILURE_CLASSES as readonly string[]).includes(value)
  );
}

function isOutcome(value: unknown): value is VideoStudioOpsOutcome {
  return (
    typeof value === "string" &&
    (VIDEO_STUDIO_OPS_OUTCOMES as readonly string[]).includes(value)
  );
}

function isRecoveryKind(value: unknown): value is VideoStudioOpsRecoveryKind {
  return (
    typeof value === "string" &&
    (VIDEO_STUDIO_OPS_RECOVERY_KINDS as readonly string[]).includes(value)
  );
}

function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function sanitizeVideoStudioOpsEvent(
  input: VideoStudioOpsEventInput
): VideoStudioOpsEvent {
  const event: VideoStudioOpsEvent = {
    kind: VIDEO_STUDIO_OPS_EVENT_KIND,
    event: typeof input.event === "string" ? input.event : "video_studio.unknown",
    stage: typeof input.stage === "string" ? input.stage : "unknown",
    outcome: isOutcome(input.outcome) ? input.outcome : "failed",
  };
  event.orgId = optionalId(input.orgId);
  event.workspaceId = optionalId(input.workspaceId);
  event.campaignId = optionalId(input.campaignId);
  event.taskId = optionalId(input.taskId);
  event.creativeId = optionalId(input.creativeId);
  event.jobId = optionalId(input.jobId);
  if (typeof input.attempt === "number" && Number.isFinite(input.attempt)) {
    event.attempt = input.attempt;
  }
  event.step = optionalId(input.step);
  if (isFailureClass(input.failureClass)) event.failureClass = input.failureClass;
  if (typeof input.retryCount === "number" && Number.isFinite(input.retryCount)) {
    event.retryCount = input.retryCount;
  }
  if (isRecoveryKind(input.recoveryKind)) event.recoveryKind = input.recoveryKind;
  event.resolution = optionalId(input.resolution);
  if (input.message !== undefined) {
    event.message = boundOpsDiagnosticMessage(input.message);
  }

  const cleaned: VideoStudioOpsEvent = { ...event };
  for (const key of Object.keys(cleaned) as Array<keyof VideoStudioOpsEvent>) {
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

export function emitVideoStudioOpsEvent(
  input: VideoStudioOpsEventInput
): VideoStudioOpsEvent {
  const event = sanitizeVideoStudioOpsEvent(input);
  const line = JSON.stringify(event);
  if (event.outcome === "failed") console.error(line);
  else if (event.outcome === "retrying" || event.outcome === "denied") console.warn(line);
  else console.info(line);
  return event;
}
