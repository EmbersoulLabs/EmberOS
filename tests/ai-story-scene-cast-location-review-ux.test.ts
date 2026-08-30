import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AiStorySceneReviewPresentationSchema, GeneratedSceneReviewReadModelSchema } from "@ceo-agent/shared";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const id = (tail: string) => `00000000-0000-4000-8000-${tail.padStart(12, "0")}`;

const presentation = AiStorySceneReviewPresentationSchema.parse({
  title: "Scene 1",
  summary: "Ari hands the sample to River",
  purpose: "Reveal",
  importance: "Major",
  transitional: false,
  cast: [
    { castId: id("1"), kind: "Character", displayName: "Ari", description: "Campaign founder", referenceAssetIds: [id("11")], recurringInStory: true },
    { castId: id("2"), kind: "Supporting Character", displayName: "River", description: "Story-local witness", referenceAssetIds: [], recurringInStory: true },
    { castId: id("3"), kind: "Scene actor", displayName: "Visitor", description: "Unknown role", referenceAssetIds: [], recurringInStory: false },
  ],
  location: { locationId: id("4"), kind: "Story location", displayName: "Unknown atrium", description: "Open bright space", referenceAssetIds: [], promotionAction: "REUSE_IN_CAMPAIGN" },
  products: [{ productAuthorityId: id("5"), displayName: "Sample object", referenceAssetId: id("12") }],
  actionSummary: ["Ari hands the sample to River"],
  startsWith: ["Possession: Ari holds the sample"],
  endsWith: ["Possession: River holds the sample"],
  continuityNotes: ["River returns in Scene 3"],
  legacyCompatibility: false,
});

describe("AI Story Scene, Cast, Location, and generated Review product UX", () => {
  it("accepts generalized user-facing Scene projections without technical scope enums", () => {
    expect(presentation.cast.map((member) => member.kind)).toEqual(["Character", "Supporting Character", "Scene actor"]);
    expect(presentation.location?.displayName).toBe("Unknown atrium");
    expect(presentation.products[0]?.displayName).toBe("Sample object");
    expect(JSON.stringify(presentation)).not.toContain("STORY_SUPPORTING_CHARACTER");
  });

  it("keeps optional presentation and QC evidence backward compatible", () => {
    const legacy = GeneratedSceneReviewReadModelSchema.parse({
      sceneExecutionId: id("20"), sceneId: "legacy-scene", sceneOrder: 0, reviewState: "PENDING_REVIEW",
      runtimeState: "QUEUED", reviewAvailable: false, recoveryMode: null, approvedAttemptId: null,
      approvedSceneResultId: null, latestAttemptId: null, latestReviewId: null, retryEligibility: null,
      retryInputRevisionId: null, retryAuthorizationId: null, latestAttemptNumber: null,
      latestAttemptStatus: null, attemptCount: 0, retryRemaining: 3, maxAttempts: 3,
      latestAttemptKnownCost: null, sceneKnownCost: null, currency: "USD", running: false,
      attempts: [], generatedMedia: null,
    });
    expect(legacy.presentation).toBeUndefined();
    expect(legacy.postGenerationQcEvidence).toBeUndefined();
  });

  it("implements progressive Scene review, explicit decisions, and accessible mobile-safe controls", () => {
    const component = read("apps/web/src/components/ai-story/SceneReviewWorkspacePanel.tsx");
    for (const label of ["Who", "Where", "Product or important object", "What happens", "Generated result", "Quality review", "Approve Scene", "Needs changes", "Next Scene"])
      expect(component).toContain(label);
    expect(component).toContain("sm:grid-cols-2");
    expect(component).toContain("lg:grid-cols");
    expect(component).toContain("aria-label={`Generated video for Scene");
    expect(component).toContain("role=\"status\"");
    expect(component).toContain("Nothing retries automatically");
    expect(component).toContain("No approval has been assumed");
  });

  it("translates QC and repair outcomes while hiding normal-user runtime machinery", () => {
    const component = read("apps/web/src/components/ai-story/SceneReviewWorkspacePanel.tsx");
    for (const label of ["Quality check complete", "Check recommended", "Needs changes", "Please verify", "Try generating this Scene again", "Review the Character and reference photo"])
      expect(component).toContain(label);
    for (const exposed of ["requestFingerprint", "semanticPlanFingerprint", "providerTaskId", "referenceBudget", "Shot Recipe ID"])
      expect(component).not.toContain(exposed);
  });

  it("uses canonical services for photo and explicit location promotion", () => {
    const character = read("apps/web/src/components/ai-story/CharacterPanel.tsx");
    const preview = read("apps/web/src/app/api/campaigns/[id]/assets/[assetId]/preview/route.ts");
    const promotion = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/scenes/[sceneId]/location/promotion/route.ts");
    expect(character).toContain("Add reference photo");
    expect(character).toContain("Remove photo");
    expect(preview).toContain("signPrivateCampaignAsset");
    expect(promotion).toContain("AiStoryLocationAuthorityService");
    expect(promotion).toContain("promoteEphemeralToStory");
    expect(promotion).toContain("promoteStoryToCampaign");
    expect(promotion).not.toContain("insert(");
  });

  it("preserves operator diagnostics and keeps the product workspace canonical", () => {
    const runtime = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");
    const page = read("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx");
    expect(runtime).toContain("<SceneReviewWorkspacePanel");
    expect(page).toContain('data-testid="advanced-planning-diagnostics"');
    expect(page).toContain('data-testid="advanced-execution-diagnostics"');
  });
});
