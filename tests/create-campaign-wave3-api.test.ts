import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Wave 3 Create Campaign API authority", () => {
  it("validates auth, operator role, typed input, and main workflow", () => {
    const route = readFileSync("apps/web/src/app/api/campaigns/create/route.ts", "utf8");
    const command = readFileSync("apps/web/src/lib/create-campaign-command.ts", "utf8");
    expect(route).toContain("requireAuth()");
    expect(route).toContain('"operator"');
    expect(route).toContain("CreateCampaignContextSchema.safeParse");
    expect(command).toContain("createCampaignFromContext");
    expect(command).toContain("executeCampaignGenerate");
    expect(command).not.toContain("release-next-scene");
  });

  it("uses a transaction lock and one Workspace idempotency identity", () => {
    const repository = readFileSync("packages/db/src/queries/create-campaign.ts", "utf8");
    const migration = readFileSync("packages/db/sql/create-campaign-wave3-v1.sql", "utf8");
    expect(repository).toContain("pg_advisory_xact_lock");
    expect(repository).toContain("creationIdempotencyKey");
    expect(migration).toContain("campaigns_workspace_creation_idempotency_idx");
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM campaigns|UPDATE campaigns SET id/);
  });

  it("preserves story refs and binds their assets without binary ownership mutation", () => {
    const repository = readFileSync("packages/db/src/queries/create-campaign.ts", "utf8");
    expect(repository).toContain("campaignStoryRefs");
    expect(repository).toContain("campaignAssetRefs");
    expect(repository).not.toContain("update(schema.assets)");
  });
});
