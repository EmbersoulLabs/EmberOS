import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BusinessProfileUpdateSchema,
  normalizeBusinessProfileRecord,
  normalizeStoredPublishingPlatforms,
  PUBLISHING_PLATFORM_IDS,
} from "@ceo-agent/shared";
import {
  buildBusinessProfilePatch,
  canApplyBusinessProfileSaveResponse,
  createEmptyBusinessProfileDraft,
  profileToFormValues,
  resolveBusinessProfileSaveView,
} from "../apps/web/src/lib/business-profile-form";

const orgId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const workspaceId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("Wave 2 Business Profile contract", () => {
  it("normalizes aliases, deduplicates, and orders canonical platform IDs", () => {
    expect(
      normalizeStoredPublishingPlatforms([
        "google_business",
        "instagram",
        "TikTok",
        "instagram",
        "xhs",
      ])
    ).toEqual({
      recognized: ["tiktok", "instagram", "xiaohongshu", "googleBusiness"],
      unrecognized: [],
    });
  });

  it("rejects unknown platform values on writes", () => {
    expect(
      BusinessProfileUpdateSchema.safeParse({
        defaultPublishingPlatforms: ["tiktok", "unknown-network"],
      }).success
    ).toBe(false);
  });

  it("preserves unknown legacy evidence with a warning surface", () => {
    const draft = createEmptyBusinessProfileDraft(orgId, workspaceId);
    const normalized = normalizeBusinessProfileRecord({
      ...draft,
      defaultPublishingPlatforms: ["instagram", "legacy-network"],
    });
    expect(normalized.defaultPublishingPlatforms).toEqual(["instagram"]);
    expect(normalized.unrecognizedPublishingPlatforms).toEqual(["legacy-network"]);
  });

  it("round-trips platform changes and supports an intentional empty list", () => {
    const baseline = profileToFormValues(createEmptyBusinessProfileDraft(orgId, workspaceId));
    const selected = { ...baseline, defaultPublishingPlatforms: ["tiktok", "linkedin"] as const };
    expect(buildBusinessProfilePatch(selected, 1, "en", baseline)).toEqual({
      version: 1,
      defaultPublishingPlatforms: ["tiktok", "linkedin"],
    });
    const cleared = {
      ...baseline,
      defaultPublishingPlatforms: ["tiktok"] as (typeof PUBLISHING_PLATFORM_IDS)[number][],
    };
    expect(
      buildBusinessProfilePatch(
        { ...cleared, defaultPublishingPlatforms: [] },
        2,
        "en",
        cleared
      )
    ).toEqual({ version: 2, defaultPublishingPlatforms: [] });
  });

  it("models clean, dirty, saving, and failed-save truthfully", () => {
    expect(resolveBusinessProfileSaveView("idle", false)).toBe("clean");
    expect(resolveBusinessProfileSaveView("idle", true)).toBe("dirty");
    expect(resolveBusinessProfileSaveView("saving", true)).toBe("saving");
    expect(resolveBusinessProfileSaveView("failed", true)).toBe("error");
    expect(resolveBusinessProfileSaveView("failed", false)).toBe("error");
  });

  it("does not allow an older response to replace newer save state", () => {
    expect(canApplyBusinessProfileSaveResponse(4, 5)).toBe(false);
    expect(canApplyBusinessProfileSaveResponse(5, 5)).toBe(true);
    expect(canApplyBusinessProfileSaveResponse(6, 5)).toBe(true);
  });

  it("keeps the Blueprint vertical-card order and mobile sticky truthful status", () => {
    const source = readFileSync(
      resolve(__dirname, "../apps/web/src/components/business-profile/BusinessProfileEditor.tsx"),
      "utf8"
    );
    const order = [
      "businessProfile.section.business",
      "businessProfile.section.contact",
      "businessProfile.section.brand",
      "businessProfile.section.languages",
      "businessProfile.section.publishingPlatforms",
      "businessProfile.section.businessHours",
    ].map((value) => source.indexOf(value));
    expect(order.every((value) => value >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(source).toContain('data-testid="business-profile-mobile-save-status"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("editRevisionRef.current === editRevisionAtStart");
  });

  it("retains current main AI analysis instead of importing Staging authority", () => {
    const source = readFileSync(
      resolve(__dirname, "../apps/web/src/components/business-profile/BusinessProfileEditor.tsx"),
      "utf8"
    );
    expect(source).toContain("BusinessProfileAiPanel");
    expect(source).toContain("runAiAnalyze");
    expect(source).toContain("businessProfileAiAnalysisToUpdate");
  });
});
