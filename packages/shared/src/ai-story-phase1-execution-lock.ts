/**
 * Sprint 3 Phase 1 production lock.
 *
 * Phase 1 ends after Scene compilation, provider-neutral AI QC, and Generate
 * Review. Every boundary capable of scheduling or executing AI Story provider
 * work must call this guard before performing side effects.
 */
export const PHASE1_EXECUTION_LOCKED = "PHASE1_EXECUTION_LOCKED" as const;

export const PHASE1_EXECUTION_LOCK_MESSAGE =
  "Phase 1 lock: Scene compilation, AI QC, and Generate Review only. Provider execution, Outbox, Queue, and Worker paths are disabled until later Sprint 3 phases are approved." as const;

export class Phase1ExecutionLockedError extends Error {
  readonly code = PHASE1_EXECUTION_LOCKED;
  readonly status = 409;

  constructor() {
    super(PHASE1_EXECUTION_LOCK_MESSAGE);
    this.name = "Phase1ExecutionLockedError";
  }
}

export function assertPhase1ExecutionLocked(): void {
  throw new Phase1ExecutionLockedError();
}
