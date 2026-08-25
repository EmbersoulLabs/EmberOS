import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearRememberedCredentials,
  loadRememberedCredentials,
  removeLegacyRememberedPassword,
  saveRememberedCredentials,
} from "../apps/web/src/lib/auth-remember";

const PASSWORD_KEY = "emberos.auth.password";
const EMAIL_KEY = "emberos.auth.email";
const REMEMBER_KEY = "emberos.auth.remember";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}

describe("Remember Me credential security", () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
    Object.defineProperty(globalThis, "localStorage", { value: localStorage, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("persists only the allowed identifier when Remember Me is enabled", () => {
    saveRememberedCredentials("operator@example.com");

    expect(localStorage.getItem(EMAIL_KEY)).toBe("operator@example.com");
    expect(localStorage.getItem(REMEMBER_KEY)).toBe("1");
    expect(localStorage.getItem(PASSWORD_KEY)).toBeNull();
    expect(loadRememberedCredentials()).toEqual({
      email: "operator@example.com",
      remember: true,
    });
  });

  it("removes a legacy plaintext password during safe initialization", () => {
    localStorage.setItem(REMEMBER_KEY, "1");
    localStorage.setItem(EMAIL_KEY, "operator@example.com");
    localStorage.setItem(PASSWORD_KEY, "legacy-plaintext");

    expect(loadRememberedCredentials()).toEqual({
      email: "operator@example.com",
      remember: true,
    });
    expect(localStorage.getItem(PASSWORD_KEY)).toBeNull();
  });

  it("clears identifier preference and malformed legacy values when disabled", () => {
    localStorage.setItem(REMEMBER_KEY, "malformed");
    localStorage.setItem(EMAIL_KEY, "operator@example.com");
    localStorage.setItem(PASSWORD_KEY, "{not-json");

    clearRememberedCredentials();

    expect(localStorage.length).toBe(0);
    expect(loadRememberedCredentials()).toBeNull();
  });

  it("cannot reconstruct a password after reload or logout cleanup", () => {
    saveRememberedCredentials("operator@example.com");
    localStorage.setItem(PASSWORD_KEY, "unexpected-legacy-value");

    removeLegacyRememberedPassword();
    const reloaded = loadRememberedCredentials();

    expect(reloaded).not.toHaveProperty("password");
    expect(localStorage.getItem(PASSWORD_KEY)).toBeNull();
  });
});
