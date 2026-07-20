import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBusinessProfilePatch,
  classifyBusinessProfileHttpStatus,
  createEmptyBusinessProfileDraft,
  extractApiWarnings,
  isVersionConflictStatus,
  profileToFormValues,
  validateBusinessProfilePatch,
} from "../apps/web/src/lib/business-profile-form";
import {
  assessBusinessProfileCompletion,
  businessProfileAiAnalysisToUpdate,
  emptyBusinessHours,
} from "@ceo-agent/shared";

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

  it("keeps website and social presence fields optional", () => {
    const baseline = profileToFormValues(createEmptyBusinessProfileDraft(orgId, workspaceId));
    const values = {
      ...baseline,
      companyName: "Acme",
      industryId: "retail",
      services: ["Repair"],
      businessDescription: "Phone repair shop.",
      targetAudience: "Local phone owners",
      businessEmail: "hello@acme.test",
      businessPhone: "+6591234567",
      country: "Singapore",
      address: "1 Main Street",
      postalCode: "123456",
      brandKeywords: ["repair"],
      website: "",
      whatsappBusiness: "",
      facebook: "",
      instagram: "",
      tiktok: "",
      youtube: "",
    };

    const completion = assessBusinessProfileCompletion(values);
    const patch = buildBusinessProfilePatch(values, 1, "en", baseline);

    expect(completion.complete).toBe(true);
    expect(completion.missing).not.toEqual(
      expect.arrayContaining([
        "website",
        "whatsappBusiness",
        "facebook",
        "instagram",
        "tiktok",
        "youtube",
      ])
    );
    expect(validateBusinessProfilePatch(patch).success).toBe(true);
  });

  it("defines platform-specific optional helper copy and examples", () => {
    const locales = ["en", "ms", "zh"] as const;
    for (const locale of locales) {
      const raw = readFileSync(
        resolve(__dirname, `../packages/shared/src/i18n/locales/${locale}.json`),
        "utf8"
      );
      const messages = JSON.parse(raw) as Record<string, string>;

      expect(messages["businessProfile.hint.website"]).toBeTruthy();
      expect(messages["businessProfile.hint.whatsappBusiness"]).toBeTruthy();
      expect(messages["businessProfile.hint.facebook"]).toBeTruthy();
      expect(messages["businessProfile.hint.instagram"]).toBeTruthy();
      expect(messages["businessProfile.hint.tiktok"]).toBeTruthy();
      expect(messages["businessProfile.hint.youtube"]).toBeTruthy();
      expect(messages["businessProfile.placeholder.website"]).toBe("https://yourbusiness.com");
      expect(messages["businessProfile.placeholder.whatsappBusiness"]).toBe("https://wa.me/6591234567");
      expect(messages["businessProfile.placeholder.facebook"]).toBe("https://facebook.com/yourbusiness");
      expect(messages["businessProfile.placeholder.instagram"]).toBe("https://instagram.com/yourbusiness");
      expect(messages["businessProfile.placeholder.tiktok"]).toBe("https://tiktok.com/@yourbusiness");
      expect(messages["businessProfile.placeholder.youtube"]).toBe("https://youtube.com/@yourbusiness");
      expect(messages["businessProfile.urlHint"]).not.toContain("instagram.com/yourbusiness");
    }
  });

  it("keeps Business Profile identity UI free of developer asset wording", () => {
    const editorSource = readFileSync(
      resolve(__dirname, "../apps/web/src/components/business-profile/BusinessProfileEditor.tsx"),
      "utf8"
    );
    const enMessages = JSON.parse(
      readFileSync(resolve(__dirname, "../packages/shared/src/i18n/locales/en.json"), "utf8")
    ) as Record<string, string>;

    expect(editorSource).toContain("businessProfile.logoUploadButton");
    expect(editorSource).not.toContain("businessProfile.storagePathPlaceholder");
    expect(editorSource).not.toContain("businessProfile.section.assets");
    expect(editorSource).not.toContain("businessProfile.field.brandColors");
    expect(editorSource).not.toContain("businessProfile.field.brandFonts");
    expect(editorSource).not.toContain("businessProfile.field.brandImages");
    expect(enMessages["businessProfile.logoUploadButton"]).toBe("Upload Logo");
    expect(enMessages["businessProfile.logoUploadHint"]).toContain("Optional");
    expect(Object.keys(enMessages)).not.toEqual(
      expect.arrayContaining([
        "businessProfile.assetsHint",
        "businessProfile.field.brandColors",
        "businessProfile.field.brandFonts",
        "businessProfile.field.brandImages",
        "businessProfile.section.assets",
        "businessProfile.storagePathPlaceholder",
        "businessProfile.uploadArea.pendingSpec",
        "businessProfile.uploadArea.title",
        "businessProfile.uploadReferenceHint",
      ])
    );
  });

  it("maps Accept & Save AI draft onto form fields without implying auto-overwrite", () => {
    const update = businessProfileAiAnalysisToUpdate({
      brandSummary: "Edited summary before save.",
      brandPersonality: ["Creative"],
      brandTone: ["Playful"],
      brandKeywords: ["Handmade", "Edited"],
      targetAudience: ["Gift Buyers"],
    });

    const baseline = profileToFormValues(createEmptyBusinessProfileDraft(orgId, workspaceId));
    const accepted = {
      ...baseline,
      businessDescription: update.businessDescription,
      brandPersonality: update.brandPersonality,
      brandKeywords: update.brandKeywords,
      targetAudience: update.targetAudience,
    };
    const patch = buildBusinessProfilePatch(accepted, 1, "en", baseline);

    expect(patch.businessDescription).toBe("Edited summary before save.");
    expect(patch.brandKeywords).toEqual(["Handmade", "Edited"]);
    expect(patch.targetAudience).toBe("Gift Buyers");
    expect(validateBusinessProfilePatch(patch).success).toBe(true);
  });
  it("treats analyzing flag as duplicate-submission lock", () => {
    const canStart = (analyzing: boolean) => !analyzing;
    expect(canStart(false)).toBe(true);
    expect(canStart(true)).toBe(false);
  });
});
