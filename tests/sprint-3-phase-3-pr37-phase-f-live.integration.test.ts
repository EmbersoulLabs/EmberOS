/**
 * Sprint 3 PR 3.7 Phase F — Live Seedance / MiniMax full-chain acceptance gates.
 *
 * Opt-in only. Never marks skipped runs as PASS.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb } from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialSql } from "./helpers/commercial-phase-e-sql";
import { cleanupPr32Tenant } from "./helpers/ai-story-pr32-scheduling";
import {
  isPhaseFLiveGateEnabled,
  phaseFProviderReady,
  runPhaseFLiveFullChainGate,
} from "./helpers/ai-story-pr37-phase-f-live";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

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

describeIntegration("Sprint 3 PR 3.7 Phase F live Provider acceptance", () => {
  let sql: Sql;

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
      "../packages/db/sql/ai-story-worker-runtime-v1.sql",
      "../packages/db/sql/ai-story-worker-attempt-observation-v1.sql",
      "../packages/db/sql/ai-story-scene-projection-v1.sql",
      "../packages/db/sql/ai-story-generated-scene-review-v1.sql",
      "../packages/db/sql/ai-story-assembly-job-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-runtime-artifact-v1.sql",
      "../packages/db/sql/ai-story-final-story-result-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await applyPhaseECommercialSql(sql);
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  it.skipIf(!isPhaseFLiveGateEnabled())(
    "Gate A — Seedance live full chain (opt-in)",
    async () => {
      const ready = phaseFProviderReady("seedance");
      if (!ready.ok) {
        expect.fail(`BLOCKED_BY_ENVIRONMENT: Seedance — ${ready.reason}`);
      }

      const report = await runPhaseFLiveFullChainGate({ sql, provider: "seedance" });
      expect(report.ran).toBe(true);
      expect(report.error).toBeUndefined();
      expect(report.productStatus).toBe("SUCCEEDED");
      expect(report.hasFinalStoryResult).toBe(true);
      expect(report.counts?.runtimeAuthorization).toBe(1);
      expect(report.counts?.routingDecision).toBe(1);
      expect(report.counts?.providerExecution).toBe(1);
      expect(report.counts?.envelope).toBe(1);
      expect(report.counts?.outbox).toBe(1);
      expect(report.counts?.dispatch).toBe(1);
      expect(report.counts?.workerEvidence).toBe(1);
      expect(report.counts?.usage).toBe(1);
      expect(report.counts?.cost).toBe(1);
      expect(report.counts?.sceneResult).toBe(1);
      expect(report.counts?.assemblyJob).toBe(1);
      expect(report.counts?.assemblyArtifact).toBe(1);
      expect(report.counts?.finalStoryResult).toBe(1);
    },
    900_000
  );

  it.skipIf(!isPhaseFLiveGateEnabled())(
    "Gate B — MiniMax live full chain (opt-in)",
    async () => {
      const ready = phaseFProviderReady("minimax");
      if (!ready.ok) {
        expect.fail(`BLOCKED_BY_ENVIRONMENT: MiniMax — ${ready.reason}`);
      }

      const report = await runPhaseFLiveFullChainGate({ sql, provider: "minimax" });
      expect(report.ran).toBe(true);
      expect(report.error).toBeUndefined();
      expect(report.productStatus).toBe("SUCCEEDED");
      expect(report.hasFinalStoryResult).toBe(true);
      expect(report.counts?.finalStoryResult).toBe(1);
      expect(report.counts?.usage).toBe(1);
      expect(report.counts?.cost).toBe(1);
    },
    900_000
  );
});
