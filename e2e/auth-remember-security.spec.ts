import { expect, test, type Page } from "@playwright/test";

const REMEMBER_KEY = "emberos.auth.remember";
const EMAIL_KEY = "emberos.auth.email";
const PASSWORD_KEY = "emberos.auth.password";

async function seedLegacyStorage(page: Page, remember = "1") {
  await page.addInitScript(({ rememberKey, emailKey, passwordKey, rememberValue }) => {
    if (sessionStorage.getItem("emberos.e2e.legacy-seeded") === "1") return;
    localStorage.setItem(rememberKey, rememberValue);
    localStorage.setItem(emailKey, "operator@example.com");
    localStorage.setItem(passwordKey, "legacy-plaintext-password");
    sessionStorage.setItem("emberos.e2e.legacy-seeded", "1");
  }, { rememberKey: REMEMBER_KEY, emailKey: EMAIL_KEY, passwordKey: PASSWORD_KEY, rememberValue: remember });
}

function fakeJwt() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: "authenticated",
    sub: "00000000-0000-4000-8000-000000000001",
    email: "operator@example.com"
  })}.e2e-signature`;
}

async function mockSuccessfulLogin(page: Page) {
  await page.route("**/auth/v1/token**", async (route) => {
    const now = new Date().toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: fakeJwt(),
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "e2e-refresh-token",
        user: {
          id: "00000000-0000-4000-8000-000000000001",
          aud: "authenticated",
          role: "authenticated",
          email: "operator@example.com",
          email_confirmed_at: now,
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          identities: [],
          created_at: now,
          updated_at: now
        }
      })
    });
  });
}

test("legacy plaintext password is removed on unauthenticated load and reload", async ({ page }) => {
  await seedLegacyStorage(page);
  await page.goto("/login");

  await expect(page.locator('input[type="email"]')).toHaveValue("operator@example.com");
  await expect(page.locator('input[type="password"]')).toHaveValue("");
  await expect(page.locator('input[type="checkbox"]').first()).toBeChecked();
  expect(await page.evaluate((key) => localStorage.getItem(key), PASSWORD_KEY)).toBeNull();

  await page.reload();
  await expect(page.locator('input[type="password"]')).toHaveValue("");
  expect(await page.evaluate((key) => localStorage.getItem(key), PASSWORD_KEY)).toBeNull();
});

test("authenticated Remember Me persists only the identifier", async ({ page }) => {
  await mockSuccessfulLogin(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("operator@example.com");
  await page.locator('input[type="password"]').fill("correct-horse-battery-staple");
  await page.locator('input[type="checkbox"]').first().check();
  await page.locator('button[type="submit"]').click();

  await page.waitForFunction(({ rememberKey, emailKey }) =>
    localStorage.getItem(rememberKey) === "1" && localStorage.getItem(emailKey) === "operator@example.com",
  { rememberKey: REMEMBER_KEY, emailKey: EMAIL_KEY });
  expect(await page.evaluate((key) => localStorage.getItem(key), PASSWORD_KEY)).toBeNull();
});

test("disabled Remember Me clears the identifier and malformed legacy credential", async ({ page }) => {
  await seedLegacyStorage(page, "malformed");
  await mockSuccessfulLogin(page);
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("operator@example.com");
  await page.locator('input[type="password"]').fill("correct-horse-battery-staple");
  await page.locator('input[type="checkbox"]').first().uncheck();
  await page.locator('button[type="submit"]').click();

  await page.waitForFunction(({ rememberKey, emailKey, passwordKey }) =>
    localStorage.getItem(rememberKey) === null &&
    localStorage.getItem(emailKey) === null &&
    localStorage.getItem(passwordKey) === null,
  { rememberKey: REMEMBER_KEY, emailKey: EMAIL_KEY, passwordKey: PASSWORD_KEY });
});
