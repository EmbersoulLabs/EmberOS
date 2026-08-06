import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AI_STORY_ALLOWED_TRANSITIONS,
  AiStoryCreateBodySchema,
  AiStoryStructuredDraftSchema,
  AiStoryUpdateDraftBodySchema,
  assertAiStoryTransition,
  buildAiStoryContextWarnings,
  nextAiStoryVersionNumber,
} from "@ceo-agent/shared";

describe("AI Story vertical slice (V1)", () => {
  describe("domain — validation and transitions", () => {
    it("validates structured Story Draft minimum fields", () => {
      const draft = {
        title: "Launch story",
        summary: "A customer discovers the product.",
        objective: "Awareness",
        targetAudience: "Young professionals",
        tone: "Warm and confident",
        estimatedDuration: "30s",
        story: {
          opening: "Morning routine.",
          development: "Problem and discovery.",
          ending: "Happy customer.",
        },
        keyMessages: ["Easy to use"],
        cta: "Shop now",
        assetReferences: [],
        warnings: [],
      };
      expect(AiStoryStructuredDraftSchema.safeParse(draft).success).toBe(true);
    });

    it("rejects malformed structured Story Draft", () => {
      expect(
        AiStoryStructuredDraftSchema.safeParse({
          title: "x",
          summary: "",
        }).success
      ).toBe(false);
    });

    it("validates create and update request bodies", () => {
      expect(
        AiStoryCreateBodySchema.safeParse({
          title: "Spring",
          originalIdea: "Tell our brand story",
        }).success
      ).toBe(true);
      expect(
        AiStoryCreateBodySchema.safeParse({ title: "", originalIdea: "x" }).success
      ).toBe(false);

      const draft = AiStoryStructuredDraftSchema.parse({
        title: "T",
        summary: "S",
        objective: "O",
        targetAudience: "A",
        tone: "T",
        estimatedDuration: "30s",
        story: { opening: "a", development: "b", ending: "c" },
        keyMessages: [],
        cta: "Go",
        assetReferences: [],
        warnings: [],
      });
      expect(
        AiStoryUpdateDraftBodySchema.safeParse({ structuredContent: draft }).success
      ).toBe(true);
    });

    it("enforces explicit status transitions", () => {
      expect(() => assertAiStoryTransition("draft", "generating")).not.toThrow();
      expect(() => assertAiStoryTransition("generating", "review")).not.toThrow();
      expect(() => assertAiStoryTransition("review", "approved")).not.toThrow();
      expect(() => assertAiStoryTransition("approved", "ready_for_animation")).not.toThrow();
      expect(() => assertAiStoryTransition("ready_for_animation", "planning")).not.toThrow();
      expect(() => assertAiStoryTransition("planning", "planning_review")).not.toThrow();
      expect(() => assertAiStoryTransition("planning_review", "ready_for_execution")).not.toThrow();
      expect(() => assertAiStoryTransition("draft", "ready_for_animation")).toThrow(
        /Invalid AI Story transition/
      );
    });

    it("documents allowed transitions for all statuses", () => {
      expect(AI_STORY_ALLOWED_TRANSITIONS.review).toContain("approved");
      expect(AI_STORY_ALLOWED_TRANSITIONS.ready_for_animation).toEqual([
        "planning",
        "archived",
      ]);
      expect(AI_STORY_ALLOWED_TRANSITIONS.planning).toEqual(["planning_review", "failed"]);
      expect(AI_STORY_ALLOWED_TRANSITIONS.planning_review).toEqual([
        "planning",
        "ready_for_execution",
        "archived",
      ]);
      expect(AI_STORY_ALLOWED_TRANSITIONS.archived).toEqual([]);
    });

    it("increments version numbers monotonically", () => {
      expect(nextAiStoryVersionNumber([])).toBe(1);
      expect(nextAiStoryVersionNumber([{ versionNumber: 1 }])).toBe(2);
      expect(
        nextAiStoryVersionNumber([{ versionNumber: 1 }, { versionNumber: 3 }])
      ).toBe(4);
    });

    it("emits warnings for missing optional context without blocking", () => {
      const warnings = buildAiStoryContextWarnings({
        businessProfileComplete: false,
        campaignObjective: null,
        targetAudience: "",
        brandTone: "",
        assetCount: 0,
      });
      expect(warnings.map((w) => w.code)).toEqual([
        "business_profile_incomplete",
        "missing_objective",
        "missing_audience",
        "missing_brand_tone",
        "no_assets",
      ]);
    });
  });

  describe("service — freeze immutability contract", () => {
    it("freezeAiStoryVersion rejects silent mutation of frozen versions", () => {
      const service = readFileSync("apps/web/src/lib/ai-story-service.ts", "utf8");
      expect(service).toContain("if (version.frozenAt)");
      expect(service).toContain("isNull(schema.aiStoryVersions.frozenAt)");
      expect(service).toContain("Story version is already frozen");
    });

    it("PATCH route blocks edits when version is frozen", () => {
      const route = readFileSync(
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route.ts",
        "utf8"
      );
      expect(route).toContain("loaded.currentVersion?.frozenAt");
      expect(route).toContain("Frozen Story versions cannot be edited");
      expect(route).toContain("createAiStoryVersion");
    });
  });

  describe("API — auth, tenancy, and campaign ownership", () => {
    const listRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/route.ts",
      "utf8"
    );
    const storyRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route.ts",
      "utf8"
    );
    const generateRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts",
      "utf8"
    );
    const approveRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/approve/route.ts",
      "utf8"
    );
    const planningGenerateRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/generate/route.ts",
      "utf8"
    );
    const planningApproveRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/approve/route.ts",
      "utf8"
    );
    const planningStageRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/stages/[stage]/route.ts",
      "utf8"
    );
    const rewriteRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/rewrite/route.ts",
      "utf8"
    );
    const screenwriterRoute = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/screenwriter/route.ts",
      "utf8"
    );

    it("requires authentication and workspace role on all routes", () => {
      for (const source of [
        listRoute,
        storyRoute,
        generateRoute,
        approveRoute,
        planningGenerateRoute,
        planningApproveRoute,
        planningStageRoute,
        rewriteRoute,
        screenwriterRoute,
      ]) {
        expect(source).toContain("requireAuth");
        expect(source).toContain("requireWorkspaceRole");
      }
    });

    it("scopes reads and writes to campaign workspace", () => {
      expect(listRoute).toContain("listCampaignAiStories");
      expect(listRoute).toContain("campaign.workspaceId");
      expect(storyRoute).toContain("loadCampaignAiStory");
      expect(storyRoute).toContain("campaign.workspaceId");
      expect(generateRoute).toContain("loadCampaignAiStory");
      expect(approveRoute).toContain("loadCampaignAiStory");
      expect(planningGenerateRoute).toContain("loadCampaignAiStory");
      expect(planningApproveRoute).toContain("loadCampaignAiStory");
      expect(planningStageRoute).toContain("runSinglePlanningStage");
      expect(rewriteRoute).toContain("loadCampaignAiStory");
      expect(screenwriterRoute).toContain("saveCreativeContext");
    });

    it("validates campaign assets belong to the campaign and workspace", () => {
      expect(listRoute).toContain("assertCampaignAssets");
      const service = readFileSync("apps/web/src/lib/ai-story-service.ts", "utf8");
      expect(service).toContain("campaignAssetRefs");
      expect(service).toContain("schema.assets.workspaceId");
    });

    it("approve transitions review to ready_for_animation via freeze", () => {
      expect(approveRoute).toContain("freezeAiStoryVersion");
      expect(approveRoute).toContain('"ready_for_animation"');
    });

    it("generate uses provider-neutral polish service", () => {
      expect(generateRoute).toContain("polishAiStoryDraft");
      expect(generateRoute).not.toMatch(/openai/i);
    });

    it("rewrite uses provider-neutral screenwriter rewrite", () => {
      expect(rewriteRoute).toContain("rewriteAiStoryDraft");
      expect(rewriteRoute).not.toMatch(/openai/i);
    });

    it("screenwriter persists characters dialogue narrative into Creative Context", () => {
      expect(screenwriterRoute).toContain("generateStoryCharacters");
      expect(screenwriterRoute).toContain("generateStoryDialogue");
      expect(screenwriterRoute).toContain("generateStoryNarrative");
      expect(screenwriterRoute).toContain("saveCreativeContext");
      expect(screenwriterRoute).not.toMatch(/openai/i);
    });

    it("planning generate uses provider-neutral planning service", () => {
      expect(planningGenerateRoute).toContain("runFullStoryPlanningPipeline");
      expect(planningGenerateRoute).toContain('"ready_for_animation"');
      expect(planningGenerateRoute).toContain('"planning_review"');
      expect(planningGenerateRoute).not.toMatch(/openai/i);
    });

    it("planning stages route runs ordered stage runner", () => {
      expect(planningStageRoute).toContain("STORY_PLANNING_STAGE_ORDER");
      expect(planningStageRoute).toContain("runSinglePlanningStage");
      expect(planningStageRoute).not.toMatch(/openai/i);
    });
  });

  describe("AI polish service", () => {
    it("validates provider output strictly", async () => {
      vi.doMock("../packages/agents/src/llm", () => ({
        callJsonModel: vi.fn(async () => ({
          result: { title: "Only title" },
          usage: { input: 1, output: 1, costUsd: 0 },
        })),
      }));

      const { polishAiStoryDraft } = await import("../packages/agents/src/ai-story/story-polish-service");
      const result = await polishAiStoryDraft({
        originalIdea: "Tell our story",
        campaign: { name: "Spring" },
        assetLabels: [],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("malformed");
      }
    });

    it("returns structured draft for valid provider output", async () => {
      vi.resetModules();
      vi.doMock("../packages/agents/src/llm", () => ({
        callJsonModel: vi.fn(async () => ({
          result: {
            title: "Launch",
            summary: "Summary",
            objective: "Awareness",
            targetAudience: "Everyone",
            tone: "Warm",
            estimatedDuration: "30s",
            story: { opening: "A", development: "B", ending: "C" },
            keyMessages: ["Easy"],
            cta: "Buy",
            assetReferences: [],
            warnings: [],
          },
          usage: { input: 10, output: 20, costUsd: 0.01 },
        })),
      }));

      const { polishAiStoryDraft } = await import("../packages/agents/src/ai-story/story-polish-service");
      const result = await polishAiStoryDraft({
        originalIdea: "Customer journey",
        campaign: { name: "Spring", objective: "awareness" },
        assetLabels: ["hero.png"],
        businessProfileComplete: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.draft.title).toBe("Launch");
        expect(result.warnings.some((w) => w.code === "missing_brand_tone")).toBe(true);
      }
    });
  });

  describe("UI — Campaign-owned entry and review states", () => {
    const workspace = readFileSync(
      "apps/web/src/components/campaign/CampaignWorkspace.tsx",
      "utf8"
    );
    const createPage = readFileSync(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/new/page.tsx",
      "utf8"
    );
    const reviewPage = readFileSync(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
      "utf8"
    );

    it("keeps Create Marketing generate action and adds Create Story entry", () => {
      expect(workspace).toContain("campaign.workspace.generate");
      expect(workspace).toContain("Create Story");
      expect(workspace).toContain("/ai-stories/new");
      expect(workspace).toContain("/ai-stories/");
    });

    it("create form collects plain-language idea and optional assets", () => {
      expect(createPage).toContain("Story idea");
      expect(createPage).toContain("originalIdea");
      expect(createPage).toContain("assetIds");
      expect(createPage).toContain("/generate");
    });

    it("review page supports edit, approve, and ready_for_animation display", () => {
      expect(reviewPage).toContain("Approve & freeze");
      expect(reviewPage).toContain("ready_for_animation");
      expect(reviewPage).toContain("Ready for Animation");
      expect(reviewPage).toContain("Save edits");
      expect(reviewPage).toContain("Generate All Planning");
      expect(reviewPage).toContain("Generate Creative Context");
      expect(reviewPage).toContain("Generate Director Thinking");
      expect(reviewPage).toContain("Rewrite Story");
      expect(reviewPage).toContain("Animation Package");
      expect(reviewPage).toContain("READY FOR EXECUTION");
    });
  });

  describe("schema — distinct from workspace Asset Story", () => {
    it("uses ai_stories tables, not legacy stories table", () => {
      const sql = readFileSync("packages/db/sql/ai-story-v1.sql", "utf8");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS ai_stories");
      expect(sql).toContain("ai_story_versions");
      expect(sql).not.toContain("CREATE TABLE IF NOT EXISTS stories");
    });

    it("drizzle schema exports campaign-owned AI Story tables", () => {
      const schema = readFileSync("packages/db/src/schema/index.ts", "utf8");
      expect(schema).toContain('export const aiStories = pgTable');
      expect(schema).toContain('"ai_stories"');
      expect(schema).toContain("not workspace Asset Story");
      expect(schema).toContain("aiStoryCreativeContexts");
      expect(schema).toContain("aiStoryAnimationPackages");
    });
  });
});
