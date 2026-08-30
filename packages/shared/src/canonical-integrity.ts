/**
 * Server-only canonical integrity hashing.
 * Keep Node `crypto` off the browser-safe shared entrypoint.
 */
import { createHash } from "node:crypto";

export function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortCanonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortCanonicalValue(child)])
    );
  }
  return value;
}

/** Deterministic `sha256:<hex>` over canonically sorted JSON. */
export function sha256CanonicalIntegrityHash(value: unknown): string {
  const canonical = JSON.stringify(sortCanonicalValue(value));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function deterministicUuidFromFingerprint(
  kind: string,
  fingerprint: string
): string {
  const hex = sha256CanonicalIntegrityHash({ kind, fingerprint })
    .replace(/^sha256:/, "")
    .slice(0, 32);
  const bytes = hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const normalized = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}
