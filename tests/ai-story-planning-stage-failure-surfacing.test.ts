import { beforeEach, describe, expect, it, vi } from "vitest";
import { describePlanningStageFailure } from "@ceo-agent/shared";

const CAMPAIGN = "41000000-0000-4000-8000-000000000001";
const STORY = "41000000-0000-4000-8000-000000000002";
const WORKSPACE = "41000000-0000-4000-8000-000000000003";
const ORG = "41000000-0000-4000-8000-000000000004";
const USER = "41000000-0000-4000-8000-000000000005";
const STORY_VERSION = "41000000-0000-4000-8000-000000000006";

const { requireAuth, authorizeAccess, getDb, loadCampaignAiStory, getJob } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  authorizeAccess: vi.fn(),
  getDb: vi.fn(),
  loadCampaignAiStory: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/auth")>("../apps/web/src/lib/auth");
  return { ...actual, requireAuth: () => requireAuth() };
});

vi.mock("@/lib/ai-story-access", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/ai-story-access")>(
    "../apps/web/src/lib/ai-story-access"
  );
  return { ...actual, authorizeAiStoryAccess: (...args: unknown[]) => authorizeAccess(...args) };
});

vi.mock("@/lib/ai-story-service", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/ai-story-service")>(
    "../apps/web/src/lib/ai-story-service"
  );
  return { ...actual, loadCampaignAiStory: (...args: unknown[]) => loadCampaignAiStory(...args) };
});

vi.mock("@/lib/ai-story-planning-service", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/ai-story-planning-service")>(
    "../apps/web/src/lib/ai-story-planning-service"
  );
  return {
    ...actual,
    loadLatestCreativeContextForStory: vi.fn().mockResolvedValue(null),
    getLatestAnimationPackageForStory: vi.fn().mockResolvedValue(null),
    getLatestCompleteAnimationPackageForStory: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@ceo-agent/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/db")>();
  return { ...actual, getDb: () => getDb() };
});

vi.mock("@ceo-agent/queue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/queue")>();
  return { ...actual, agentQueue: () => ({ getJob }) };
});

function campaignDb() {
  const limit = vi.fn().mockResolvedValue([{ id: CAMPAIGN, orgId: ORG, workspaceId: WORKSPACE }]);
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    })),
  };
}

describe("describePlanningStageFailure", () => {
  it("translates a known contract code into an actionable message", () => {
    expect(describePlanningStageFailure("CHARACTER_PROPOSAL_ACCEPTANCE_REQUIRED")).toMatch(
      /accept the pending character/i
    );
  });

  it("falls back to the raw reason for an unrecognized code", () => {
    expect(describePlanningStageFailure("SOME_NEW_CODE")).toBe("This stage failed: SOME_NEW_CODE");
  });

  it("has a generic message when there is no reason at all", () => {
    expect(describePlanningStageFailure(null)).toMatch(/unknown reason/i);
  });
});

describe("GET /planning stageFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: USER, email: "user@example.test" });
    authorizeAccess.mockResolvedValue(undefined);
    getDb.mockReturnValue(campaignDb());
    loadCampaignAiStory.mockResolvedValue({
      story: { id: STORY, status: "planning", currentVersionId: STORY_VERSION },
      currentVersion: { id: STORY_VERSION, frozenAt: new Date().toISOString() },
    });
  });

  async function callRoute(query: string) {
    const route = await import(
      "../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/route"
    );
    return route.GET(new Request(`http://localhost${query}`), {
      params: Promise.resolve({ id: CAMPAIGN, storyId: STORY }),
    });
  }

  it("returns a translated stageFailure when the stage's job failed", async () => {
    getJob.mockResolvedValue({
      failedReason: "CHARACTER_PROPOSAL_ACCEPTANCE_REQUIRED",
      getState: vi.fn().mockResolvedValue("failed"),
    });

    const res = await callRoute("/api?stage=scene_plan");
    const body = await res.json();

    expect(getJob).toHaveBeenCalledWith(`story-plan-${STORY_VERSION}-scene_plan`);
    expect(body.stageFailure).toEqual({
      stage: "scene_plan",
      code: "CHARACTER_PROPOSAL_ACCEPTANCE_REQUIRED",
      message: expect.stringMatching(/accept the pending character/i),
    });
  });

  it("returns no stageFailure when the stage's job is still running", async () => {
    getJob.mockResolvedValue({
      failedReason: undefined,
      getState: vi.fn().mockResolvedValue("active"),
    });

    const res = await callRoute("/api?stage=scene_plan");
    const body = await res.json();

    expect(body.stageFailure).toBeNull();
  });

  it("returns no stageFailure when no stage query param is given", async () => {
    const res = await callRoute("/api");
    const body = await res.json();

    expect(getJob).not.toHaveBeenCalled();
    expect(body.stageFailure).toBeNull();
  });

  it("ignores an unknown stage value instead of querying the queue", async () => {
    const res = await callRoute("/api?stage=not_a_real_stage");
    const body = await res.json();

    expect(getJob).not.toHaveBeenCalled();
    expect(body.stageFailure).toBeNull();
  });
});
