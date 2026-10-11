export const E2E_SESSION_COOKIE = "emberos_e2e_session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Test-only session minting. Production builds cannot enable this, even if the flag is set. */
export function e2eLocalAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_LOCAL_AUTH === "1" &&
    Boolean(process.env.E2E_LOCAL_AUTH_SECRET)
  );
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function signaturesMatch(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function signE2ESession(userId: string, ttlSec = 60 * 60): Promise<string> {
  const secret = process.env.E2E_LOCAL_AUTH_SECRET;
  if (!e2eLocalAuthEnabled() || !secret) throw new Error("Local E2E auth is disabled");
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${userId}.${exp}`;
  return `${payload}.${await signPayload(secret, payload)}`;
}

export async function readE2ESessionUser(
  token: string | undefined | null
): Promise<{ id: string; email: string } | null> {
  const secret = process.env.E2E_LOCAL_AUTH_SECRET;
  if (!e2eLocalAuthEnabled() || !secret || !token) return null;
  const [userId, exp, signature] = token.split(".");
  if (!userId || !exp || !signature || token.split(".").length !== 3) return null;
  if (!UUID_RE.test(userId)) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return null;
  const expected = await signPayload(secret, `${userId}.${exp}`);
  if (!signaturesMatch(expected, signature)) return null;
  return { id: userId, email: "e2e-local@example.test" };
}
