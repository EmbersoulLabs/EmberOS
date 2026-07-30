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
  await expect(page.getByText(/^Uploaded$|^已上传$/i).first()).toBeVisible({
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

    // Stabilize UI language for reliable EN option labels (not product scope)
    await page.evaluate(() => {
      localStorage.setItem("emberos-locale", "en");
      localStorage.setItem("emberos.locale", "en");
    });

    // ── 2) Workspace → New Campaign wizard ────────────────────────────────
    await page.goto(`/w/${workspaceSlug}/campaigns/new`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("emberos-locale", "en"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/step\s*1\s*of\s*5|第\s*1\s*\/\s*5/i)).toBeVisible();

    const campaignName = `E2E Video ${Date.now()}`;
    await page.getByRole("textbox", { name: /campaign name|活动名称/i }).fill(campaignName);
    await page.getByRole("button", { name: /continue/i }).click();

    // Objective + platforms + audience (never use global Language <select> in AppShell)
    const objectiveSelect = page.locator("main select").filter({ has: page.locator('option[value="awareness"]') });
    await expect(objectiveSelect).toBeVisible({ timeout: 30_000 });
    await objectiveSelect.selectOption("awareness");
    const audience = page.locator("main textarea").first();
    if (await audience.isVisible().catch(() => false)) {
      await audience.fill("Adults shopping for gifts online");
    }
    await page.getByRole("button", { name: /continue/i }).click();

    // ── 3) Upload real video fixture via production upload UI ──────────────
    await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: 60_000 });
    await page.locator('input[type="file"]').setInputFiles(fixtureVideo);
    await waitForUploadSuccess(page);
    await page.screenshot({ path: resolve(artifactsDir, "01-upload.png"), fullPage: true });
    await page.getByRole("button", { name: /continue/i }).click();

    // Brief
    const brief = page.locator("main textarea").first();
    if (await brief.isVisible().catch(() => false)) {
      await brief.fill("E2E video acceptance: short promo with clear CTA.");
    }
    await page.getByRole("button", { name: /continue/i }).click();

    // ── 4) Create Campaign → production Generate ──────────────────────────
    const createBtn = page.getByRole("button", { name: /create campaign/i });
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

    // ── 5) Wait for worker: Marketing Package + Auto Clip finalize + reviews ─
    let reviewReady = false;
    let jobId: string | null = null;
    for (let i = 0; i < 150; i++) {
      const statusRes = await page.request.get(`/api/tasks/${taskId}`);
      const expRes = await page.request.get(`/api/tasks/${taskId}/export?resolution=720p`);
      let status: string | undefined;
      let content: string | undefined;
      if (statusRes.ok()) {
        const data = (await statusRes.json()) as {
          task?: {
            status?: string;
            stepProgress?: Record<string, { status?: string }>;
          };
          status?: string;
          stepProgress?: Record<string, { status?: string }>;
        };
        status = data.task?.status ?? data.status;
        const progress = data.task?.stepProgress ?? data.stepProgress ?? {};
        content = progress.content_generate?.status;
        await writeEvidence("task-poll.json", { attempt: i, status, content });
        if (status === "failed") {
          throw new Error(`Pipeline failed: ${JSON.stringify(data).slice(0, 2000)}`);
        }
      }
      if (expRes.ok()) {
        const exp = (await expRes.json()) as {
          clipCount?: number;
          allClipsReady?: boolean;
          campaignStatus?: string | null;
          creatives?: Array<{ id: string; renderStatus?: string }>;
        };
        await writeEvidence("export-status-poll.json", { attempt: i, ...exp });
        if ((exp.creatives?.[0]?.id)) jobId = exp.creatives[0].id;
        // Require task completed + 3 preview-ready clips + review gate
        if (
          status === "completed" &&
          content === "completed" &&
          (exp.clipCount ?? 0) >= 3 &&
          exp.allClipsReady &&
          (exp.campaignStatus === "pending_internal_review" ||
            exp.campaignStatus === "pending_client_review" ||
            exp.campaignStatus === "approved" ||
            exp.campaignStatus === "export_ready")
        ) {
          reviewReady = true;
          break;
        }
      }
      await page.waitForTimeout(5000);
      if (i % 6 === 0) await page.reload({ waitUntil: "domcontentloaded" });
    }
    expect(reviewReady, "Task did not reach review-ready Auto Clip state").toBe(true);

    // ── 6) Review → Approve (UI) — only this campaign's pending creatives ─
    page.on("dialog", (d) => {
      void d.accept().catch(() => undefined);
    });
    await page.evaluate(() => localStorage.setItem("emberos-locale", "en"));
    // Prefer production task CTA into the review queue
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });
    const reviewLink = page.getByRole("link", { name: /review queue|审核|open review/i });
    if (await reviewLink.first().isVisible().catch(() => false)) {
      await reviewLink.first().click();
      await page.waitForURL(/\/reviews/, { timeout: 30_000 });
    } else {
      await page.goto(`/w/${workspaceSlug}/reviews`, { waitUntil: "domcontentloaded" });
    }

    const meRes = await page.request.get("/api/me");
    const meBody = (await meRes.json()) as {
      workspaces?: Array<{ id: string; slug: string }>;
    };
    const wsId = meBody.workspaces?.find((w) => w.slug === workspaceSlug)?.id;
    expect(wsId, "E2E workspace missing from /api/me").toBeTruthy();

    let reviewId: string | null = null;
    let pendingForCampaign: Array<{ review: { id: string } }> = [];
    for (let i = 0; i < 60; i++) {
      const revRes = await page.request.get(
        `/api/reviews?workspaceId=${wsId}&status=pending`
      );
      const revBody = (await revRes.json()) as {
        reviews?: Array<{ review: { id: string }; campaign?: { name?: string } }>;
        error?: string;
      };
      await writeEvidence("reviews-api.json", { attempt: i, status: revRes.status(), body: revBody });
      pendingForCampaign = (revBody.reviews ?? []).filter(
        (r) => r.campaign?.name === campaignName
      );
      if (pendingForCampaign.length >= 3) break;
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    expect(
      pendingForCampaign.length,
      `Expected 3 pending reviews for ${campaignName}`
    ).toBeGreaterThanOrEqual(3);

    await expect(page.getByText(campaignName).first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: resolve(artifactsDir, "03-reviews.png"), fullPage: true });

    let approved = 0;
    for (let i = 0; i < 6; i++) {
      const card = page.locator("div.rounded-lg.border").filter({ hasText: campaignName }).first();
      const btn = card.getByRole("button", { name: /approve|通过/i });
      if (!(await btn.isVisible().catch(() => false))) break;
      const reviewResponse = page.waitForResponse(
        (res) =>
          res.url().includes("/api/reviews/") &&
          res.url().includes("/decide") &&
          res.request().method() === "POST",
        { timeout: 60_000 }
      );
      await btn.click();
      const res = await reviewResponse;
      const body = (await res.json().catch(() => ({}))) as {
        review?: { id?: string };
        id?: string;
      };
      reviewId = body.review?.id ?? body.id ?? reviewId;
      approved += 1;
      await writeEvidence(`review-approve-${i}.json`, { status: res.status(), body });
      await page.waitForTimeout(1000);
    }
    expect(approved, "Expected to approve this campaign's 3 Auto Clip reviews").toBe(3);
    await writeEvidence("review-summary.json", { approved, reviewId, campaignName });

    // ── 7) Export ZIP via task Export CTA ─────────────────────────────────
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: resolve(artifactsDir, "04-export-surface.png"), fullPage: true });

    // Wait until approval clears export gate
    let exportUnlocked = false;
    for (let i = 0; i < 60; i++) {
      const expRes = await page.request.get(`/api/tasks/${taskId}/export?resolution=720p`);
      if (expRes.ok()) {
        const exp = (await expRes.json()) as {
          approvalRequired?: boolean;
          canExport?: boolean;
          status?: string;
          exportPackUrl?: string | null;
          campaignStatus?: string | null;
        };
        await writeEvidence("export-gate.json", { attempt: i, ...exp });
        if (exp.exportPackUrl || (!exp.approvalRequired && exp.canExport)) {
          exportUnlocked = true;
          break;
        }
      }
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    expect(exportUnlocked, "Export gate still locked after review approvals").toBe(true);

    // Reload so task UI picks up post-approval export eligibility
    await page.reload({ waitUntil: "domcontentloaded" });
    const exportCta = page.getByRole("button", { name: /export 3 clips zip|export 3 clips|导出/i });
    await expect(exportCta.first()).toBeVisible({ timeout: 120_000 });
    for (let i = 0; i < 36; i++) {
      if (await exportCta.first().isEnabled().catch(() => false)) break;
      await page.waitForTimeout(5000);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    await expect(exportCta.first()).toBeEnabled({ timeout: 60_000 });

    const exportResponsePromise = page.waitForResponse(
      (res) => res.url().includes(`/api/tasks/${taskId}/export`) && res.request().method() === "POST",
      { timeout: 120_000 }
    );
    await exportCta.first().click();
    const expRes = await exportResponsePromise;
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
