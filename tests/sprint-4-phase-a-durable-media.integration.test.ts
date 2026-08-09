/**
 * Sprint 4 Phase A — Durable Scene Media Attestation PostgreSQL integration.
 * Requires RUN_DB_INTEGRATION_TESTS=1 and DATABASE_URL.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createExecutionDispatch } from "@ceo-agent/shared";
import {
  DurableSceneMediaPersistenceError,
  DurableSceneMediaAttestationRepositoryImpl,
  SceneProjectionRepositoryImpl,
  SceneProviderWorkerRuntimeRepository,
  ProviderExecutionFinalizationRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  ExecutionEnvelopeRepository,
  closeDb,
} from "@ceo-agent/db";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import { SceneFinalizationCoordinator } from "../packages/agents/src/ai-story/scene-finalization-coordinator";
import { buildDurableSceneMediaAttestation } from "../packages/agents/src/ai-story";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import { buildTerminalSuccessWorkerResult } from "./helpers/ai-story-pr35-finalizer";
import { PHASE_2A_IDS, PHASE_2A_WORKSPACE_B_IDS } from "./helpers/ai-story-phase-2a";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

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

async function persistDispatch(
  sql: Sql,
  scheduled: {
    outboxJobId: string;
    providerExecutionId: string;
    envelopeId: string;
    payloadReference: string;
    correlation: {
      correlationId: string;
      ownership: { orgId: string; workspaceId: string };
      scheduledAt: string;
    };
    routingDecision: {
      capabilityId: string;
      capabilityVersion: string;
    };
    requestHash: string;
    envelopeHash: string;
  }
) {
  const dispatch = await createExecutionDispatch({
    version: "1",
    dispatchId: `dispatch:${scheduled.outboxJobId}`,
    jobId: scheduled.outboxJobId,
    executionId: scheduled.providerExecutionId,
    envelopeId: scheduled.envelopeId,
    payloadReference: scheduled.payloadReference,
    correlationId: scheduled.correlation.correlationId,
    tenantId: scheduled.correlation.ownership.orgId,
    workspaceId: scheduled.correlation.ownership.workspaceId,
    capabilityId: scheduled.routingDecision.capabilityId,
    capabilityVersion: scheduled.routingDecision.capabilityVersion,
    requestHash: scheduled.requestHash,
    envelopeHash: scheduled.envelopeHash,
    workerHandoff: {
      envelopeId: scheduled.envelopeId,
      payloadReference: scheduled.payloadReference,
      dispatchContractVersion: "1",
    },
    status: "DISPATCHED",
    createdAt: scheduled.correlation.scheduledAt,
  });

  await sql`
    INSERT INTO provider_execution_dispatches (
      dispatch_id, version, job_id, execution_id, envelope_id,
      payload_reference, correlation_id, org_id, workspace_id,
      capability_id, capability_version, request_hash, envelope_hash,
      worker_handoff, dispatch_hash, status, created_at
    ) VALUES (
      ${dispatch.dispatchId},
      ${dispatch.version},
      ${dispatch.jobId},
      ${dispatch.executionId},
      ${dispatch.envelopeId},
      ${dispatch.payloadReference},
      ${dispatch.correlationId},
      ${dispatch.tenantId},
      ${dispatch.workspaceId},
      ${dispatch.capabilityId},
      ${dispatch.capabilityVersion},
      ${dispatch.requestHash},
      ${dispatch.envelopeHash},
      ${sql.json(dispatch.workerHandoff)},
      ${dispatch.dispatchHash},
      ${dispatch.status},
      ${dispatch.createdAt}
    )
  `;
  return dispatch;
}

describeIntegration("Sprint 4 Phase A durable scene media persistence", () => {
  let sql: Sql;
  const repo = () => new DurableSceneMediaAttestationRepositoryImpl();

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
      "../packages/db/sql/ai-story-scene-projection-v1.sql",
      "../packages/db/sql/ai-story-durable-scene-media-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "s4a");
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  async function projectSucceededScene() {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "s4a-durable-media",
    });
    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      actorUserId: PR32_USER_A,
    });
    await new ExecutionEnvelopeRepository().getEnvelope(scheduled.envelopeId);
    const dispatch = await persistDispatch(sql, scheduled);

    const chain = new SceneProjectionRepositoryImpl();
    const loaded = await chain.loadValidatedBundleByDispatchId(dispatch.dispatchId);
    expect(loaded).toBeTruthy();
    const worker = buildTerminalSuccessWorkerResult(loaded!, {
      providerExecutionId: loaded!.providerExecutionId,
      outboxJobId: loaded!.outboxJobId,
      dispatchId: loaded!.dispatch.dispatchId,
      routingDecisionId: loaded!.routingDecision.routingDecisionId,
      providerId: loaded!.routingDecision.selectedProviderId,
      adapterVersion: loaded!.routingDecision.selectedAdapterVersion,
      providerAttemptId: crypto.randomUUID(),
      workerExecutionResultId: crypto.randomUUID(),
    });
    await new SceneProviderWorkerRuntimeRepository().acceptOrReturnWorkerExecutionResult(
      worker
    );

    const outcome = await new SceneFinalizationCoordinator({
      chain,
      bridge: {
        ledger: new ProviderLedgerRepository(),
        outbox: new ProviderOutboxRepository(),
      },
      productionFinalizer: new ProviderExecutionFinalizationRepository(),
      projection: chain,
    }).finalizeAndProject({ dispatchId: dispatch.dispatchId });
    expect(outcome.outcome).toBe("PROJECTED");
    if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");

    return {
      prepared,
      sceneResult: outcome.sceneResult,
      ownership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
        campaignId: PHASE_2A_IDS.campaignId,
        storyId: PHASE_2A_IDS.storyId,
        storyVersionId: PHASE_2A_IDS.storyVersionId,
        animationPackageId: PHASE_2A_IDS.animationPackageId,
        executionPlanId: prepared.executionPlanId,
      },
    };
  }

  function makeAttestation(input: {
    ownership: {
      orgId: string;
      workspaceId: string;
      campaignId: string;
      storyId: string;
      storyVersionId: string;
      animationPackageId: string;
      executionPlanId: string;
    };
    sceneExecutionId: string;
    sceneResultId: string;
    contentHash: string;
    durableObjectReference: string;
    byteSize?: number;
    acceptedAt?: string;
  }) {
    return buildDurableSceneMediaAttestation({
      ownership: input.ownership,
      sceneExecutionId: input.sceneExecutionId,
      sceneResultId: input.sceneResultId,
      sourceHttpsUri:
        "https://cdn.example.com/media/scene.mp4?token=secret&sig=abc",
      durableObjectReference: input.durableObjectReference,
      contentHash: input.contentHash,
      byteSize: input.byteSize ?? 2048,
      acceptedAt: input.acceptedAt ?? "2026-08-10T12:00:00.000Z",
    });
  }

  it("accepts attestation", async () => {
    const { sceneResult, ownership } = await projectSucceededScene();
    const contentHash =
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const durableObjectReference = `${ownership.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/${contentHash.slice(7)}.mp4`;
    const attestation = makeAttestation({
      ownership,
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash,
      durableObjectReference,
    });

    const accepted = await repo().acceptOrConverge(attestation);
    expect(accepted.replayed).toBe(false);
    expect(accepted.attestation.mediaAttestationId).toBe(
      attestation.mediaAttestationId
    );
    expect(accepted.attestation.contentHash).toBe(contentHash);

    const loaded = await repo().getBySceneResultId(sceneResult.sceneResultId);
    expect(loaded?.integrityHash).toBe(attestation.integrityHash);
  });

  it("replay converge returns existing attestation", async () => {
    const { sceneResult, ownership } = await projectSucceededScene();
    const contentHash =
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const durableObjectReference = `${ownership.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/${contentHash.slice(7)}.mp4`;
    const attestation = makeAttestation({
      ownership,
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash,
      durableObjectReference,
    });

    const first = await repo().acceptOrConverge(attestation);
    expect(first.replayed).toBe(false);
    const second = await repo().acceptOrConverge(attestation);
    expect(second.replayed).toBe(true);
    expect(second.attestation.mediaAttestationId).toBe(
      first.attestation.mediaAttestationId
    );
  });

  it("conflict fail closed for different contentHash same sceneResultId", async () => {
    const { sceneResult, ownership } = await projectSucceededScene();
    const hashA =
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const hashB =
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
    const first = makeAttestation({
      ownership,
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash: hashA,
      durableObjectReference: `${ownership.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/${hashA.slice(7)}.mp4`,
    });
    await repo().acceptOrConverge(first);

    const conflicting = makeAttestation({
      ownership,
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash: hashB,
      durableObjectReference: `${ownership.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/${hashB.slice(7)}.mp4`,
    });

    await expect(repo().acceptOrConverge(conflicting)).rejects.toBeInstanceOf(
      DurableSceneMediaPersistenceError
    );
    await expect(repo().acceptOrConverge(conflicting)).rejects.toMatchObject({
      code: "DURABLE_SCENE_MEDIA_IDENTITY_CONFLICT",
    });
  });

  it("listByExecutionPlanId returns accepted attestations", async () => {
    const { sceneResult, ownership, prepared } = await projectSucceededScene();
    const contentHash =
      "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const attestation = makeAttestation({
      ownership,
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash,
      durableObjectReference: `${ownership.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/${contentHash.slice(7)}.mp4`,
    });
    await repo().acceptOrConverge(attestation);

    const listed = await repo().listByExecutionPlanId(prepared.executionPlanId);
    expect(listed.some((row) => row.sceneResultId === sceneResult.sceneResultId)).toBe(
      true
    );
    expect(
      listed.every((row) => row.executionPlanId === prepared.executionPlanId)
    ).toBe(true);
  });

  it("cross-workspace ownership denial", async () => {
    const { sceneResult, ownership } = await projectSucceededScene();
    const contentHash =
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    // Claim workspace B ownership against workspace A scene result.
    const foreign = makeAttestation({
      ownership: {
        ...ownership,
        orgId: PHASE_2A_WORKSPACE_B_IDS.orgId,
        workspaceId: PHASE_2A_WORKSPACE_B_IDS.workspaceId,
        campaignId: PHASE_2A_WORKSPACE_B_IDS.campaignId,
        storyId: PHASE_2A_WORKSPACE_B_IDS.storyId,
        storyVersionId: PHASE_2A_WORKSPACE_B_IDS.storyVersionId,
        animationPackageId: PHASE_2A_WORKSPACE_B_IDS.animationPackageId,
      },
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash,
      durableObjectReference: `${PHASE_2A_WORKSPACE_B_IDS.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/${contentHash.slice(7)}.mp4`,
    });

    await expect(repo().acceptOrConverge(foreign)).rejects.toMatchObject({
      code: "DURABLE_SCENE_MEDIA_OWNERSHIP_INVALID",
    });
  });

  it("10 concurrent identical durable-media ingests converge to one attestation", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const {
      createLocalDurableObjectStore,
      ingestProviderSceneMedia,
      buildDurableSceneMediaObjectKey,
    } = await import("../packages/agents/src/ai-story");

    const { sceneResult, ownership } = await projectSucceededScene();
    const bytes = Buffer.from(
      "s4a-concurrent-identical-provider-media-bytes-v1\n".repeat(64)
    );
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const expectedObjectKey = buildDurableSceneMediaObjectKey({
      workspaceId: ownership.workspaceId,
      executionPlanId: ownership.executionPlanId,
      sceneExecutionId: sceneResult.sceneExecutionId,
      contentHash,
    });

    const storeRoot = await mkdtemp(join(tmpdir(), "s4a-concurrent-ingest-"));
    const store = createLocalDurableObjectStore(storeRoot);
    const fetchImpl: typeof fetch = async () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": String(bytes.length) },
      });

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        ingestProviderSceneMedia({
          ingest: {
            ownership,
            sceneExecutionId: sceneResult.sceneExecutionId,
            sceneResultId: sceneResult.sceneResultId,
            sourceHttpsUri:
              "https://cdn.example.com/media/concurrent.mp4?token=ephemeral",
            fetchImpl,
            now: () => new Date("2026-08-10T12:30:00.000Z"),
          },
          store,
          repository: repo(),
        })
      )
    );

    const freshAccepts = outcomes.filter((row) => !row.replayed).length;
    const attestationIds = new Set(
      outcomes.map((row) => row.attestation.mediaAttestationId)
    );
    const contentHashes = new Set(outcomes.map((row) => row.attestation.contentHash));
    const objectKeys = new Set(
      outcomes.map((row) => row.attestation.durableObjectReference)
    );

    expect(outcomes).toHaveLength(10);
    expect(freshAccepts).toBeLessThanOrEqual(1);
    expect(attestationIds.size).toBe(1);
    expect(contentHashes.size).toBe(1);
    expect(contentHashes.has(contentHash)).toBe(true);
    expect(objectKeys.size).toBe(1);
    expect(objectKeys.has(expectedObjectKey)).toBe(true);

    const dbRows = await sql`
      SELECT media_attestation_id, content_hash, durable_object_reference
      FROM ai_story_durable_scene_media_attestations
      WHERE scene_result_id = ${sceneResult.sceneResultId}
    `;
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.content_hash).toBe(contentHash);
    expect(dbRows[0]!.durable_object_reference).toBe(expectedObjectKey);

    await store.assertReadableObject({
      workspaceId: ownership.workspaceId,
      objectKey: expectedObjectKey,
      expectedContentHash: contentHash,
    });

    // No alternate object keys for this scene execution under the content-addressed prefix.
    const listed = await repo().listByExecutionPlanId(ownership.executionPlanId);
    const forScene = listed.filter(
      (row) => row.sceneResultId === sceneResult.sceneResultId
    );
    expect(forScene).toHaveLength(1);

    await rm(storeRoot, { recursive: true, force: true });
  }, 180_000);

  it("conflicting-byte concurrency fail-closes without overwrite", async () => {
    const { mkdtemp, writeFile, rm, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const {
      createLocalDurableObjectStore,
      hashFileSha256Stream,
      DurableObjectStoreError,
    } = await import("../packages/agents/src/ai-story");

    const { sceneResult, ownership } = await projectSucceededScene();
    const bytesA = Buffer.from("s4a-conflict-bytes-A-v1");
    const bytesB = Buffer.from("s4a-conflict-bytes-B-v1-DIFFERENT");
    const hashA = `sha256:${createHash("sha256").update(bytesA).digest("hex")}`;
    const hashB = `sha256:${createHash("sha256").update(bytesB).digest("hex")}`;
    expect(hashA).not.toBe(hashB);

    // Same immutable object key identity (force shared key) with conflicting bytes.
    const sharedObjectKey = `${ownership.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/shared-conflict.mp4`;
    const storeRoot = await mkdtemp(join(tmpdir(), "s4a-conflict-bytes-"));
    const store = createLocalDurableObjectStore(storeRoot);
    const pathA = join(storeRoot, "a.bin");
    const pathB = join(storeRoot, "b.bin");
    await writeFile(pathA, bytesA);
    await writeFile(pathB, bytesB);

    const putSettled = await Promise.allSettled([
      store.putImmutableObject({
        workspaceId: ownership.workspaceId,
        objectKey: sharedObjectKey,
        localPath: pathA,
        contentHash: hashA,
        mediaType: "video/mp4",
        byteSize: bytesA.length,
      }),
      store.putImmutableObject({
        workspaceId: ownership.workspaceId,
        objectKey: sharedObjectKey,
        localPath: pathB,
        contentHash: hashB,
        mediaType: "video/mp4",
        byteSize: bytesB.length,
      }),
    ]);
    const putOk = putSettled.filter((row) => row.status === "fulfilled");
    const putFail = putSettled.filter((row) => row.status === "rejected");
    expect(putOk.length).toBe(1);
    expect(putFail.length).toBe(1);
    expect(putFail[0]).toMatchObject({
      status: "rejected",
      reason: expect.any(DurableObjectStoreError),
    });

    const winnerHash = await hashFileSha256Stream(join(storeRoot, sharedObjectKey));
    expect([hashA, hashB]).toContain(winnerHash);
    // Object bytes must equal exactly one of the inputs — never a mix.
    const stored = await readFile(join(storeRoot, sharedObjectKey));
    expect(
      stored.equals(bytesA) || stored.equals(bytesB)
    ).toBe(true);

    const attestationWinner = makeAttestation({
      ownership,
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash: winnerHash,
      durableObjectReference: sharedObjectKey,
      byteSize: stored.length,
    });
    const attestationLoser = makeAttestation({
      ownership,
      sceneExecutionId: sceneResult.sceneExecutionId,
      sceneResultId: sceneResult.sceneResultId,
      contentHash: winnerHash === hashA ? hashB : hashA,
      durableObjectReference: `${ownership.workspaceId}/ai-story/scenes/${ownership.executionPlanId}/${sceneResult.sceneExecutionId}/loser-key.mp4`,
      byteSize: winnerHash === hashA ? bytesB.length : bytesA.length,
    });

    // Converge the object-matching attestation under concurrency first.
    const winnerSettled = await Promise.all(
      Array.from({ length: 10 }, () => repo().acceptOrConverge(attestationWinner))
    );
    const freshWinner = winnerSettled.filter((row) => !row.replayed).length;
    expect(freshWinner).toBeLessThanOrEqual(1);
    expect(
      new Set(winnerSettled.map((row) => row.attestation.mediaAttestationId)).size
    ).toBe(1);

    // Conflicting-byte attestation identity must fail closed — no second acceptance.
    const loserSettled = await Promise.allSettled(
      Array.from({ length: 10 }, () => repo().acceptOrConverge(attestationLoser))
    );
    expect(loserSettled.every((row) => row.status === "rejected")).toBe(true);
    for (const row of loserSettled) {
      if (row.status !== "rejected") continue;
      expect(row.reason).toMatchObject({
        code: "DURABLE_SCENE_MEDIA_IDENTITY_CONFLICT",
      });
    }

    const dbRows = await sql`
      SELECT media_attestation_id, content_hash, durable_object_reference, integrity_hash
      FROM ai_story_durable_scene_media_attestations
      WHERE scene_result_id = ${sceneResult.sceneResultId}
    `;
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.content_hash).toBe(winnerHash);
    expect(dbRows[0]!.media_attestation_id).toBe(
      attestationWinner.mediaAttestationId
    );
    expect(dbRows[0]!.integrity_hash).toBe(attestationWinner.integrityHash);

    // Winner object still readable and uncorrupted after conflict race.
    await store.assertReadableObject({
      workspaceId: ownership.workspaceId,
      objectKey: sharedObjectKey,
      expectedContentHash: winnerHash,
    });

    await rm(storeRoot, { recursive: true, force: true });
  }, 180_000);
});
