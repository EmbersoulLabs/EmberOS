export const SERVER_RUNTIME_DEADLINE_MS = 15_000;

export const RUNTIME_READ_STAGES = [
  "route_entry", "request_parse", "auth", "workspace_authorization",
  "story_load", "execution_plan_load", "ownership_validation",
  "runtime_authorization_read", "execution_plan_review_projection_read", "release_state_read", "provider_attempt_read",
  "scene_result_read", "generated_scene_review_read", "durable_attestation_read",
  "media_playback_resolution", "cost_usage_projection", "runtime_projection_build",
  "response_schema_validation", "response_serialization",
] as const;

export type RuntimeReadStage = (typeof RUNTIME_READ_STAGES)[number];
export type RuntimeReadStageStatus = "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
export type RuntimeReadStageTiming = {
  readonly stage: RuntimeReadStage;
  readonly startedAt: number | null;
  readonly durationMs: number | null;
  readonly status: RuntimeReadStageStatus;
};

export class RuntimeReadDeadlineError extends Error {
  readonly code = "AI_STORY_RUNTIME_READ_TIMEOUT";
  constructor(readonly timedOutStage: RuntimeReadStage, readonly elapsedMs: number) {
    super("Runtime data loading timed out.");
    this.name = "RuntimeReadDeadlineError";
  }
}

export class RuntimeReadStageRecorder {
  private readonly startedAt = performance.now();
  private readonly rows = new Map<RuntimeReadStage, RuntimeReadStageTiming>(
    RUNTIME_READ_STAGES.map((stage) => [stage, { stage, startedAt: null, durationMs: null, status: "NOT_REACHED" }])
  );
  private readonly activeStages = new Set<RuntimeReadStage>();

  constructor(private readonly signal: AbortSignal) {
    this.completeSync("route_entry");
  }

  completeSync(stage: RuntimeReadStage): void {
    const now = performance.now();
    this.rows.set(stage, { stage, startedAt: Math.round(now - this.startedAt), durationMs: 0, status: "COMPLETED" });
  }

  async run<T>(stage: RuntimeReadStage, operation: () => Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new RuntimeReadDeadlineError(stage, this.elapsedMs());
    this.activeStages.add(stage);
    const start = performance.now();
    this.rows.set(stage, { stage, startedAt: Math.round(start - this.startedAt), durationMs: null, status: "NOT_REACHED" });
    try {
      const value = await operation();
      this.rows.set(stage, { stage, startedAt: Math.round(start - this.startedAt), durationMs: Math.round(performance.now() - start), status: "COMPLETED" });
      this.activeStages.delete(stage);
      return value;
    } catch (error) {
      const timedOut = this.signal.aborted || error instanceof RuntimeReadDeadlineError;
      this.rows.set(stage, { stage, startedAt: Math.round(start - this.startedAt), durationMs: Math.round(performance.now() - start), status: timedOut ? "TIMED_OUT" : "FAILED" });
      this.activeStages.delete(stage);
      throw error;
    }
  }

  markTimedOut(): RuntimeReadStage {
    const activeStage = [...this.activeStages]
      .sort((left, right) => (this.rows.get(left)?.startedAt ?? 0) - (this.rows.get(right)?.startedAt ?? 0))[0]
      ?? this.lastCompletedStage()
      ?? "route_entry";
    const row = this.rows.get(activeStage)!;
    if (row.status !== "COMPLETED") {
      this.rows.set(activeStage, { ...row, durationMs: row.startedAt == null ? null : this.elapsedMs() - row.startedAt, status: "TIMED_OUT" });
    }
    return activeStage;
  }

  elapsedMs(): number { return Math.round(performance.now() - this.startedAt); }
  lastCompletedStage(): RuntimeReadStage | null {
    return [...this.rows.values()].filter((row) => row.status === "COMPLETED").at(-1)?.stage ?? null;
  }
  duration(stage: RuntimeReadStage): number | null { return this.rows.get(stage)?.durationMs ?? null; }
  snapshot(): readonly RuntimeReadStageTiming[] { return [...this.rows.values()]; }
}
