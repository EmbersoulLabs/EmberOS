import { describe, expect, it, beforeEach, vi } from "vitest";

function stubBrowserStorage() {
  const store: Record<string, string> = {};
  const storage = {
    getItem(key: string) {
      return store[key] ?? null;
    },
    setItem(key: string, value: string) {
      store[key] = value;
    },
    removeItem(key: string) {
      delete store[key];
    },
    _store: store,
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  return storage as typeof storage & { _store: Record<string, string> };
}

describe("auth remember-me (no plaintext passwords)", () => {
  beforeEach(() => {
    vi.resetModules();
    stubBrowserStorage();
  });

  it("stores email only and clears legacy password key", async () => {
    const ls = localStorage as unknown as { _store: Record<string, string> };
    ls._store["emberos.auth.password"] = "secret123";

    const { saveRememberedCredentials, loadRememberedCredentials } = await import(
      "../apps/web/src/lib/auth-remember"
    );

    saveRememberedCredentials("user@example.com");
    expect(ls._store["emberos.auth.email"]).toBe("user@example.com");
    expect(ls._store["emberos.auth.remember"]).toBe("1");
    expect(ls._store["emberos.auth.password"]).toBeUndefined();

    const loaded = loadRememberedCredentials();
    expect(loaded).toEqual({ email: "user@example.com", remember: true });
    expect(ls._store["emberos.auth.password"]).toBeUndefined();
  });

  it("migrates legacy installs by clearing password on load", async () => {
    const ls = localStorage as unknown as { _store: Record<string, string> };
    ls._store["emberos.auth.remember"] = "1";
    ls._store["emberos.auth.email"] = "legacy@example.com";
    ls._store["emberos.auth.password"] = "plaintext-password";

    const { loadRememberedCredentials } = await import("../apps/web/src/lib/auth-remember");
    const loaded = loadRememberedCredentials();
    expect(loaded?.email).toBe("legacy@example.com");
    expect(loaded).not.toHaveProperty("password");
    expect(ls._store["emberos.auth.password"]).toBeUndefined();
  });

  it("login page does not persist password client-side", async () => {
    const { readFileSync } = await import("node:fs");
    const login = readFileSync("apps/web/src/app/login/page.tsx", "utf8");
    expect(login).toContain("saveRememberedCredentials(email)");
    expect(login).not.toMatch(/saveRememberedCredentials\(email,\s*password\)/);
    expect(login).not.toContain("saved.password");
  });
});
