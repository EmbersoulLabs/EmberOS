export const VIDEO_STUDIO_OUTPUT_COUNT = 3 as const;

export type VideoStudioPresentationState =
  | "READY"
  | "QUEUED"
  | "PROCESSING"
  | "RECOVERING"
  | "COMPLETE"
  | "PARTIAL"
  | "FAILED"
  | "STALE_OR_WRONG_TASK";

export type VideoStudioSlotState =
  | "READY"
  | "RENDERING"
  | "FAILED"
  | "MISSING"
  | "PREVIEW_DELIVERY_ERROR";

export type VideoStudioCreativeState = {
  id?: string | null;
  videoUrl?: string | null;
  status?: string | null;
  renderStatus?: string | null;
  renderProgress?: { error?: string | null } | null;
};

export type VideoStudioResultInput = {
  task?: { status?: string | null; campaignId?: string | null } | null;
  routeCampaignId: string;
  creatives?: VideoStudioCreativeState[];
  previewDeliveryErrorIds?: ReadonlySet<string>;
  exportStatus?: string | null;
};

export type VideoStudioResultProjection = {
  state: VideoStudioPresentationState;
  slots: Array<{ index: number; creativeId: string | null; state: VideoStudioSlotState }>;
  readyCount: number;
  failedCount: number;
  missingCount: number;
  isExportActive: boolean;
};

export type CreativeRecoveryPollDecision = "READY" | "FAILED" | "CONTINUE" | "PAUSE_ACTIVE";

const ACTIVE_TASK_STATES = new Set(["queued", "running", "processing", "retrying", "resume"]);
const ACTIVE_RENDER_STATES = new Set(["preview_rendering", "final_rendering"]);
const ACTIVE_EXPORT_STATES = new Set(["final_rendering", "export_pending"]);

export function resolveCreativeRecoveryPollDecision(
  creative: VideoStudioCreativeState | null | undefined,
  pollCount: number,
  maxPolls: number
): CreativeRecoveryPollDecision {
  if (creative?.videoUrl) return "READY";
  if (
    creative?.status === "failed" ||
    creative?.renderStatus === "failed" ||
    Boolean(creative?.renderProgress?.error)
  )
    return "FAILED";
  return pollCount >= maxPolls ? "PAUSE_ACTIVE" : "CONTINUE";
}

export function projectVideoStudioResult(input: VideoStudioResultInput): VideoStudioResultProjection {
  const creatives = input.creatives ?? [];
  const taskStatus = input.task?.status ?? null;
  const taskTerminal = taskStatus === "completed" || taskStatus === "failed";
  const wrongCampaign = Boolean(
    input.task?.campaignId && input.task.campaignId !== input.routeCampaignId
  );

  const slots = Array.from({ length: VIDEO_STUDIO_OUTPUT_COUNT }, (_, index) => {
    const creative = creatives[index];
    const creativeId = creative?.id ?? null;
    let state: VideoStudioSlotState;
    if (!creative) state = taskTerminal ? "MISSING" : "RENDERING";
    else if (creativeId && input.previewDeliveryErrorIds?.has(creativeId)) {
      state = "PREVIEW_DELIVERY_ERROR";
    } else if (creative.videoUrl) state = "READY";
    else if (
      creative.status === "failed" ||
      Boolean(creative.renderProgress?.error) ||
      creative.renderStatus === "failed"
    )
      state = "FAILED";
    else if (ACTIVE_RENDER_STATES.has(creative.renderStatus ?? "") || !taskTerminal)
      state = "RENDERING";
    else state = "MISSING";
    return { index, creativeId, state };
  });

  const readyCount = slots.filter((slot) => slot.state === "READY").length;
  const failedCount = slots.filter(
    (slot) => slot.state === "FAILED" || slot.state === "PREVIEW_DELIVERY_ERROR"
  ).length;
  const missingCount = slots.filter((slot) => slot.state === "MISSING").length;
  const recovering = taskTerminal && slots.some((slot) => slot.state === "RENDERING");
  const isExportActive = ACTIVE_EXPORT_STATES.has(input.exportStatus ?? "");

  let state: VideoStudioPresentationState;
  if (wrongCampaign) state = "STALE_OR_WRONG_TASK";
  else if (!input.task) state = "READY";
  else if (taskStatus === "queued") state = "QUEUED";
  else if (recovering) state = "RECOVERING";
  else if (ACTIVE_TASK_STATES.has(taskStatus ?? "") || isExportActive) state = "PROCESSING";
  else if (readyCount === VIDEO_STUDIO_OUTPUT_COUNT) state = "COMPLETE";
  else if (readyCount > 0) state = "PARTIAL";
  else if (taskTerminal || failedCount > 0 || missingCount === VIDEO_STUDIO_OUTPUT_COUNT)
    state = "FAILED";
  else state = "PROCESSING";

  return { state, slots, readyCount, failedCount, missingCount, isExportActive };
}
