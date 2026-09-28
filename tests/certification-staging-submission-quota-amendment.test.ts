import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
  STAGING_BOUNDED_SUCCESSOR_SEEDANCE_CERTIFICATION_QUOTA_AMENDMENT_REASON,
} from "@ceo-agent/shared/server";

const source = readFileSync(
  "packages/db/src/queries/certification-commercial-authority.ts",
  "utf8"
);

describe("staging successor certification quota amendment", () => {
  it("keeps Production quota amendment at exactly one additional submission", () => {
    const production = source.slice(
      source.indexOf("async amendActiveProductionSubmissionQuota"),
      source.indexOf("async amendActiveStagingSubmissionQuota")
    );
    expect(production).toContain('input.environment !== "PRODUCTION"');
    expect(production).toContain("input.maxProviderSubmissions !== row.maxProviderSubmissions + 1");
    expect(production).toContain("PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON");
    expect(production).not.toContain("STAGING_BOUNDED_SUCCESSOR_SEEDANCE_CERTIFICATION_QUOTA_TARGET");
  });

  it("authorizes only the staging 4 to 9 successor certification quota", () => {
    const staging = source.slice(
      source.indexOf("async amendActiveStagingSubmissionQuota"),
      source.indexOf("async provisionPrice")
    );
    const update = staging.slice(staging.indexOf("await tx.update"));
    expect(staging).toContain('input.environment !== "STAGING"');
    expect(staging).toContain("STAGING_BOUNDED_SUCCESSOR_SEEDANCE_CERTIFICATION_QUOTA_AMENDMENT_REASON");
    expect(staging).not.toContain("PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON");
    expect(update).toContain("maxProviderSubmissions: nextScope.maxProviderSubmissions");
    expect(update).not.toContain("consumedProviderSubmissions");
    expect(update).not.toContain("spentProviderCostUsd");
    expect(update).not.toContain("maxProviderCostUsd");
    expect(STAGING_BOUNDED_SUCCESSOR_SEEDANCE_CERTIFICATION_QUOTA_AMENDMENT_REASON)
      .not.toBe(PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON);
  });
});
