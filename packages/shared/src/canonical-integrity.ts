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
