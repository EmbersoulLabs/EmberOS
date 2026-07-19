import { describe, expect, it } from "vitest";
import {
  buildBusinessProfilePatch,
  classifyBusinessProfileHttpStatus,
  createEmptyBusinessProfileDraft,
  extractApiWarnings,
  isVersionConflictStatus,
  profileToFormValues,
  validateBusinessProfilePatch,
} from "../apps/web/src/lib/business-profile-form";
import { emptyBusinessHours } from "@ceo-agent/shared";

const orgId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const workspaceId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("business-profile UI helpers", () => {
  it("maps successful load", () => {
    expect(classifyBusinessProfileHttpStatus(200)).toBe("ok");
  });

  it("maps 403 forbidden", () => {
    expect(classifyBusinessProfileHttpStatus(403)).toBe("forbidden");
  });

  it("maps 404 not found / empty", () => {
    expect(classifyBusinessProfileHttpStatus(404)).toBe("not_found");
  });

  it("detects 409 version conflict", () => {
    expect(isVersionConflictStatus(409)).toBe(true);
    expect(isVersionConflictStatus(400)).toBe(false);
  });

  it("extracts non-blocking API warnings for rendering", () => {
    expect(
      extractApiWarnings({
        warnings: [
          {
            code: "BUSINESS_PROFILE_INCOMPLETE",
            message: "Business Profile is incomplete. AI quality may be affected.",
            missing: ["companyName"],
          },
        ],
      })
    ).toHaveLength(1);
    expect(extractApiWarnings({})).toEqual([]);
  });

  it("validates successful save payload", () => {
    const result = validateBusinessProfilePatch({
      version: 2,
      companyName: "Acme Co",
    });
    expect(result.success).toBe(true);
  });

  it("surfaces validation errors for invalid field values", () => {
    const result = validateBusinessProfilePatch({
      version: 1,
      businessEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("builds sparse PATCH so incomplete forms can autosave", () => {
    const baseline = profileToFormValues(createEmptyBusinessProfileDraft(orgId, workspaceId));
    const values = { ...baseline, companyName: "Acme" };
    const patch = buildBusinessProfilePatch(values, 1, "en", baseline);
    expect(patch).toEqual({ version: 1, companyName: "Acme" });
  });

  it("sends null when nullable fields are cleared", () => {
    const baseline = profileToFormValues(createEmptyBusinessProfileDraft(orgId, workspaceId));
    baseline.website = "https://example.com";
    baseline.logo = "logos/acme.png";
    baseline.instagram = "https://instagram.com/acme";
    baseline.city = "Singapore";
    baseline.brandColors = ["#111111"];

    const values = {
      ...baseline,
      website: "",
      logo: "",
      instagram: "",
      city: "",
      brandColors: [] as string[],
    };

    const patch = buildBusinessProfilePatch(values, 3, "en", baseline);
    expect(patch).toEqual({
      version: 3,
      website: null,
      logo: null,
      instagram: null,
      city: null,
      brandColors: [],
    });
    expect(validateBusinessProfilePatch(patch).success).toBe(true);
  });

  it("omits unchanged fields even when blank", () => {
    const baseline = profileToFormValues(createEmptyBusinessProfileDraft(orgId, workspaceId));
    const patch = buildBusinessProfilePatch(baseline, 1, "en", baseline);
    expect(patch).toEqual({ version: 1 });
  });

  it("creates empty draft defaults for empty-state editing", () => {
    const draft = createEmptyBusinessProfileDraft(orgId, workspaceId);
    const values = profileToFormValues(draft);
    expect(values.companyName).toBe("");
    expect(values.businessHours).toEqual(emptyBusinessHours());
  });
});
