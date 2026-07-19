import { describe, expect, it, vi } from "vitest";
import {
  OrganizationAccessError,
  requireOrganizationMembership,
  TenantValidationError,
  type OrganizationMemberRow,
} from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";

const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const userId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function memberRow(
  overrides: Partial<OrganizationMemberRow> &
    Pick<OrganizationMemberRow, "orgId" | "userId" | "role">
): OrganizationMemberRow {
  return {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("isUuid", () => {
  it("accepts valid UUIDs", () => {
    expect(isUuid(orgA)).toBe(true);
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("requireOrganizationMembership (real authorization path)", () => {
  it("rejects malformed orgId with VALIDATION_ERROR before lookup", async () => {
    const lookup = vi.fn(async () => null);

    await expect(
      requireOrganizationMembership("not-a-uuid", userId, "member", lookup)
    ).rejects.toMatchObject({
      name: "TenantValidationError",
      code: "VALIDATION_ERROR",
      message: "orgId must be a valid UUID",
    });

    expect(lookup).not.toHaveBeenCalled();
  });

  it("Org A member cannot create / access Org B workspace", async () => {
    const lookup = vi.fn(async (requestedOrgId: string, requestedUserId: string) => {
      if (requestedOrgId === orgA && requestedUserId === userId) {
        return memberRow({ orgId: orgA, userId, role: "owner" });
      }
      return null;
    });

    await expect(
      requireOrganizationMembership(orgA, userId, "member", lookup)
    ).resolves.toMatchObject({ orgId: orgA, userId, role: "owner" });

    await expect(
      requireOrganizationMembership(orgB, userId, "member", lookup)
    ).rejects.toBeInstanceOf(OrganizationAccessError);

    await expect(
      requireOrganizationMembership(orgB, userId, "member", lookup)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Not a member of this organization",
    });

    expect(lookup).toHaveBeenCalledWith(orgB, userId);
  });

  it("does not grant access from membership in a different organization", async () => {
    const lookup = vi.fn(async (requestedOrgId: string) => {
      if (requestedOrgId === orgA) {
        return memberRow({ orgId: orgA, userId, role: "admin" });
      }
      return null;
    });

    await expect(
      requireOrganizationMembership(orgB, userId, "member", lookup)
    ).rejects.toBeInstanceOf(OrganizationAccessError);
  });

  it("TenantValidationError is distinct from OrganizationAccessError", () => {
    const validation = new TenantValidationError("orgId must be a valid UUID");
    const forbidden = new OrganizationAccessError(
      "Not a member of this organization",
      "FORBIDDEN"
    );
    expect(validation.code).toBe("VALIDATION_ERROR");
    expect(forbidden.code).toBe("FORBIDDEN");
    expect(validation).not.toBeInstanceOf(OrganizationAccessError);
  });
});
