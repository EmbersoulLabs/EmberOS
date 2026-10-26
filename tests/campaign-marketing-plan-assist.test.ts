import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30_000 });

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function fakeProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "71000000-0000-4000-8000-000000000001",
    orgId: "51000000-0000-4000-8000-000000000003",
    workspaceId: "51000000-0000-4000-8000-000000000002",
    businessDescription: "A food stall",
    companyName: "Tapao Jom",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

const CAMPAIGN = "51000000-0000-4000-8000-000000000001";
const WORKSPACE = "51000000-0000-4000-8000-000000000002";
const ORG = "51000000-0000-4000-8000-000000000003";
const USER = "51000000-0000-4000-8000-000000000004";

const {
  requireAuth,
  requireControlledSelfUseWorkspaceOperator,
  getDb,
  getBusinessProfileByWorkspace,
  callStructuredJsonModel,
  reserve,
  settle,
  getReservationById,
} = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireControlledSelfUseWorkspaceOperator: vi.fn(),
  getDb: vi.fn(),
  getBusinessProfileByWorkspace: vi.fn(),
  callStructuredJsonModel: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  getReservationById: vi.fn(),
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/auth")>("../apps/web/src/lib/auth");
  return { ...actual, requireAuth: () => requireAuth() };
});

vi.mock("@/lib/controlled-self-use-workspace-access", async () => {
  const actual = await vi.importActual<typeof import("../apps/web/src/lib/controlled-self-use-workspace-access")>(
    "../apps/web/src/lib/controlled-self-use-workspace-access"
  );
  return { ...actual, requireControlledSelfUseWorkspaceOperator: (...args: unknown[]) => requireControlledSelfUseWorkspaceOperator(...args) };
});

vi.mock("@ceo-agent/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/agents")>();
  return { ...actual, callStructuredJsonModel: (...args: unknown[]) => callStructuredJsonModel(...args) };
});

vi.mock("@ceo-agent/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/db")>();
  class FakeAuthorityService {
    reserve(...args: unknown[]) { return reserve(...args); }
    settle(...args: unknown[]) { return settle(...args); }
    release() { return Promise.resolve(); }
    getReservationById(...args: unknown[]) { return getReservationById(...args); }
  }
  return {
    ...actual,
    getDb: () => getDb(),
    getBusinessProfileByWorkspace: (...args: unknown[]) => getBusinessProfileByWorkspace(...args),
    ControlledSelfUseAuthorityService: FakeAuthorityService,
  };
});

function mockDb(input: { targetAudience?: unknown; platforms?: string[]; productAssetCount?: number }) {
  const campaignRow = {
    id: CAMPAIGN,
    orgId: ORG,
    workspaceId: WORKSPACE,
    name: "Nasi Lemak",
    goal: "Sales",
    platforms: input.platforms ?? ["tiktok"],
    targetAudience: input.targetAudience === undefined ? { summary: "Office workers" } : input.targetAudience,
  };
  const productRows = Array.from({ length: input.productAssetCount ?? 1 }, (_, index) => ({ id: `asset-${index}` }));

  // First select(): campaign lookup. Then two asset queries inside
  // loadAttachedProductAssets (legacy select, then referenced innerJoin).
  const campaignSelect = {
    from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([campaignRow]) })) })),
  };
  const legacyAssetsSelect = {
    from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(productRows) })),
  };
  const referencedAssetsSelect = {
    from: vi.fn(() => ({ innerJoin: vi.fn(() => ({ where: vi.fn(() => ({ orderBy: vi.fn().mockResolvedValue([]) })) })) })),
  };
  const select = vi.fn()
    .mockReturnValueOnce(campaignSelect)
    .mockReturnValueOnce(legacyAssetsSelect)
    .mockReturnValueOnce(referencedAssetsSelect);
  getDb.mockReturnValue({ select });
}

async function callRoute() {
  const route = await import("../apps/web/src/app/api/campaigns/[id]/marketing-plans/assist/route");
  return route.POST(new Request("http://localhost", { method: "POST" }), {
    params: Promise.resolve({ id: CAMPAIGN }),
  });
}

describe("POST /api/campaigns/[id]/marketing-plans/assist — missing material", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: USER });
    requireControlledSelfUseWorkspaceOperator.mockResolvedValue({ orgId: ORG, id: WORKSPACE });
  });

  it("only business_profile and target_audience block generation — platforms and product never do", async () => {
    mockDb({ targetAudience: null, platforms: [], productAssetCount: 0 });
    getBusinessProfileByWorkspace.mockResolvedValue(null);

    const res = await callRoute();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.missing.sort()).toEqual(["business_profile", "target_audience"]);
  });

  it("falls back to the Business Profile's targetAudience when the Campaign has none", async () => {
    mockDb({ targetAudience: null });
    getBusinessProfileByWorkspace.mockResolvedValue(fakeProfileRow({ targetAudience: "Office workers nearby" }));
    reserve.mockResolvedValue({ reservation: { reservationId: "r1", status: "RESERVED" } });
    settle.mockResolvedValue(undefined);
    callStructuredJsonModel.mockResolvedValue({
      result: {
        objective: "Grow awareness",
        targetAudience: "Office workers nearby",
        keyMessage: "Fast, tasty, convenient",
        marketingApproach: "Short videos",
        creativeDirection: "Warm and inviting",
        recommendedModule: "AI_STORY",
        rationale: "No source footage exists",
        expectedOutcome: "More orders",
        businessFactRefs: ["companyName"],
      },
      usage: { costUsd: 0.01 },
      providerRequestId: "req1",
      decodeIssue: null,
    });

    const res = await callRoute();
    expect(res.status).toBe(200);
  });
});

describe("POST /api/campaigns/[id]/marketing-plans/assist — zero-asset Campaigns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: USER });
    requireControlledSelfUseWorkspaceOperator.mockResolvedValue({ orgId: ORG, id: WORKSPACE });
    getBusinessProfileByWorkspace.mockResolvedValue(fakeProfileRow());
    reserve.mockResolvedValue({ reservation: { reservationId: "r1", status: "RESERVED" } });
    settle.mockResolvedValue(undefined);
  });

  it("does not block generation when there are zero product assets, and forces AI_STORY + ZERO_ASSET regardless of what the model answered", async () => {
    mockDb({ productAssetCount: 0 });
    // Deliberately have the model answer something wrong, to prove the route
    // enforces the structural rule itself rather than trusting the model.
    callStructuredJsonModel.mockResolvedValue({
      result: {
        objective: "Grow awareness",
        targetAudience: "Office workers",
        keyMessage: "Fast, tasty, convenient",
        marketingApproach: "Short videos",
        creativeDirection: "Warm and inviting",
        recommendedModule: "VIDEO_STUDIO",
        rationale: "Video converts well",
        expectedOutcome: "More orders",
        businessFactRefs: ["companyName"],
      },
      usage: { costUsd: 0.01 },
      providerRequestId: "req1",
      decodeIssue: null,
    });

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ready).toBe(true);
    expect(body.proposal.recommendedModule).toBe("AI_STORY");
    expect(body.proposal.assetMode).toBe("ZERO_ASSET");
    expect(body.proposal.assetIds).toEqual([]);
  });

  it("uses ASSET_BASED with the attached asset ids when at least one product asset exists", async () => {
    mockDb({ productAssetCount: 2 });
    callStructuredJsonModel.mockResolvedValue({
      result: {
        objective: "Grow awareness",
        targetAudience: "Office workers",
        keyMessage: "Fast, tasty, convenient",
        marketingApproach: "Short videos",
        creativeDirection: "Warm and inviting",
        recommendedModule: "VIDEO_STUDIO",
        rationale: "Video converts well",
        expectedOutcome: "More orders",
        businessFactRefs: ["companyName"],
      },
      usage: { costUsd: 0.01 },
      providerRequestId: "req1",
      decodeIssue: null,
    });

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal.recommendedModule).toBe("VIDEO_STUDIO");
    expect(body.proposal.assetMode).toBe("ASSET_BASED");
    expect(body.proposal.assetIds).toEqual(["asset-0", "asset-1"]);
  });
});

describe("POST /api/campaigns/[id]/marketing-plans/assist — provider plumbing", () => {
  it("reserves a Controlled Self-Use authority and wraps the provider call before calling the model", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/marketing-plans/assist/route.ts");
    const missingCheck = route.indexOf("if (missing.length)");
    const reserveCall = route.indexOf("authority.reserve({");
    const wrap = route.indexOf("withControlledSelfUseProviderContext(", reserveCall);
    const providerCall = route.indexOf("callStructuredJsonModel({", wrap);
    const settleCall = route.indexOf("authority.settle(", providerCall);
    expect(missingCheck).toBeGreaterThan(0);
    expect(reserveCall).toBeGreaterThan(missingCheck);
    expect(wrap).toBeGreaterThan(reserveCall);
    expect(providerCall).toBeGreaterThan(wrap);
    expect(settleCall).toBeGreaterThan(providerCall);
    expect(route).toContain("authority.release(reservation.reservationId");
  });

  it("constrains businessFactRefs to the exact keys createRevision's fact-check accepts", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/marketing-plans/assist/route.ts");
    const service = read("packages/db/src/queries/campaign-marketing-plans.ts");
    for (const key of ["companyName", "industryDisplayName", "businessDescription", "services"]) {
      expect(route).toContain(`"${key}"`);
    }
    // createRevision validates businessFactRefs generically against the live
    // profile record — this just confirms the cited keys are real column names.
    expect(service).toContain("businessFactRefs.map");
  });
});
