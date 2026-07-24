import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrandProfileSchema,
  CEO_MAX_RETRIES,
  effectiveCampaignGoal,
  normalizeStrategyPlan,
  parseCampaignCreativeBrief,
  type CampaignAIContext,
  type MarketingContentPackage,
  type StepProgress,
  type StrategyPlan,
  type VisionAnalysis,
} from "@ceo-agent/shared";
import {
  enrichCampaignAIContext,
  provideCampaignAIContext,
  provideCampaignAIContextFromCampaign,
} from "../packages/agents/src/campaign-context-provider";
import { markRunningStepsFailed } from "../packages/agents/src/pipeline-lifecycle";
import {
  contentPackageToCopyVariants,
  contentPackageToHookSet,
} from "../packages/agents/src/marketing-content";

const AGENCY_STAGE_ORDER = [
  "parse_intent",
  "vision_analyze",
  "strategy_plan",
  "ceo_plan",
  "content_classify",
  "content_generate",
  "hook_generate",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "compliance_check",
  "marketing_score",
  "human_review",
] as const;

const AUTO_CLIP_STAGE_ORDER = [
  "parse_intent",
  "vision_analyze",
  "strategy_plan",
  "highlight_index",
  "content_generate",
  "hook_generate",
  "clip_segment",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "marketing_score",
  "export_ready",
] as const;

const usage = { input: 1, output: 1, costUsd: 0 };

function mockVision(assetId = "asset-img-1"): VisionAnalysis {
  return {
    assetId,
    mediaType: "image",
    subjects: ["bouquet"],
    scenes: [{ startSec: 0, endSec: 1, description: "Floral arrangement" }],
    products: ["roses"],
    hooks: ["Fresh blooms daily"],
    suggestedMoments: [],
    transcriptSummary: "shop floor ambience",
  };
}

function mockStrategy(): StrategyPlan {
  return normalizeStrategyPlan(null, {
    industry: "florist",
    businessType: "local_shop",
    product: "Rose bouquet",
    marketingGoal: "Brand Awareness",
    marketingAngle: "Same-day delivery",
    tone: "Warm",
    videoStyle: "Product Showcase",
    audience: { interests: ["flowers"], painPoints: ["last-minute gifts"] },
    customerJourney: "Awareness",
    platformPriority: ["tiktok"],
    ctaStrategy: "Order today",
    keywords: ["roses", "gift"],
    hashtags: {
      industry: ["#florist"],
      local: ["#kl"],
      trending: ["#fyp"],
      seo: ["rose bouquet"],
    },
  });
}

function mockMarketingPack(): MarketingContentPackage {
  return {
    hooks: [
      { type: "curiosity", text: "Why this bouquet sells out" },
      { type: "offer", text: "Same-day roses" },
    ],
    cta: [{ text: "Order now", type: "shop" }],
    voiceScripts: {
      "15s": "Fresh roses, same-day delivery.",
      "30s": "Need a gift today? Our rose bouquet ships same-day across the city.",
      "60s": "Walk into our shop and leave with a hand-tied rose bouquet in minutes.",
    },
    captions: {
      tiktok: "Same-day rose bouquet 🌹 #florist",
      instagram: "Hand-tied roses, delivered today.",
      xiaohongshu: "今日玫瑰花束同日送達",
    },
    subtitleTimeline: [{ startSec: 0, endSec: 3, text: "Fresh roses" }],
  } as MarketingContentPackage;
}

type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

interface PipelineSimState {
  taskStatus: "pending" | "running" | "completed" | "failed";
  campaignStatus: string;
  stepProgress: StepProgress;
  executed: string[];
  hooksJson: unknown;
  strategyJson: unknown;
  marketingScoreJson: unknown;
  contentPackage: MarketingContentPackage | null;
  copyVariants: unknown;
  errorMessage: string | null;
  campaignContext: CampaignAIContext | null;
  lastDownstreamInput: Record<string, unknown>;
}

function createSim(initial?: Partial<PipelineSimState>): PipelineSimState {
  return {
    taskStatus: "pending",
    campaignStatus: "draft",
    stepProgress: {},
    executed: [],
    hooksJson: null,
    strategyJson: null,
    marketingScoreJson: null,
    contentPackage: null,
    copyVariants: null,
    errorMessage: null,
    campaignContext: null,
    lastDownstreamInput: {},
    ...initial,
  };
}

function setStep(state: PipelineSimState, stepId: string, status: StageStatus, output?: unknown) {
  const prev = state.stepProgress[stepId] ?? { status: "pending" as const };
  state.stepProgress[stepId] = {
    ...prev,
    status,
    ...(status === "running" ? { startedAt: new Date().toISOString() } : {}),
    ...(status === "completed" || status === "failed" || status === "skipped"
      ? { completedAt: new Date().toISOString() }
      : {}),
    ...(output !== undefined ? { output } : {}),
    ...(status === "failed" && state.errorMessage ? { error: state.errorMessage } : {}),
  };
}

/** Behavioural stand-in for agency pipeline stage handoffs (no LLM). */
function runAgencyPipelineSim(
  state: PipelineSimState,
  opts: { failAt?: string; skipDownstreamOnFail?: boolean } = {}
): PipelineSimState {
  const brand = BrandProfileSchema.parse({ industry: "florist" });
  const campaign = {
    goal: "brand_awareness",
    platforms: ["tiktok"],
    targetAudienceOverride: "Gift buyers 25-40",
    campaignBrief: "Promote same-day rose delivery",
    metadata: { contentLocale: "en" },
  };
  const brief = parseCampaignCreativeBrief(campaign);
  const goal = effectiveCampaignGoal(brief, campaign.goal, "en");

  state.taskStatus = "running";
  state.campaignStatus = "processing";
  state.campaignContext = provideCampaignAIContext({
    businessProfile: brand,
    campaignObjective: goal,
    publishingPlatforms: campaign.platforms,
    targetAudience: campaign.targetAudienceOverride,
    campaignBrief: brief.campaignBrief,
    workspaceLanguage: "en",
    assets: [{ id: "asset-img-1", type: "image" }],
  });

  const stages: Array<{ id: (typeof AGENCY_STAGE_ORDER)[number]; run: () => void }> = [
    {
      id: "parse_intent",
      run: () => {
        setStep(state, "parse_intent", "completed", { goal });
      },
    },
    {
      id: "vision_analyze",
      run: () => {
        const vision = mockVision();
        state.campaignContext = enrichCampaignAIContext(state.campaignContext!, {
          vision,
          transcript: vision.transcriptSummary ?? null,
        });
        setStep(state, "vision_analyze", "completed", vision);
        state.lastDownstreamInput.vision = vision;
      },
    },
    {
      id: "strategy_plan",
      run: () => {
        const vision = state.stepProgress.vision_analyze?.output as VisionAnalysis;
        expect(vision).toBeTruthy();
        const strategy = mockStrategy();
        state.campaignContext = enrichCampaignAIContext(state.campaignContext!, {
          vision,
          strategy,
        });
        state.strategyJson = strategy;
        setStep(state, "strategy_plan", "completed", strategy);
        state.lastDownstreamInput.strategy = strategy;
        state.lastDownstreamInput.strategySawVision = Boolean(vision?.subjects?.length);
      },
    },
    {
      id: "ceo_plan",
      run: () => {
        expect(state.campaignContext?.strategy).toBeTruthy();
        expect(state.campaignContext?.vision).toBeTruthy();
        setStep(state, "ceo_plan", "completed", { steps: ["content", "edit"] });
      },
    },
    {
      id: "content_classify",
      run: () => {
        expect(state.campaignContext?.vision).toBeTruthy();
        setStep(state, "content_classify", "completed", {
          contentType: "product_showcase",
          presetId: "retail_product",
        });
      },
    },
    {
      id: "content_generate",
      run: () => {
        expect(state.campaignContext?.strategy).toBeTruthy();
        const pack = mockMarketingPack();
        state.contentPackage = pack;
        setStep(state, "content_generate", "completed", pack);
      },
    },
    {
      id: "hook_generate",
      run: () => {
        const pack = state.contentPackage!;
        const hookSet = contentPackageToHookSet(pack);
        state.hooksJson = hookSet;
        setStep(state, "hook_generate", "completed", hookSet);
        state.lastDownstreamInput.hookSet = hookSet;
      },
    },
    {
      id: "copy_generate",
      run: () => {
        const pack = state.contentPackage!;
        const strategy = state.strategyJson as StrategyPlan;
        const variants = contentPackageToCopyVariants(pack, strategy, ["tiktok"]);
        state.copyVariants = variants;
        setStep(state, "copy_generate", "completed", variants);
        state.lastDownstreamInput.copyVariants = variants;
      },
    },
    {
      id: "edit_director_plan",
      run: () => {
        expect(state.copyVariants).toBeTruthy();
        expect(state.campaignContext?.vision).toBeTruthy();
        setStep(state, "edit_director_plan", "completed", { clips: [{ startSec: 0, endSec: 8 }] });
      },
    },
    {
      id: "ffmpeg_render",
      run: () => {
        setStep(state, "ffmpeg_render", "completed", { renderStatus: "preview_ready" });
      },
    },
    {
      id: "compliance_check",
      run: () => {
        const ctx = provideCampaignAIContextFromCampaign({
          brandProfile: brand,
          campaign,
          vision: state.stepProgress.vision_analyze?.output as VisionAnalysis,
          strategy: state.strategyJson as StrategyPlan,
          assets: [{ id: "asset-img-1", type: "image" }],
          transcript: "shop floor ambience",
        });
        state.lastDownstreamInput.complianceContext = ctx;
        expect(ctx.campaignObjective).toBe(goal);
        expect(ctx.vision).toBeTruthy();
        expect(ctx.strategy).toBeTruthy();
        setStep(state, "compliance_check", "completed", { passed: true, score: 1, flags: [], checkedAt: new Date().toISOString() });
      },
    },
    {
      id: "marketing_score",
      run: () => {
        expect(state.hooksJson).toBeTruthy();
        expect(state.strategyJson).toBeTruthy();
        expect(state.copyVariants).toBeTruthy();
        const score = { overallScore: 82, hookScore: 80, visualScore: 84, copyScore: 81, ctaScore: 79, platformFitScore: 83, improvements: [] };
        state.marketingScoreJson = score;
        setStep(state, "marketing_score", "completed", score);
      },
    },
    {
      id: "human_review",
      run: () => {
        setStep(state, "human_review", "pending");
        state.taskStatus = "completed";
        state.campaignStatus = "pending_internal_review";
      },
    },
  ];

  for (const stage of stages) {
    if (state.executed.includes(stage.id)) {
      throw new Error(`Duplicate stage execution: ${stage.id}`);
    }
    setStep(state, stage.id, "running");
    if (opts.failAt === stage.id) {
      state.errorMessage = `Simulated failure at ${stage.id}`;
      state.stepProgress = markRunningStepsFailed(state.stepProgress, state.errorMessage);
      state.taskStatus = "failed";
      state.campaignStatus = "failed";
      if (opts.skipDownstreamOnFail !== false) break;
      continue;
    }
    stage.run();
    state.executed.push(stage.id);
  }

  return state;
}

function runAutoClipToScoreSim(state: PipelineSimState): PipelineSimState {
  const brand = BrandProfileSchema.parse({});
  const campaign = {
    goal: "more_views",
    platforms: ["tiktok", "instagram"],
    campaignBrief: "Clip the best moments",
    metadata: {},
  };
  const brief = parseCampaignCreativeBrief(campaign);
  const goal = effectiveCampaignGoal(brief, campaign.goal, "en");
  state.taskStatus = "running";
  state.campaignContext = provideCampaignAIContext({
    businessProfile: brand,
    campaignObjective: goal,
    publishingPlatforms: campaign.platforms,
    campaignBrief: brief.campaignBrief,
    workspaceLanguage: "en",
    assets: [{ id: "vid-1", type: "video" }],
  });

  for (const stepId of AUTO_CLIP_STAGE_ORDER) {
    if (state.executed.includes(stepId)) throw new Error(`Duplicate: ${stepId}`);
    setStep(state, stepId, "running");
    if (stepId === "vision_analyze") {
      const vision = { ...mockVision("vid-1"), mediaType: "video" as const, durationSec: 90 };
      state.campaignContext = enrichCampaignAIContext(state.campaignContext!, { vision });
      setStep(state, stepId, "completed", vision);
    } else if (stepId === "marketing_score") {
      const ctx = provideCampaignAIContextFromCampaign({
        brandProfile: brand,
        campaign,
        vision: state.stepProgress.vision_analyze?.output as VisionAnalysis,
        assets: [{ id: "vid-1", type: "video" }],
      });
      expect(ctx.campaignObjective).toBe(goal);
      expect(ctx.vision).toBeTruthy();
      const score = { overallScore: 77, improvements: [] };
      state.marketingScoreJson = score;
      setStep(state, stepId, "completed", score);
      state.taskStatus = "completed";
    } else {
      setStep(state, stepId, "completed", { ok: true });
    }
    state.executed.push(stepId);
  }
  return state;
}

describe("Campaign E2E pipeline — lifecycle", () => {
  it("marks running steps failed and leaves completed steps intact", () => {
    const progress: StepProgress = {
      parse_intent: { status: "completed", completedAt: "t0" },
      vision_analyze: { status: "running", startedAt: "t1" },
      strategy_plan: { status: "pending" },
    };
    const next = markRunningStepsFailed(progress, "Vision crashed");
    expect(next.parse_intent?.status).toBe("completed");
    expect(next.vision_analyze?.status).toBe("failed");
    expect(next.vision_analyze?.error).toBe("Vision crashed");
    expect(next.strategy_plan?.status).toBe("pending");
  });

  it("never leaves a stage running after pipeline failure", () => {
    const state = runAgencyPipelineSim(createSim(), { failAt: "content_classify" });
    expect(state.taskStatus).toBe("failed");
    expect(state.campaignStatus).toBe("failed");
    const running = Object.values(state.stepProgress).filter((s) => s?.status === "running");
    expect(running).toHaveLength(0);
    expect(state.stepProgress.content_classify?.status).toBe("failed");
    expect(state.executed).not.toContain("content_generate");
    expect(state.executed).not.toContain("human_review");
  });
});

describe("Campaign E2E pipeline — successful agency path", () => {
  it("runs Create→Upload→Vision→Strategy→CEO→Content Type→Marketing→Edit→Compliance→Score→Review", () => {
    const state = runAgencyPipelineSim(createSim());
    expect(state.taskStatus).toBe("completed");
    expect(state.campaignStatus).toBe("pending_internal_review");
    expect(state.executed).toEqual([...AGENCY_STAGE_ORDER]);
    for (const step of AGENCY_STAGE_ORDER) {
      if (step === "human_review") {
        expect(state.stepProgress[step]?.status).toBe("pending");
      } else {
        expect(state.stepProgress[step]?.status).toBe("completed");
      }
    }
  });

  it("passes upstream vision and strategy into downstream CampaignAIContext", () => {
    const state = runAgencyPipelineSim(createSim());
    expect(state.lastDownstreamInput.strategySawVision).toBe(true);
    expect(state.campaignContext?.vision?.subjects).toContain("bouquet");
    expect(state.campaignContext?.strategy?.product).toBe("Rose bouquet");
    const complianceCtx = state.lastDownstreamInput.complianceContext as CampaignAIContext;
    expect(complianceCtx.vision?.assetId).toBe("asset-img-1");
    expect(complianceCtx.strategy?.ctaStrategy).toBe("Order today");
    expect(complianceCtx.transcript).toBe("shop floor ambience");
  });

  it("persists outputs required by Review (pack, hooks, copy, score)", () => {
    const state = runAgencyPipelineSim(createSim());
    const pack = state.stepProgress.content_generate?.output as MarketingContentPackage;
    expect(pack.captions.tiktok).toMatch(/rose/i);
    expect(state.hooksJson).toMatchObject({ recommendedHookId: expect.any(String) });
    expect(Array.isArray(state.copyVariants)).toBe(true);
    expect((state.copyVariants as unknown[]).length).toBeGreaterThan(0);
    expect(state.marketingScoreJson).toMatchObject({ overallScore: 82 });
    expect(state.stepProgress.human_review?.status).toBe("pending");
  });

  it("rejects duplicate stage execution", () => {
    const state = createSim();
    state.executed = ["vision_analyze"];
    expect(() => runAgencyPipelineSim(state)).toThrow(/Duplicate stage execution/);
  });
});

describe("Campaign E2E pipeline — Auto Clip reaches final score", () => {
  it("completes auto-clip stages through marketing_score with rebuilt context", () => {
    const state = runAutoClipToScoreSim(createSim());
    expect(state.taskStatus).toBe("completed");
    expect(state.executed.at(-1)).toBe("export_ready");
    expect(state.stepProgress.marketing_score?.status).toBe("completed");
    expect(state.marketingScoreJson).toMatchObject({ overallScore: 77 });
    expect(state.campaignContext?.campaignObjective).toBeTruthy();
  });
});

describe("Campaign E2E pipeline — regeneration contexts", () => {
  it("provideCampaignAIContextFromCampaign uses effectiveCampaignGoal (not raw goal only)", () => {
    const campaign = {
      goal: "品牌曝光",
      campaignGoal: "more_engagement" as const,
      platforms: ["xiaohongshu"],
      campaignBrief: "春日花束",
      metadata: { contentLocale: "zh" },
      targetAudienceOverride: "25-35女性",
    };
    const brief = parseCampaignCreativeBrief(campaign);
    const expected = effectiveCampaignGoal(brief, campaign.goal, "zh");
    const ctx = provideCampaignAIContextFromCampaign({
      brandProfile: BrandProfileSchema.parse({}),
      campaign,
      vision: mockVision(),
      strategy: mockStrategy(),
    });
    expect(ctx.campaignObjective).toBe(expected);
    expect(ctx.campaignBrief).toBe("春日花束");
    expect(ctx.targetAudience).toBe("25-35女性");
    expect(ctx.vision?.subjects).toContain("bouquet");
    expect(ctx.strategy?.product).toBe("Rose bouquet");
  });

  it("copy regeneration context carries strategy + vision from upstream", () => {
    const vision = mockVision();
    const strategy = mockStrategy();
    const base = provideCampaignAIContext({
      businessProfile: BrandProfileSchema.parse({}),
      campaignObjective: "more_views",
      publishingPlatforms: ["tiktok"],
      campaignBrief: "Regen copy",
      workspaceLanguage: "en",
    });
    const forCopy = enrichCampaignAIContext(base, { vision, strategy });
    expect(forCopy.vision?.hooks?.[0]).toBe("Fresh blooms daily");
    expect(forCopy.strategy?.marketingAngle).toBe("Same-day delivery");
  });
});

describe("Campaign E2E pipeline — compliance failure handling", () => {
  it("retries copy while under CEO_MAX_RETRIES, then fails cleanly", () => {
    const decisions: string[] = [];
    for (let retryCount = 0; retryCount <= CEO_MAX_RETRIES; retryCount++) {
      if (retryCount < CEO_MAX_RETRIES) {
        decisions.push("retry_copy");
      } else {
        const progress: StepProgress = {
          compliance_check: { status: "running", startedAt: "t" },
        };
        const failed = markRunningStepsFailed(progress, "Compliance check failed (score=0)");
        expect(failed.compliance_check?.status).toBe("failed");
        decisions.push("fail_pipeline");
      }
    }
    expect(decisions).toEqual(["retry_copy", "retry_copy", "fail_pipeline"]);
    expect(CEO_MAX_RETRIES).toBe(2);
  });
});

describe("failPipelineExecution persists failed running step", () => {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];

  beforeEach(() => {
    updates.length = 0;
    vi.resetModules();
  });

  it("updates task stepProgress + status and campaign status together", async () => {
    const taskRow = {
      id: "task-1",
      campaignId: "camp-1",
      currentStep: "strategy_plan",
      stepProgress: {
        vision_analyze: { status: "completed" },
        strategy_plan: { status: "running", startedAt: "t" },
      } satisfies StepProgress,
    };

    vi.doMock("@ceo-agent/db", () => {
      const schema = {
        tasks: { id: "tasks.id" },
        campaigns: { id: "campaigns.id" },
      };
      return {
        schema,
        getDb: () => ({
          select: () => ({
            from: () => ({
              where: () => ({
                limit: async () => [taskRow],
              }),
            }),
          }),
          update: (table: { id: string }) => ({
            set: (values: Record<string, unknown>) => ({
              where: async () => {
                updates.push({ table: table.id, values });
                if (table.id === "tasks.id") Object.assign(taskRow, values);
                return [];
              },
            }),
          }),
        }),
      };
    });

    const { failPipelineExecution } = await import("../packages/agents/src/pipeline-lifecycle");
    await failPipelineExecution({
      taskId: "task-1",
      campaignId: "camp-1",
      message: "Strategy agent timeout",
    });

    expect(updates.some((u) => u.table === "tasks.id" && u.values.status === "failed")).toBe(true);
    expect(updates.some((u) => u.table === "campaigns.id" && u.values.status === "failed")).toBe(true);
    const taskUpdate = updates.find((u) => u.table === "tasks.id");
    const progress = taskUpdate?.values.stepProgress as StepProgress;
    expect(progress.strategy_plan?.status).toBe("failed");
    expect(progress.strategy_plan?.error).toBe("Strategy agent timeout");
    expect(progress.vision_analyze?.status).toBe("completed");
  });
});

describe("usage smoke for mocked agent usage shape", () => {
  it("keeps agent usage shape for pipeline cost accounting", () => {
    expect(usage.costUsd).toBe(0);
  });
});
