/**
 * Sprint 1 Export verification using Playwright storage state (cookie auth).
 *
 * Prerequisites:
 *   1. pnpm e2e:marketing (writes test-results/sprint1-acceptance/storage-state.json)
 *   2. Web + worker running
 *
 * Usage:
 *   npx tsx scripts/sprint1-export-verify.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, createWriteStream, existsSync, readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { chromium } from "@playwright/test";
import postgres from "postgres";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(root, ".env.e2e.local") });
config({ path: resolve(root, ".env.local") });

const require = createRequire(import.meta.url);
const BASE = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3000";
const TASK_ID = process.env.E2E_EXPORT_TASK_ID?.trim() || "9c4b8b17-9a51-4a52-a5bb-0be6bea4641d";
const OUT = resolve(root, "test-results/sprint1-acceptance");
const STATE = resolve(OUT, "storage-state.json");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(STATE)) {
    throw new Error(`Missing ${STATE}. Run pnpm e2e:marketing first.`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: STATE, baseURL: BASE });
  const page = await context.newPage();

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    const pending = await sql`
      SELECT r.id FROM reviews r
      JOIN creatives c ON c.id = r.creative_id
      WHERE c.task_id = ${TASK_ID} AND r.decision = 'pending'
    `;
    console.log(JSON.stringify({ pendingReviews: pending.length, taskId: TASK_ID }));

    for (const row of pending) {
      const res = await page.request.post(`/api/reviews/${row.id}/decide`, {
        data: { decision: "approved" },
      });
      const body = await res.json().catch(() => ({}));
      console.log(JSON.stringify({ reviewId: row.id, status: res.status(), body }));
      if (!res.ok()) throw new Error(`Approve failed for ${row.id}`);
    }

    await sleep(3000);

    const exportPost = await page.request.post(`/api/tasks/${TASK_ID}/export`, {
      data: { resolution: "720p" },
    });
    const exportBody = await exportPost.json().catch(() => ({}));
    writeFileSync(
      resolve(OUT, "export-api-post.json"),
      JSON.stringify({ status: exportPost.status(), body: exportBody }, null, 2)
    );
    console.log(JSON.stringify({ exportPost: exportPost.status(), body: exportBody }));

    let packUrl: string | null = null;
    let packFilename: string | null = null;
    for (let i = 0; i < 60; i++) {
      const getRes = await page.request.get(`/api/tasks/${TASK_ID}/export?resolution=720p`);
      const getBody = (await getRes.json()) as {
        status?: string;
        exportPackUrl?: string | null;
        exportPackFilename?: string | null;
        canExport?: boolean;
        approvalRequired?: boolean;
        error?: string;
      };
      writeFileSync(
        resolve(OUT, "export-api-poll.json"),
        JSON.stringify({ attempt: i, status: getRes.status(), body: getBody }, null, 2)
      );
      console.log(
        JSON.stringify({
          poll: i,
          http: getRes.status(),
          status: getBody.status,
          approvalRequired: getBody.approvalRequired,
          canExport: getBody.canExport,
          hasUrl: Boolean(getBody.exportPackUrl),
        })
      );
      if (getBody.exportPackUrl) {
        packUrl = getBody.exportPackUrl;
        packFilename = getBody.exportPackFilename ?? null;
        break;
      }
      if (getRes.status() >= 400 && getBody.status === "failed") {
        throw new Error(`Export failed: ${JSON.stringify(getBody)}`);
      }
      await sleep(5000);
    }

    if (!packUrl) throw new Error("Export pack URL not ready within timeout");

    const zipRes = await fetch(packUrl);
    if (!zipRes.ok || !zipRes.body) throw new Error(`ZIP download failed: ${zipRes.status}`);
    const zipPath = resolve(OUT, packFilename ?? "export-pack.zip");
    await pipeline(Readable.fromWeb(zipRes.body as never), createWriteStream(zipPath));

    const entries: string[] = [];
    try {
      const AdmZip = require("adm-zip") as typeof import("adm-zip");
      const zip = new AdmZip(zipPath);
      for (const e of zip.getEntries()) entries.push(e.entryName);
    } catch {
      const { statSync } = await import("node:fs");
      entries.push(`(list unavailable; bytes=${statSync(zipPath).size})`);
      // Try PowerShell listing later if needed
    }

    const [taskRow] = await sql`
      SELECT id, status,
             step_progress->'export_packs' AS export_packs,
             step_progress->'export_pack' AS export_pack
      FROM tasks WHERE id = ${TASK_ID}
    `;

    const report = {
      taskId: TASK_ID,
      packUrl,
      packFilename,
      zipPath,
      entries,
      taskPersistence: taskRow,
      storageStateBytes: readFileSync(STATE).byteLength,
    };
    writeFileSync(resolve(OUT, "export-verify-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await sql.end();
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
