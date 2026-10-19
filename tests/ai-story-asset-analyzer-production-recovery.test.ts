import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const route = readFileSync(
  "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts",
  "utf8"
);
const repository = readFileSync(
  "packages/db/src/queries/ai-story-asset-aware-execution-planner.ts",
  "utf8"
);
const migration = readFileSync(
  "packages/db/sql/ai-story-asset-analysis-diagnostics-v1.sql",
  "utf8"
);

describe("system-wide Asset Analyzer recovery contract", () => {
  it("binds semantic analysis to the same server-authorized Provider context before any HTTP call", () => {
    const context = route.indexOf("withControlledSelfUseProviderContext({");
    const grounding = route.indexOf("runAssetGrounding)", context);
    expect(context).toBeGreaterThan(-1);
    expect(grounding).toBeGreaterThan(context);
    expect(route).toContain("SUBMITTED without completion evidence is intentionally left unresolved");
  });

  it("persists sanitized Provider evidence and blocks automatic UNKNOWN replay", () => {
    expect(repository).toContain('eq(schema.assetAnalysisAttempts.status, "UNKNOWN")');
    expect(repository).toContain("ASSET_ANALYSIS_UNKNOWN_RECONCILIATION_REQUIRED");
    expect(repository).toContain("providerRequestId: evidence?.providerRequestId");
    expect(migration).toContain("status IN ('SUCCEEDED', 'FAILED', 'UNKNOWN')");
    expect(migration).not.toMatch(/GRANT\s+.*asset_analysis_attempts/i);
  });

  it("maps definite failures to actionable HTTP responses without leaking raw errors", () => {
    expect(route).toContain('error.analyzerFailureStage === "PROVIDER_AUTHORIZATION" ? 403 : 422');
    expect(route).toContain("Asset analysis has an uncertain Provider outcome; reconcile status before retrying");
    expect(route).not.toContain("error.stack");
  });
});
