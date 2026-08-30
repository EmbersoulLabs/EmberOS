import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  assessBusinessProfileAiSources,
  businessProfileAiAnalysisToUpdate,
  normalizeBusinessProfileAiAnalysis,
  validateBusinessProfileAiAnalysis,
} from "@ceo-agent/shared";

describe("business-profile AI normalization", () => {
  it("normalizes successful analysis and dedupes lists", () => {
    const analysis = normalizeBusinessProfileAiAnalysis({
      brandSummary: "  Modern florist for elegant gifting.  ",
      brandPersonality: ["Professional", "professional", " Friendly "],
      brandTone: ["Warm", "", "Warm"],
      brandKeywords: ["Luxury Florist", "Wedding", "Wedding"],
      targetAudience: "Women 25-40, Corporate Clients",
    });

    expect(analysis.brandSummary).toBe("Modern florist for elegant gifting.");
    expect(analysis.brandPersonality).toEqual(["Professional", "Friendly"]);
    expect(analysis.brandTone).toEqual(["Warm"]);
    expect(analysis.brandKeywords).toEqual(["Luxury Florist", "Wedding"]);
    expect(analysis.targetAudience).toEqual(["Women 25-40", "Corporate Clients"]);
  });

  it("rejects empty brand summary after generation", () => {
    expect(() =>
      normalizeBusinessProfileAiAnalysis({
        brandSummary: "   ",
        brandPersonality: ["Warm"],
        brandTone: ["Calm"],
        brandKeywords: ["Gift"],
        targetAudience: ["Shoppers"],
      })
    ).toThrow();
  });

  it("maps accepted analysis onto Business Profile update fields", () => {
    const update = businessProfileAiAnalysisToUpdate({
      brandSummary: "Premium cafe for remote workers.",
      brandPersonality: ["Friendly"],
      brandTone: ["Warm", "Friendly"],
      brandKeywords: ["Coffee", "Workspace"],
      targetAudience: ["Freelancers", "Students"],
    });

    expect(update.businessDescription).toBe("Premium cafe for remote workers.");
    expect(update.brandPersonality).toEqual(["Friendly", "Warm"]);
    expect(update.brandKeywords).toEqual(["Coffee", "Workspace"]);
    expect(update.targetAudience).toBe("Freelancers, Students");
  });

  it("computes confidence from available sources without failing on empty optionals", () => {
    const sparse = assessBusinessProfileAiSources({
      companyName: "Bloom Co",
      industryDisplayName: "Florist",
    });
    expect(sparse.sourcesUsed).toContain("companyName");
    expect(sparse.sourcesUsed).toContain("industry");
    expect(sparse.missingSources).toContain("website");
    expect(sparse.confidence).toBeGreaterThan(0);
    expect(sparse.confidence).toBeLessThan(100);

    const empty = assessBusinessProfileAiSources({});
    expect(empty.sourcesUsed).toEqual([]);
    expect(empty.confidence).toBe(0);
  });

  it("validateBusinessProfileAiAnalysis returns ok/false wrappers", () => {
    expect(
      validateBusinessProfileAiAnalysis({
        brandSummary: "Clear positioning.",
        brandPersonality: ["Modern"],
        brandTone: ["Confident"],
        brandKeywords: ["Design"],
        targetAudience: ["Startups"],
      }).ok
    ).toBe(true);

    expect(
      validateBusinessProfileAiAnalysis({
        brandSummary: "",
        brandPersonality: [],
        brandTone: [],
        brandKeywords: [],
        targetAudience: [],
      }).ok
    ).toBe(false);
  });
});

const workspaceA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const orgA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const userId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const profileId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const requireAuth = vi.fn();
const requireWorkspaceRole = vi.fn();
const getBusinessProfileByWorkspace = vi.fn();
const executeSkill = vi.fn();

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireAuth: () => requireAuth(),
  };
});

vi.mock("@ceo-agent/db", async () => {
  const actual = await vi.importActual<typeof import("@ceo-agent/db")>("@ceo-agent/db");
  return {
    ...actual,
    requireWorkspaceRole: (...args: unknown[]) => requireWorkspaceRole(...args),
    getBusinessProfileByWorkspace: (...args: unknown[]) =>
      getBusinessProfileByWorkspace(...args),
  };
});

vi.mock("@/lib/business-profile-ai", () => ({
  executeSkill: (...args: unknown[]) => executeSkill(...args),
  AiSkillError: class AiSkillError extends Error {
    constructor(
      message: string,
      readonly code: string,
      readonly cause?: unknown
    ) {
      super(message);
      this.name = "AiSkillError";
    }
  },
}));

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: profileId,
    orgId: orgA,
    workspaceId: workspaceA,
    companyName: "Bloom Florist",
    industryId: "retail",
    industryDisplayName: "Retail",
    industryCustomValue: null,
    services: ["Bouquets"],
    businessDescription: "We craft elegant floral gifts.",
    targetAudience: null,
    businessHours: [],
    businessEmail: null,
    businessPhone: null,
    whatsappBusiness: null,
    website: "https://bloom.example",
    facebook: null,
    instagram: "https://instagram.com/bloom",
    tiktok: null,
    youtube: null,
    redNote: null,
    linkedIn: null,
    country: "Malaysia",
    stateProvince: null,
    city: null,
    address: null,
    postalCode: null,
    timezone: null,
    brandPersonality: [],
    brandStyle: [],
    brandValues: [],
    brandKeywords: [],
    logo: null,
    brandColors: ["#AA2244"],
    brandFonts: [],
    brandImages: [],
    supportedLanguages: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: userId,
    updatedBy: userId,
    deletedAt: null,
    version: 1,
    ...overrides,
  };
}

async function loadAnalyzeRoute() {
  return import("../apps/web/src/app/api/workspaces/[id]/business-profile/analyze/route");
}

describe("POST /api/workspaces/[id]/business-profile/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: userId });
    requireWorkspaceRole.mockResolvedValue({ orgId: orgA, role: "operator" });
    getBusinessProfileByWorkspace.mockResolvedValue(profileRow());
  });

  it("returns normalized AI analysis on success", async () => {
    executeSkill.mockResolvedValue({
      brandSummary: "Modern premium florist specialising in elegant gifting.",
      brandPersonality: ["Professional", "Premium"],
      brandTone: ["Elegant", "Warm"],
      brandKeywords: ["Luxury Florist", "Wedding", "Corporate Gifts"],
      targetAudience: ["Women 25-40", "Wedding Customers"],
      confidence: 45,
      metadata: {
        sourcesUsed: ["companyName", "industry", "businessDescription"],
        missingSources: ["logo"],
        usage: { input: 10, output: 20, costUsd: 0.001 },
        provider: "openai",
        model: "gpt-4o-mini",
        skillId: "business-profile-analyzer",
        promptVersion: "1.0.0",
        schemaVersion: "1.0.0",
      },
    });

    const { POST } = await loadAnalyzeRoute();
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: workspaceA }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.brandSummary).toContain("florist");
    expect(body.brandKeywords).toContain("Wedding");
    expect(body.targetAudience).toEqual(["Women 25-40", "Wedding Customers"]);
    expect(body.confidence).toBe(45);
    expect(executeSkill).toHaveBeenCalledOnce();
    expect(executeSkill.mock.calls[0]?.[0]).toBe("business-profile-analyzer");
  });

  it("returns friendly error when AI fails without touching profile persistence", async () => {
    executeSkill.mockRejectedValue(new Error("model timeout"));
    const { POST } = await loadAnalyzeRoute();
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: workspaceA }),
    });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.code).toBe("AI_ANALYSIS_FAILED");
    expect(body.error).toMatch(/try again/i);
  });

  it("rejects completely empty business context", async () => {
    getBusinessProfileByWorkspace.mockResolvedValue(
      profileRow({
        companyName: null,
        industryId: null,
        industryDisplayName: null,
        industryCustomValue: null,
        services: [],
        businessDescription: null,
        website: null,
        instagram: null,
        brandColors: [],
        brandKeywords: [],
        brandPersonality: [],
        targetAudience: null,
        logo: null,
        country: null,
      })
    );

    const { POST } = await loadAnalyzeRoute();
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: workspaceA }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INSUFFICIENT_CONTEXT");
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("allows analysis when only required-ish core fields exist (optionals empty)", async () => {
    getBusinessProfileByWorkspace.mockResolvedValue(
      profileRow({
        website: null,
        instagram: null,
        logo: null,
        brandColors: [],
        services: [],
        businessDescription: null,
      })
    );
    executeSkill.mockResolvedValue({
      brandSummary: "Retail florist brand.",
      brandPersonality: ["Friendly"],
      brandTone: ["Warm"],
      brandKeywords: ["Flowers"],
      targetAudience: ["Local shoppers"],
      confidence: 18,
      metadata: {
        sourcesUsed: ["companyName", "industry"],
        missingSources: [],
        usage: { input: 1, output: 1, costUsd: 0 },
        provider: "openai",
        model: "gpt-4o-mini",
        skillId: "business-profile-analyzer",
        promptVersion: "1.0.0",
        schemaVersion: "1.0.0",
      },
    });

    const { POST } = await loadAnalyzeRoute();
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: workspaceA }),
    });

    expect(res.status).toBe(200);
  });

  it("requires auth / workspace role (unauthorized path)", async () => {
    const { AuthError } = await import("@/lib/auth");
    requireAuth.mockRejectedValue(new AuthError("Unauthorized", "UNAUTHORIZED", 401));
    const { POST } = await loadAnalyzeRoute();
    const res = await POST(new Request("http://localhost/api", { method: "POST", body: "{}" }), {
      params: Promise.resolve({ id: workspaceA }),
    });
    expect(res.status).toBe(401);
  });
});
