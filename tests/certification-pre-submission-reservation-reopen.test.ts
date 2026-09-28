import { describe, expect, it } from "vitest";
import { canReopenUnsubmittedCertificationReservation } from "../packages/db/src/queries/certification-commercial-authority";

describe("unsubmitted certification reservation reopen", () => {
  it("reopens a release that never reached submission", () => {
    expect(canReopenUnsubmittedCertificationReservation({
      status: "RELEASED",
      hasSubmittedEvent: false,
      hasSlotReconciliation: false,
    })).toBe(true);
  });

  it("keeps a submitted release closed until slot reconciliation", () => {
    expect(canReopenUnsubmittedCertificationReservation({
      status: "RELEASED",
      hasSubmittedEvent: true,
      hasSlotReconciliation: false,
    })).toBe(false);
    expect(canReopenUnsubmittedCertificationReservation({
      status: "RELEASED",
      hasSubmittedEvent: false,
      hasSlotReconciliation: true,
    })).toBe(false);
    expect(canReopenUnsubmittedCertificationReservation({
      status: "RESERVED",
      hasSubmittedEvent: false,
      hasSlotReconciliation: false,
    })).toBe(false);
  });
});
