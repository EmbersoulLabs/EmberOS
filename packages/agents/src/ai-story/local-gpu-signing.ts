import { createHmac } from "node:crypto";
import {
  canonicalLocalGpuSigningPayload,
  type LocalGpuSignedFields,
} from "@ceo-agent/shared";

/**
 * Desktop job token.
 * payload = base64url(UTF-8 JSON claims), no padding.
 * signature = base64url(HMAC-SHA256(UTF-8 secret, UTF-8 payload string)), no padding.
 * The secret is the literal string. It is never hex-decoded.
 * HTTP method, path, query, body, and body hash are not inputs.
 */
export function signLocalGpuRequest(secret: string, fields: LocalGpuSignedFields): {
  canonicalPayload: string;
  payload: string;
  signature: string;
  token: string;
} {
  if (!secret) throw new Error("LOCAL_GPU_SIGNING_SECRET_REQUIRED");
  const canonicalPayload = canonicalLocalGpuSigningPayload(fields);
  const payload = Buffer.from(canonicalPayload, "utf8").toString("base64url");
  const signature = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(payload, "utf8")
    .digest("base64url");
  return { canonicalPayload, payload, signature, token: `${payload}.${signature}` };
}
