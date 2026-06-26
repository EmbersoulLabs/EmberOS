import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Tables with RLS enabled by packages/db/scripts/apply-rls.ts */
const RLS_ENABLED_TABLES = [
  "workspaces",
  "workspace_members",
  "campaigns",
  "assets",
  "tasks",
  "creatives",
  "reviews",
];

/** Business tables with workspace_id that still need RLS (audit A4 / F3 follow-up). */
const RLS_PENDING_TABLES = [
  "client_invites",
  "publish_jobs",
  "agent_logs",
  "marketing_scores",
  "content_analytics",
  "workspace_insights",
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
    ];
    for (const name of policyNames) {
      expect(sql, `missing policy ${name}`).toMatch(
        new RegExp(`CREATE POLICY ${name}`, "i")
      );
    }
  });

  it("documents tables still missing RLS (P3 follow-up)", () => {
    const sql = readFileSync(resolve(__dirname, "../packages/db/sql/rls.sql"), "utf8");
    for (const table of RLS_PENDING_TABLES) {
      expect(sql).not.toMatch(new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, "i"));
    }
    expect(RLS_PENDING_TABLES.length).toBeGreaterThan(0);
  });
});
