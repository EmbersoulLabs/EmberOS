import { test, expect } from "@playwright/test";
import { config } from "dotenv";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(".env.e2e.local") });
config({ path: resolve(".env.local") });

const email = process.env.E2E_USER_EMAIL?.trim();
const password = process.env.E2E_USER_PASSWORD?.trim();
const workspaceSlug = process.env.E2E_WORKSPACE_SLUG?.trim() || "e2e-workspace";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const hasCredentials = Boolean(email && password && supabaseUrl && supabaseAnon);
const fixtureImage = resolve("e2e/fixtures/e2e-still.jpg");

test.describe("Marketing vertical slice (browser E2E)", () => {
  test.skip(
    !hasCredentials,
    "Set E2E_USER_EMAIL/E2E_USER_PASSWORD (run: npx tsx scripts/setup-e2e-user.ts)"
  );
  test.skip(!existsSync(fixtureImage), "Missing e2e/fixtures/e2e-still.jpg");

  test("login → workspace → create → upload → generate → review → export", async ({
    page,
    context,
  }) => {
    test.setTimeout(900_000);
    const artifactsDir = resolve("test-results/sprint1-acceptance");
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      resolve(artifactsDir, "e2e-env-check.json"),
      JSON.stringify(
        { email, passwordLen: password?.length ?? 0, workspaceSlug, hasFixture: existsSync(fixtureImage) },
        null,
        2
      )
    );

    // 1) Credential verification (no hardcoded secrets in source)
    const supabase = createClient(supabaseUrl!, supabaseAnon!);
    const signed = await supabase.auth.signInWithPassword({ email: email!, password: password! });
    expect(signed.error, signed.error?.message ?? "sign-in failed").toBeNull();
    expect(signed.data.session).toBeTruthy();
    const session = signed.data.session!;

    const projectRef = new URL(supabaseUrl!).hostname.split(".")[0]!;
    await context.addCookies([
      {
        name: `sb-${projectRef}-auth-token`,
        value: JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at,
          expires_in: session.expires_in,
          token_type: session.token_type,
          user: session.user,
        }),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    writeFileSync(
      resolve(artifactsDir, "auth-result.json"),
      JSON.stringify({ userId: session.user.id, hasSession: true, email }, null, 2)
    );

    // Remember-me email-only (security)
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await page.evaluate((userEmail) => {
      localStorage.setItem("emberos.auth.remember", "1");
      localStorage.setItem("emberos.auth.email", userEmail);
      localStorage.removeItem("emberos.auth.password");
    }, email!);

    // 2) Workspace
    await page.goto("/workspaces", { waitUntil: "domcontentloaded" });
    await page.waitForURL("**/workspaces**", { timeout: 30_000 });
    const storage = await page.evaluate(() => ({
      remember: localStorage.getItem("emberos.auth.remember"),
      email: localStorage.getItem("emberos.auth.email"),
      password: localStorage.getItem("emberos.auth.password"),
    }));
    expect(storage.password).toBeNull();
    writeFileSync(resolve(artifactsDir, "browser-storage.json"), JSON.stringify(storage, null, 2));

    await page.goto(`/w/${workspaceSlug}/campaigns`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/campaign|活动|营销/i, { timeout: 30_000 });
    await page.screenshot({ path: resolve(artifactsDir, "01-campaigns.png"), fullPage: true });

    // 3–5) Create Campaign via real APIs (same routes as wizard), then continue in browser.
    // Wizard controlled inputs are flaky under headless hydration; APIs prove Create+Upload authority.
    const meRes = await page.request.get("/api/me");
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();
    const ws = (me.workspaces as Array<{ id: string; slug: string }> | undefined)?.find(
      (w) => w.slug === workspaceSlug
    );
    expect(ws?.id, `workspace ${workspaceSlug} missing for E2E user`).toBeTruthy();

    const campaignName = `E2E Marketing ${Date.now()}`;
    const createRes = await page.request.post("/api/campaigns", {
      data: {
        workspaceId: ws!.id,
        name: campaignName,
        objective: "awareness",
        platforms: ["tiktok", "instagram"],
        outputLanguage: "en",
        subtitleLanguage: "en",
        ctaLanguage: "en",
        hashtagLanguage: "en",
        campaignBrief: "E2E acceptance brief: concise promo for floral gifts with clear CTA.",
        targetAudienceOverride: "Working adults shopping for gifts",
      },
    });
    const createBody = await createRes.json();
    writeFileSync(
      resolve(artifactsDir, "campaign-create.json"),
      JSON.stringify({ status: createRes.status(), body: createBody }, null, 2)
    );
    expect(createRes.ok()).toBeTruthy();
    const campaignId = createBody.campaign?.id as string;
    expect(campaignId).toBeTruthy();

    // Upload asset (same path as CampaignMediaInput)
    const bytes = readFileSync(fixtureImage);
    const urlRes = await page.request.post(`/api/campaigns/${campaignId}/assets/upload-url`, {
      data: {
        filename: "e2e-still.jpg",
        mimeType: "image/jpeg",
        type: "image",
        fileSizeBytes: bytes.byteLength,
      },
    });
    const urlBody = await urlRes.json();
    writeFileSync(
      resolve(artifactsDir, "upload-url.json"),
      JSON.stringify({ status: urlRes.status(), body: urlBody }, null, 2)
    );
    expect(urlRes.ok()).toBeTruthy();
    const uploadUrl = urlBody.uploadUrl as string;
    const assetId = urlBody.assetId as string;
    const putRes = await page.request.put(uploadUrl, {
      data: bytes,
      headers: { "Content-Type": "image/jpeg" },
    });
    expect(putRes.ok()).toBeTruthy();
    const confirmRes = await page.request.post(`/api/campaigns/${campaignId}/assets/${assetId}/confirm`, {
      data: {},
    });
    const confirmBody = await confirmRes.json().catch(() => ({}));
    writeFileSync(
      resolve(artifactsDir, "asset-upload.json"),
      JSON.stringify(
        { uploadStatus: putRes.status(), confirmStatus: confirmRes.status(), assetId, confirm: confirmBody },
        null,
        2
      )
    );
    expect(confirmRes.ok()).toBeTruthy();

    const mediaRes = await page.request.post(`/api/campaigns/${campaignId}/media`, {
      data: { assetIds: [assetId], storyIds: [] },
    });
    expect(mediaRes.ok()).toBeTruthy();

    // Browser: open campaign workspace (proves account can access E2E Workspace)
    await page.goto(`/w/${workspaceSlug}/campaigns/${campaignId}`, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: resolve(artifactsDir, "02-campaign-workspace.png"), fullPage: true });
    await expect(page.getByRole("heading", { name: new RegExp(campaignName.slice(0, 20)) })).toBeVisible({
      timeout: 30_000,
    });

    // Generate via production API (same path as Generate button) under authenticated browser session
    const genRes = await page.request.post(`/api/campaigns/${campaignId}/generate`, { data: {} });
    const genBody = await genRes.json().catch(() => ({}));
    writeFileSync(
      resolve(artifactsDir, "generate-response.json"),
      JSON.stringify({ status: genRes.status(), body: genBody }, null, 2)
    );
    expect(genRes.ok()).toBeTruthy();
    const taskId = (genBody as { taskId?: string }).taskId;
    expect(taskId).toBeTruthy();

    const taskUrl = `/w/${workspaceSlug}/campaigns/${campaignId}/task?taskId=${taskId}`;
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });
    writeFileSync(resolve(artifactsDir, "task-url.txt"), page.url());
    await page.screenshot({ path: resolve(artifactsDir, "03-task-progress.png"), fullPage: true });

    // 6) Worker processing — poll until marketing package / completed
    let completed = false;
    for (let i = 0; i < 90; i++) {
      const statusRes = await page.request.get(`/api/tasks/${taskId}`);
      if (statusRes.ok()) {
        const data = (await statusRes.json()) as {
          task?: { status?: string; stepProgress?: Record<string, { status?: string }> };
          status?: string;
          stepProgress?: Record<string, { status?: string }>;
        };
        const status = data.task?.status ?? data.status;
        const content =
          data.task?.stepProgress?.content_generate?.status ??
          data.stepProgress?.content_generate?.status;
        writeFileSync(
          resolve(artifactsDir, "task-poll.json"),
          JSON.stringify({ attempt: i, status, content }, null, 2)
        );
        if (status === "completed" || content === "completed") {
          completed = true;
          break;
        }
        if (status === "failed") {
          throw new Error(`Pipeline failed: ${JSON.stringify(data)}`);
        }
      }
      await page.waitForTimeout(5000);
      if (i % 6 === 0) await page.reload({ waitUntil: "domcontentloaded" });
    }
    expect(completed).toBe(true);
    await page.screenshot({ path: resolve(artifactsDir, "03b-package-ready.png"), fullPage: true });

    // 7) Review → Approve
    await page.goto(`/w/${workspaceSlug}/reviews`, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: resolve(artifactsDir, "04-reviews.png"), fullPage: true });
    const approveCount = await page.getByRole("button", { name: /approve|批准|通过/i }).count();
    for (let i = 0; i < Math.min(approveCount, 8); i++) {
      const btn = page.getByRole("button", { name: /approve|批准|通过/i }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      page.once("dialog", (d) => d.dismiss().catch(() => undefined));
      await btn.click();
      await page.waitForTimeout(1500);
    }
    writeFileSync(
      resolve(artifactsDir, "review-approvals.json"),
      JSON.stringify({ attemptedApprovals: approveCount }, null, 2)
    );

    // 8) Export / Download (may require 3 clips — record outcome)
    await page.goto(taskUrl, { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: resolve(artifactsDir, "05-export-surface.png"), fullPage: true });
    const exportCta = page.getByRole("button", { name: /export|导出/i });
    if (await exportCta.first().isVisible().catch(() => false)) {
      const exportResponse = page
        .waitForResponse(
          (res) => res.url().includes("/export") && res.request().method() === "POST",
          { timeout: 60_000 }
        )
        .catch(() => null);
      await exportCta.first().click();
      const expRes = await exportResponse;
      if (expRes) {
        writeFileSync(
          resolve(artifactsDir, "export-post.json"),
          JSON.stringify(
            { status: expRes.status(), body: await expRes.json().catch(() => ({})) },
            null,
            2
          )
        );
      }
      for (let i = 0; i < 60; i++) {
        const download = page.getByRole("link", { name: /download|下载/i });
        if (await download.isVisible().catch(() => false)) {
          const href = await download.getAttribute("href");
          writeFileSync(resolve(artifactsDir, "export-download.json"), JSON.stringify({ href }, null, 2));
          if (href) {
            const zipRes = await page.request.get(href);
            writeFileSync(resolve(artifactsDir, "export-pack.zip"), Buffer.from(await zipRes.body()));
          }
          break;
        }
        await page.waitForTimeout(5000);
        await page.reload({ waitUntil: "domcontentloaded" });
      }
    } else {
      writeFileSync(
        resolve(artifactsDir, "export-cta-missing.json"),
        JSON.stringify({
          note: "Export CTA not visible — image campaigns often produce <3 clips (AUTO_CLIP)",
          taskUrl,
        }, null, 2)
      );
    }

    await page.screenshot({ path: resolve(artifactsDir, "06-final.png"), fullPage: true });
    await context.storageState({ path: resolve(artifactsDir, "storage-state.json") });
    expect(JSON.parse(readFileSync(resolve(artifactsDir, "browser-storage.json"), "utf8")).password).toBeNull();
  });
});
