import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../client";

export type LocalGpuReleaseCandidate = {
  sceneExecutionId: string;
  releasedAt: Date | null;
  gateProviderAttemptId: string | null;
  executionMode: string;
  releaseState: string;
};

export function canClaimLocalGpuRelease(row: Pick<LocalGpuReleaseCandidate, "executionMode" | "releaseState" | "gateProviderAttemptId">): boolean {
  return row.executionMode === "LOCAL_GPU"
    && row.releaseState === "RELEASED"
    && row.gateProviderAttemptId === null;
}

export function orderLocalGpuReleases<T extends Pick<LocalGpuReleaseCandidate, "releasedAt" | "sceneExecutionId">>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftAt = left.releasedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const rightAt = right.releasedAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return left.sceneExecutionId.localeCompare(right.sceneExecutionId);
  });
}

export function selectNextLocalGpuRelease<T extends LocalGpuReleaseCandidate>(rows: readonly T[]): T | null {
  return orderLocalGpuReleases(rows).find((row) => canClaimLocalGpuRelease(row)) ?? null;
}

type ClaimDb = Pick<ReturnType<typeof getDb>, "update" | "select">;

/** Conditional update. A concurrent worker that loses the null-gate race claims nothing in this cycle. */
export async function claimExplicitLocalGpuReleaseGate(
  db: ClaimDb,
  input: { sceneExecutionId: string; jobId: string },
): Promise<boolean> {
  const rows = await db.update(schema.aiStorySceneReleaseStates).set({
    gateProviderAttemptId: input.jobId,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
    eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
    eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    isNull(schema.aiStorySceneReleaseStates.gateProviderAttemptId),
  )).returning({ sceneExecutionId: schema.aiStorySceneReleaseStates.sceneExecutionId });
  return rows.length === 1;
}

export function localGpuReleaseClaimOrder() {
  return [
    sql`${schema.aiStorySceneReleaseStates.releasedAt} asc nulls last`,
    asc(schema.aiStorySceneReleaseStates.sceneExecutionId),
  ];
}

export class InMemoryLocalGpuReleaseLedger {
  constructor(private readonly rows: LocalGpuReleaseCandidate[]) {}

  selectNext(): LocalGpuReleaseCandidate | null {
    return selectNextLocalGpuRelease(this.rows);
  }

  claim(sceneExecutionId: string, jobId: string): boolean {
    const row = this.rows.find((item) => item.sceneExecutionId === sceneExecutionId);
    if (!row || !canClaimLocalGpuRelease(row)) return false;
    row.gateProviderAttemptId = jobId;
    return true;
  }
}

/** Claims only the release already selected for this cycle. A lost CAS does not advance to the next row. */
export function claimPreparedLocalGpuRelease(
  ledger: { claim(sceneExecutionId: string, jobId: string): boolean },
  selected: LocalGpuReleaseCandidate | null,
  jobId: string,
): LocalGpuReleaseCandidate | null {
  if (!selected || !ledger.claim(selected.sceneExecutionId, jobId)) return null;
  return selected;
}
