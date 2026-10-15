import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Campaign AI suggestion recovery", () => {
  it("returns an actionable provider-authorization error before the paid boundary", () => {
    const route = read("apps/web/src/app/api/workspaces/[id]/audience/suggest/route.ts");
    const guard = route.indexOf('process.env.AI_STORY_PROVIDER_DISPATCH_MODE === "allowlisted_self_use"');
    const providerCall = route.indexOf("callStructuredJsonModel({", guard);
    expect(guard).toBeGreaterThan(0);
    expect(providerCall).toBeGreaterThan(guard);
    expect(route).toContain("Enter the target audience manually");
    expect(route).toContain('"AI_UNAVAILABLE"');
  });

  it("bounds an authorized suggestion response", () => {
    const route = read("apps/web/src/app/api/workspaces/[id]/audience/suggest/route.ts");
    expect(route).toContain("maxOutputTokens: 300");
  });
});
