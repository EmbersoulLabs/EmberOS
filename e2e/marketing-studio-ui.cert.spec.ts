import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Seed = {
  editorId: string;
  viewerId: string;
  outsiderId: string;
  workspaceSlug: string;
  campaignId: string;
  taskId: string;
  exhaustedTaskId: string;
  otherCampaignId: string;
  databaseUrl: string;
  secret: string;
  baseURL: string;
};

const seed = JSON.parse(readFileSync(path.join(tmpdir(), "emberos-marketing-ui-seed.json"), "utf8")) as Seed;
const evidenceDir = path.resolve("test-results/marketing-ui-cert");
mkdirSync(evidenceDir, { recursive: true });

const evidence: Record<string, unknown> = { seedCampaignId: seed.campaignId, responses: {} };
const paidRequests: string[] = [];
const pageErrors: string[] = [];

function record(name: string, status: number, body?: unknown) {
  (evidence.responses as Record<string, unknown>)[name] = { status, body };
}

async function signIn(context: BrowserContext, userId: string) {
  const response = await context.request.post("/api/e2e/session", {
    data: { userId },
    headers: { "x-e2e-auth-secret": seed.secret },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function openPackage(page: Page) {
  await page.goto(`/w/${seed.workspaceSlug}/campaigns/${seed.campaignId}`);
  await page.getByRole("button", { name: "View Marketing Package" }).click();
  await expect(page.getByText("抖音中文").first()).toBeVisible();
}

async function switchLocale(page: Page, locale: "zh" | "en" | "ms") {
  await page.locator('select[aria-label="Language"]').selectOption(locale);
}

type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>) & {
  end: () => Promise<void>;
};

function openSql(): Sql {
  const require = createRequire(path.resolve("packages/db/package.json"));
  const postgres = require("postgres") as (url: string, options: { max: number }) => Sql;
  return postgres(seed.databaseUrl, { max: 1 });
}

async function storedProgress() {
  const sql = openSql();
  const rows = await sql`select step_progress, cost_usd from tasks where id = ${seed.taskId}::uuid`;
  await sql.end();
  return rows[0] as { step_progress: Record<string, unknown>; cost_usd: string };
}

function watch(page: Page) {
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const host = new URL(request.url()).host;
    if (/openai|anthropic|generativelanguage|openrouter/i.test(host)) paidRequests.push(request.url());
  });
}

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  evidence.pageErrors = pageErrors;
  evidence.paidRequests = paidRequests;
  writeFileSync(path.join(evidenceDir, "evidence.json"), JSON.stringify(evidence, null, 2));
});

test("loads the saved package, scripts, fallback, and text download", async ({ browser }) => {
  const context = await browser.newContext();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(context, seed.editorId);
  const page = await context.newPage();
  watch(page);
  await openPackage(page);
  await expect(page.getByText("模板回退。此营销包不是模型生成的。")).toBeVisible();
  await expect(page.getByText("十五秒脚本")).toBeVisible();
  await expect(page.getByText("三十秒脚本")).toBeVisible();
  await expect(page.getByText("六十秒脚本")).toBeVisible();
  await expect(page.getByText("中文口播十五秒")).toBeVisible();
  await expect(page.getByText("English voice fifteen")).toBeVisible();
  await expect(page.getByText("0s–3s 开场")).toBeVisible();
  await expect(page.getByText("十秒钩子").first()).toBeVisible();
  await expect(page.getByText("立即了解").first()).toBeVisible();
  await expect(page.getByText("Product close-up")).toBeVisible();
  await expect(page.getByText("Upbeat acoustic")).toBeVisible();
  await expect(page.getByText("Soft zoom")).toBeVisible();
  await expect(page.getByText("Weekdays 7pm")).toBeVisible();
  const ctr = page.locator("div").filter({ has: page.getByText("预计点击率", { exact: true }) }).last();
  const conversion = page.locator("div").filter({ has: page.getByText("预计转化率", { exact: true }) }).last();
  await expect(ctr).toContainText("暂无");
  await expect(conversion).toContainText("暂无");
  await expect(page.locator("body")).not.toContainText("2.4");
  await expect(page.locator("body")).not.toContainText("%–");

  const script = page.locator("div").filter({ has: page.getByText("15 秒脚本", { exact: true }) }).last();
  await script.getByRole("button", { name: "复制" }).click();
  await expect(script.getByRole("button", { name: "已复制" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("十五秒脚本");

  const [download, response] = await Promise.all([
    page.waitForEvent("download"),
    page.waitForResponse((res) => res.url().includes("/marketing-pack/download")),
    page.getByRole("link", { name: "下载营销包" }).click(),
  ]);
  expect(response.status()).toBe(200);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const text = readFileSync(filePath!, "utf8");
  expect(text).toContain("十五秒脚本");
  expect(text).toContain("抖音中文");
  expect(text.toLowerCase()).not.toContain("system prompt");
  expect(text).not.toContain("OPENAI_API_KEY");
  expect(text).not.toContain("sk-");
  evidence.downloadExcerpt = text.slice(0, 400);
  await page.screenshot({ path: path.join(evidenceDir, "package-zh.png"), fullPage: true });

  const video = await context.request.post(`/api/tasks/${seed.taskId}/export`, {
    data: { platforms: ["tiktok"], resolution: "720p" },
  });
  const videoBody = await video.json();
  record("videoExport", video.status(), videoBody);
  expect(video.status()).toBe(409);
  expect(videoBody.code).toBe("VALIDATION_ERROR");
  await context.close();
});

test("edits one locale without changing the others", async ({ browser }) => {
  const context = await browser.newContext();
  await signIn(context, seed.editorId);
  const page = await context.newPage();
  watch(page);
  await openPackage(page);

  await switchLocale(page, "en");
  await expect(page.getByText("TikTok English").first()).toBeVisible();
  await page.getByRole("tab", { name: "TikTok" }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const caption = page.locator("textarea").first();
  await caption.fill("TikTok English saved by e2e");
  const saveResponse = page.waitForResponse((res) => res.url().includes("/marketing-pack") && res.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await saveResponse;
  record("editorSave", saved.status(), await saved.json());
  expect(saved.status()).toBe(200);
  await expect(page.getByText("TikTok English saved by e2e").first()).toBeVisible();

  await switchLocale(page, "zh");
  await expect(page.getByText("抖音中文").first()).toBeVisible();
  await expect(page.getByText("TikTok English saved by e2e")).toHaveCount(0);
  await page.getByRole("tab", { name: "小红书" }).click();
  await expect(page.getByText("小红书原文").first()).toBeVisible();

  await switchLocale(page, "ms");
  await page.getByRole("tab", { name: "Instagram" }).click();
  await expect(page.getByText("IG Melayu").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator("textarea").first().fill("IG Melayu disimpan e2e");
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByText("IG Melayu disimpan e2e").first()).toBeVisible();

  await switchLocale(page, "en");
  await expect(page.getByText("IG English").first()).toBeVisible();
  await expect(page.getByText("IG Melayu disimpan e2e")).toHaveCount(0);
  await page.getByRole("tab", { name: "TikTok" }).click();
  await expect(page.getByText("TikTok English saved by e2e").first()).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "View Marketing Package" }).click();
  await switchLocale(page, "zh");
  await expect(page.getByText("抖音中文").first()).toBeVisible();
  await page.getByRole("tab", { name: "小红书" }).click();
  await expect(page.getByText("小红书原文").first()).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "multilingual.png"), fullPage: true });

  const row = await storedProgress();
  const output = (row.step_progress.content_generate as { output?: Record<string, Record<string, string>> }).output;
  evidence.databaseAfterLocaleEdits = {
    zhTiktok: output?.captions?.tiktok,
    enTiktok: output?.captionsEn?.tiktok,
    msInstagram: output?.captionsMs?.instagram,
    enInstagram: output?.captionsEn?.instagram,
    xiaohongshu: output?.captions?.xiaohongshu,
  };
  expect(output?.captions?.tiktok).toBe("抖音中文");
  expect(output?.captionsEn?.tiktok).toBe("TikTok English saved by e2e");
  expect(output?.captionsMs?.instagram).toBe("IG Melayu disimpan e2e");
  expect(output?.captionsEn?.instagram).toBe("IG English");
  expect(output?.captions?.xiaohongshu).toBe("小红书原文");
  await context.close();
});

test("keeps a stale editor draft when the save conflicts", async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  await signIn(first, seed.editorId);
  await signIn(second, seed.editorId);
  const pageA = await first.newPage();
  const pageB = await second.newPage();
  watch(pageA);
  watch(pageB);
  let holdPolls = false;
  let releasePolls = () => {};
  const pollsHeld = new Promise<void>((resolve) => {
    releasePolls = resolve;
  });
  await pageB.route(
    (url) => url.pathname === `/api/campaigns/${seed.campaignId}`,
    async (route) => {
      if (holdPolls && route.request().method() === "GET") await pollsHeld;
      await route.continue();
    }
  );

  await openPackage(pageA);
  await openPackage(pageB);
  holdPolls = true;
  await switchLocale(pageA, "en");
  await switchLocale(pageB, "en");
  await pageA.getByRole("tab", { name: "TikTok" }).click();
  await pageB.getByRole("tab", { name: "TikTok" }).click();
  await pageA.getByRole("button", { name: "Edit", exact: true }).click();
  await pageB.getByRole("button", { name: "Edit", exact: true }).click();
  await pageA.locator("textarea").first().fill("English saved first");
  await pageB.locator("textarea").first().fill("English stale draft");
  const firstSave = pageA.waitForResponse((res) => res.url().includes("/marketing-pack") && res.request().method() === "PATCH");
  await pageA.getByRole("button", { name: "Save", exact: true }).click();
  expect((await firstSave).status()).toBe(200);

  const conflictResponse = pageB.waitForResponse((res) => res.url().includes("/marketing-pack") && res.request().method() === "PATCH");
  await pageB.getByRole("button", { name: "Save", exact: true }).click();
  const conflict = await conflictResponse;
  const conflictBody = await conflict.json();
  record("staleSave", conflict.status(), conflictBody);
  expect(conflict.status()).toBe(409);
  expect(conflictBody.code).toBe("CONFLICT");
  await expect(pageB.getByText("Someone else saved this package. Your draft is still here — reload before saving again.")).toBeVisible();
  await expect(pageB.locator("textarea").first()).toHaveValue("English stale draft");
  await pageB.screenshot({ path: path.join(evidenceDir, "conflict.png"), fullPage: true });
  releasePolls();

  const row = await storedProgress();
  const output = (row.step_progress.content_generate as { output?: { captionsEn?: { tiktok?: string } } }).output;
  evidence.databaseAfterConflict = output?.captionsEn?.tiktok;
  expect(output?.captionsEn?.tiktok).toBe("English saved first");
  await first.close();
  await second.close();
});

test("enforces viewer, editor, and workspace authorization", async ({ browser }) => {
  const viewer = await browser.newContext();
  await signIn(viewer, seed.viewerId);
  const viewerPage = await viewer.newPage();
  watch(viewerPage);
  await openPackage(viewerPage);
  await expect(viewerPage.getByText("抖音中文").first()).toBeVisible();
  const regenerate = viewerPage.waitForResponse((res) => res.url().includes("/marketing-pack/regenerate"));
  await viewerPage.getByRole("button", { name: "重新生成" }).click();
  const regenerateResponse = await regenerate;
  const regenerateBody = await regenerateResponse.json();
  record("viewerRegenerate", regenerateResponse.status(), regenerateBody);
  expect(regenerateResponse.status()).toBe(403);
  expect(regenerateBody.code).toBe("FORBIDDEN");
  await expect(viewerPage.getByText("重新生成失败，请重试。")).toBeVisible();

  const translate = await viewer.request.post(`/api/tasks/${seed.taskId}/marketing-pack/translate`, {
    data: { locale: "en", contentRevision: 0 },
  });
  const translateBody = await translate.json();
  record("viewerTranslate", translate.status(), translateBody);
  expect(translate.status()).toBe(403);
  expect(translateBody.code).toBe("FORBIDDEN");

  const outsider = await browser.newContext();
  await signIn(outsider, seed.outsiderId);
  const denied = await outsider.request.get(`/api/campaigns/${seed.campaignId}`);
  const deniedBody = await denied.json();
  record("otherWorkspace", denied.status(), deniedBody);
  expect(denied.status()).toBe(403);
  expect(deniedBody.code).toBe("FORBIDDEN");

  const editor = await browser.newContext();
  await signIn(editor, seed.editorId);
  const budget = await editor.request.post(`/api/tasks/${seed.exhaustedTaskId}/marketing-pack/translate`, {
    data: { locale: "en", contentRevision: 0 },
  });
  const budgetBody = await budget.json();
  record("exhaustedBudget", budget.status(), budgetBody);
  expect(budget.status()).toBe(402);
  expect(budgetBody.code).toBe("BUDGET_EXCEEDED");

  const sql = openSql();
  const rows = await sql`select cost_usd from tasks where id = ${seed.exhaustedTaskId}::uuid`;
  await sql.end();
  evidence.exhaustedCostAfter402 = rows[0]?.cost_usd;
  expect(Number(rows[0]?.cost_usd)).toBeCloseTo(0.5, 5);
  expect(paidRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
  await viewer.close();
  await outsider.close();
  await editor.close();
});
