import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptBootstrapPlatformAdminGrant,
  resolvePlatformAdminAccess,
  type PlatformAdminRepository,
} from "@ceo-agent/db";
import type { PlatformAdminAssignment, PlatformAdminRevocation } from "@ceo-agent/shared";
import { platformAdminPostAuthDestination } from "../apps/web/src/lib/platform-admin-auth";
import { organizationSlugCandidates } from "../apps/web/src/lib/organization-provisioning";

const assignment: PlatformAdminAssignment = {
  contractVersion: "1",
  platformAdminAssignmentId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  platformRole: "PLATFORM_SUPER_ADMIN",
  status: "ACTIVE",
  grantedAt: "2026-09-26T00:00:00.000Z",
  grantedByUserId: null,
  reason: "test bootstrap",
  integrityHash: `sha256:${"a".repeat(64)}`,
};

function repository(input: { active?: PlatformAdminAssignment | null; any?: boolean } = {}): PlatformAdminRepository {
  return {
    countAcceptedGrants: async () => input.any ? 1 : 0,
    hasAnyAcceptedGrant: async () => input.any ?? Boolean(input.active),
    getGrantByAssignmentId: async () => input.active ?? null,
    getActiveGrantForUser: async () => input.active ?? null,
    listGrantsForUser: async () => input.active ? [input.active] : [],
    acceptOrConvergeGrant: async (value) => ({ value, replayed: false }),
    acceptBootstrapGrant: async (value) => ({ value, replayed: false }),
    acceptOrConvergeRevocation: async (value: PlatformAdminRevocation) => ({ value, replayed: false }),
    getRevocationByAssignmentId: async () => null,
  };
}

describe("Super Admin authority convergence", () => {
  it("routes only an ACTIVE persistent grant to /admin", async () => {
    const active = await resolvePlatformAdminAccess({
      userId: assignment.userId,
      email: "admin@example.test",
      repository: repository({ active: assignment }),
      allowlist: new Set(),
    });
    expect(platformAdminPostAuthDestination(active)).toBe("/admin");

    const bootstrapOnly = await resolvePlatformAdminAccess({
      userId: assignment.userId,
      email: "admin@example.test",
      repository: repository(),
      allowlist: new Set(["admin@example.test"]),
    });
    expect(bootstrapOnly.status).toBe("BOOTSTRAP_ELIGIBLE");
    expect(platformAdminPostAuthDestination(bootstrapOnly)).toBe("/workspaces");
  });

  it("does not let an email allowlist independently authorize after bootstrap closes", async () => {
    const resolution = await resolvePlatformAdminAccess({
      userId: assignment.userId,
      email: "admin@example.test",
      repository: repository({ any: true }),
      allowlist: new Set(["admin@example.test"]),
    });
    expect(resolution).toEqual({ status: "DENIED", reason: "BOOTSTRAP_CLOSED" });
  });

  it("keeps first-admin bootstrap server-owned and one-time", async () => {
    const accepted = await acceptBootstrapPlatformAdminGrant({
      userId: assignment.userId,
      email: "admin@example.test",
      reason: "bounded test bootstrap",
      grantedAt: "2026-09-26T00:00:00.000Z",
      repository: repository(),
      allowlist: new Set(["admin@example.test"]),
    });
    expect(accepted.platformRole).toBe("PLATFORM_SUPER_ADMIN");
    await expect(acceptBootstrapPlatformAdminGrant({
      userId: assignment.userId,
      email: "admin@example.test",
      reason: "must fail",
      repository: repository({ any: true }),
      allowlist: new Set(["admin@example.test"]),
    })).rejects.toThrow(/BOOTSTRAP_CLOSED|denied/i);
  });

  it("allocates deterministic collision-free fallback slugs per user", () => {
    const a = organizationSlugCandidates({ name: "EmberSoul Labs", requestedSlug: "embersoullabs", userId: assignment.userId });
    const b = organizationSlugCandidates({ name: "EmberSoul Labs", requestedSlug: "embersoullabs", userId: "33333333-3333-4333-8333-333333333333" });
    expect(a[0]).toBe("embersoullabs");
    expect(a[1]).not.toBe(b[1]);
    expect(a[1]).toMatch(/^embersoullabs-[a-f0-9]{10}$/);
  });

  it("keeps Platform Admin and Organization authority tables server-only", () => {
    const sql = readFileSync(resolve("packages/db/sql/platform-admin-control-plane-security-v1.sql"), "utf8");
    for (const table of ["platform_admin_grants", "platform_admin_revocations", "admin_audit_events", "organizations", "organization_members"]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM anon, authenticated`);
    }
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i);
  });

  it("contains no public bootstrap endpoint or legacy runtime email authorization", () => {
    const middleware = readFileSync(resolve("apps/web/src/middleware.ts"), "utf8");
    const legacyGuard = readFileSync(resolve("apps/web/src/lib/require-superadmin.ts"), "utf8");
    expect(middleware).not.toContain("isSuperAdminEmail");
    expect(legacyGuard).toContain("requirePlatformAdmin");
    expect(readFileSync(resolve("apps/web/src/app/login/page.tsx"), "utf8")).toContain('window.location.href = "/auth/continue"');
  });
});
