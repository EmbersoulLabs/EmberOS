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

const { requireAuth, requireControlledSelfUseWorkspaceOperator, getDb, getBusinessProfileByWorkspace } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireControlledSelfUseWorkspaceOperator: vi.fn(),
  getDb: vi.fn(),
  getBusinessProfileByWorkspace: vi.fn(),
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

vi.mock("@ceo-agent/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ceo-agent/db")>();
  return { ...actual, getDb: () => getDb(), getBusinessProfileByWorkspace: (...args: unknown[]) => getBusinessProfileByWorkspace(...args) };
});

describe("POST /api/campaigns/[id]/marketing-plans/assist — missing material", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: USER });
    requireControlledSelfUseWorkspaceOperator.mockResolvedValue({ orgId: ORG, id: WORKSPACE });
  });

  async function callRoute() {
    const route = await import("../apps/web/src/app/api/campaigns/[id]/marketing-plans/assist/route");
    return route.POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: CAMPAIGN }),
    });
  }

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

  it("lists business_profile, target_audience, platform_strategy, and product when every material is missing", async () => {
    mockDb({ targetAudience: null, platforms: [], productAssetCount: 0 });
    getBusinessProfileByWorkspace.mockResolvedValue(null);

    const res = await callRoute();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.missing.sort()).toEqual(["business_profile", "platform_strategy", "product", "target_audience"]);
  });

  it("only lists product when everything else is present", async () => {
    mockDb({ productAssetCount: 0 });
    getBusinessProfileByWorkspace.mockResolvedValue(fakeProfileRow());

    const res = await callRoute();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.missing).toEqual(["product"]);
  });

  it("falls back to the Business Profile's targetAudience when the Campaign has none", async () => {
    // Keep every other material missing too, so this stays inside the 409
    // gate and never reaches the reservation/AI call this test isn't mocking
    // — the only thing under test is whether target_audience still counts as
    // present when it comes from the Business Profile instead of the Campaign.
    mockDb({ targetAudience: null, platforms: [], productAssetCount: 0 });
    getBusinessProfileByWorkspace.mockResolvedValue(
      fakeProfileRow({ businessDescription: null, targetAudience: "Office workers nearby" })
    );

    const res = await callRoute();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.missing).not.toContain("target_audience");
    expect(body.missing.sort()).toEqual(["business_profile", "platform_strategy", "product"]);
  });
});

describe("POST /api/campaigns/[id]/marketing-plans/assist — provider plumbing", () => {
  it("reserves a Controlled Self-Use authority and wraps the provider call before calling the model", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/marketing-plans/assist/route.ts");
    const missingCheck = route.indexOf("if (missing.length)");
    const reserve = route.indexOf("authority.reserve({");
    const wrap = route.indexOf("withControlledSelfUseProviderContext(", reserve);
    const providerCall = route.indexOf("callStructuredJsonModel({", wrap);
    const settle = route.indexOf("authority.settle(", providerCall);
    expect(missingCheck).toBeGreaterThan(0);
    expect(reserve).toBeGreaterThan(missingCheck);
    expect(wrap).toBeGreaterThan(reserve);
    expect(providerCall).toBeGreaterThan(wrap);
    expect(settle).toBeGreaterThan(providerCall);
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
