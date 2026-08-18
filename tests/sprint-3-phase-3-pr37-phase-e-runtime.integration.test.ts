/**
 * Sprint 3 PR 3.7 Phase E — product runtime projection after canonical Execute (Postgres).
 * Happy-path continuation uses Phase C test adapters (no live Seedance/MiniMax).
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb } from "@ceo-agent/db";
import { authorizeAndExecuteExecutionPlan } from "../packages/agents/src/ai-story/authorize-and-execute-execution-plan";
import { deriveProductRuntimeProjection } from "../packages/agents/src/ai-story/derive-product-runtime-projection";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialSql } from "./helpers/commercial-phase-e-sql";
import { PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";
import {
  cleanupPr32Tenant,
  FixedSeedanceRouter,
  PR32_USER_A,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import { prepareReadyForCanonicalExecute } from "./helpers/ai-story-pr37-phase-d-execute";
import {
  countRows,
  createPhaseCAdapterRegistry,
  createPhaseCCoordinator,
  ffmpegAvailable,
  generateFixtureClip,
  scheduleAndDispatchScene,
} from "./helpers/ai-story-pr37-phase-c-e2e";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

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

describeIntegration("Sprint 3 PR 3.7 Phase E runtime projection (Postgres)", () => {
  let sql: Sql;
  let artifactRoot: string;
  let clipPath = "";
  let clipHash = "";
  let clipUri = "";

  beforeAll(async () => {
    sql = createIntegrationSql();
    artifactRoot = await mkdtemp(join(tmpdir(), "pr37e-"));
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
      "../packages/db/sql/ai-story-worker-runtime-v1.sql",
      "../packages/db/sql/ai-story-worker-attempt-observation-v1.sql",
      "../packages/db/sql/ai-story-scene-projection-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql",
      "../packages/db/sql/ai-story-final-story-result-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await applyPhaseECommercialSql(sql);
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37e");
    if (RUN_FFMPEG) {
      const clipRoot = await mkdtemp(join(tmpdir(), "pr37e-clips-"));
      const clip = await generateFixtureClip(clipRoot, "scene.mp4", {
        seconds: 1,
        color: "blue",
      });
      clipPath = clip.path;
      clipHash = clip.hash;
      clipUri = clip.uri(PHASE_2A_IDS.workspaceId);
    }
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
    await rm(artifactRoot, { recursive: true, force: true });
  }, 60_000);

  it("READY → Execute → runtime statuses; SUCCEEDED when ffmpeg available", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37e-happy");

    const ready = await prepareReadyForCanonicalExecute({
      purpose: "pr37e-happy",
      ids: PHASE_2A_IDS,
      userId: PR32_USER_A,
      sceneOrder: [0],
    });

    const beforeReady = await deriveProductRuntimeProjection({
      executionPlanId: ready.executionPlanId,
      callerRole: "operator",
    });
    expect(beforeReady.status).toBe("READY_FOR_EXECUTION");
    expect(beforeReady.canExecute).toBe(true);

    const viewerReady = await deriveProductRuntimeProjection({
      executionPlanId: ready.executionPlanId,
      callerRole: "client_viewer",
    });
    expect(viewerReady.canExecute).toBe(false);

    const executed = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: PR32_USER_A,
      ownership: ready.ownership,
      router: new FixedSeedanceRouter(),
    });

    const afterAuth = await deriveProductRuntimeProjection({
      executionPlanId: ready.executionPlanId,
      callerRole: "operator",
    });
    expect(afterAuth.canExecute).toBe(false);
    expect(["AUTHORIZED", "SCENES_RUNNING"]).toContain(afterAuth.status);
    expect(afterAuth.runtimeAuthorizationId).toBe(executed.runtimeAuthorizationId);

    if (!RUN_FFMPEG) {
      console.warn("ffmpeg unavailable — skipping SUCCEEDED assertion");
      return;
    }

    const media = { uri: clipUri, contentHash: clipHash };
    const adapters = createPhaseCAdapterRegistry("terminal_success", media).registry;
    const pathByUri = new Map<string, string>([[clipUri, clipPath]]);
    const { coordinator } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });

    // Execute already scheduled; scheduleAuthorizedScene converges and we persist Dispatch.
    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: ready.executionPlanId,
      sceneExecutionId: ready.sceneExecutionIds[0]!,
      runtimeAuthorizationId: executed.runtimeAuthorizationId,
      commercialAuthorizationId: executed.commercialAuthorizationId,
    });
    await coordinator.continueFromDispatch(dispatch.dispatchId);

    const finalProjection = await deriveProductRuntimeProjection({
      executionPlanId: ready.executionPlanId,
      callerRole: "client_viewer",
    });
    expect(finalProjection.status).toBe("SUCCEEDED");
    expect(finalProjection.hasFinalStoryResult).toBe(true);
    expect(finalProjection.canExecute).toBe(false);
    expect(finalProjection.succeededSceneCount).toBe(1);

    const before = await countRows(sql, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.orgId);
    expect(before.finalStoryResult).toBe(1);
    await deriveProductRuntimeProjection({
      executionPlanId: ready.executionPlanId,
      callerRole: "operator",
    });
    expect(await countRows(sql, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.orgId)).toEqual(
      before
    );
  }, 300_000);

  it("terminal scene failure → SCENES_FAILED, no FSR", async () => {
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr37e-fail");

    const ready = await prepareReadyForCanonicalExecute({
      purpose: "pr37e-fail",
      ids: PHASE_2A_IDS,
      userId: PR32_USER_A,
      sceneOrder: [0],
    });
    const executed = await authorizeAndExecuteExecutionPlan({
      executionPlanId: ready.executionPlanId,
      actorUserId: PR32_USER_A,
      ownership: ready.ownership,
      router: new FixedSeedanceRouter(),
    });

    const media = {
      uri: clipUri || `fixture://${PHASE_2A_IDS.workspaceId}/scene.mp4`,
      contentHash:
        clipHash ||
        "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    };
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

    const { dispatch } = await scheduleAndDispatchScene({
      sql,
      executionPlanId: ready.executionPlanId,
      sceneExecutionId: ready.sceneExecutionIds[0]!,
      runtimeAuthorizationId: executed.runtimeAuthorizationId,
      commercialAuthorizationId: executed.commercialAuthorizationId,
    });
    await coordinator.continueFromDispatch(dispatch.dispatchId);

    const projection = await deriveProductRuntimeProjection({
      executionPlanId: ready.executionPlanId,
      callerRole: "operator",
    });
    expect(projection.status).toBe("SCENES_FAILED");
    expect(projection.hasFinalStoryResult).toBe(false);
    expect(projection.safeFailureSummary).toBeTruthy();
    const counts = await countRows(sql, PHASE_2A_IDS.workspaceId, PHASE_2A_IDS.orgId);
    expect(counts.finalStoryResult).toBe(0);
  }, 300_000);
});
