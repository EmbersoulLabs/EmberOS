import { createHmac, timingSafeEqual } from "node:crypto";
import {
  canonicalLocalGpuSigningPayload,
  LocalGpuContractError,
  LocalGpuEnvironmentSchema,
  type LocalGpuSignedFields,
} from "@ceo-agent/shared/server";

export function signLocalGpuRequest(secret: string, fields: LocalGpuSignedFields): {
  canonicalPayload: string;
  payload: string;
  signature: string;
  token: string;
} {
  if (!secret) throw new Error("LOCAL_GPU_SIGNING_SECRET_REQUIRED");
  const canonicalPayload = canonicalLocalGpuSigningPayload(fields);
  const payload = Buffer.from(canonicalPayload, "utf8").toString("base64url");
  const signature = createHmac("sha256", Buffer.from(secret, "utf8")).update(payload, "utf8").digest("base64url");
  return { canonicalPayload, payload, signature, token: `${payload}.${signature}` };
}

export function verifyLocalGpuRequest(input: {
  secret: string;
  token: string;
  now: Date;
  workspaceId: string;
  environment: "staging" | "production";
  seenNonces?: Set<string>;
}): LocalGpuSignedFields {
  if (!input.secret) throw new LocalGpuContractError("LOCAL_GPU_SIGNING_SECRET_REQUIRED");
  const parts = input.token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new LocalGpuContractError("LOCAL_GPU_SIGNATURE_INVALID");
  const expected = createHmac("sha256", Buffer.from(input.secret, "utf8")).update(parts[0], "utf8").digest("base64url");
  const actual = Buffer.from(parts[1]);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new LocalGpuContractError("LOCAL_GPU_SIGNATURE_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new LocalGpuContractError("LOCAL_GPU_SIGNATURE_INVALID");
  }
  if (!parsed || typeof parsed !== "object") throw new LocalGpuContractError("LOCAL_GPU_SIGNATURE_INVALID");
  const record = parsed as Record<string, unknown>;
  const fields: LocalGpuSignedFields = {
    v: 1,
    environment: LocalGpuEnvironmentSchema.parse(record.environment),
    action: String(record.action ?? ""),
    jobId: String(record.jobId ?? ""),
    workspaceId: String(record.workspaceId ?? ""),
    actorId: String(record.actorId ?? ""),
    authority: String(record.authority ?? ""),
    workflow: String(record.workflow ?? ""),
    sceneExecutionId: String(record.sceneExecutionId ?? ""),
    expiresAt: Number(record.expiresAt),
    nonce: String(record.nonce ?? ""),
    uploadBinding: typeof record.uploadBinding === "string" || (record.uploadBinding && typeof record.uploadBinding === "object")
      ? record.uploadBinding as LocalGpuSignedFields["uploadBinding"]
      : {},
    ...(typeof record.creativeBinding === "string" ? { creativeBinding: record.creativeBinding } : {}),
  };
  canonicalLocalGpuSigningPayload(fields);
  const decoded = Buffer.from(parts[0], "base64url").toString("utf8");
  if (decoded !== canonicalLocalGpuSigningPayload(fields)) throw new LocalGpuContractError("LOCAL_GPU_SIGNATURE_INVALID");
  if (!Number.isInteger(fields.expiresAt) || fields.expiresAt <= input.now.getTime()) {
    throw new LocalGpuContractError("LOCAL_GPU_REQUEST_EXPIRED");
  }
  if (fields.environment !== input.environment) throw new LocalGpuContractError("LOCAL_GPU_ENVIRONMENT_ISOLATION");
  if (fields.workspaceId !== input.workspaceId) throw new LocalGpuContractError("LOCAL_GPU_WORKSPACE_MISMATCH");
  if (input.seenNonces?.has(fields.nonce)) throw new LocalGpuContractError("LOCAL_GPU_TOKEN_REPLAYED");
  input.seenNonces?.add(fields.nonce);
  return fields;
}
