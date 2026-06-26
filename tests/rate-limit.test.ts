import { describe, expect, it } from "vitest";
import { checkMemoryRateLimit } from "@ceo-agent/shared";

describe("checkMemoryRateLimit", () => {
  it("allows requests under the limit", () => {
    const buckets = new Map<string, { count: number; resetAt: number }>();
    const now = 1_000_000;

    expect(checkMemoryRateLimit(buckets, "user:1", 3, 60_000, now)).toEqual({
      allowed: true,
    });
    expect(checkMemoryRateLimit(buckets, "user:1", 3, 60_000, now + 1)).toEqual({
      allowed: true,
    });
    expect(checkMemoryRateLimit(buckets, "user:1", 3, 60_000, now + 2)).toEqual({
      allowed: true,
    });
  });

  it("blocks when the limit is exceeded", () => {
    const buckets = new Map<string, { count: number; resetAt: number }>();
    const now = 2_000_000;

    checkMemoryRateLimit(buckets, "user:2", 2, 10_000, now);
    checkMemoryRateLimit(buckets, "user:2", 2, 10_000, now + 1);

    const blocked = checkMemoryRateLimit(buckets, "user:2", 2, 10_000, now + 2);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) {
      expect(blocked.retryAfterSec).toBeGreaterThan(0);
    }
  });

  it("resets after the window expires", () => {
    const buckets = new Map<string, { count: number; resetAt: number }>();
    const now = 3_000_000;

    checkMemoryRateLimit(buckets, "user:3", 1, 5_000, now);
    expect(checkMemoryRateLimit(buckets, "user:3", 1, 5_000, now + 1).allowed).toBe(false);
    expect(checkMemoryRateLimit(buckets, "user:3", 1, 5_000, now + 5_001).allowed).toBe(true);
  });
});
