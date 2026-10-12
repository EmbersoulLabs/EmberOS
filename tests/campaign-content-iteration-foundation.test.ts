import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_CONTENT_ITERATION_STATES, canTransitionCampaignContentIteration } from "@ceo-agent/shared";

describe("Campaign Content Iteration V1 contract", () => {
  it("keeps the bounded lifecycle explicit without changing independent modules", () => {
    expect(CAMPAIGN_CONTENT_ITERATION_STATES).toContain("PLANNING");
    expect(CAMPAIGN_CONTENT_ITERATION_STATES).toContain("PUBLISHED");
    expect(canTransitionCampaignContentIteration("PLANNING", "PLAN_APPROVED")).toBe(true);
    expect(canTransitionCampaignContentIteration("PLANNING", "PUBLISHED")).toBe(false);
    expect(canTransitionCampaignContentIteration("COMPLETED", "PLANNING")).toBe(false);
  });

  it("ships additive, isolated, server-command and rollback contracts", () => {
    const migration = readFileSync("packages/db/sql/campaign-content-iterations-v1.sql", "utf8");
    const rollback = readFileSync("packages/db/sql/campaign-content-iterations-v1.rollback.sql", "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS campaign_content_iterations");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS campaign_workflow_facts");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).not.toMatch(/CREATE POLICY campaign_content_iterations_(insert|update|delete)/);
    expect(migration).not.toMatch(/CREATE POLICY campaign_workflow_facts_(insert|update|delete)/);
    expect(rollback).toContain("DROP TABLE IF EXISTS campaign_workflow_facts");
  });
});
