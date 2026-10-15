import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("E2E Campaign soft-archive boundary", () => {
  it("maps the existing Production soft-archive columns", () => {
    const schema = readFileSync(resolve("packages/db/src/schema/index.ts"), "utf8");
    const campaigns = schema.slice(
      schema.indexOf('export const campaigns = pgTable('),
      schema.indexOf('export const assets = pgTable(')
    );

    expect(campaigns).toContain('archivedAt: timestamp("archived_at"');
    expect(campaigns).toContain('deletedAt: timestamp("deleted_at"');
  });

  it("keeps archived and deleted Campaigns out of the normal Campaign list", () => {
    const route = readFileSync(
      resolve("apps/web/src/app/api/campaigns/route.ts"),
      "utf8"
    );

    expect(route).toContain("isNull(schema.campaigns.archivedAt)");
    expect(route).toContain("isNull(schema.campaigns.deletedAt)");
  });
});
