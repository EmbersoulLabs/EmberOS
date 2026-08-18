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
  DEFAULT_OFFICIAL_SCENE_BUCKET,
  STORAGE_PATHS,
  freezeOfficialSceneObjectIdentity,
  officialSceneBackgroundObjectKey,
  photoSceneMetadata,
} from "@ceo-agent/shared";
import { encodeRgbaPng } from "../packages/agents/src/photo-scene/png";
import { processPhotoSceneComposeJob } from "../apps/worker/src/processors/photo-scene-compose-handler";
import {
  readLatestCampaignMarketing,
  requestMarketingImage,
  retryMarketingComposition,
} from "../apps/web/src/lib/photo-scene-marketing";
import { signPrivateCampaignAsset } from "../apps/web/src/lib/asset-signed-delivery";
import { createAdminClient } from "../apps/web/src/lib/supabase/admin";
import { isRlsEnabled, withAuthenticatedUser } from "./helpers/db-integration";

const RUN = process.env.RUN_PHOTO_SCENE_10D_RUNTIME_CERT === "1";

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function blockPng(r: number, g: number, b: number, a: number, w = 24, h = 32): Buffer {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return encodeRgbaPng(w, h, rgba);
}

async function waitGeneration(
  db: ReturnType<typeof getDb>,
  generationId: string,
  workspaceId: string,
  status: "ready" | "failed",
  timeoutMs = 90_000
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

describe.skipIf(!RUN).sequential("Photo Scene 10D durable runtime zero-paid-API", () => {
  const opsLines: string[] = [];
  let sql: ReturnType<typeof postgres>;
  let worker: Worker | undefined;
  let origInfo: typeof console.info;
  let origError: typeof console.error;
  let origWarn: typeof console.warn;
  const storageKeys: string[] = [];
  const officialKeys: string[] = [];
  const fixture = {
    orgId: "",
    workspaceAId: "",
    workspaceBId: "",
    userAId: "",
    userBId: "",
    campaignAId: "",
    campaignBId: "",
    extractedAId: "",
    extractedBId: "",
    sceneId: "",
    generationId: "",
    outputPath: "",
  };

  beforeAll(async () => {
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
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/photo-scene-generations-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/photo-scene-official-scenes-v1.sql"), "utf8"));

    const suffix = crypto.randomUUID().slice(0, 8);
    fixture.orgId = crypto.randomUUID();
    fixture.workspaceAId = crypto.randomUUID();
    fixture.workspaceBId = crypto.randomUUID();
    fixture.userAId = crypto.randomUUID();
    fixture.userBId = crypto.randomUUID();
    fixture.campaignAId = crypto.randomUUID();
    fixture.campaignBId = crypto.randomUUID();
    fixture.extractedAId = crypto.randomUUID();
    fixture.extractedBId = crypto.randomUUID();
    fixture.sceneId = crypto.randomUUID();

    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${fixture.orgId}, ${"Photo Scene 10D Cert"}, ${`ps10d-${suffix}`})
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
      INSERT INTO campaigns (id, org_id, workspace_id, name, platforms, status, campaign_brief, strategy_json)
      VALUES
        (${fixture.campaignAId}, ${fixture.orgId}, ${fixture.workspaceAId}, ${"Cert Campaign A"}, ${["tiktok"]}, ${"draft"}, ${"Brief A"}, ${sql.json({ hooks: [{ text: "Fresh drop" }], cta: [{ text: "Shop" }] } as never)}),
        (${fixture.campaignBId}, ${fixture.orgId}, ${fixture.workspaceBId}, ${"Cert Campaign B"}, ${["tiktok"]}, ${"draft"}, ${"Brief B"}, ${sql.json({} as never)})
    `;

    const extractedBytes = blockPng(40, 180, 40, 220);
    const extractedHash = hashBytes(extractedBytes);
    const pathA = STORAGE_PATHS.library(fixture.workspaceAId, fixture.extractedAId, "png");
    const pathB = STORAGE_PATHS.library(fixture.workspaceBId, fixture.extractedBId, "png");
    storageKeys.push(pathA, pathB);
    const supabase = createAdminClient();
    const tenantBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    for (const [key, bytes] of [
      [pathA, extractedBytes],
      [pathB, extractedBytes],
    ] as const) {
      const { error } = await supabase.storage.from(tenantBucket).upload(key, bytes, {
        contentType: "image/png",
        upsert: true,
      });
      if (error) throw new Error(`extracted upload failed: ${error.message}`);
    }

    const sceneBytes = blockPng(30, 30, 90, 255, 32, 32);
    const sceneHash = hashBytes(sceneBytes);
    const sceneKey = officialSceneBackgroundObjectKey(fixture.sceneId, 1);
    const sceneIdentity = freezeOfficialSceneObjectIdentity(DEFAULT_OFFICIAL_SCENE_BUCKET, sceneKey);
    let officialBucket = DEFAULT_OFFICIAL_SCENE_BUCKET;
    const officialUpload = await supabase.storage.from(officialBucket).upload(sceneKey, sceneBytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (officialUpload.error) {
      officialBucket = tenantBucket;
      const fallbackIdentity = freezeOfficialSceneObjectIdentity(tenantBucket, sceneKey);
      const fallback = await supabase.storage.from(tenantBucket).upload(sceneKey, sceneBytes, {
        contentType: "image/png",
        upsert: true,
      });
      if (fallback.error) throw new Error(`scene upload failed: ${fallback.error.message}`);
      officialKeys.push(sceneKey);
      await seedScene(sql, fixture.sceneId, fallbackIdentity, sceneHash);
    } else {
      officialKeys.push(sceneKey);
      await seedScene(sql, fixture.sceneId, sceneIdentity, sceneHash);
    }

    const extractedMeta = { photoScene: photoSceneMetadata("extracted_product") };
    await sql`
      INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path, mime_type, content_hash, metadata)
      VALUES
        (${fixture.extractedAId}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"image"}, ${pathA}, ${"image/png"}, ${extractedHash}, ${sql.json(extractedMeta as never)}),
        (${fixture.extractedBId}, ${fixture.orgId}, ${fixture.workspaceBId}, ${fixture.campaignBId}, ${"image"}, ${pathB}, ${"image/png"}, ${extractedHash}, ${sql.json(extractedMeta as never)})
    `;
    await sql`
      INSERT INTO photo_scene_generations (
        org_id, workspace_id, campaign_id, operation, status, source_asset_id, source_content_hash,
        input_capsule, input_fingerprint, output_asset_id, provider_key, attempt_count
      )
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${"product_extraction"}, ${"ready"},
        ${fixture.extractedAId}, ${extractedHash}, ${sql.json({ operation: "product_extraction" } as never)},
        ${extractedHash}, ${fixture.extractedAId}, ${"deterministic"}, ${1}
      )
    `;

    const frozen = {
      version: 1,
      contract: "photo-scene-frozen-scene-v1",
      sceneId: fixture.sceneId,
      sceneVersion: 1,
      sceneContentHash: sceneHash,
      backgroundStorageIdentity: freezeOfficialSceneObjectIdentity(officialBucket, sceneKey),
      presetId: "feed_1x1",
      placement: {
        anchor: "center",
        offsetX: 0,
        offsetY: 0,
        scale: 1,
        rotation: 0,
        zIndex: 1,
        shadowPreset: "soft",
      },
    };
    await sql`
      INSERT INTO photo_scene_scene_selections (
        org_id, workspace_id, campaign_id, extracted_asset_id, frozen_selection
      )
      VALUES (
        ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, ${fixture.extractedAId}, ${sql.json(frozen as never)}
      )
    `;

    worker = new Worker(
      QUEUE_NAMES.PHOTO_SCENE,
      async (job) => {
        if (job.name === "photo_scene.extract") {
          throw new Error("10D cert must not run extraction");
        }
        if (job.name !== "photo_scene.compose") return;
        await processPhotoSceneComposeJob(
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
  }, 90_000);

  afterAll(async () => {
    if (origInfo) console.info = origInfo;
    if (origError) console.error = origError;
    if (origWarn) console.warn = origWarn;
    try {
      await worker?.close();
    } catch {
      /* ignore */
    }
    const supabase = createAdminClient();
    try {
      if (storageKeys.length) {
        await supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets").remove(storageKeys);
      }
    } catch {
      /* ignore */
    }
    try {
      if (officialKeys.length) {
        await supabase.storage.from(DEFAULT_OFFICIAL_SCENE_BUCKET).remove(officialKeys);
        await supabase.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets").remove(officialKeys);
      }
    } catch {
      /* ignore */
    }
    if (sql && fixture.orgId) {
      await sql`DELETE FROM photo_scene_generations WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM photo_scene_scene_selections WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM campaign_asset_refs WHERE campaign_id IN (${fixture.campaignAId}, ${fixture.campaignBId})`;
      await sql`DELETE FROM assets WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM photo_scene_official_scene_versions WHERE scene_id = ${fixture.sceneId}`;
      await sql`DELETE FROM photo_scene_official_scenes WHERE id = ${fixture.sceneId}`;
      await sql`DELETE FROM campaigns WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM workspace_members WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM workspaces WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM organizations WHERE id = ${fixture.orgId}`;
      await sql.end({ timeout: 2 });
    }
    await closeDb();
  }, 30_000);

  it("composes a durable marketing image with zero Photoroom calls", async () => {
    expect(getPhotoroomNetworkCallCount()).toBe(0);
    const db = getDb();
    expect(await isRlsEnabled(sql, "photo_scene_generations")).toBe(true);
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, fixture.campaignAId))
      .limit(1);
    const first = await requestMarketingImage(db, {
      campaign: campaign!,
      userId: fixture.userAId,
    });
    fixture.generationId = first.dto.id;
    expect(["queued", "processing"]).toContain(first.dto.status);
    const ready = await waitGeneration(db, fixture.generationId, fixture.workspaceAId, "ready");
    expect(ready.operation).toBe("marketing_image");
    expect(ready.providerKey).toBe("deterministic_compositor");
    expect(ready.costUsd).toBe("0");
    expect(ready.outputAssetId).toBeTruthy();
    expect(ready.sourceAssetId).toBe(fixture.extractedAId);

    const [output] = await db.select().from(schema.assets).where(eq(schema.assets.id, ready.outputAssetId!)).limit(1);
    expect(output?.type).toBe("image");
    expect(output?.metadata).toMatchObject({ photoScene: { role: "marketing_image" } });
    expect(output?.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(output?.storagePath).toBe(STORAGE_PATHS.library(fixture.workspaceAId, output!.id, "png"));
    storageKeys.push(output!.storagePath);
    fixture.outputPath = output!.storagePath;
    const refs = await sql<{ asset_id: string }[]>`
      SELECT asset_id FROM campaign_asset_refs
      WHERE campaign_id = ${fixture.campaignAId} AND asset_id = ${output!.id}
    `;
    expect(refs).toHaveLength(1);

    const publicUrl = createAdminClient()
      .storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets")
      .getPublicUrl(output!.storagePath).data.publicUrl;
    const anonymous = await fetch(publicUrl);
    expect([400, 401, 403, 404]).toContain(anonymous.status);
    const signed = await signPrivateCampaignAsset({
      workspaceId: fixture.workspaceAId,
      storagePath: output!.storagePath,
      download: "marketing-image.png",
    });
    expect(signed).toMatch(/token=/);
    const preview = await fetch(signed);
    expect(preview.ok).toBe(true);

    const refreshed = await readLatestCampaignMarketing(db, {
      campaignId: fixture.campaignAId,
      workspaceId: fixture.workspaceAId,
      orgId: fixture.orgId,
    });
    expect(refreshed?.id).toBe(fixture.generationId);
    expect(refreshed?.status).toBe("ready");
    expect(getPhotoroomNetworkCallCount()).toBe(0);
  }, 120_000);

  it("preserves retry identity and create Generate Again as a new generation", async () => {
    const db = getDb();
    await db
      .update(schema.photoSceneGenerations)
      .set({ status: "failed", errorCode: "COMPOSITION_FAILED", boundedError: "Could not generate this marketing image. Try again or change the scene." })
      .where(eq(schema.photoSceneGenerations.id, fixture.generationId));
    const retried = await retryMarketingComposition(db, {
      generationId: fixture.generationId,
      workspaceId: fixture.workspaceAId,
      orgId: fixture.orgId,
    });
    expect(retried.id).toBe(fixture.generationId);
    const readyAgain = await waitGeneration(db, fixture.generationId, fixture.workspaceAId, "ready");
    expect(readyAgain.id).toBe(fixture.generationId);
    if (readyAgain.outputAssetId) {
      const [out] = await db.select().from(schema.assets).where(eq(schema.assets.id, readyAgain.outputAssetId)).limit(1);
      if (out) storageKeys.push(out.storagePath);
    }

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, fixture.campaignAId))
      .limit(1);
    const again = await requestMarketingImage(db, {
      campaign: campaign!,
      userId: fixture.userAId,
      generateAgain: true,
    });
    expect(again.dto.id).not.toBe(fixture.generationId);
    const againReady = await waitGeneration(db, again.dto.id, fixture.workspaceAId, "ready");
    expect(againReady.inputFingerprint).toBe(readyAgain.inputFingerprint);
    if (againReady.outputAssetId) {
      const [out] = await db.select().from(schema.assets).where(eq(schema.assets.id, againReady.outputAssetId)).limit(1);
      if (out) storageKeys.push(out.storagePath);
    }
    expect(getPhotoroomNetworkCallCount()).toBe(0);
  }, 120_000);

  it("denies workspace B from reading workspace A generation", async () => {
    await expect(
      withAuthenticatedUser(sql, fixture.userBId, async (tx) => {
        const rows = await tx<{ id: string }[]>`
          SELECT id FROM photo_scene_generations WHERE id = ${fixture.generationId}
        `;
        return rows;
      })
    ).resolves.toEqual([]);
    expect(getPhotoroomNetworkCallCount()).toBe(0);
  });
});

async function seedScene(
  sql: ReturnType<typeof postgres>,
  sceneId: string,
  identity: string,
  hash: string
) {
  await sql`
    INSERT INTO photo_scene_official_scenes (id, slug, name, category, tags)
    VALUES (${sceneId}, ${`cert-${sceneId.slice(0, 8)}`}, ${"Cert studio"}, ${"studio"}, ${sql.array(["cert"])})
  `;
  await sql`
    INSERT INTO photo_scene_official_scene_versions (
      scene_id, version, status, supported_presets, background_storage_identity, background_content_hash,
      preview_storage_identity, safe_area, product_anchor, scale_min, scale_max, default_scale,
      default_offset_x, default_offset_y, default_shadow_preset, published_at
    )
    VALUES (
      ${sceneId}, ${1}, ${"published"}, ${sql.array(["story_9x16", "feed_1x1", "portrait_4x5"])},
      ${identity}, ${hash}, ${identity},
      ${sql.json({ x: 0.2, y: 0.4, width: 0.6, height: 0.4 })},
      ${"center"}, ${"0.6"}, ${"1.4"}, ${"1"}, ${"0"}, ${"0"}, ${"soft"}, ${new Date()}
    )
  `;
}
