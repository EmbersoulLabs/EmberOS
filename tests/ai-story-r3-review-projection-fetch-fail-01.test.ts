import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const routePath =
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts";

describe("R3 runtime review projection fetch reliability", () => {
  it("bounds private playback signing without failing the runtime projection", async () => {
    const route = await readFile(routePath, "utf8");
    expect(route).toContain("PLAYBACK_SIGNING_TIMEOUT_MS = 8_000");
    expect(route).toContain("withDeadline(");
    expect(route).toContain('deliveryStatus: "UNAVAILABLE"');
    expect(route).not.toContain("postCanonicalExecute");
  });

  it("correlates and times the read-only runtime request", async () => {
    const route = await readFile(routePath, "utf8");
    expect(route).toContain("x-emberos-request-correlation-id");
    expect(route).toContain("runtime_projection_ms");
    expect(route).toContain("private_signing_ms");
    expect(route).toContain("total_request_ms");
  });

  it("shows a bounded read-only retry instead of a generic fetch error", async () => {
    const client = await readFile("apps/web/src/lib/ai-story-runtime-client.ts", "utf8");
    const panel = await readFile("apps/web/src/components/ai-story/StoryRuntimePanel.tsx", "utf8");
    expect(client).toContain("RUNTIME_READ_TIMEOUT_MS = 20_000");
    expect(client).toContain('credentials: "same-origin"');
    expect(client).toContain("RUNTIME_READ_NETWORK_ERROR");
    expect(panel).toContain("story-runtime-read-retry");
    expect(panel).not.toContain('setError("Failed to fetch")');
  });
});
