import { createHmac } from "node:crypto";
import {
  canonicalLocalGpuSigningPayload,
  type LocalGpuSignedFields,
} from "@ceo-agent/shared";

export function signLocalGpuCanonicalPayload(secret: string, canonicalPayload: string): {
  signature: string;
  token: string;
} {
  if (!secret) throw new Error("LOCAL_GPU_SIGNING_SECRET_REQUIRED");
  const signature = createHmac("sha256", secret).update(canonicalPayload, "utf8").digest("hex");
  const token = `${Buffer.from(canonicalPayload, "utf8").toString("base64url")}.${signature}`;
  return { signature, token };
}

export function signLocalGpuRequest(secret: string, fields: LocalGpuSignedFields): {
  canonicalPayload: string;
  signature: string;
  token: string;
} {
  const canonicalPayload = canonicalLocalGpuSigningPayload(fields);
  return { canonicalPayload, ...signLocalGpuCanonicalPayload(secret, canonicalPayload) };
}
