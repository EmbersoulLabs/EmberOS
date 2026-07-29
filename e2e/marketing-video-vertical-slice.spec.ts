import { test, expect, type Page } from "@playwright/test";
import { config } from "dotenv";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

config({ path: resolve(".env.e2e.local") });
config({ path: resolve(".env.local") });

const email = process.env.E2E_USER_EMAIL?.trim();
const password = process.env.E2E_USER_PASSWORD?.trim();
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
const hasCredentials = Boolean(email && password);
const fixtureVideo = resolve("e2e/fixtures/e2e-clip.mp4");
const artifactsDir = resolve("test-results/sprint1-video-acceptance");

async function writeEvidence(name: string, data: unknown) {
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(resolve(artifactsDir, name), JSON.stringify(data, null, 2));
}

async function waitForUploadSuccess(page: Page) {
  await expect(page.getByText(/^Uploaded$|上传成功|已上传/i).first()).toBeVisible({
    timeout: 180_000,
  });
}

test.describe("Marketing vertical slice — Video Campaign (browser E2E)", () => {
  test.skip(!hasCredentials, "Set E2E_USER_EMAIL / E2E_USER_PASSWORD");
  test.skip(!existsSync(fixtureVideo), "Missing e2e/fixtures/e2e-clip.mp4");

  test("login → create video campaign → generate → review → export ZIP", async ({
    page,
  }) => {
    test.setTimeout(900_000);
    mkdirSync(artifactsDir, { recursive: true });

    // ── 1) Real login UI (no cookie/session injection) ─────────────────────
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.locator('input[type="email"]').fill(email!);
    await page.locator('input[type="password"]').fill(password!);
    const remember = page.locator('input[type="checkbox"]').first();
    if (!(await remember.isChecked())) await remember.check();
    await page.getByRole("button", { name: /sign in|登录|登入/i }).click();
    await page.waitForURL(/\/workspaces/, { timeout: 60_000 });

    const storage = await page.evaluate(() => ({
      remember: localStorage.getItem("emberos.auth.remember"),
      email: localStorage.getItem("emberos.auth.email"),
      password: localStorage.getItem("emberos.auth.password"),
    }));
    expect(storage.password).toBeNull();
    await writeEvidence("browser-storage.json", storage);

    // ── 2) Workspace → New Campaign wizard ────────────────────────────────
    await page.goto(`/w/${workspaceSlug}/campaigns/new`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /new campaign|新建|创建活动/i })).toBeVisible({
      timeout: 30_000,
    });

    const campaignName = `E2E Video ${Date.now()}`;
    await page.locator('input[placeholder]').first().fill(campaignName);
    await page.getByRole("button", { name: /continue|继续|下一步/i }).click();

    // Objective + platforms + audience
    await page.locator("select").first().selectOption("awareness");
    const audience = page.locator("textarea").first();
    if (await audience.isVisible().catch(() => false)) {
      await audience.fill("Adults shopping for gifts online");
    }
    await page.getByRole("button", { name: /continue|继续|下一步/i }).click();

    // ── 3) Upload real video fixture via production upload UI ──────────────
    await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: 30_000 });
    // Draft campaign must exist after objective Continue
    await page.locator('input[type="file"]').setInputFiles(fixtureVideo);
    await waitForUploadSuccess(page);
    await page.screenshot({ path: resolve(artifactsDir, "01-upload.png"), fullPage: true });
    await page.getByRole("button", { name: /continue|继续|下一步/i }).click();

    // Brief
    const brief = page.locator("textarea").first();
    if (await brief.isVisible().catch(() => false)) {
      await brief.fill("E2E video acceptance: short promo with clear CTA.");
    }
    await page.getByRole("button", { name: /continue|继续|下一步/i }).click();

    // ── 4) Create Campaign → production Generate ──────────────────────────
    const createBtn = page.getByRole("button", { name: /create campaign|创建活动|创建营销/i });
    await expect(createBtn).toBeEnabled({ timeout: 30_000 });
    await createBtn.click();
    await page.waitForURL(/\/campaigns\/[^/]+\/task/, { timeout: 120_000 });

    const taskUrl = page.url();
    const campaignId = taskUrl.match(/\/campaigns\/([^/]+)\/task/)?.[1] ?? "";
    const taskId = new URL(taskUrl, "http://local").searchParams.get("taskId") ?? "";
    expect(campaignId).toBeTruthy();
    expect(taskId).toBeTruthy();
    await writeEvidence("ids.json", { campaignId, taskId, taskUrl, campaignName });
    writeFileSync(resolve(artifactsDir, "task-url.txt"), taskUrl);
    await page.screenshot({ path: resolve(artifactsDir, "02-task.png"), fullPage: true });

    // ── 5) Wait for worker / Marketing Package / clips ─────────────────────
    let packageReady = false;
    let jobId: string | null = null;
    for (let i = 0; i < 120; i++) {
      const statusRes = await page.request.get(`/api/tasks/${taskId}`);
      if (statusRes.ok()) {
        const data = (await statusRes.json()) as {
          task?: {
            status?: string;
            stepProgress?: Record<string, { status?: string; output?: unknown }>;
          };
          status?: string;
          stepProgress?: Record<string, { status?: string }>;
        };
        const status = data.task?.status ?? data.status;
        const progress = data.task?.stepProgress ?? data.stepProgress ?? {};
        const content = progress.content_generate?.status;
        const routerOut = progress.pipeline_router?.status;
        await writeEvidence("task-poll.json", {
          attempt: i,
          status,
          content,
          router: routerOut,
        });
        if (status === "failed") {
          throw new Error(`Pipeline failed: ${JSON.stringify(data).slice(0, 2000)}`);
        }
        // Auto Clip: task completes when clips ready; marketing package may complete earlier
        if (status === "completed" || content === "completed") {
          packageReady = true;
          break;
        }
      }
      // Capture agent job id from health/queue when available is best-effort only
      await page.waitForTimeout(5000);
      if (i % 6 === 0) await page.reload({ waitUntil: "domcontentloaded" });
    }
    expect(packageReady).toBe(true);

    // Ensure Auto Clip path (3 creatives) — poll creatives list via task export status
    let clipsReady = false;
    for (let i = 0; i < 90; i++) {
      const expRes = await page.request.get(`/api/tasks/${taskId}/export?resolution=720p`);
      if (expRes.ok()) {
        const exp = (await expRes.json()) as {
          clipCount?: number;
          allClipsReady?: boolean;
          approvalRequired?: boolean;
          canExport?: boolean;
          creatives?: Array<{ id: string; renderStatus?: string }>;
        };
        await writeEvidence("export-status-poll.json", { attempt: i, ...exp });
        if ((exp.clipCount ?? 0) >= 3 && exp.allClipsReady) {
          clipsReady = true;
          jobId = exp.creatives?.[0]?.id ?? null;
          break;
        }
      }
      await page.waitForTimeout(5000);
      if (i % 6 === 0) await page.reload({ waitUntil: "domcontentloaded" });
    }
    expect(clipsReady).toBe(true);

    // ── 6) Review → Approve (UI) ──────────────────────────────────────────
    await page.goto(`/w/${workspaceSlug}/reviews`, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: resolve(artifactsDir, "03-reviews.png"), fullPage: true });
    const approveButtons = page.getByRole("button", { name: /approve|批准|通过/i });
    const approveCount = await approveButtons.count();
    let reviewId: string | null = null;
    for (let i = 0; i < Math.min(approveCount, 8); i++) {
      const btn = page.getByRole("button", { name: /approve|批准|通过/i }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      const reviewResponse = page
        .waitForResponse(
          (res) =>
            res.url().includes("/api/reviews/") &&
            res.url().includes("/decide") &&
            res.request().method() === "POST",
          { timeout: 30_000 }
        )
        .catch(() => null);
      page.once("dialog", (d) => d.accept().catch(() => undefined));
      await btn.click();
      const res = await reviewResponse;
      if (res) {
        const body = (await res.json().catch(() => ({}))) as { review?: { id?: string }; id?: string };
        reviewId = body.review?.id ?? body.id ?? reviewId;
        await writeEvidence(`review-approve-${i}.json`, {
          status: res.status(),
          body,
        });
      }
      await page.waitForTimeout(1500);
    }
    await writeEvidence("review-summary.json", { attemptedApprovals: approveCount, reviewId });

    // ── 7) Export ZIP via task Export CTA ─────────────────────────────────
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: resolve(artifactsDir, "04-export-surface.png"), fullPage: true });

    // Wait until approval clears export gate
    for (let i = 0; i < 36; i++) {
      const expRes = await page.request.get(`/api/tasks/${taskId}/export?resolution=720p`);
      if (expRes.ok()) {
        const exp = (await expRes.json()) as {
          approvalRequired?: boolean;
          canExport?: boolean;
          status?: string;
          exportPackUrl?: string | null;
        };
        await writeEvidence("export-gate.json", { attempt: i, ...exp });
        if (exp.exportPackUrl) break;
        if (!exp.approvalRequired && exp.canExport) break;
      }
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    const exportCta = page.getByRole("button", { name: /export|导出/i });
    await expect(exportCta.first()).toBeVisible({ timeout: 120_000 });

    const exportResponse = page.waitForResponse(
      (res) => res.url().includes(`/api/tasks/${taskId}/export`) && res.request().method() === "POST",
      { timeout: 120_000 }
    );
    await exportCta.first().click();
    const expRes = await exportResponse;
    const expBody = (await expRes.json().catch(() => ({}))) as {
      status?: string;
      jobId?: string;
      exportPackUrl?: string;
    };
    await writeEvidence("export-post.json", { status: expRes.status(), body: expBody });
    if (expBody.jobId) jobId = expBody.jobId;

    let zipFilename: string | null = null;
    let zipHref: string | null = null;
    for (let i = 0; i < 90; i++) {
      const download = page.getByRole("link", { name: /download|下载/i });
      if (await download.isVisible().catch(() => false)) {
        zipHref = await download.getAttribute("href");
        const label = (await download.textContent()) ?? "";
        const match = label.match(/\(([^)]+\.zip)\)/i);
        zipFilename = match?.[1] ?? null;
        if (zipHref) {
          const zipRes = await page.request.get(zipHref);
          expect(zipRes.ok()).toBeTruthy();
          const buf = Buffer.from(await zipRes.body());
          expect(buf.byteLength).toBeGreaterThan(1000);
          writeFileSync(resolve(artifactsDir, "export-pack.zip"), buf);
          // ZIP magic
          expect(buf[0]).toBe(0x50);
          expect(buf[1]).toBe(0x4b);
        }
        break;
      }
      // Also poll API for completed pack
      const poll = await page.request.get(`/api/tasks/${taskId}/export?resolution=720p`);
      if (poll.ok()) {
        const data = (await poll.json()) as {
          status?: string;
          exportPackUrl?: string | null;
          exportPackFilename?: string | null;
        };
        if (data.status === "ready" && data.exportPackUrl) {
          zipHref = data.exportPackUrl;
          zipFilename = data.exportPackFilename ?? zipFilename;
          const zipRes = await page.request.get(data.exportPackUrl);
          expect(zipRes.ok()).toBeTruthy();
          const buf = Buffer.from(await zipRes.body());
          writeFileSync(resolve(artifactsDir, "export-pack.zip"), buf);
          expect(buf.byteLength).toBeGreaterThan(1000);
          break;
        }
      }
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    expect(zipHref, "Export ZIP download URL missing").toBeTruthy();
    if (!zipFilename && zipHref) {
      try {
        zipFilename = decodeURIComponent(zipHref.split("/").pop() ?? "") || null;
      } catch {
        zipFilename = zipHref.split("/").pop() ?? null;
      }
    }

    await writeEvidence("export-download.json", {
      href: zipHref,
      filename: zipFilename,
      jobId,
      reviewId,
      campaignId,
      taskId,
    });
    await page.screenshot({ path: resolve(artifactsDir, "05-final.png"), fullPage: true });

    // Persist final evidence summary for freeze report
    await writeEvidence("freeze-evidence.json", {
      campaignId,
      taskId,
      jobId,
      reviewId,
      zipFilename,
      zipHref,
    });
  });
});
