import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const CAMPAIGN = "81000000-0000-4000-8000-000000000001";
const STORY = "81000000-0000-4000-8000-000000000002";
const WORKSPACE = "81000000-0000-4000-8000-000000000003";
const ORG = "81000000-0000-4000-8000-000000000004";
const USER = "81000000-0000-4000-8000-000000000005";

const { requireAuth, authorizeAiStoryAccess, getDb, loadCampaignAiStory, archiveAiStoryMock } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  authorizeAiStoryAccess: vi.fn(),
  getDb: vi.fn(),
  loadCampaignAiStory: vi.fn(),
  archiveAiStoryMock: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/auth")>("../apps/web/src/lib/auth");
  return { ...actual, requireAuth: () => requireAuth() };
});

vi.mock("@/lib/ai-story-access", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/ai-story-access")>(
    "../apps/web/src/lib/ai-story-access"
  );
  return { ...actual, authorizeAiStoryAccess: (...args: unknown[]) => authorizeAiStoryAccess(...args) };
});

vi.mock("@/lib/ai-story-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../apps/web/src/lib/ai-story-service")>();
  return {
    ...actual,
    loadCampaignAiStory: (...args: unknown[]) => loadCampaignAiStory(...args),
    archiveAiStory: (...args: unknown[]) => archiveAiStoryMock(...args),
  };
});

vi.mock("@ceo-agent/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/db")>();
  return { ...actual, getDb: () => getDb() };
});

function campaignDb() {
  const limit = vi.fn().mockResolvedValue([{ id: CAMPAIGN, orgId: ORG, workspaceId: WORKSPACE }]);
  return {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit })) })) })),
  };
}

describe("DELETE /api/campaigns/[id]/ai-stories/[storyId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: USER });
    authorizeAiStoryAccess.mockResolvedValue(undefined);
    getDb.mockReturnValue(campaignDb());
    loadCampaignAiStory.mockResolvedValue({ story: { id: STORY, status: "draft" } });
  });

  async function callRoute() {
    const route = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/route");
    return route.DELETE(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ id: CAMPAIGN, storyId: STORY }),
    });
  }

  it("requires operator role, then archives the Story and returns success", async () => {
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ archived: true });

    expect(authorizeAiStoryAccess).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, workspaceId: WORKSPACE, minRole: "operator" })
    );
    expect(archiveAiStoryMock).toHaveBeenCalledWith(expect.anything(), STORY, CAMPAIGN, WORKSPACE);
  });

  it("returns 404 when the Story doesn't resolve inside this Campaign/Workspace", async () => {
    loadCampaignAiStory.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(404);
    expect(archiveAiStoryMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the Campaign doesn't exist", async () => {
    getDb.mockReturnValue({ select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) })) });
    const res = await callRoute();
    expect(res.status).toBe(404);
    expect(archiveAiStoryMock).not.toHaveBeenCalled();
  });
});
