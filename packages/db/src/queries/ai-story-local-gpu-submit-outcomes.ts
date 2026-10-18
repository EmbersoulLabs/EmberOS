import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { LOCAL_GPU_T2V_WORKFLOW } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export type LocalGpuSubmitOutcomeKind =
  | "SUBMIT_STARTED"
  | "SUBMIT_ACCEPTED"
  | "SUBMIT_REJECTED"
  | "SUBMIT_UNCERTAIN"
  | "STATUS_NOT_FOUND_EXHAUSTED"
  | "DESKTOP_NON_ACCEPTANCE_ATTESTED"
  | "HUMAN_RETRY_AUTHORIZED";

export type LocalGpuSubmitOutcomeContext = {
  orgId: string;
  workspaceId: string;
  storyId: string;
  sceneExecutionId: string;
  packageId: string;
  dispatchAuthorityId: string;
  jobId: string;
};

export type LocalGpuSubmitOutcomeEvidence = {
  httpStatus?: number | null;
  desktopErrorCode?: string | null;
  desktopErrorMessage?: string | null;
  uncertainReason?: string | null;
  diagnostic?: Record<string, unknown>;
};

export type LocalGpuSubmitLedgerState = {
  attemptNumber: number;
  started: boolean;
  accepted: boolean;
  terminal: "SUBMIT_REJECTED" | "STATUS_NOT_FOUND_EXHAUSTED" | null;
  retryAuthorized: boolean;
  /** Verified Desktop attestation that no submit of this job was ever enqueued, for the current attempt. */
  nonAcceptanceAttested: boolean;
  /** Latest submit evidence for the current attempt; bounds status-only reconciliation. */
  evidenceAt: Date | null;
};

export class LocalGpuSubmitOutcomeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

const TERMINAL = new Set(["SUBMIT_REJECTED", "STATUS_NOT_FOUND_EXHAUSTED"]);

/** True when the current attempt of the release gate's job has terminal evidence and no newer human retry. */
export function localGpuGateTerminalSql(gate: SQL | typeof schema.aiStorySceneReleaseStates.gateProviderAttemptId): SQL {
  return sql`exists (
    select 1 from ${schema.aiStoryLocalGpuSubmitOutcomes} t
    where t.job_id = ${gate}
      and t.kind in ('SUBMIT_REJECTED', 'STATUS_NOT_FOUND_EXHAUSTED')
      and t.attempt_number = (select max(m.attempt_number) from ${schema.aiStoryLocalGpuSubmitOutcomes} m where m.job_id = t.job_id)
  )`;
}

/** True when a human-authorized retry attempt exists for the gate's job and the Worker has not started it. */
export function localGpuGateRetryPendingSql(gate: SQL | typeof schema.aiStorySceneReleaseStates.gateProviderAttemptId): SQL {
  return sql`exists (
    select 1 from ${schema.aiStoryLocalGpuSubmitOutcomes} h
    where h.job_id = ${gate}
      and h.kind = 'HUMAN_RETRY_AUTHORIZED'
      and h.attempt_number = (select max(m.attempt_number) from ${schema.aiStoryLocalGpuSubmitOutcomes} m where m.job_id = h.job_id)
      and not exists (
        select 1 from ${schema.aiStoryLocalGpuSubmitOutcomes} s
        where s.job_id = h.job_id and s.attempt_number = h.attempt_number and s.kind = 'SUBMIT_STARTED'
      )
  )`;
}

export function deriveLocalGpuSubmitLedgerState(
  rows: readonly { attemptNumber: number; kind: string; createdAt: Date }[],
  legacyClaimAt: Date | null,
): LocalGpuSubmitLedgerState {
  const attemptNumber = rows.reduce((max, row) => Math.max(max, row.attemptNumber), 1);
  const current = rows.filter((row) => row.attemptNumber === attemptNumber);
  const kinds = new Set(current.map((row) => row.kind));
  const terminal = current.find((row) => TERMINAL.has(row.kind))?.kind as LocalGpuSubmitLedgerState["terminal"] | undefined;
  const evidence = current
    .filter((row) => ["SUBMIT_STARTED", "SUBMIT_ACCEPTED", "SUBMIT_UNCERTAIN"].includes(row.kind))
    .map((row) => row.createdAt.getTime());
  return {
    attemptNumber,
    started: kinds.has("SUBMIT_STARTED"),
    accepted: kinds.has("SUBMIT_ACCEPTED"),
    terminal: terminal ?? null,
    retryAuthorized: kinds.has("HUMAN_RETRY_AUTHORIZED"),
    nonAcceptanceAttested: kinds.has("DESKTOP_NON_ACCEPTANCE_ATTESTED"),
    evidenceAt: evidence.length > 0
      ? new Date(Math.max(...evidence))
      : attemptNumber === 1 ? legacyClaimAt : null,
  };
}

export async function readLocalGpuSubmitLedger(db: Db, input: { workspaceId: string; sceneExecutionId: string; jobId: string }): Promise<LocalGpuSubmitLedgerState> {
  const rows = await db.select({
    attemptNumber: schema.aiStoryLocalGpuSubmitOutcomes.attemptNumber,
    kind: schema.aiStoryLocalGpuSubmitOutcomes.kind,
    createdAt: schema.aiStoryLocalGpuSubmitOutcomes.createdAt,
  }).from(schema.aiStoryLocalGpuSubmitOutcomes).where(and(
    eq(schema.aiStoryLocalGpuSubmitOutcomes.workspaceId, input.workspaceId),
    eq(schema.aiStoryLocalGpuSubmitOutcomes.sceneExecutionId, input.sceneExecutionId),
    eq(schema.aiStoryLocalGpuSubmitOutcomes.jobId, input.jobId),
  )).orderBy(asc(schema.aiStoryLocalGpuSubmitOutcomes.createdAt));
  const [release] = await db.select({ updatedAt: schema.aiStorySceneReleaseStates.updatedAt })
    .from(schema.aiStorySceneReleaseStates).where(and(
      eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
      eq(schema.aiStorySceneReleaseStates.gateProviderAttemptId, input.jobId),
    )).limit(1);
  return deriveLocalGpuSubmitLedgerState(rows, release?.updatedAt ?? null);
}

/**
 * Appends one outcome. (jobId, attemptNumber, kind) is unique, so the first writer wins and
 * replays converge; the boolean reports whether this call created the row.
 */
export async function appendLocalGpuSubmitOutcome(
  db: Db,
  context: LocalGpuSubmitOutcomeContext,
  attemptNumber: number,
  kind: LocalGpuSubmitOutcomeKind,
  evidence: LocalGpuSubmitOutcomeEvidence = {},
  recordedByUserId: string | null = null,
): Promise<boolean> {
  const inserted = await db.insert(schema.aiStoryLocalGpuSubmitOutcomes).values({
    outcomeId: deterministicPersistenceUuid("local-gpu-submit-outcome.v1", { jobId: context.jobId, attemptNumber, kind }),
    orgId: context.orgId,
    workspaceId: context.workspaceId,
    storyId: context.storyId,
    sceneExecutionId: context.sceneExecutionId,
    packageId: context.packageId,
    dispatchAuthorityId: context.dispatchAuthorityId,
    jobId: context.jobId,
    attemptNumber,
    kind,
    httpStatus: evidence.httpStatus ?? null,
    desktopErrorCode: evidence.desktopErrorCode ?? null,
    desktopErrorMessage: evidence.desktopErrorMessage ?? null,
    uncertainReason: evidence.uncertainReason ?? null,
    diagnostic: evidence.diagnostic ?? {},
    recordedBy: recordedByUserId ? "HUMAN" : "WORKER",
    recordedByUserId,
  }).onConflictDoNothing().returning({ outcomeId: schema.aiStoryLocalGpuSubmitOutcomes.outcomeId });
  return inserted.length === 1;
}

export async function listLocalGpuSubmitOutcomes(db: Db, input: { workspaceId: string; sceneExecutionId: string }) {
  return db.select().from(schema.aiStoryLocalGpuSubmitOutcomes).where(and(
    eq(schema.aiStoryLocalGpuSubmitOutcomes.workspaceId, input.workspaceId),
    eq(schema.aiStoryLocalGpuSubmitOutcomes.sceneExecutionId, input.sceneExecutionId),
  )).orderBy(asc(schema.aiStoryLocalGpuSubmitOutcomes.createdAt));
}

type ReleaseScope = { orgId: string; workspaceId: string; executionPlanId: string; sceneExecutionId: string };

/** Locks the released LOCAL_GPU Scene and resolves its submitted job and active dispatch authority. */
async function lockSubmittedLocalGpuScene(tx: Db, input: ReleaseScope) {
  const [release] = await tx.select().from(schema.aiStorySceneReleaseStates).where(and(
    eq(schema.aiStorySceneReleaseStates.orgId, input.orgId),
    eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
    eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
    eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
    eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
    eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
  )).limit(1).for("update");
  if (!release?.gateProviderAttemptId || !release.currentLocalGenerationPackageId) {
    throw new LocalGpuSubmitOutcomeError("LOCAL_GPU_RETRY_NO_SUBMITTED_JOB", 409);
  }
  const jobId = release.gateProviderAttemptId;
  const [authority] = await tx.select().from(schema.aiStoryLocalGpuDispatchAuthorities).where(and(
    eq(schema.aiStoryLocalGpuDispatchAuthorities.workspaceId, input.workspaceId),
    eq(schema.aiStoryLocalGpuDispatchAuthorities.sceneExecutionId, input.sceneExecutionId),
    eq(schema.aiStoryLocalGpuDispatchAuthorities.packageId, release.currentLocalGenerationPackageId),
    eq(schema.aiStoryLocalGpuDispatchAuthorities.runtimeAuthorizationId, release.runtimeAuthorizationId),
  )).limit(1);
  if (!authority || authority.status !== "ACTIVE" || authority.revokedAt) {
    throw new LocalGpuSubmitOutcomeError("LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED", 409);
  }
  const state = await readLocalGpuSubmitLedger(tx, { workspaceId: input.workspaceId, sceneExecutionId: input.sceneExecutionId, jobId });
  return { jobId, authority, state };
}

/** The submitted job, its workflow and current attempt, for requesting Desktop submission evidence. */
export async function readLocalGpuAttestationScope(db: Db, input: ReleaseScope) {
  return db.transaction(async (tx) => {
    const { jobId, authority, state } = await lockSubmittedLocalGpuScene(tx as unknown as Db, input);
    const snapshot = authority.dispatchSnapshot as { route?: { assetMode?: unknown }; request?: { workflow?: unknown } } | null;
    // Contract V3 zero-asset snapshots carry no workflow field; the adapter always signs them as T2V.
    const workflow = typeof snapshot?.request?.workflow === "string" ? snapshot.request.workflow
      : snapshot?.route?.assetMode === "WITHOUT_ASSET" ? LOCAL_GPU_T2V_WORKFLOW : null;
    if (!workflow) throw new LocalGpuSubmitOutcomeError("LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED", 409);
    return { jobId, workflow, state };
  });
}

export type LocalGpuNonAcceptanceAttestation = {
  verdict: "REJECTED_BEFORE_ENQUEUE";
  basis: string;
  attestationDigest: string;
  challenge: string;
  issuedAt: string;
  desktopVersion: string;
  submitAuthorizationCount: number;
  lastSubmitAuthorizationAt: string | null;
  rejection: { httpStatus: number; errorCode: string; at: string } | null;
};

/**
 * Appends a verified Desktop non-acceptance attestation for the current attempt. Only an attempt whose
 * delivery ended unresolved (404 exhaustion) needs one; an authoritative rejection already proves it.
 */
export async function recordLocalGpuNonAcceptanceAttestation(db: Db, input: ReleaseScope & {
  actorUserId: string; expectedAttemptNumber: number; expectedJobId: string; attestation: LocalGpuNonAcceptanceAttestation;
}) {
  return db.transaction(async (tx) => {
    const { jobId, authority, state } = await lockSubmittedLocalGpuScene(tx as unknown as Db, input);
    if (jobId !== input.expectedJobId || state.attemptNumber !== input.expectedAttemptNumber) {
      throw new LocalGpuSubmitOutcomeError("LOCAL_GPU_RETRY_ATTEMPT_STALE", 409);
    }
    if (state.terminal !== "STATUS_NOT_FOUND_EXHAUSTED" || state.accepted || state.retryAuthorized) {
      throw new LocalGpuSubmitOutcomeError("LOCAL_GPU_ATTESTATION_NOT_APPLICABLE", 409);
    }
    const created = await appendLocalGpuSubmitOutcome(tx as unknown as Db, {
      orgId: input.orgId, workspaceId: input.workspaceId, storyId: authority.storyId,
      sceneExecutionId: input.sceneExecutionId, packageId: authority.packageId,
      dispatchAuthorityId: authority.dispatchAuthorityId, jobId,
    }, state.attemptNumber, "DESKTOP_NON_ACCEPTANCE_ATTESTED", {
      desktopErrorCode: input.attestation.rejection?.errorCode ?? null,
      httpStatus: input.attestation.rejection?.httpStatus ?? null,
      diagnostic: { ...input.attestation },
    }, input.actorUserId);
    return { jobId, attemptNumber: state.attemptNumber, replayed: !created };
  });
}

/**
 * Human-controlled recovery. Non-acceptance must be proven for the current attempt: an authoritative
 * Desktop rejection, or a verified Desktop attestation after 404 exhaustion. A 404 alone is refused.
 * Opens attempt n+1 for the same deterministic job identity; the Worker claims it once.
 */
export async function authorizeLocalGpuHumanRetry(db: Db, input: {
  orgId: string; workspaceId: string; executionPlanId: string; sceneExecutionId: string; actorUserId: string; expectedAttemptNumber: number;
}) {
  return db.transaction(async (tx) => {
    const { jobId, authority, state } = await lockSubmittedLocalGpuScene(tx as unknown as Db, input);
    const nextAttempt = state.attemptNumber + 1;
    if (state.retryAuthorized && state.attemptNumber === input.expectedAttemptNumber + 1) {
      return { jobId, attemptNumber: state.attemptNumber, replayed: true as const };
    }
    if (state.attemptNumber !== input.expectedAttemptNumber) {
      throw new LocalGpuSubmitOutcomeError("LOCAL_GPU_RETRY_ATTEMPT_STALE", 409);
    }
    const proven = state.terminal === "SUBMIT_REJECTED"
      || (state.terminal === "STATUS_NOT_FOUND_EXHAUSTED" && state.nonAcceptanceAttested && !state.accepted);
    if (!proven) {
      throw new LocalGpuSubmitOutcomeError(
        state.terminal === "STATUS_NOT_FOUND_EXHAUSTED" ? "LOCAL_GPU_NON_ACCEPTANCE_UNPROVEN" : "LOCAL_GPU_RETRY_NOT_ELIGIBLE",
        409,
      );
    }
    await appendLocalGpuSubmitOutcome(tx as unknown as Db, {
      orgId: input.orgId, workspaceId: input.workspaceId, storyId: authority.storyId,
      sceneExecutionId: input.sceneExecutionId, packageId: authority.packageId,
      dispatchAuthorityId: authority.dispatchAuthorityId, jobId,
    }, nextAttempt, "HUMAN_RETRY_AUTHORIZED", { diagnostic: { supersedesAttemptNumber: state.attemptNumber } }, input.actorUserId);
    return { jobId, attemptNumber: nextAttempt, replayed: false as const };
  });
}
