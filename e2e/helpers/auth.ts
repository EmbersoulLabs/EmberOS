import { createServerClient } from "@supabase/ssr";
import type { BrowserContext } from "@playwright/test";

type Credentials = { email: string; password: string };
type PendingCookie = { name: string; value: string; options?: Record<string, unknown> };

export function canonicalE2EBaseURL(): string {
  const value = process.env.E2E_BASE_URL?.trim() || "http://127.0.0.1:3100";
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1") {
    throw new Error(`E2E_BASE_URL must use 127.0.0.1, received ${url.hostname}`);
  }
  return url.origin;
}

export async function authenticateContext(
  context: BrowserContext,
  credentials: Credentials
): Promise<{ userId: string; cookieNames: string[] }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !supabaseAnon) throw new Error("Supabase E2E environment is not configured");

  let pending: PendingCookie[] = [];
  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        pending = cookies;
      },
    },
  });
  const { data, error } = await supabase.auth.signInWithPassword(credentials);
  if (error || !data.user || !data.session) {
    throw new Error(error?.message || "Supabase did not return an authenticated session");
  }
  if (pending.length === 0) throw new Error("Supabase SSR did not emit authentication cookies");

  const origin = canonicalE2EBaseURL();
  const cookies = pending.map(({ name, value, options }) => ({
    name,
    value,
    url: origin,
    httpOnly: options?.httpOnly === true,
    secure: options?.secure === true,
    sameSite:
      options?.sameSite === "strict" ? "Strict" : options?.sameSite === "none" ? "None" : "Lax",
  }));
  await context.clearCookies();
  await context.addCookies(cookies);
  return { userId: data.user.id, cookieNames: cookies.map(({ name }) => name) };
}
