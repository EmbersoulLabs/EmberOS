import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockedExternalNetworkAttempts, installCertificationNetworkIsolation } from "./helpers/certification-network-isolation";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const catalog = JSON.parse(read("tests/fixtures/ai-story-production-predecessor-manifest.json"));
const manifest = JSON.parse(read("docs/releases/ai-story-v1-production-migration-manifest.json"));
const exactGap = [
  "ai_story_canonical_scene_versions", "ai_story_canonical_scenes", "ai_story_cast_promotions",
  "ai_story_character_versions", "ai_story_characters", "ai_story_compiled_provider_requests",
  "ai_story_director_plan_versions", "ai_story_keyframe_paid_authorizations",
  "ai_story_location_promotions", "ai_story_location_versions", "ai_story_locations",
  "ai_story_motion_plan_versions", "ai_story_outline_versions",
  "ai_story_post_generation_qc_evaluations",
  "ai_story_post_terminal_provider_retry_authorizations",
  "ai_story_pre_dispatch_bundle_supersessions", "ai_story_pre_generation_qc_evaluations",
  "ai_story_provider_attempt_compiled_bindings",
  "ai_story_provider_create_response_diagnostics", "ai_story_script_director_handoffs",
  "ai_story_script_versions", "ai_story_supporting_character_versions",
  "ai_story_supporting_characters", "certification_commercial_events",
  "certification_commercial_reservations", "certification_commercial_scopes",
  "certification_planning_authorities", "certification_planning_claims",
  "certification_submission_slot_reconciliations", "provider_usd_pricing_rules",
].sort();
const productionOnly = [
  "provider_execution_finalizations", "provider_finalization_costs",
  "provider_finalization_usage", "provider_terminal_ledger_records",
];

describe("bounded Production overlay migration manifest", () => {
  let restoreNetwork: () => void;
  beforeAll(() => { restoreNetwork = installCertificationNetworkIsolation(); });
  afterAll(() => { restoreNetwork(); });

  it("includes the exact live Production RLS policy helper before policy creation", () => {
    expect(catalog.functions).toHaveLength(1);
    expect(catalog.functions[0]).toEqual({
      schema: "public",
      name: "user_workspace_ids",
      identityArguments: "",
      resultType: "SETOF uuid",
      language: "sql",
      volatility: "STABLE",
      securityDefiner: true,
      leakproof: false,
      owner: "postgres",
      config: null,
      dependency: "workspace_members.user_id/workspace_id + auth.uid()",
      source: "live Production pg_proc / pg_policy dependency",
    });
    const fixtureSql = read("tests/fixtures/ai-story-production-predecessor-schema.sql");
    const helperAt = fixtureSql.indexOf("CREATE OR REPLACE FUNCTION public.user_workspace_ids()");
    const firstPolicyAt = fixtureSql.indexOf("CREATE POLICY");
    expect(helperAt).toBeGreaterThan(fixtureSql.indexOf('CREATE TABLE "workspaces"'));
    expect(firstPolicyAt).toBeGreaterThan(helperAt);
    expect(fixtureSql).toContain("SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()");
    expect(fixtureSql.slice(helperAt, firstPolicyAt)).toMatch(/RETURNS SETOF uuid\s+LANGUAGE sql\s+STABLE SECURITY DEFINER/);
  });

  it("blocks external HTTP before transmission in the certification harness", () => {
    expect(() => fetch("https://api.openai.com/v1/models")).toThrow("NETWORK_CALL_BLOCKED_BY_TEST_HARNESS");
    expect(blockedExternalNetworkAttempts()).toContain("api.openai.com");
  });

  it("retains the live-catalog predecessor contract instead of substituting staging schema", () => {
    expect(catalog.sourceKind).toBe("read-only pg_catalog snapshot");
    expect(catalog.productionCodeBase).toBe(manifest.productionBaseSha);
    const tableNames = new Set<string>();
    for (const table of catalog.tables) {
      expect(tableNames.has(table.table), table.table).toBe(false);
      tableNames.add(table.table);
      expect(table.columns.length, `${table.table} columns`).toBeGreaterThan(0);
      expect(table.constraints.some((constraint: { type: string }) => constraint.type === "p"), `${table.table} primary key`).toBe(true);
      expect(table.indexes.length, `${table.table} indexes`).toBeGreaterThan(0);
      expect(typeof table.rls, `${table.table} RLS`).toBe("boolean");
      expect(typeof table.forceRls, `${table.table} forced RLS`).toBe("boolean");
      expect(Array.isArray(table.policies), `${table.table} policies`).toBe(true);
      expect(Array.isArray(table.triggers), `${table.table} triggers`).toBe(true);
    }
    for (const missing of exactGap) expect(tableNames.has(missing), missing).toBe(false);
  });

  it("represents the exact live 30-table gap and four Production-only Provider tables", () => {
    expect(catalog.sourceProjectRef).toBe("egkgybrjmzukzmkcrpag");
    expect(manifest.productionProjectRef).toBe(catalog.sourceProjectRef);
    expect(catalog.tables).toHaveLength(58);
    expect(manifest.gapTables).toEqual(exactGap);
    for (const name of productionOnly) expect(catalog.tables.some((table: { table: string }) => table.table === name)).toBe(true);
    expect(new Set(catalog.tables.map((table: { table: string }) => table.table)).size).toBe(58);
  });

  it("has an exact-source, topologically ordered, non-row-mutating 24-step closure", () => {
    expect(manifest.entries).toHaveLength(24);
    const known = new Set(catalog.tables.map((table: { table: string }) => `table:${table.table}`));
    const created = new Set<string>();
    for (const [index, entry] of manifest.entries.entries()) {
      expect(entry.order).toBe(index + 1);
      expect(entry.destructive).toBe(false);
      expect(entry.modifiesExistingRows).toBe(false);
      expect(entry.replayPolicy).toBe("ONE_SHOT_FAIL_CLOSED");
      for (const dependency of entry.requires) expect(known.has(dependency), `${entry.file} requires ${dependency}`).toBe(true);
      const source = read(entry.file);
      expect(createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex"), entry.file).toBe(entry.sha256);
      expect(source).not.toMatch(/\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i);
      for (const provision of entry.provides) {
        if (provision.startsWith("table:") && !known.has(provision)) created.add(provision.slice(6));
        known.add(provision);
      }
    }
    expect([...created].sort()).toEqual(exactGap);
    expect(productionOnly.every((name) => known.has(`table:${name}`))).toBe(true);
  });
});
