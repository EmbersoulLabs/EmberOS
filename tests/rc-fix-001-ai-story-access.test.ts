import { describe, expect, it, vi } from "vitest";
import { effectiveProjectionHasCapability } from "@ceo-agent/shared";
import { buildEffectiveEntitlementProjection } from "@ceo-agent/shared/server";
import {
  AiStoryAccessDeniedError,
  authorizeAiStoryAccess,
} from "../apps/web/src/lib/ai-story-access";
import { handleApiError } from "../apps/web/src/lib/auth";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000002";
const WORKSPACE = "10000000-0000-4000-8000-000000000003";
const NOW = "2026-08-11T00:00:00.000Z";

function projection(capabilities: Array<"ai_story.access" | "ai_story.execute">) {
  return buildEffectiveEntitlementProjection({
    orgId: ORG,
    workspaceId: WORKSPACE,
    projectedAt: NOW,
    entries: capabilities.map((capabilityKey, index) => ({
      capabilityKey,
      source: "PLAN" as const,
      entitlementGrantId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      grantedAt: NOW,
      expiresAt: null,
    })),
  });
}

function dependencies(input?: {
  capabilities?: Array<"ai_story.access" | "ai_story.execute">;
  workspaceAllowed?: boolean;
  platformAdminStatus?: "ACTIVE_GRANT" | "DENIED";
  organizationPlan?: string | null;
}) {
  return {
    requireWorkspaceRole: input?.workspaceAllowed === false
      ? vi.fn().mockRejectedValue(new Error("workspace denied"))
      : vi.fn().mockResolvedValue({ orgId: ORG, workspaceId: WORKSPACE, role: "operator" }),
    resolvePlatformAdmin: vi.fn().mockResolvedValue(
      input?.platformAdminStatus === "ACTIVE_GRANT"
        ? { status: "ACTIVE_GRANT", assignment: { platformAdminAssignmentId: "active" } }
        : { status: "DENIED", reason: "NO_ACTIVE_GRANT" }
    ),
    entitlementRepository: {
      rebuildEffectiveProjection: vi.fn().mockResolvedValue(
        projection(input?.capabilities ?? [])
      ),
    },
    getOrganizationPlan: vi.fn().mockResolvedValue(input?.organizationPlan ?? "free"),
    now: () => NOW,
  };
}

const request = {
  user: { id: USER, email: "user@example.com" },
  orgId: ORG,
  workspaceId: WORKSPACE,
  minRole: "client_viewer" as const,
};

describe("RC-FIX-001 canonical AI Story access", () => {
  it("allows Agency-style access projection for list/read/planning", async () => {
    await expect(authorizeAiStoryAccess(request, dependencies({ capabilities: ["ai_story.access"] })))
      .resolves.toEqual({ allowedBy: "EFFECTIVE_ENTITLEMENT" });
  });

  it("allows Agency plan capability without commercial entitlements", async () => {
    const deps = dependencies({ organizationPlan: "agency" });
    await expect(authorizeAiStoryAccess(request, deps)).resolves.toEqual({
      allowedBy: "AGENCY_PLAN_CAPABILITY",
    });
    expect(deps.entitlementRepository.rebuildEffectiveProjection).not.toHaveBeenCalled();
  });

  it.each(["free", "pro"])("denies %s without ai_story.access", async () => {
    await expect(authorizeAiStoryAccess(request, dependencies()))
      .rejects.toBeInstanceOf(AiStoryAccessDeniedError);
  });

  it("denies a workspace outsider even if an unrelated org projection has access", async () => {
    await expect(authorizeAiStoryAccess(request, dependencies({
      capabilities: ["ai_story.access"],
      workspaceAllowed: false,
    }))).rejects.toThrow("workspace denied");
  });

  it("denies organization entitlement reuse through a mismatched workspace membership", async () => {
    const deps = dependencies({ capabilities: ["ai_story.access"] });
    deps.requireWorkspaceRole.mockResolvedValue({ orgId: crypto.randomUUID() });
    await expect(authorizeAiStoryAccess(request, deps))
      .rejects.toBeInstanceOf(AiStoryAccessDeniedError);
    expect(deps.entitlementRepository.rebuildEffectiveProjection).not.toHaveBeenCalled();
  });

  it("allows only an ACTIVE persistent Platform Admin override", async () => {
    const deps = dependencies({ platformAdminStatus: "ACTIVE_GRANT", workspaceAllowed: false });
    await expect(authorizeAiStoryAccess(request, deps)).resolves.toEqual({
      allowedBy: "ACTIVE_PLATFORM_ADMIN",
    });
    expect(deps.requireWorkspaceRole).not.toHaveBeenCalled();
  });

  it("does not let revoked/denied admin authority bypass membership", async () => {
    await expect(authorizeAiStoryAccess(request, dependencies({
      platformAdminStatus: "DENIED",
      workspaceAllowed: false,
    }))).rejects.toThrow("workspace denied");
  });

  it("ignores forged browser role fields", async () => {
    const forged = { ...request, user: { ...request.user, role: "superadmin" } };
    await expect(authorizeAiStoryAccess(forged, dependencies()))
      .rejects.toBeInstanceOf(AiStoryAccessDeniedError);
  });

  it("keeps access and execute capabilities independent", async () => {
    const accessOnly = projection(["ai_story.access"]);
    await expect(authorizeAiStoryAccess(request, dependencies({ capabilities: ["ai_story.access"] })))
      .resolves.toBeDefined();
    expect(effectiveProjectionHasCapability(accessOnly, "ai_story.execute")).toBe(false);

    await expect(authorizeAiStoryAccess(request, dependencies({ capabilities: ["ai_story.execute"] })))
      .rejects.toBeInstanceOf(AiStoryAccessDeniedError);
  });

  it("returns the stable safe HTTP denial contract", async () => {
    const response = handleApiError(new AiStoryAccessDeniedError());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "AI Story access denied",
      code: "AI_STORY_ACCESS_DENIED",
    });
  });
});
