import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const CAMPAIGN = "31000000-0000-4000-8000-000000000001";
const STORY = "31000000-0000-4000-8000-000000000002";
const PLAN = "31000000-0000-4000-8000-000000000003";
const ORG = "31000000-0000-4000-8000-000000000004";
const WORKSPACE = "31000000-0000-4000-8000-000000000005";
const USER = "31000000-0000-4000-8000-000000000006";

const { requireAuth, authorizeAccess, resolvePlan, getDb } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  authorizeAccess: vi.fn(),
  resolvePlan: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@ceo-agent/agents", () => ({
  runFullStoryPlanningPipeline: vi.fn(),
  authorizeAndExecuteExecutionPlan: vi.fn(),
  authorizeAiStoryExecution: vi.fn(),
  CanonicalExecuteError: class CanonicalExecuteError extends Error {},
  AiStoryExecutionDeniedError: class AiStoryExecutionDeniedError extends Error {},
}));

function accessDenied() {
  return Object.assign(new Error("AI Story access denied"), {
    code: "AI_STORY_ACCESS_DENIED",
  });
}

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/auth")>(
    "../apps/web/src/lib/auth"
  );
  return { ...actual, requireAuth: () => requireAuth() };
});

vi.mock("@/lib/ai-story-access", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/ai-story-access")>(
    "../apps/web/src/lib/ai-story-access"
  );
  return {
    ...actual,
    authorizeAiStoryAccess: (...args: unknown[]) => authorizeAccess(...args),
  };
});

vi.mock("@/lib/ai-story-execution-plan-access", async () => {
  const actual = await vi.importActual<
    typeof import("../apps/web/src/lib/ai-story-execution-plan-access")
  >("../apps/web/src/lib/ai-story-execution-plan-access");
  return {
    ...actual,
    resolveAuthorizedExecutionPlan: (...args: unknown[]) => resolvePlan(...args),
  };
});

vi.mock("@ceo-agent/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/db")>();
  return { ...actual, getDb: () => getDb() };
});

function campaignDb() {
  const limit = vi.fn().mockResolvedValue([
    { id: CAMPAIGN, orgId: ORG, workspaceId: WORKSPACE },
  ]);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    })),
  };
}

async function expectDenied(response: Response) {
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: "AI Story access denied",
    code: "AI_STORY_ACCESS_DENIED",
  });
}

describe("RC-FIX-001 AI Story HTTP authorization boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: USER, email: "user@example.test" });
    authorizeAccess.mockRejectedValue(accessDenied());
    resolvePlan.mockRejectedValue(accessDenied());
    getDb.mockReturnValue(campaignDb());
  });

  it("returns 403 for list and create", async () => {
    const route = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/route");
    await expectDenied(
      await route.GET(new Request("http://localhost"), {
        params: Promise.resolve({ id: CAMPAIGN }),
      })
    );
    await expectDenied(
      await route.POST(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Denied", originalIdea: "Denied" }),
        }),
        { params: Promise.resolve({ id: CAMPAIGN }) }
      )
    );
  });

  it("returns 403 for story read", async () => {
    const route = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route"
    );
    await expectDenied(
      await route.GET(new Request("http://localhost"), {
        params: Promise.resolve({ id: CAMPAIGN, storyId: STORY }),
      })
    );
  });

  it("returns 403 for planning read and generation", async () => {
    const readRoute = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/route"
    );
    await expectDenied(
      await readRoute.GET(new Request("http://localhost"), {
        params: Promise.resolve({ id: CAMPAIGN, storyId: STORY }),
      })
    );
    const generateRoute = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/generate/route"
    );
    await expectDenied(
      await generateRoute.POST(new Request("http://localhost", { method: "POST" }), {
        params: Promise.resolve({ id: CAMPAIGN, storyId: STORY }),
      })
    );
  });

  it("returns 403 before canonical execution", async () => {
    const route = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route"
    );
    await expectDenied(
      await route.POST(
        new Request("http://localhost", { method: "POST", body: "{}" }),
        { params: Promise.resolve({ id: CAMPAIGN, storyId: STORY, executionPlanId: PLAN }) }
      )
    );
  });

  it("returns 403 before Final Story Result read", async () => {
    const route = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/final-story-result/route"
    );
    await expectDenied(
      await route.GET(new Request("http://localhost"), {
        params: Promise.resolve({ id: CAMPAIGN, storyId: STORY, executionPlanId: PLAN }),
      })
    );
  });
});
