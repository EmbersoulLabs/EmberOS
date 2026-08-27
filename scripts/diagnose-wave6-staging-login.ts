import { chromium } from "@playwright/test";

const baseUrl = "https://emberos-git-staging-kahliantoo-8279s-projects.vercel.app";
const expectedProject = "voofxbuzpocyjzoxrpfi";
const email = process.env.STAGING_CERT_USER_EMAIL?.trim();
const password = process.env.STAGING_CERT_USER_PASSWORD?.trim();
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
if (!email || !password || !bypass) throw new Error("Encrypted Preview certification secrets are required");

type AuthObservation = {
  observed: boolean;
  projectId: string | null;
  status: number | null;
  success: boolean;
  sessionReturned: boolean;
  accessTokenReturned: boolean;
  userReturned: boolean;
  emailMatched: boolean;
  emailConfirmed: boolean;
  disabledOrBanned: boolean;
  errorCategory: string | null;
};

async function main() {
  let providerCalls = 0;
  let resolveAuth!: (value: AuthObservation) => void;
  const authObservation = new Promise<AuthObservation>((resolve) => { resolveAuth = resolve; });
  let authSettled = false;
  const workspaceResponses: number[] = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route(`${baseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const providerMutation = request.method() !== "GET" && /\/api\/.*(?:generate|execute|release-next-scene|recover-pre-dispatch|retry|rewrite|polish|suggest)/i.test(url.pathname);
    if (providerMutation) {
      providerCalls += 1;
      return route.abort("blockedbyclient");
    }
    await route.continue({ headers: { ...request.headers(), "x-vercel-protection-bypass": bypass } });
  });

  const page = await context.newPage();
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.origin === baseUrl && url.pathname === "/workspaces") workspaceResponses.push(response.status());
    if (authSettled || !url.hostname.endsWith(".supabase.co") || url.pathname !== "/auth/v1/token") return;
    authSettled = true;
    let body: Record<string, unknown> = {};
    try { body = await response.json() as Record<string, unknown>; } catch { /* safe empty body */ }
    const user = body.user && typeof body.user === "object" ? body.user as Record<string, unknown> : null;
    const errorCode = typeof body.error_code === "string" ? body.error_code : typeof body.code === "string" ? body.code : null;
    resolveAuth({
      observed: true,
      projectId: url.hostname.split(".")[0] ?? null,
      status: response.status(),
      success: response.ok() && Boolean(body.access_token) && Boolean(user),
      sessionReturned: Boolean(body.access_token && body.refresh_token),
      accessTokenReturned: Boolean(body.access_token),
      userReturned: Boolean(user),
      emailMatched: Boolean(user && typeof user.email === "string" && user.email.toLowerCase() === email.toLowerCase()),
      emailConfirmed: Boolean(user && (user.email_confirmed_at || user.confirmed_at)),
      disabledOrBanned: Boolean(user && user.banned_until),
      errorCategory: response.ok() ? null : errorCode ?? `HTTP_${response.status()}`,
    });
  });

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    const previewProtectionAccess = !page.url().includes("vercel.com/sso-api");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    const auth = await Promise.race([
      authObservation,
      new Promise<AuthObservation>((resolve) => setTimeout(() => resolve({
        observed: false, projectId: null, status: null, success: false, sessionReturned: false,
        accessTokenReturned: false, userReturned: false, emailMatched: false, emailConfirmed: false,
        disabledOrBanned: false, errorCategory: "AUTH_REQUEST_NOT_OBSERVED",
      }), 30_000)),
    ]);
    await page.waitForTimeout(3_000);
    const postAuthPath = new URL(page.url()).pathname;
    const cookies = (await context.cookies()).filter((cookie) => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name));
    const cookieMetadata = cookies.map((cookie) => ({
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
    const passwordPersistenceAbsent = await page.evaluate(() => {
      for (let index = 0; index < localStorage.length; index += 1) {
        if (/password|passwd|pwd/i.test(localStorage.key(index) ?? "")) return false;
      }
      return true;
    });
    const me = await page.evaluate(async () => {
      const response = await fetch("/api/me", { redirect: "manual" });
      let body: Record<string, unknown> = {};
      try { body = await response.json() as Record<string, unknown>; } catch { /* safe empty body */ }
      const workspaces = Array.isArray(body.workspaces) ? body.workspaces : [];
      const first = workspaces[0] && typeof workspaces[0] === "object" ? workspaces[0] as Record<string, unknown> : null;
      return {
        status: response.status,
        userPresent: Boolean(body.user),
        workspaceCount: workspaces.length,
        role: first && typeof first.role === "string" ? first.role : null,
      };
    });
    const workspaceResponse = await page.goto(`${baseUrl}/workspaces`, { waitUntil: "domcontentloaded" });
    const finalPath = new URL(page.url()).pathname;
    console.log(JSON.stringify({
      previewProtectionAccess,
      loginFormSubmitted: true,
      expectedProject,
      authRequestProject: auth.projectId,
      projectBindingMatch: auth.projectId === expectedProject,
      authHttpStatus: auth.status,
      authSuccess: auth.success,
      sessionReturned: auth.sessionReturned,
      accessTokenReturned: auth.accessTokenReturned,
      userReturned: auth.userReturned,
      existingIdentityMatched: auth.emailMatched,
      emailConfirmed: auth.emailConfirmed,
      disabledOrBanned: auth.disabledOrBanned,
      authErrorCategory: auth.errorCategory,
      postAuthPath,
      authCookieCreated: cookies.length > 0,
      authCookieMetadata: cookieMetadata,
      passwordPersistenceAbsent,
      apiMeStatus: me.status,
      sessionVisibleToServer: me.userPresent,
      workspaceMembershipActive: me.workspaceCount > 0,
      expectedRole: me.role ?? "UNRESOLVED",
      workspacesRequestStatus: workspaceResponse?.status() ?? null,
      workspacesObservedStatuses: workspaceResponses,
      finalPath,
      redirectedBackToLogin: finalPath === "/login",
      providerCalls,
    }));
    if (providerCalls !== 0) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ diagnosisCompleted: false, safeErrorCategory: error instanceof Error ? error.name : "UNKNOWN", providerCalls: 0 }));
  process.exitCode = 1;
});
