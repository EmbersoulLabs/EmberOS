import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ApprovedAnimationPackageAuthorityError,
  certifyApprovedAnimationPackageRows,
  schema,
} from "@ceo-agent/db";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";

type PackageRow = typeof schema.aiStoryAnimationPackages.$inferSelect;

function row(
  id: string,
  patch: Partial<PackageRow> = {}
): PackageRow {
  return {
    id,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    campaignId: "00000000-0000-4000-8000-000000000003",
    storyId: "00000000-0000-4000-8000-000000000004",
    storyVersionId: "00000000-0000-4000-8000-000000000005",
    status: "ready_for_execution",
    payload: animationPackageFixture("ready_for_execution"),
    consistencyReport: { consistent: true, issues: [], links: [] },
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    approvedAt: new Date("2026-01-01T00:00:00Z"),
    approvedBy: "00000000-0000-4000-8000-000000000006",
    ...patch,
  };
}

describe("current approved Animation Package authority", () => {
  it("certifies zero or one package without timestamp selection", () => {
    expect(certifyApprovedAnimationPackageRows([])).toBeNull();
    const canonical = row("00000000-0000-4000-8000-000000000010");
    expect(certifyApprovedAnimationPackageRows([canonical])?.id).toBe(canonical.id);

    const newer = row("00000000-0000-4000-8000-000000000011", {
      createdAt: new Date("2026-09-01T00:00:00Z"),
      approvedAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(() => certifyApprovedAnimationPackageRows([canonical, newer])).toThrowError(
      expect.objectContaining({
        code: "CURRENT_APPROVED_ANIMATION_PACKAGE_AUTHORITY_AMBIGUOUS",
      })
    );
  });

  it("fails closed for invalid payload, row/payload mismatch, and missing evidence", () => {
    expect(() => certifyApprovedAnimationPackageRows([row(crypto.randomUUID(), { payload: {} })]))
      .toThrow(ApprovedAnimationPackageAuthorityError);
    expect(() => certifyApprovedAnimationPackageRows([
      row(crypto.randomUUID(), { payload: animationPackageFixture("review") }),
    ])).toThrowError(expect.objectContaining({ code: "ANIMATION_PACKAGE_APPROVAL_STATE_MISMATCH" }));
    expect(() => certifyApprovedAnimationPackageRows([
      row(crypto.randomUUID(), {
        status: "review",
        payload: animationPackageFixture("ready_for_execution"),
      }),
    ])).toThrowError(expect.objectContaining({ code: "ANIMATION_PACKAGE_APPROVAL_STATE_MISMATCH" }));
    expect(() => certifyApprovedAnimationPackageRows([
      row(crypto.randomUUID(), { approvedAt: null }),
    ])).toThrowError(expect.objectContaining({ code: "APPROVED_ANIMATION_PACKAGE_EVIDENCE_MISSING" }));
  });

  it("keeps execution authority free of latest-approved selection", () => {
    const discovery = readFileSync(
      resolve(process.cwd(), "apps/web/src/lib/ai-story-execution-plan-discovery.ts"),
      "utf8"
    );
    const orchestrator = readFileSync(
      resolve(process.cwd(), "packages/agents/src/ai-story/story-execution-orchestrator.ts"),
      "utf8"
    );
    for (const source of [discovery, orchestrator]) {
      expect(source).toContain("resolveApprovedAnimationPackageForStoryVersion");
      expect(source).not.toMatch(/aiStoryAnimationPackages\.approvedAt[\s\S]{0,300}limit\(1\)/);
    }
    const approval = readFileSync(
      resolve(process.cwd(), "apps/web/src/lib/ai-story-planning-service.ts"),
      "utf8"
    );
    expect(approval).toContain("ANIMATION_PACKAGE_STORY_VERSION_NOT_CURRENT");
    expect(approval).toContain("pg_advisory_xact_lock");
    expect(approval).toContain("ANIMATION_PACKAGE_ALREADY_APPROVED_FOR_STORY_VERSION");
    expect(approval).not.toMatch(/PhotoRoom|enqueuePhotoSceneExtract|Seedance|MiniMax/);
  });

  it("declares the same partial unique index in schema and ordered SQL", () => {
    const schemaSource = readFileSync(
      resolve(process.cwd(), "packages/db/src/schema/index.ts"),
      "utf8"
    );
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "packages/db/sql/ai-story-current-approved-animation-package-authority-v1.sql"
      ),
      "utf8"
    );
    const index = "ai_story_animation_packages_one_ready_per_story_version_idx";
    expect(schemaSource).toContain(index);
    expect(migration).toContain(index);
    expect(migration).toMatch(/where status = 'ready_for_execution'/i);
    expect(migration).toMatch(/having count\(\*\) > 1/i);
    expect(migration).not.toMatch(/^\s*(delete|update)\b/im);
  });
});
