import type {
  ProductRuntimeAssemblyState,
  ProductRuntimeStatus,
} from "./ai-story-product-runtime-status";

export const FULL_EPISODE_PREVIEW_STATES = [
  "GENERATING",
  "WAITING_FOR_REVIEW",
  "ASSEMBLING",
  "FINAL_READY",
  "ASSEMBLY_FAILED",
] as const;
export type FullEpisodePreviewState = (typeof FULL_EPISODE_PREVIEW_STATES)[number];

export const FULL_EPISODE_DURATION_PENDING = "Duration pending" as const;
export const FULL_EPISODE_DURATION_UNAVAILABLE = "Duration unavailable" as const;

export function resolveFullEpisodePreviewState(input: {
  readonly hasFinalStoryResult?: boolean | null;
  readonly status?: ProductRuntimeStatus | string | null;
  readonly assemblyState?: ProductRuntimeAssemblyState | string | null;
  readonly pendingReviewSceneCount?: number | null;
  readonly waitingForHumanReview?: boolean;
}): FullEpisodePreviewState {
  if (input.hasFinalStoryResult || input.status === "SUCCEEDED") return "FINAL_READY";
  if (input.status === "ASSEMBLY_FAILED" || input.assemblyState === "FAILED") {
    return "ASSEMBLY_FAILED";
  }
  if (input.waitingForHumanReview || (input.pendingReviewSceneCount ?? 0) > 0) {
    return "WAITING_FOR_REVIEW";
  }
  if (
    input.status === "ASSEMBLING" ||
    input.status === "WAITING_FOR_ASSEMBLY" ||
    input.status === "SCENES_COMPLETE" ||
    input.assemblyState === "PROCESSING" ||
    input.assemblyState === "ACCEPTED"
  ) {
    return "ASSEMBLING";
  }
  return "GENERATING";
}

export const EPISODE_ASSEMBLY_ACTIVITIES = [
  "APPROVING",
  "APPROVED",
  "WAITING_FOR_REVIEW",
  "WAITING_FOR_ASSEMBLY",
  "ASSEMBLY_QUEUED",
  "ASSEMBLING",
  "EPISODE_READY",
  "ASSEMBLY_FAILED",
  "GENERATING",
] as const;
export type EpisodeAssemblyActivity = (typeof EPISODE_ASSEMBLY_ACTIVITIES)[number];

/** Maps persisted runtime facts onto the episode preview. Client approval phase is local only. */
export function resolveEpisodeAssemblyActivity(input: {
  readonly previewState: FullEpisodePreviewState;
  readonly status?: string | null;
  readonly assemblyState?: string | null;
  readonly approvalPhase?: "idle" | "approving" | "approved" | "error";
}): EpisodeAssemblyActivity {
  if (input.approvalPhase === "approving") return "APPROVING";
  if (input.previewState === "FINAL_READY") return "EPISODE_READY";
  if (input.previewState === "ASSEMBLY_FAILED" || input.assemblyState === "FAILED" || input.status === "ASSEMBLY_FAILED") {
    return "ASSEMBLY_FAILED";
  }
  if (input.approvalPhase === "approved" && input.previewState !== "ASSEMBLING") return "APPROVED";
  if (input.status === "SCENES_COMPLETE") return "WAITING_FOR_ASSEMBLY";
  if (input.assemblyState === "ACCEPTED" || input.status === "WAITING_FOR_ASSEMBLY") return "ASSEMBLY_QUEUED";
  if (input.previewState === "ASSEMBLING" || input.status === "ASSEMBLING" || input.assemblyState === "PROCESSING") {
    return "ASSEMBLING";
  }
  if (input.previewState === "WAITING_FOR_REVIEW") return "WAITING_FOR_REVIEW";
  return "GENERATING";
}

export function episodeAssemblyActivityCopy(activity: EpisodeAssemblyActivity): string {
  switch (activity) {
    case "APPROVING":
      return "Saving your approval...";
    case "APPROVED":
      return "Scene approved.";
    case "WAITING_FOR_ASSEMBLY":
      return "Preparing your episode...";
    case "ASSEMBLY_QUEUED":
      return "Preparing your episode...";
    case "ASSEMBLING":
      return "Assembling your episode...";
    case "EPISODE_READY":
      return "Your episode is ready!";
    case "ASSEMBLY_FAILED":
      return "Episode assembly failed. Please check the status.";
    case "WAITING_FOR_REVIEW":
      return "Review the generated moments below before the final Episode is assembled.";
    case "GENERATING":
      return "EmberOS is creating your Episode moments.";
  }
}

export function episodeAssemblyActivityIsLoading(activity: EpisodeAssemblyActivity): boolean {
  return activity === "APPROVING" || activity === "WAITING_FOR_ASSEMBLY" || activity === "ASSEMBLY_QUEUED" || activity === "ASSEMBLING";
}

export function fullEpisodePendingCopy(state: FullEpisodePreviewState): string {
  switch (state) {
    case "WAITING_FOR_REVIEW":
      return "Review the generated moments below before the final Episode is assembled.";
    case "ASSEMBLING":
      return "Your moments are ready. EmberOS is assembling the final Episode.";
    case "ASSEMBLY_FAILED":
      return "The final Episode could not be assembled. Your approved moments are preserved.";
    case "FINAL_READY":
      return "";
    case "GENERATING":
    default:
      return "EmberOS is creating your Episode moments.";
  }
}

export function formatEpisodeClockDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000);
  const bounded = Math.max(0, totalSeconds);
  const minutes = Math.floor(bounded / 60);
  const seconds = bounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function resolveEpisodeDurationLabel(
  durationMs: number | null | undefined,
  options: { readonly expected?: boolean } = {}
): string {
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
    return formatEpisodeClockDuration(durationMs);
  }
  return options.expected ? FULL_EPISODE_DURATION_UNAVAILABLE : FULL_EPISODE_DURATION_PENDING;
}
