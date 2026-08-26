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
const storageUpload = vi.fn();
const storageRemove = vi.fn();
const storageFrom = vi.fn();

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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (...args: unknown[]) => storageFrom(...args),
    },
  }),
}));

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
    defaultPublishingPlatforms: [],
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

async function loadLogoRoute() {
  return import("../apps/web/src/app/api/workspaces/[id]/business-profile/logo/route");
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

  it("GET returns persisted logo reference after reload", async () => {
    const logoUrl =
      "https://example.supabase.co/storage/v1/object/public/campaign-assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/brand/business-logo-existing.png";
    getBusinessProfileByWorkspace.mockResolvedValue(incompleteProfileRow({ logo: logoUrl }));
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: workspaceA }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.logo).toBe(logoUrl);
  });

  it("GET returns canonical Default Publishing Platforms", async () => {
    getBusinessProfileByWorkspace.mockResolvedValue(
      incompleteProfileRow({
        defaultPublishingPlatforms: ["google_business", "instagram", "instagram"],
      })
    );
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: workspaceA }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.profile.defaultPublishingPlatforms).toEqual([
      "instagram",
      "googleBusiness",
    ]);
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

describe("Business Profile logo persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    requireAuth.mockResolvedValue({ id: userId });
    requireWorkspaceRole.mockResolvedValue({
      orgId: orgA,
      workspaceId: workspaceA,
      userId,
      role: "operator",
    });
    storageFrom.mockReturnValue({
      upload: storageUpload,
      remove: storageRemove,
    });
    storageUpload.mockResolvedValue({ error: null });
    storageRemove.mockResolvedValue({ error: null });
    getBusinessProfileByWorkspace.mockResolvedValue(incompleteProfileRow());
    updateBusinessProfile.mockImplementation(
      async (_orgId: string, _workspaceId: string, _userId: string, update: Record<string, unknown>) =>
        incompleteProfileRow({ logo: update.logo ?? null, version: 2 })
    );
  });

  it("uploads logo image to Supabase Storage and persists Business Profile logo URL", async () => {
    const { POST } = await loadLogoRoute();
    const formData = new FormData();
    formData.set("file", new File(["logo"], "brand-logo.png", { type: "image/png" }));

    const res = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: formData,
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(storageFrom).toHaveBeenCalledWith("business-branding");
    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(
        /^aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\/brand\/business-logo-.+\.png$/
      ),
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/png", upsert: false })
    );
    expect(updateBusinessProfile).toHaveBeenCalledWith(
      orgA,
      workspaceA,
      userId,
      expect.objectContaining({
        logo: expect.stringMatching(
          /^https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/business-branding\/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\/brand\/business-logo-.+\.png$/
        ),
      })
    );
    expect(body.profile.logo).toBe(body.logo);
    expect(body.storagePath).toMatch(
      /^aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\/brand\/business-logo-.+\.png$/
    );
  });

  it("replaces logo and safely removes the previous managed logo file", async () => {
    const oldLogo =
      "https://example.supabase.co/storage/v1/object/public/campaign-assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/brand/business-logo-old.png";
    getBusinessProfileByWorkspace.mockResolvedValue(incompleteProfileRow({ logo: oldLogo }));
    const { POST } = await loadLogoRoute();
    const formData = new FormData();
    formData.set("file", new File(["new"], "new-logo.webp", { type: "image/webp" }));

    const res = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: formData,
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );

    expect(res.status).toBe(200);
    expect(storageRemove).toHaveBeenCalledWith([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/brand/business-logo-old.png",
    ]);
  });

  it("remove clears the Business Profile logo reference and deletes the managed file", async () => {
    const oldLogo =
      "https://example.supabase.co/storage/v1/object/public/campaign-assets/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/brand/business-logo-old.png";
    getBusinessProfileByWorkspace.mockResolvedValue(incompleteProfileRow({ logo: oldLogo }));
    const { DELETE } = await loadLogoRoute();

    const res = await DELETE(new Request("http://localhost/api", { method: "DELETE" }), {
      params: Promise.resolve({ id: workspaceA }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(updateBusinessProfile).toHaveBeenCalledWith(orgA, workspaceA, userId, {
      logo: null,
    });
    expect(storageRemove).toHaveBeenCalledWith([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/brand/business-logo-old.png",
    ]);
    expect(body.profile.logo).toBeNull();
  });

  it("rejects invalid logo file types before storage upload", async () => {
    const { POST } = await loadLogoRoute();
    const formData = new FormData();
    formData.set("file", new File(["pdf"], "logo.pdf", { type: "application/pdf" }));

    const res = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: formData,
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(storageUpload).not.toHaveBeenCalled();
    expect(updateBusinessProfile).not.toHaveBeenCalled();
  });

  it("returns storage error when logo upload fails", async () => {
    storageUpload.mockResolvedValue({ error: { message: "storage offline" } });
    const { POST } = await loadLogoRoute();
    const formData = new FormData();
    formData.set("file", new File(["logo"], "logo.png", { type: "image/png" }));

    const res = await POST(
      new Request("http://localhost/api", {
        method: "POST",
        body: formData,
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("STORAGE_ERROR");
    expect(updateBusinessProfile).not.toHaveBeenCalled();
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

  it("PATCH validates and persists Default Publishing Platforms", async () => {
    updateBusinessProfile.mockResolvedValue(
      incompleteProfileRow({
        defaultPublishingPlatforms: ["tiktok", "linkedin"],
        version: 2,
      })
    );
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      new Request("http://localhost/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaultPublishingPlatforms: ["linkedin", "tiktok", "linkedin"],
          version: 1,
        }),
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );
    expect(res.status).toBe(200);
    expect(updateBusinessProfile).toHaveBeenCalledWith(
      orgA,
      workspaceA,
      userId,
      expect.objectContaining({
        defaultPublishingPlatforms: ["tiktok", "linkedin"],
      })
    );
  });

  it("PATCH rejects unknown Default Publishing Platforms", async () => {
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      new Request("http://localhost/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          defaultPublishingPlatforms: ["unknown-network"],
          version: 1,
        }),
      }),
      { params: Promise.resolve({ id: workspaceA }) }
    );
    expect(res.status).toBe(400);
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
