import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, expect, test, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000611";
const workspaceId = "00000000-0000-4000-8000-000000000612";
const campaignId = "00000000-0000-4000-8000-000000000613";
const storyId = "00000000-0000-4000-8000-000000000614";
const storyVersionId = "00000000-0000-4000-8000-000000000615";
const packageId = "00000000-0000-4000-8000-000000000616";
let authServer: Server;

const draft = {
  title: "Authority consistency",
  summary: "A product remains bound to its source.",
  objective: "Awareness",
  targetAudience: "Operators",
  tone: "Precise",
  estimatedDuration: "15 seconds",
  story: { opening: "The product is still.", development: "The product turns.", ending: "The product holds." },
  keyMessages: ["Exact product"],
  cta: "Review",
  assetReferences: [],
  warnings: [],
};

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: "authenticated",
    sub: userId,
    email: "operator@example.com",
  })}.e2e`;
}

beforeAll(async () => {
  authServer = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/auth/v1/user")) {
      response.end(JSON.stringify({
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "operator@example.com",
        app_metadata: {},
        user_metadata: {},
        identities: [],
      }));
      return;
    }
    response.end("{}");
  });
  await new Promise<void>((resolve, reject) => {
    authServer.listen(54321, "127.0.0.1", resolve).once("error", reject);
  });
});

afterAll(async () => {
  if (authServer) await new Promise<void>((resolve) => authServer.close(() => resolve()));
});

async function openPlanning(page: Page, readiness: { status: "PASS" | "BLOCK"; findings: unknown[] }) {
  let approvalPosts = 0;
  let paidCalls = 0;
  let storyStatus = "planning_review";
  await page.addInitScript(() => localStorage.setItem("emberos-locale", "en"));
  await page.route("**/auth/continue", (route) => route.fulfill({
    status: 307,
    headers: { location: "/workspaces" },
  }));
  await page.route("**/auth/v1/token**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      access_token: token(),
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "e2e-refresh",
      user: { id: userId, aud: "authenticated", role: "authenticated", email: "operator@example.com", app_metadata: {}, user_metadata: {}, identities: [] },
    }),
  }));
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (/api\.openai\.com|\/v1\/chat\/completions|\/v1\/responses/.test(url)) paidCalls += 1;
    if (url.includes("/api/me")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workspaces: [{ id: workspaceId, slug: "authority", name: "Authority", role: "operator" }] }),
      });
    }
    if (url.endsWith(`/api/campaigns/${campaignId}/ai-stories/${storyId}`)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          story: { id: storyId, status: storyStatus },
          currentVersion: { id: storyVersionId, structuredContent: draft },
          characters: [],
          supportingCharacters: [],
        }),
      });
    }
    if (url.endsWith(`/api/campaigns/${campaignId}/ai-stories/${storyId}/planning`)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ animationPackage: { id: packageId, payload: { status: "review" } } }),
      });
    }
    if (url.includes("/planning/readiness")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ readiness }),
      });
    }
    if (url.endsWith("/planning/approve") && route.request().method() === "POST") {
      approvalPosts += 1;
      storyStatus = "ready_for_execution";
      const body = route.request().postDataJSON() as { executionEnvironment?: string };
      expect(body.executionEnvironment).toBe("LOCAL_GPU");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ storyId, status: "ready_for_execution" }),
      });
    }
    if (url.includes("/execution-plans/current")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ executionPlan: null }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("operator@example.com");
  await page.locator('input[type="password"]').fill("synthetic-only");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/workspaces");
  await page.goto(`/w/authority/campaigns/${campaignId}/ai-stories/${storyId}`);
  await page.getByText("Advanced animation preparation").click();
  return {
    approvalPosts: () => approvalPosts,
    paidCalls: () => paidCalls,
  };
}

test("unchanged readiness PASS can be approved once", async ({ page }) => {
  const observed = await openPlanning(page, { status: "PASS", findings: [] });
  const button = page.getByRole("button", { name: "Approve Planning" });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText("Your Episode is ready for generation review.")).toBeVisible();
  expect(observed.approvalPosts()).toBe(1);
  expect(observed.paidCalls()).toBe(0);
});

test("derivative authority mismatch blocks approval", async ({ page }) => {
  const observed = await openPlanning(page, {
    status: "BLOCK",
    findings: [{
      code: "DERIVATIVE_AUTHORITY_MISMATCH",
      classification: "CONTRADICTION",
      message: "Derivative evidence must bind the exact Scene Product authority",
      scriptSceneIds: [],
    }],
  });
  await expect(page.getByTestId("planning-readiness-finding")).toContainText("DERIVATIVE_AUTHORITY_MISMATCH");
  await expect(page.getByRole("button", { name: "Approve Planning" })).toBeDisabled();
  expect(observed.approvalPosts()).toBe(0);
  expect(observed.paidCalls()).toBe(0);
});
