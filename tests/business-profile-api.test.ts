import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceAccessError } from "@ceo-agent/db";
import { assessBusinessProfileCompletion } from "@ceo-agent/shared";
import { businessProfileQualityWarnings } from "../apps/web/src/lib/business-profile-warnings";

const workspaceA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const workspaceB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const orgA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const userId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const profileId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const requireAuth = vi.fn();
const requireWorkspaceRole = vi.fn();
const getBusinessProfileByWorkspace = vi.fn();
const updateBusinessProfile = vi.fn();

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
    updateBusinessProfile: (...args: unknown[]) => updateBusinessProfile(...args),
  };
});

function incompleteProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: profileId,
    orgId: orgA,
    workspaceId: workspaceA,
    companyName: null,
    industryId: null,
    industryDisplayName: null,
    industryCustomValue: null,
    services: [],
    businessDescription: null,
    targetAudience: null,
    businessHours: [],
    businessEmail: null,
    businessPhone: null,
    whatsappBusiness: null,
    website: null,
    facebook: null,
    instagram: null,
    tiktok: null,
    youtube: null,
    redNote: null,
    linkedIn: null,
    country: null,
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
    brandColors: [],
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

async function loadRoute() {
  return import("../apps/web/src/app/api/workspaces/[id]/business-profile/route");
}

describe("businessProfileQualityWarnings", () => {
  it("returns non-blocking BUSINESS_PROFILE_INCOMPLETE when incomplete", () => {
    const completion = assessBusinessProfileCompletion(incompleteProfileRow());
    const warnings = businessProfileQualityWarnings(completion);
    expect(completion.complete).toBe(false);
    expect(warnings).toEqual([
      {
        code: "BUSINESS_PROFILE_INCOMPLETE",
        message: "Business Profile is incomplete. AI quality may be affected.",
        missing: completion.missing,
      },
    ]);
  });

  it("returns no warnings when complete", () => {
    const complete = incompleteProfileRow({
      companyName: "Acme",
      industryId: "retail",
      industryDisplayName: "Retail",
      services: ["Consulting"],
      businessDescription: "We help",
      targetAudience: "SMBs",
      businessEmail: "a@b.com",
      businessPhone: "+60123456789",
      country: "Malaysia",
      address: "1 Main St",
      postalCode: "50000",
      brandKeywords: ["trust"],
    });
    const completion = assessBusinessProfileCompletion(complete);
    expect(completion.complete).toBe(true);
    expect(businessProfileQualityWarnings(completion)).toEqual([]);
  });
});

describe("GET /api/workspaces/[id]/business-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: userId });
    requireWorkspaceRole.mockResolvedValue({
      orgId: orgA,
      workspaceId: workspaceA,
      userId,
      role: "admin",
    });
    getBusinessProfileByWorkspace.mockResolvedValue(incompleteProfileRow());
  });

  it("GET success returns profile, completion, and non-blocking warnings", async () => {
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: workspaceA }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.id).toBe(profileId);
    expect(body.profile.workspaceId).toBe(workspaceA);
    expect(body.completion.complete).toBe(false);
    expect(body.warnings?.[0]?.code).toBe("BUSINESS_PROFILE_INCOMPLETE");
    expect(getBusinessProfileByWorkspace).toHaveBeenCalledWith(workspaceA);
    expect(requireWorkspaceRole).toHaveBeenCalledWith(workspaceA, userId, "client_viewer");
  });

  it("GET returns 404 when profile does not exist (no lazy create)", async () => {
    getBusinessProfileByWorkspace.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: workspaceA }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(getBusinessProfileByWorkspace).toHaveBeenCalledWith(workspaceA);
  });

  it("GET forbidden when not a workspace member", async () => {
    requireWorkspaceRole.mockRejectedValue(
      new WorkspaceAccessError("Not a member of this workspace", "FORBIDDEN")
    );
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: workspaceB }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
    expect(getBusinessProfileByWorkspace).not.toHaveBeenCalled();
  });

  it("GET rejects invalid workspace UUID", async () => {
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(requireWorkspaceRole).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/workspaces/[id]/business-profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: userId });
    requireWorkspaceRole.mockResolvedValue({
      orgId: orgA,
      workspaceId: workspaceA,
      userId,
      role: "operator",
    });
    updateBusinessProfile.mockResolvedValue(
      incompleteProfileRow({ companyName: "Acme Co", version: 2 })
    );
  });

  it("PATCH success updates with operator role and returns warnings when incomplete", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      new Request("http://localhost/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: "Acme Co", version: 1 }),
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.companyName).toBe("Acme Co");
    expect(body.profile.version).toBe(2);
    expect(body.warnings?.[0]?.code).toBe("BUSINESS_PROFILE_INCOMPLETE");
    expect(requireWorkspaceRole).toHaveBeenCalledWith(workspaceA, userId, "operator");
    expect(updateBusinessProfile).toHaveBeenCalledWith(
      orgA,
      workspaceA,
      userId,
      expect.objectContaining({ companyName: "Acme Co", version: 1 })
    );
  });

  it("PATCH validation failure returns 400 VALIDATION_ERROR", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      new Request("http://localhost/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessEmail: "not-an-email", version: 1 }),
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(updateBusinessProfile).not.toHaveBeenCalled();
  });

  it("PATCH version conflict returns 409", async () => {
    const err = new Error("Business profile version conflict") as Error & { code: string };
    err.code = "VERSION_CONFLICT";
    updateBusinessProfile.mockRejectedValue(err);

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      new Request("http://localhost/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: "Acme", version: 1 }),
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("VERSION_CONFLICT");
  });

  it("PATCH cross-tenant forbidden does not update", async () => {
    requireWorkspaceRole.mockRejectedValue(
      new WorkspaceAccessError("Not a member of this workspace", "FORBIDDEN")
    );
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      new Request("http://localhost/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: "Hacked", version: 1 }),
      }),
      { params: Promise.resolve({ id: workspaceB }) }
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
    expect(updateBusinessProfile).not.toHaveBeenCalled();
  });
});
