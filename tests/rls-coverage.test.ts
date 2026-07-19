import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Tables with RLS enabled by packages/db/sql/rls.sql */
const RLS_ENABLED_TABLES = [
  "workspaces",
  "workspace_members",
  "campaigns",
  "assets",
  "tasks",
  "creatives",
  "reviews",
  "client_invites",
  "publish_jobs",
  "agent_logs",
  "marketing_scores",
  "content_analytics",
  "workspace_insights",
  "business_profiles",
];

describe("RLS coverage", () => {
  it("rls.sql enables RLS on all core tenant tables", () => {
    const sql = readFileSync(resolve(__dirname, "../packages/db/sql/rls.sql"), "utf8");
    for (const table of RLS_ENABLED_TABLES) {
      expect(sql, `missing ENABLE ROW LEVEL SECURITY for ${table}`).toMatch(
        new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i")
      );
    }
  });

  it("apply-rls.ts policy list matches rls.sql policy names", () => {
    const sql = readFileSync(resolve(__dirname, "../packages/db/sql/rls.sql"), "utf8");
    const policyNames = [
      "workspace_select",
      "workspace_members_select",
      "campaigns_all",
      "assets_all",
      "tasks_all",
      "creatives_all",
      "reviews_all",
      "client_invites_all",
      "publish_jobs_all",
      "agent_logs_all",
      "marketing_scores_all",
      "content_analytics_all",
      "workspace_insights_all",
      "business_profiles_select",
      "business_profiles_insert",
      "business_profiles_update",
      "business_profiles_delete",
    ];
    for (const name of policyNames) {
      expect(sql, `missing policy ${name}`).toMatch(
        new RegExp(`CREATE POLICY ${name}`, "i")
      );
    }
  });

  it("business_profiles INSERT/UPDATE policies use WITH CHECK tenant bounds", () => {
    const sql = readFileSync(resolve(__dirname, "../packages/db/sql/rls.sql"), "utf8");
    const apply = readFileSync(
      resolve(__dirname, "../packages/db/scripts/apply-rls.ts"),
      "utf8"
    );

    expect(sql).toMatch(/business_profiles_insert[\s\S]*WITH CHECK/i);
    expect(sql).toMatch(/business_profiles_update[\s\S]*USING[\s\S]*WITH CHECK/i);
    expect(sql).toMatch(/org_id = \(SELECT org_id FROM workspaces WHERE id = workspace_id\)/);

    expect(apply).toContain("business_profiles_insert");
    expect(apply).toContain("business_profiles_update");
    expect(apply).toContain("MEMBER_WORKSPACE_AND_ORG");
    // Legacy FOR ALL policy must not be recreated; guarded drop is required.
    expect(apply).not.toMatch(/CREATE POLICY\s+business_profiles_all/i);
    expect(sql).not.toMatch(/CREATE POLICY\s+business_profiles_all/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS business_profiles_all/i);
    expect(apply).toContain("LEGACY_POLICY_DROPS");
    expect(apply).toContain('name: "business_profiles_all"');
  });
});
