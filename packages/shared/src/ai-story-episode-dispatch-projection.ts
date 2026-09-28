export type EpisodeProjectionGap = {
  field: string;
  gate: string;
  reason: string;
};

export function assertEpisodeProjectionReuse(input: {
  currentSemanticHash: string | null;
  projectedSemanticHash: string;
}): "CREATE" | "REUSE" {
  if (!input.currentSemanticHash) return "CREATE";
  if (input.currentSemanticHash === input.projectedSemanticHash) return "REUSE";
  throw new EpisodeDispatchProjectionError(
    "EPISODE_PROJECTED_AUTHORITY_CONFLICT",
    "Current Handoff, Director, or Motion authority does not match the Episode projection",
  );
}

export class EpisodeDispatchProjectionError extends Error {
  constructor(
    readonly code:
      | "EPISODE_DIRECTOR_PROJECTION_UNREPRESENTABLE"
      | "EPISODE_MOTION_PROJECTION_UNREPRESENTABLE"
      | "EPISODE_DISPATCH_AUTHORITY_CONFLICT"
      | "EPISODE_PROJECTED_AUTHORITY_CONFLICT"
      | "EPISODE_DISPATCH_SOURCE_MISSING",
    message: string,
    readonly fields: readonly EpisodeProjectionGap[] = [],
  ) {
    super(message);
    this.name = "EpisodeDispatchProjectionError";
  }
}
