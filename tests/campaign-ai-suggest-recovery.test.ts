import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Campaign AI suggestion recovery", () => {
  it("reserves a Controlled Self-Use authority and wraps the provider call before calling the model", () => {
    const route = read("apps/web/src/app/api/workspaces/[id]/audience/suggest/route.ts");
    const reserve = route.indexOf("authority.reserve({");
    const wrap = route.indexOf("withControlledSelfUseProviderContext(", reserve);
    const providerCall = route.indexOf("callStructuredJsonModel({", wrap);
    const settle = route.indexOf("authority.settle(", providerCall);
    expect(reserve).toBeGreaterThan(0);
    expect(wrap).toBeGreaterThan(reserve);
    expect(providerCall).toBeGreaterThan(wrap);
    expect(settle).toBeGreaterThan(providerCall);
    // The reservation is released, not silently dropped, if the provider call throws.
    expect(route).toContain("authority.release(reservation.reservationId");
  });

  it("bounds an authorized suggestion response", () => {
    const route = read("apps/web/src/app/api/workspaces/[id]/audience/suggest/route.ts");
    expect(route).toContain("maxOutputTokens: 300");
  });
});
