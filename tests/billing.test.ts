import { describe, it, expect, afterEach } from "vitest";
import {
  isPaidOrgPlan,
  parseExportResolution,
  canExport1080p,
  exportPaywallEnabled,
} from "../packages/shared/src/billing";

describe("billing", () => {
  const prev = process.env.EXPORT_PAYWALL;

  afterEach(() => {
    if (prev === undefined) delete process.env.EXPORT_PAYWALL;
    else process.env.EXPORT_PAYWALL = prev;
  });

  it("recognizes paid org plans", () => {
    expect(isPaidOrgPlan("pro")).toBe(true);
    expect(isPaidOrgPlan("agency")).toBe(true);
    expect(isPaidOrgPlan("free")).toBe(false);
  });

  it("parses export resolution", () => {
    expect(parseExportResolution("1080p")).toBe("1080p");
    expect(parseExportResolution("720p")).toBe("720p");
    expect(parseExportResolution("4k")).toBe("720p");
  });

  it("opens 1080p when paywall disabled", () => {
    process.env.EXPORT_PAYWALL = "false";
    expect(exportPaywallEnabled()).toBe(false);
    expect(canExport1080p("free")).toBe(true);
  });

  it("gates 1080p when paywall enabled", () => {
    process.env.EXPORT_PAYWALL = "true";
    expect(exportPaywallEnabled()).toBe(true);
    expect(canExport1080p("free")).toBe(false);
    expect(canExport1080p("pro")).toBe(true);
  });
});
