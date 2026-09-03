import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "packages/db/sql/certification-commercial-effective-quota-v1.sql"
), "utf8");
const applyScript = readFileSync(resolve(
  process.cwd(),
  "packages/db/scripts/apply-certification-commercial-effective-quota-v1.ts"
), "utf8");

describe("certification commercial effective quota migration", () => {
  it("retires the gross-only check and installs ledger-aware enforcement", () => {
    expect(migration).toContain(
      "DROP CONSTRAINT IF EXISTS certification_commercial_scope_quota_check"
    );
    expect(migration).toContain(
      "NEW.consumed_provider_submissions\n    - reconciled_non_submissions\n    + NEW.reserved_provider_submissions"
    );
    expect(migration).toContain("certification_commercial_scope_effective_quota_check");
    expect(migration).not.toContain(
      "consumed_provider_submissions + reserved_provider_submissions <= max_provider_submissions"
    );
  });

  it("retains local sanity and serializes reconciliation on the scope row", () => {
    expect(migration).toContain("consumed_provider_submissions >= 0");
    expect(migration).toContain("reserved_provider_submissions >= 0");
    expect(migration).toContain("reconciled_non_submissions > NEW.consumed_provider_submissions");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("certification_slot_reconciliation_scope_identity_check");
  });

  it("is an ordered STAGING-only, hold-protected apply authority", () => {
    expect(applyScript).toContain("refuseProductionAiStoryApply()");
    expect(applyScript).toContain("STAGING_ENVIRONMENT_REQUIRED");
    expect(applyScript).toContain("CERTIFICATION_NO_DISPATCH_MUST_REMAIN_ACTIVE");
    expect(applyScript).toContain("certification-commercial-effective-quota-v1.sql");
  });
});
