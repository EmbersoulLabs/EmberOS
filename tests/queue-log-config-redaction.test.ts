import { describe, expect, it } from "vitest";
import { redisLogLabel } from "../packages/queue/src/redis-log-label";

describe("queue log redaction", () => {
  it("does not return an unparseable Redis URL", () => {
    const secret = "not-a-redis-url";
    expect(redisLogLabel(secret)).toBe("unparsed");
    expect(redisLogLabel(secret)).not.toContain(secret);
  });

  it("returns only the hostname for a parseable Redis URL", () => {
    expect(redisLogLabel("redis://:secret-password@example.upstash.io:6379")).toBe(
      "example.upstash.io"
    );
  });
});
