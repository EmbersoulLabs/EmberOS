import "./helpers/block-photoroom-fetch";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Worker } from "bullmq";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPhotoroomNetworkCallCount } from "./helpers/block-photoroom-fetch";
import { closeDb, getDb, schema } from "@ceo-agent/db";
import { QUEUE_NAMES, getBullmqPrefix, getRedisConnection } from "@ceo-agent/queue";
import {
  STORAGE_PATHS,
  USER_SAFE_EXTRACTION_FAILURE_MESSAGE,
  clientPollCannotDeclareFailure,
  photoSceneMetadata,
} from "@ceo-agent/shared";
import { resolveBackgroundRemovalProvider } from "../packages/agents/src/photo-scene/background-removal";
import { encodeRgbaPng, validateExtractedPng } from "../packages/agents/src/photo-scene/png";
import { processPhotoSceneExtractJob } from "../apps/worker/src/processors/photo-scene-extract-handler";
import {
  readLatestCampaignExtraction,
  readProductExtraction,
  requestProductExtraction,
  retryProductExtraction,
} from "../apps/web/src/lib/photo-scene-extraction";
import { signPrivateCampaignAsset } from "../apps/web/src/lib/asset-signed-delivery";
import { createAdminClient } from "../apps/web/src/lib/supabase/admin";
import { isRlsEnabled, withAuthenticatedUser } from "./helpers/db-integration";

const RUN = process.env.RUN_PHOTO_SCENE_RUNTIME_CERT === "1";

function productPng(seed: number): Buffer {
  const width = 32;
  const height = 32;
  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const subject = x > 8 && x < 24 && y > 6 && y < 26;
      rgba[i] = subject ? 40 + seed : 200;
      rgba[i + 1] = subject ? 90 : 200;
      rgba[i + 2] = subject ? 40 : 200;
      rgba[i + 3] = 255;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function waitGeneration(
  db: ReturnType<typeof getDb>,
  generationId: string,
  workspaceId: string,
  status: "ready" | "failed",
  timeoutMs = 45_000
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [generation] = await db
      .select()
      .from(schema.photoSceneGenerations)
      .where(
        and(
          eq(schema.photoSceneGenerations.id, generationId),
          eq(schema.photoSceneGenerations.workspaceId, workspaceId)
        )
      )
      .limit(1);
    if (generation?.status === status) return generation;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for generation ${generationId} to become ${status}`);
}

describe.skipIf(!RUN).sequential("Photo Scene 10B durable runtime zero-paid-API", () => {
  const opsLines: string[] = [];
  let sql: ReturnType<typeof postgres>;
  let worker: Worker | undefined;
  let origInfo: typeof console.info;
  let origError: typeof console.error;
  let origWarn: typeof console.warn;
  const storageKeys: string[] = [];
  const fixture = {
    orgId: "",
    workspaceAId: "",
    workspaceBId: "",
    userAId: "",
    userBId: "",
    campaignAId: "",
    campaignBId: "",
    sourceAId: "",
    sourceBId: "",
    sourceFailId: "",
    generationId: "",
    outputPath: "",
    fingerprint: "",
    sourceHash: "",
  };

  beforeAll(async () => {
    if (resolveBackgroundRemovalProvider().key !== "deterministic") {
      throw new Error("BLOCKED_ZERO_PAID_API_SAFETY");
    }
    origInfo = console.info;
    origError = console.error;
    origWarn = console.warn;
    const capture =
      (fn: typeof console.info) =>
      (...args: unknown[]) => {
        opsLines.push(args.map(String).join(" "));
        fn.apply(console, args as []);
      };
    console.info = capture(origInfo);
    console.error = capture(origError);
    console.warn = capture(origWarn);

    sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: "require" });
    await sql.unsafe(
      readFileSync(resolve(process.cwd(), "packages/db/sql/photo-scene-generations-v1.sql"), "utf8")
    );

    const suffix = crypto.randomUUID().slice(0, 8);
    fixture.orgId = crypto.randomUUID();
    fixture.workspaceAId = crypto.randomUUID();
    fixture.workspaceBId = crypto.randomUUID();
    fixture.userAId = crypto.randomUUID();
    fixture.userBId = crypto.randomUUID();
    fixture.campaignAId = crypto.randomUUID();
    fixture.campaignBId = crypto.randomUUID();
    fixture.sourceAId = crypto.randomUUID();
    fixture.sourceBId = crypto.randomUUID();
    fixture.sourceFailId = crypto.randomUUID();

    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${fixture.orgId}, ${"Photo Scene 10B Cert"}, ${`ps10b-${suffix}`})
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES
        (${fixture.workspaceAId}, ${fixture.orgId}, ${"Cert A"}, ${`cert-a-${suffix}`}),
        (${fixture.workspaceBId}, ${fixture.orgId}, ${"Cert B"}, ${`cert-b-${suffix}`})
    `;
    await sql`
      INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
      VALUES
        (${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.userAId}, ${"admin"}),
        (${fixture.orgId}, ${fixture.workspaceBId}, ${fixture.userBId}, ${"admin"})
    `;
    await sql`
      INSERT INTO campaigns (id, org_id, workspace_id, name, platforms, status)
      VALUES
        (${fixture.campaignAId}, ${fixture.orgId}, ${fixture.workspaceAId}, ${"Cert Campaign A"}, ${["tiktok"]}, ${"draft"}),
        (${fixture.campaignBId}, ${fixture.orgId}, ${fixture.workspaceBId}, ${"Cert Campaign B"}, ${["tiktok"]}, ${"draft"})
    `;

    const bytesA = productPng(1);
    const bytesB = productPng(2);
    const bytesFail = productPng(3);
    const pathA = STORAGE_PATHS.library(fixture.workspaceAId, fixture.sourceAId, "png");
    const pathB = STORAGE_PATHS.library(fixture.workspaceAId, fixture.sourceBId, "png");
    const pathFail = STORAGE_PATHS.library(fixture.workspaceAId, fixture.sourceFailId, "png");
    storageKeys.push(pathA, pathB, pathFail);
    const supabase = createAdminClient();
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    for (const [key, bytes] of [
      [pathA, bytesA],
      [pathB, bytesB],
      [pathFail, bytesFail],
    ] as const) {
      const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
        contentType: "image/png",
        upsert: true,
      });
      if (error) throw new Error(`source upload failed: ${error.message}`);
    }

    const meta = { photoScene: photoSceneMetadata("product_source") };
    await sql`
      INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path, mime_type, content_hash, metadata)
      VALUES
        (${fixture.sourceAId}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${pathA}, ${"image/png"}, ${hashBytes(bytesA)}, ${sql.json(meta as never)}),
        (${fixture.sourceBId}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${pathB}, ${"image/png"}, ${hashBytes(bytesB)}, ${sql.json(meta as never)}),
        (${fixture.sourceFailId}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${pathFail}, ${"image/png"}, ${hashBytes(bytesFail)}, ${sql.json(meta as never)})
    `;
  }, 60_000);

  afterAll(async () => {
    if (origInfo) console.info = origInfo;
    if (origError) console.error = origError;
    if (origWarn) console.warn = origWarn;
    try {
      await worker?.close();
    } catch {
      /* ignore */
    }
    try {
      const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
      if (storageKeys.length) await createAdminClient().storage.from(bucket).remove(storageKeys);
    } catch {
      /* ignore */
    }
    if (sql && fixture.orgId) {
      await sql`DELETE FROM photo_scene_generations WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM campaign_asset_refs WHERE campaign_id IN (${fixture.campaignAId}, ${fixture.campaignBId})`;
      await sql`DELETE FROM assets WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM campaigns WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM workspace_members WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM workspaces WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM organizations WHERE id = ${fixture.orgId}`;
      await sql.end({ timeout: 2 });
    }
    await closeDb();
  }, 30_000);

  it("persists a durable extracted product through the real worker path", async () => {
    expect(resolveBackgroundRemovalProvider().key).toBe("deterministic");
    expect(getPhotoroomNetworkCallCount()).toBe(0);
    const db = getDb();
    expect(await isRlsEnabled(sql, "photo_scene_generations")).toBe(true);
    expect(await isRlsEnabled(sql, "campaign_asset_refs")).toBe(true);
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('photo_scene_generations', 'campaign_asset_refs')
    `;
    expect(tables.map((row) => row.tablename).sort()).toEqual([
      "campaign_asset_refs",
      "photo_scene_generations",
    ]);
    const inflight = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'photo_scene_generations'
        AND indexname = 'photo_scene_generations_inflight_fingerprint_idx'
    `;
    expect(inflight[0]?.indexname).toBe("photo_scene_generations_inflight_fingerprint_idx");

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, fixture.campaignAId))
      .limit(1);

    const first = await requestProductExtraction(db, {
      campaign: campaign!,
      sourceAssetId: fixture.sourceAId,
      userId: fixture.userAId,
    });
    const concurrent = await Promise.all([
      requestProductExtraction(db, {
        campaign: campaign!,
        sourceAssetId: fixture.sourceAId,
        userId: fixture.userAId,
      }),
      requestProductExtraction(db, {
        campaign: campaign!,
        sourceAssetId: fixture.sourceAId,
        userId: fixture.userAId,
      }),
    ]);
    fixture.generationId = first.dto.id;
    expect(concurrent.every((row) => row.dto.id === fixture.generationId)).toBe(true);
    expect(["queued", "processing"]).toContain(first.dto.status);

    worker = new Worker(
      QUEUE_NAMES.PHOTO_SCENE,
      async (job) => {
        if (job.name !== "photo_scene.extract") return;
        await processPhotoSceneExtractJob(
          job.data as {
            generationId: string;
            workspaceId: string;
            orgId: string;
            campaignId: string;
          }
        );
      },
      {
        connection: getRedisConnection(),
        prefix: getBullmqPrefix(),
        concurrency: 1,
        lockDuration: 60_000,
      }
    );
    await worker.waitUntilReady();

    const ready = await waitGeneration(db, fixture.generationId, fixture.workspaceAId, "ready");
    expect(ready.providerKey).toBe("deterministic");
    expect(ready.costUsd).toBe("0");
    expect(ready.inputCapsule).toBeTruthy();
    expect(ready.inputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(ready.sourceContentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(ready.outputAssetId).toBeTruthy();
    fixture.fingerprint = ready.inputFingerprint;
    fixture.sourceHash = ready.sourceContentHash;

    const [output] = await db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, ready.outputAssetId!))
      .limit(1);
    expect(output?.type).toBe("image");
    expect(output?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(output?.storagePath).toBe(STORAGE_PATHS.library(fixture.workspaceAId, output!.id, "png"));
    expect(output?.storagePath).not.toMatch(/^https?:\/\//);
    expect(JSON.stringify(output)).not.toMatch(/publicUrl|getPublicUrl|token=/i);
    expect(output?.metadata).toMatchObject({
      photoScene: {
        role: "extracted_product",
        lineage: {
          sourceAssetId: fixture.sourceAId,
          generationId: fixture.generationId,
          operation: "product_extraction",
        },
      },
    });
    const refs = await sql<{ asset_id: string }[]>`
      SELECT asset_id FROM campaign_asset_refs
      WHERE campaign_id = ${fixture.campaignAId} AND asset_id = ${output!.id}
    `;
    expect(refs).toHaveLength(1);
    fixture.outputPath = output!.storagePath;
    storageKeys.push(output!.storagePath);

    const downloaded = await createAdminClient()
      .storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets")
      .download(output!.storagePath);
    expect(validateExtractedPng(Buffer.from(await downloaded.data!.arrayBuffer())).hasAlpha).toBe(true);

    const publicUrl = createAdminClient()
      .storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets")
      .getPublicUrl(output!.storagePath).data.publicUrl;
    const anonymous = await fetch(publicUrl);
    expect([400, 401, 403, 404]).toContain(anonymous.status);

    const signed = await signPrivateCampaignAsset({
      workspaceId: fixture.workspaceAId,
      storagePath: output!.storagePath,
    });
    expect(signed).toMatch(/token=/);
    expect(signed).not.toMatch(/PHOTOROOM_API_KEY|Authorization=Bearer/i);

    const refreshed = await readProductExtraction(db, {
      generationId: fixture.generationId,
      workspaceId: fixture.workspaceAId,
      orgId: fixture.orgId,
    });
    expect(refreshed.status).toBe("ready");
    expect(refreshed.id).toBe(fixture.generationId);
    const revisited = await readLatestCampaignExtraction(db, {
      campaignId: fixture.campaignAId,
      workspaceId: fixture.workspaceAId,
      orgId: fixture.orgId,
    });
    expect(revisited?.id).toBe(fixture.generationId);
    expect(clientPollCannotDeclareFailure()).toBe(false);
    const startedOps = opsLines.filter(
      (line) =>
        line.includes('"event":"extraction.started"') && line.includes(fixture.generationId)
    );
    const enqueuedOps = opsLines.filter(
      (line) =>
        line.includes('"event":"extraction.enqueued"') && line.includes(fixture.generationId)
    );
    expect(enqueuedOps).toHaveLength(1);
    expect(startedOps).toHaveLength(1);
  }, 90_000);

  it("reuses the READY generation and creates a new one after source mutation", async () => {
    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, fixture.campaignAId))
      .limit(1);
    const reused = await requestProductExtraction(db, {
      campaign: campaign!,
      sourceAssetId: fixture.sourceAId,
      userId: fixture.userAId,
    });
    expect(reused.dto.reused).toBe(true);
    expect(reused.dto.id).toBe(fixture.generationId);
    expect(reused.status).toBe(200);

    const mutated = await requestProductExtraction(db, {
      campaign: campaign!,
      sourceAssetId: fixture.sourceBId,
      userId: fixture.userAId,
    });
    expect(mutated.dto.id).not.toBe(fixture.generationId);
    const mutatedReady = await waitGeneration(db, mutated.dto.id, fixture.workspaceAId, "ready");
    expect(mutatedReady.sourceContentHash).not.toBe(fixture.sourceHash);
    expect(mutatedReady.inputFingerprint).not.toBe(fixture.fingerprint);
    if (mutatedReady.outputAssetId) {
      const [out] = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, mutatedReady.outputAssetId))
        .limit(1);
      if (out) storageKeys.push(out.storagePath);
    }
  }, 90_000);

  it("fails closed then retries the same generation identity", async () => {
    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, fixture.campaignAId))
      .limit(1);
    process.env.PHOTO_SCENE_DETERMINISTIC_FAIL = "true";
    const failedReq = await requestProductExtraction(db, {
      campaign: campaign!,
      sourceAssetId: fixture.sourceFailId,
      userId: fixture.userAId,
    });
    const failed = await waitGeneration(db, failedReq.dto.id, fixture.workspaceAId, "failed");
    expect(failed.outputAssetId).toBeNull();
    expect(failed.boundedError).toBe(USER_SAFE_EXTRACTION_FAILURE_MESSAGE);
    expect(failed.errorCode).toBe("PROVIDER_UNAVAILABLE");
    expect(failed.attemptCount).toBe(1);

    process.env.PHOTO_SCENE_DETERMINISTIC_FAIL = "false";
    const retried = await retryProductExtraction(db, {
      generationId: failed.id,
      workspaceId: fixture.workspaceAId,
      orgId: fixture.orgId,
    });
    expect(retried.id).toBe(failed.id);
    expect(retried.attemptCount).toBe(2);
    const recovered = await waitGeneration(db, failed.id, fixture.workspaceAId, "ready");
    expect(recovered.id).toBe(failed.id);
    expect(recovered.sourceContentHash).toBe(failed.sourceContentHash);
    expect(recovered.inputFingerprint).toBe(failed.inputFingerprint);
    expect(JSON.stringify(recovered.inputCapsule)).toBe(JSON.stringify(failed.inputCapsule));
    if (recovered.outputAssetId) {
      const [out] = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, recovered.outputAssetId))
        .limit(1);
      if (out) storageKeys.push(out.storagePath);
    }
  }, 90_000);

  it("enforces tenant isolation and zero Photoroom network calls", async () => {
    const db = getDb();
    await expect(
      readProductExtraction(db, {
        generationId: fixture.generationId,
        workspaceId: fixture.workspaceBId,
        orgId: fixture.orgId,
      })
    ).rejects.toMatchObject({ code: "WORKSPACE_ISOLATION" });
    await expect(
      retryProductExtraction(db, {
        generationId: fixture.generationId,
        workspaceId: fixture.workspaceBId,
        orgId: fixture.orgId,
      })
    ).rejects.toMatchObject({ code: "WORKSPACE_ISOLATION" });
    await expect(
      signPrivateCampaignAsset({
        workspaceId: fixture.workspaceBId,
        storagePath: fixture.outputPath,
      })
    ).rejects.toThrow();

    const [campaignB] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, fixture.campaignBId))
      .limit(1);
    await expect(
      requestProductExtraction(db, {
        campaign: campaignB!,
        sourceAssetId: fixture.sourceAId,
        userId: fixture.userBId,
      })
    ).rejects.toThrow();

    await withAuthenticatedUser(sql, fixture.userBId, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM photo_scene_generations WHERE id = ${fixture.generationId}
      `;
      expect(rows).toHaveLength(0);
    });

    const joined = opsLines.join("\n");
    expect(joined).toMatch(/"providerKey":"deterministic"/);
    expect(joined).not.toMatch(/"providerKey":"photoroom"/);
    expect(joined).not.toMatch(/sdk\.photoroom\.com/);
    expect(joined).not.toMatch(/PHOTOROOM_API_KEY/);
    expect(joined).not.toMatch(/Authorization/i);
    expect(joined).not.toMatch(/token=/);
    expect(getPhotoroomNetworkCallCount()).toBe(0);
  }, 30_000);
});
