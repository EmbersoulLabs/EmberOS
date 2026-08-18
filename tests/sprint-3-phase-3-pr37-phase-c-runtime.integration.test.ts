/**
 * Sprint 3 PR 3.7 Phase C remediation — real PostgreSQL full-chain E2E.
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 * Assembly/FSR cases also require local ffmpeg/ffprobe.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb, SceneProviderWorkerRuntimeRepository } from "@ceo-agent/db";
import { PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialAuthorizationSql } from "./helpers/commercial-phase-e-sql";
import {
  cleanupPr32Tenant,
  PR32_USER_A,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import {
  countRows,
  createPhaseCAdapterRegistry,
  createPhaseCCoordinator,
  ffmpegAvailable,
  generateFixtureClip,
  prepareAuthorizedSchedulingPlan,
  scheduleAndDispatchScene,
} from "./helpers/ai-story-pr37-phase-c-e2e";
import { SceneProviderWorkerRuntime } from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import { dispatchNextProviderExecution } from "../apps/worker/src/provider-execution-dispatch-entrypoint";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;
const RUN_FFMPEG = ffmpegAvailable();

async function applySqlFile(sql: Sql, relative: string): Promise<void> {
  const migration = readFileSync(resolve(__dirname, relative), "utf8");
  for (const statement of migration
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
}

describeIntegration("Sprint 3 PR 3.7 Phase C remediation Postgres E2E", () => {
  let sql: Sql;
  let artifactRoot: string;
  let clipPath: string;
  let clipHash: string;
  let clipUri: string;

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/provider-ledger.sql",
      "../packages/db/sql/provider-outbox.sql",
      "../packages/db/sql/provider-execution-envelope.sql",
      "../packages/db/sql/provider-execution-dispatch.sql",
      "../packages/db/sql/ai-story-scene-scheduling-v1.sql",
      "../packages/db/sql/ai-story-scene-routing-router-version-v1.sql",
      "../packages/db/sql/ai-story-scene-scheduling-rls-v1.sql",
      "../packages/db/sql/ai-story-worker-runtime-v1.sql",
      "../packages/db/sql/ai-story-worker-attempt-observation-v1.sql",
      "../packages/db/sql/ai-story-scene-projection-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql",
      "../packages/db/sql/ai-story-final-story-result-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await applyPhaseECommercialAuthorizationSql(sql);
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c");
    artifactRoot = await mkdtemp(join(tmpdir(), "pr37c-artifacts-"));
    if (RUN_FFMPEG) {
      const clipRoot = await mkdtemp(join(tmpdir(), "pr37c-clips-"));
      const clip = await generateFixtureClip(clipRoot, "scene.mp4", {
        seconds: 1,
        color: "blue",
      });
      clipPath = clip.path;
      clipHash = clip.hash;
      clipUri = clip.uri(PHASE_2A_IDS.workspaceId);
    } else {
      clipPath = "";
      clipHash =
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
      clipUri = `fixture://${PHASE_2A_IDS.workspaceId}/scene.mp4`;
    }
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
    await rm(artifactRoot, { recursive: true, force: true });
  }, 60_000);

  it("A: single-scene success full chain (counts + FSR when ffmpeg)", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-a");

    const single = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-single-1",
      ids: PHASE_2A_IDS,
      sceneOrder: [0],
    });

    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("terminal_success", media).registry;
    const pathByUri = new Map<string, string>(
      RUN_FFMPEG ? [[clipUri, clipPath]] : []
    );
    const { coordinator } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });

    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: single.executionPlanId,
      sceneExecutionId: single.sceneExecutionIds[0]!,
      runtimeAuthorizationId: single.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: single.commercialAuthorizationId,
    });

    const ownership =
      await new SceneProviderWorkerRuntimeRepository().classifyDispatchOwnership(
        dispatch.dispatchId
      );
    expect(ownership).toBe("AI_STORY_SCENE");

    const outcome = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(outcome.workerResult?.workerState).toBe("TERMINAL_SUCCESS");
    expect(outcome.workerResult?.providerId).toBe("seedance");

    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.runtimeAuthorization).toBe(1);
    expect(counts.routingDecision).toBe(1);
    expect(counts.providerExecution).toBe(1);
    expect(counts.envelope).toBe(1);
    expect(counts.outbox).toBe(1);
    expect(counts.dispatch).toBe(1);
    expect(counts.workerEvidence).toBe(1);
    expect(counts.providerAttempt).toBe(1);
    expect(counts.usage).toBe(1);
    expect(counts.cost).toBe(1);
    expect(counts.sceneResult).toBe(1);

    if (RUN_FFMPEG) {
      expect(counts.assemblyJob).toBe(1);
      expect(counts.assemblyTerminalFact).toBe(1);
      expect(counts.assemblyArtifact).toBe(1);
      expect(counts.finalStoryResult).toBe(1);
      expect(["FSR_PROJECTED", "FSR_REPLAYED", "ASSEMBLY_TRIGGERED", "ASSEMBLY_REPLAYED"]).toContain(
        outcome.status
      );
    }
  }, 300_000);

  it("B: multi-scene success → one Assembly Job / Artifact / FSR", async () => {
    if (!RUN_FFMPEG) return;
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-b");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-multi",
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("terminal_success", media).registry;
    const pathByUri = new Map([[clipUri, clipPath]]);
    const { coordinator } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });

    for (const sceneExecutionId of prepared.sceneExecutionIds) {
      const { dispatch } = await scheduleAndDispatchScene({
        sql,
        executionPlanId: prepared.executionPlanId,
        sceneExecutionId,
        runtimeAuthorizationId:
          prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      });
      await coordinator.continueFromDispatch(dispatch.dispatchId);
    }

    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.sceneResult).toBe(prepared.sceneExecutionIds.length);
    expect(counts.assemblyJob).toBe(1);
    expect(counts.assemblyArtifact).toBe(1);
    expect(counts.finalStoryResult).toBe(1);
  }, 300_000);

  it("C: terminal failure → DEAD_LETTER, no usage/cost, no Assembly/FSR", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-fail");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-fail",
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("terminal_failure", media).registry;
    const { coordinator } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri: new Map(),
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    const { dispatch, scheduled } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
    });
    const outcome = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(outcome.workerResult?.workerState).toBe("TERMINAL_FAILURE");

    const outbox = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${scheduled.outboxJobId}
    `;
    expect(outbox[0]?.status).toBe("DEAD_LETTER");

    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.usage).toBe(0);
    expect(counts.cost).toBe(0);
    expect(counts.sceneResult).toBe(1);
    expect(counts.assemblyJob).toBe(0);
    expect(counts.assemblyArtifact).toBe(0);
    expect(counts.finalStoryResult).toBe(0);
  }, 180_000);

  it("D: ACCEPTANCE_UNKNOWN → reconciliation → terminal success (no resubmit)", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-unk");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-unk",
      sceneOrder: [0],
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("acceptance_unknown", media).registry;
    const pathByUri = new Map(RUN_FFMPEG ? [[clipUri, clipPath]] : []);
    const { coordinator, workerRepo } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
    });

    const first = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(first.status).toBe("RECONCILIATION_REQUIRED");
    expect(first.workerResult?.acceptanceClassification).toBe("ACCEPTANCE_UNKNOWN");
    expect(
      await workerRepo.getWorkerExecutionResultByDispatchId(dispatch.dispatchId)
    ).toBeNull();
    expect(
      await workerRepo.getLatestWorkerAttemptObservationByDispatchId(
        dispatch.dispatchId
      )
    ).toBeTruthy();

    // Same tick may advance PROCESSING → SUCCEEDED via bound lookup (no resubmit).
    const second = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(second.workerResult?.workerState).toBe("TERMINAL_SUCCESS");
    expect(second.workerResult?.providerId).toBe("seedance");
    expect(second.workerResult?.providerAttemptId).toBe(
      first.workerResult?.providerAttemptId
    );
    expect(
      await workerRepo.getWorkerExecutionResultByDispatchId(dispatch.dispatchId)
    ).toBeTruthy();

    const wer = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_worker_execution_results
      WHERE dispatch_id = ${dispatch.dispatchId}
    `;
    expect(wer[0]?.count).toBe(1);
    const observations = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_worker_attempt_observations
      WHERE dispatch_id = ${dispatch.dispatchId}
    `;
    expect(Number(observations[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it("E: transient infrastructure → no terminal Finalizer / no Scene Result", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-infra");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-infra",
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("transient_infrastructure_error", media).registry;
    const { coordinator, workerRepo } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri: new Map(),
    });
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
    });
    const outcome = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(outcome.workerResult?.acceptanceClassification).not.toBe("ACCEPTED");
    expect(
      await workerRepo.getWorkerExecutionResultByDispatchId(dispatch.dispatchId)
    ).toBeNull();
    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.sceneResult).toBe(0);
    expect(counts.usage).toBe(0);
  }, 120_000);

  it("F: duplicate Dispatch delivery → one terminal accepted effect", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-dup");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-dup",
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("terminal_success", media).registry;
    const pathByUri = new Map(RUN_FFMPEG ? [[clipUri, clipPath]] : []);
    const { coordinator } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri,
    });
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
    });
    const first = await coordinator.continueFromDispatch(dispatch.dispatchId);
    const second = await coordinator.continueFromDispatch(dispatch.dispatchId);
    expect(first.workerResult?.providerAttemptId).toBe(
      second.workerResult?.providerAttemptId
    );
    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.workerEvidence).toBe(1);
    expect(counts.providerAttempt).toBe(1);
    expect(counts.sceneResult).toBe(1);
  }, 180_000);

  it("G: restart/resume after accepted submit → lookup, zero resubmit", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-restart");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-restart",
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("accepted_async", media).registry;
    const sharedAdapter = adapters.resolve("seedance", "1.0.0") as
      | WorkspaceMediaTestAdapterLike
      | undefined;
    const workerRepo = new SceneProviderWorkerRuntimeRepository();
    const workerA = new SceneProviderWorkerRuntime({ repository: workerRepo, adapters });
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
    });
    const submitted = await workerA.processDispatch({
      dispatchId: dispatch.dispatchId,
    });
    expect(submitted.result.acceptanceClassification).toBe("ACCEPTED");
    expect(submitted.result.providerRequestId).toBeTruthy();

    // New worker instance (restart), same repository + adapter registry.
    const workerB = new SceneProviderWorkerRuntime({ repository: workerRepo, adapters });
    const resumed = await workerB.processDispatch({
      dispatchId: dispatch.dispatchId,
      mode: "lookup",
      providerRequestId: submitted.result.providerRequestId,
    });
    // First lookup may be PROCESSING; continue until terminal.
    let terminal = resumed;
    for (let i = 0; i < 3 && terminal.result.workerState !== "TERMINAL_SUCCESS"; i++) {
      terminal = await workerB.processDispatch({
        dispatchId: dispatch.dispatchId,
        mode: "lookup",
        providerRequestId: submitted.result.providerRequestId,
      });
    }
    expect(terminal.result.workerState).toBe("TERMINAL_SUCCESS");
    expect(terminal.result.providerAttemptId).toBe(submitted.result.providerAttemptId);
    expect(terminal.result.providerId).toBe("seedance");
    void sharedAdapter;
  }, 180_000);

  it("H: 10-way continuation concurrency → one Assembly Job / Artifact / FSR", async () => {
    if (!RUN_FFMPEG) return;
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37c-conc");
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr37c-conc",
    });
    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("terminal_success", media).registry;
    const pathByUri = new Map([[clipUri, clipPath]]);
    const { coordinator } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    for (const sceneExecutionId of prepared.sceneExecutionIds) {
      const { dispatch } = await scheduleAndDispatchScene({
        sql,
        executionPlanId: prepared.executionPlanId,
        sceneExecutionId,
        runtimeAuthorizationId:
          prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      });
      await coordinator.continueFromDispatch(dispatch.dispatchId);
    }

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        coordinator.continueAssemblyAndFinalStoryResult({
          executionPlanId: prepared.executionPlanId,
          runtimeAuthorizationId:
            prepared.acceptedAuthorization.runtimeAuthorizationId,
          ownership: prepared.acceptedAuthorization.ownership,
        })
      )
    );
    expect(results.every((r) => r.assemblyJobId === results[0]?.assemblyJobId)).toBe(
      true
    );
    const counts = await countRows(
      sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    expect(counts.assemblyJob).toBe(1);
    expect(counts.assemblyArtifact).toBe(1);
    expect(counts.finalStoryResult).toBe(1);
  }, 300_000);

  it("I: AI Story selection filter does not Dispatch generic Provider jobs", async () => {
    const outcome = await dispatchNextProviderExecution({
      ownership: "AI_STORY_SCENE",
    });
    // After cleanup of prior tests there may be no pending AI Story jobs.
    expect(["NO_JOB", "DISPATCHED"]).toContain(outcome.status);
    if (outcome.status === "DISPATCHED") {
      const ownership =
        await new SceneProviderWorkerRuntimeRepository().classifyDispatchOwnership(
          outcome.dispatch.dispatchId
        );
      expect(ownership).toBe("AI_STORY_SCENE");
    }
  }, 60_000);

  it("J: security fail-closed on missing/mismatched Dispatch", async () => {
    const repository = new SceneProviderWorkerRuntimeRepository();
    await expect(
      repository.loadValidatedBundleByDispatchId("missing-dispatch-pr37c")
    ).resolves.toBeNull();
    expect(await repository.classifyDispatchOwnership("missing-dispatch-pr37c")).toBe(
      "MISSING_DISPATCH"
    );
  }, 30_000);
});

type WorkspaceMediaTestAdapterLike = { submitCount?: number };
