import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CERTIFICATION_SLOT_RECONCILIATION_OUTCOME,
  CERTIFICATION_SLOT_RECONCILIATION_REASON,
  CERTIFICATION_SLOT_RECONCILIATION_VERSION,
  projectCertificationSubmissionQuota,
} from "../packages/db/src/queries/certification-submission-slot-reconciliation";

describe("certification submission-slot reconciliation authority", () => {
  it("preserves gross history while projecting one effective credit", () => {
    expect(projectCertificationSubmissionQuota({
      maximum: 4,
      grossConsumed: 2,
      reconciledNonSubmissions: 1,
      reservedInFlight: 0,
    })).toEqual({
      maximum: 4,
      grossConsumed: 2,
      reconciledNonSubmissions: 1,
      effectiveConsumed: 1,
      reservedInFlight: 0,
      remaining: 3,
    });
  });

  it("fails closed for credits exceeding gross consumption", () => {
    expect(() => projectCertificationSubmissionQuota({
      maximum: 4,
      grossConsumed: 1,
      reconciledNonSubmissions: 2,
      reservedInFlight: 0,
    })).toThrow("internally inconsistent");
  });

  it("freezes the only permitted classification, reason, and version", () => {
    expect(CERTIFICATION_SLOT_RECONCILIATION_OUTCOME).toBe("PROVEN_NOT_SUBMITTED");
    expect(CERTIFICATION_SLOT_RECONCILIATION_REASON).toBe("PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION");
    expect(CERTIFICATION_SLOT_RECONCILIATION_VERSION).toBe("certification-submission-slot-reconciliation.v1");
  });

  it("requires positive durable non-acceptance and excludes paid lineage", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "packages/db/src/queries/certification-submission-slot-reconciliation.ts"
    ), "utf8");
    for (const guard of [
      'row.reservation_status === "RELEASED"',
      'row.worker_state === "NOT_ACCEPTED"',
      'row.acceptance_classification === "NOT_ACCEPTED"',
      'row.canonical_provider_state === "NOT_ACCEPTED"',
      "row.provider_request_id === null",
      "Number(row.attempt_count) === 0",
      "Number(row.attempt_binding_count) === 0",
      "Number(row.scene_result_count) === 0",
    ]) expect(source).toContain(guard);
  });

  it("uses effective rather than gross consumption for subsequent quota checks", () => {
    const source = readFileSync(resolve(
      process.cwd(),
      "packages/db/src/queries/certification-commercial-authority.ts"
    ), "utf8");
    expect(source).toContain("const effectiveConsumed = row.consumedProviderSubmissions - reconciledNonSubmissions");
    expect(source).toContain("effectiveConsumed + row.reservedProviderSubmissions + 1");
    expect(source).not.toContain("row.consumedProviderSubmissions + row.reservedProviderSubmissions + 1 > row.maxProviderSubmissions");
    expect(source).toContain("sourceSlotReconciliationId");
    expect(source).toContain("certificationSubmissionSlotReconciliations.certificationReservationId");
  });
});
