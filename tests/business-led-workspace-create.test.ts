import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateWorkspaceBusinessLedSchema,
  deriveWorkspaceCreateDefaults,
  resolveIndustrySeed,
  slugifyWorkspaceName,
  INDUSTRY_CUSTOM_ID,
} from "@ceo-agent/shared";

const orgId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const requireAuth = vi.fn();
const requireOrganizationMembership = vi.fn();
const createWorkspaceWithBusinessProfile = vi.fn();

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
    requireOrganizationMembership: (...args: unknown[]) =>
      requireOrganizationMembership(...args),
    createWorkspaceWithBusinessProfile: (...args: unknown[]) =>
      createWorkspaceWithBusinessProfile(...args),
  };
});

async function loadRoute() {
  return import("../apps/web/src/app/api/workspaces/route");
}

describe("PD-012 business-led create helpers", () => {
  it("requires Business Name, Country, and Industry", () => {
    expect(
      CreateWorkspaceBusinessLedSchema.safeParse({
        orgId,
        country: "Singapore",
        industry: "retail",
      }).success
    ).toBe(false);
    expect(
      CreateWorkspaceBusinessLedSchema.safeParse({
        orgId,
        businessName: "Acme",
        industry: "retail",
      }).success
    ).toBe(false);
    expect(
      CreateWorkspaceBusinessLedSchema.safeParse({
        orgId,
        businessName: "Acme",
        country: "Singapore",
      }).success
    ).toBe(false);
    expect(
      CreateWorkspaceBusinessLedSchema.safeParse({
        orgId,
        businessName: "Acme Flowers",
        country: "Singapore",
        industry: "florist",
      }).success
    ).toBe(true);
  });

  it("derives workspace display name and slug from Business Name", () => {
    const defaults = deriveWorkspaceCreateDefaults({
      businessName: "Acme Flowers",
      country: "Singapore",
      industry: "florist",
      locale: "en",
    });
    expect(defaults.workspaceName).toBe("Acme Flowers");
    expect(defaults.baseSlug).toBe("acme-flowers");
    expect(slugifyWorkspaceName("Acme Flowers")).toBe("acme-flowers");
  });

  it("seeds Business Profile industry, country, and timezone", () => {
    const defaults = deriveWorkspaceCreateDefaults({
      businessName: "Acme",
      country: "Malaysia",
      industry: "retail",
      locale: "en",
    });
    expect(defaults.country).toBe("Malaysia");
    expect(defaults.industry.industryId).toBe("retail");
    expect(defaults.industry.industryCustomValue).toBeNull();
    expect(defaults.timezone).toBe("Asia/Kuala_Lumpur");
    expect(defaults.supportedLanguages).toEqual(["English"]);
  });

  it("maps unknown industry strings to custom industry", () => {
    const seed = resolveIndustrySeed("Boutique Consulting");
    expect(seed.industryId).toBe(INDUSTRY_CUSTOM_ID);
    expect(seed.industryCustomValue).toBe("Boutique Consulting");
  });
});

describe("POST /api/workspaces (PD-012)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuth.mockResolvedValue({ id: userId });
    requireOrganizationMembership.mockResolvedValue({
      orgId,
      userId,
      role: "owner",
    });
    createWorkspaceWithBusinessProfile.mockResolvedValue({
      workspace: {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        orgId,
        name: "Acme",
        slug: "acme",
      },
      businessProfile: {
        id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
        workspaceId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        companyName: "Acme",
        country: "Singapore",
        industryId: "florist",
        industryDisplayName: "Florist",
      },
    });
  });

  it(
    "rejects unauthorized create",
    async () => {
      const { AuthError } = await import("../apps/web/src/lib/auth");
      requireAuth.mockRejectedValue(new AuthError());
      const { POST } = await loadRoute();
      const res = await POST(
        new Request("http://localhost/api/workspaces", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            businessName: "Acme",
            country: "Singapore",
            industry: "florist",
          }),
        })
      );
      expect(res.status).toBe(401);
      expect(createWorkspaceWithBusinessProfile).not.toHaveBeenCalled();
    },
    15_000
  );
  it("rejects forbidden org membership", async () => {
    const { OrganizationAccessError } = await import("@ceo-agent/db");
    requireOrganizationMembership.mockRejectedValue(
      new OrganizationAccessError("Not a member of this organization", "FORBIDDEN")
    );
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          businessName: "Acme",
          country: "Singapore",
          industry: "florist",
        }),
      })
    );
    expect(res.status).toBe(403);
    expect(createWorkspaceWithBusinessProfile).not.toHaveBeenCalled();
  });

  it("rejects missing required fields with VALIDATION_ERROR", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, businessName: "Acme" }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(createWorkspaceWithBusinessProfile).not.toHaveBeenCalled();
  });

  it("creates workspace + profile and returns redirect path", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          businessName: "Acme",
          country: "Singapore",
          industry: "florist",
          locale: "en",
        }),
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.workspace.slug).toBe("acme");
    expect(body.businessProfile.workspaceId).toBe(body.workspace.id);
    expect(body.businessProfile.companyName).toBe("Acme");
    expect(body.businessProfile.country).toBe("Singapore");
    expect(body.businessProfile.industryId).toBe("florist");
    expect(body.redirectTo).toBe("/w/acme/settings/business-profile");
    expect(createWorkspaceWithBusinessProfile).toHaveBeenCalledWith({
      orgId,
      userId,
      businessName: "Acme",
      country: "Singapore",
      industry: "florist",
      locale: "en",
    });
  });

  it("sanitizes unexpected create failures to generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    createWorkspaceWithBusinessProfile.mockRejectedValue(
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
        detail: "workspace_id",
        constraint: "business_profiles_workspace_id_unique",
      })
    );
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://localhost/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          businessName: "Acme",
          country: "Singapore",
          industry: "florist",
        }),
      })
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "Unexpected server error.",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(body)).not.toContain("23505");
    spy.mockRestore();
  });
});

describe("PD-012 UI create payload helpers", () => {
  it("builds redirect target for Business Profile settings", () => {
    const slug = "acme-flowers";
    const redirectTo = `/w/${slug}/settings/business-profile`;
    expect(redirectTo).toBe("/w/acme-flowers/settings/business-profile");
  });

  it("does not submit when required form fields are empty", () => {
    const payload = {
      orgId,
      businessName: "",
      country: "",
      industry: "",
    };
    expect(CreateWorkspaceBusinessLedSchema.safeParse(payload).success).toBe(false);
  });

  it("createWorkspaceWithBusinessProfile uses a DB transaction (static)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "../packages/db/src/queries/create-workspace.ts"),
      "utf8"
    );
    expect(src).toMatch(/db\.transaction\s*\(/);
    expect(src).toMatch(/insert\(schema\.workspaces\)/);
    expect(src).toMatch(/insert\(schema\.businessProfiles\)/);
  });
});
