import { describe, expect, it } from "vitest";
import { evaluateMigration, loadGuardManifest, type MigrationIntent } from "../scripts/hybrid-migration-guards";

const manifest = loadGuardManifest();

function intent(overrides: Partial<MigrationIntent> = {}): MigrationIntent {
  return {
    ticketId: "EMBEROS-TEST-MIGRATION-01",
    wave: 1,
    changeKind: "HYBRID_MIGRATION",
    reason: "Bounded deterministic guard test",
    sourceAuthority: "origin/staging",
    targetModule: "Asset Library",
    allowedSourcePaths: ["apps/web/src/components/asset-library/**"],
    allowedTargetPaths: ["apps/web/src/components/asset-library/**"],
    protectedDomainsExpectedToChange: [],
    protectedDomainsMustNotChange: ["AI_STORY_RUNTIME"],
    requiredTests: [],
    blueprintBaselineId: manifest.blueprintBaselineId,
    ...overrides,
  };
}

describe("hybrid migration guard", () => {
  it("allows a declared Asset Library-only Wave 1 migration", () => {
    const result = evaluateMigration({
      changedFiles: ["apps/web/src/components/asset-library/AssetCard.tsx"],
      intent: intent(),
      manifest,
    });
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects an old Staging AI Story runtime surface", () => {
    const result = evaluateMigration({
      changedFiles: ["packages/agents/src/ai-story/provider-worker.ts"],
      intent: intent({ allowedTargetPaths: ["packages/agents/src/ai-story/**"] }),
      manifest,
    });
    expect(result.errors).toContain("FORBIDDEN_STAGING_SURFACE:packages/agents/src/ai-story/provider-worker.ts");
  });

  it("rejects a protected AI Story change without an explicit declaration", () => {
    const result = evaluateMigration({
      changedFiles: ["packages/agents/src/ai-story/index.ts"],
      intent: intent({ sourceAuthority: "origin/main", allowedTargetPaths: ["packages/agents/src/ai-story/**"], protectedDomainsMustNotChange: [] }),
      manifest,
    });
    expect(result.errors).toContain("PROTECTED_DOMAIN_UNDECLARED:AI_STORY_RUNTIME");
  });

  it("rejects a declared protected change when its certified tests are missing", () => {
    const result = evaluateMigration({
      changedFiles: ["packages/agents/src/ai-story/index.ts"],
      intent: intent({ sourceAuthority: "origin/main", allowedTargetPaths: ["packages/agents/src/ai-story/**"], protectedDomainsExpectedToChange: ["AI_STORY_RUNTIME"], protectedDomainsMustNotChange: [] }),
      manifest,
    });
    expect(result.errors.some((error) => error.startsWith("PROTECTED_DOMAIN_REQUIRED_TEST_MISSING:AI_STORY_RUNTIME"))).toBe(true);
  });

  it("allows a bounded protected security repair with the required suites", () => {
    const result = evaluateMigration({
      changedFiles: ["apps/web/src/lib/auth-remember.ts"],
      intent: intent({
        wave: 0,
        changeKind: "SECURITY_REPAIR",
        sourceAuthority: "SECURITY_AUDIT",
        targetModule: "Authentication",
        allowedSourcePaths: [],
        allowedTargetPaths: ["apps/web/src/lib/auth-remember.ts"],
        protectedDomainsExpectedToChange: ["AUTHORIZATION"],
        protectedDomainsMustNotChange: [],
        requiredTests: ["tests/auth-remember-security.test.ts", "e2e/auth-remember-security.spec.ts"],
      }),
      manifest,
    });
    expect(result).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects an unknown changed path", () => {
    const result = evaluateMigration({ changedFiles: ["mystery/new.surface"], intent: intent({ allowedTargetPaths: ["mystery/**"] }), manifest });
    expect(result.errors).toContain("UNCLASSIFIED_CHANGED_FILE:mystery/new.surface");
  });

  it("rejects new AI Story Skill architecture before Wave 6", () => {
    const result = evaluateMigration({
      changedFiles: ["apps/web/src/components/asset-library/AssetCard.tsx"],
      addedLines: ["const sceneVisualRole = input.role;"],
      intent: intent(),
      manifest,
    });
    expect(result.errors).toContain("AI_STORY_SKILL_FREEZE_VIOLATION:sceneVisualRole");
  });

  it("allows only the exact Wave 6 Platform Admin recovery paths for the certified ticket", () => {
    const changedFiles = [
      "package.json",
      "packages/db/src/index.ts",
      "packages/db/src/queries/platform-admin-break-glass.ts",
      "packages/db/src/queries/platform-admin-management.ts",
      "scripts/wave6-staging-platform-admin-recovery-02.ts",
      "config/hybrid-migration-guards.json",
      "scripts/hybrid-migration-guards.ts",
      "tests/hybrid-migration-guards.test.ts",
      "tests/wave6-platform-admin-management.test.ts",
      "tests/wave6-platform-admin-recovery.integration.test.ts",
      ".migration-intents/EMBEROS-WAVE6-STAGING-PLATFORM-ADMIN-BREAK-GLASS-RECOVERY-02.json",
    ];
    const result = evaluateMigration({
      changedFiles,
      intent: intent({
        ticketId: "EMBEROS-WAVE6-STAGING-PLATFORM-ADMIN-BREAK-GLASS-RECOVERY-02",
        wave: 6,
        changeKind: "SECURITY_REPAIR",
        sourceAuthority: "SECURITY_AUDIT",
        targetModule: "Platform Admin Recovery / Post-Bootstrap Grant Management",
        allowedSourcePaths: [],
        allowedTargetPaths: changedFiles,
        protectedDomainsExpectedToChange: ["PLATFORM_ADMIN"],
        protectedDomainsMustNotChange: [],
        requiredTests: ["tests/sprint-3-phase-3-pr37-phase-e-http-security.integration.test.ts"],
      }),
      manifest,
    });
    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(result.protectedDomainsTouched).toEqual(["PLATFORM_ADMIN"]);
  });

  it.each([
    "packages/db/src/queries/ai-story-unapproved.ts",
    "packages/db/src/queries/campaign-unapproved.ts",
    "packages/db/src/queries/billing-unapproved.ts",
    "scripts/unrelated-script.ts",
    "apps/web/src/components/Unrelated.tsx",
    "apps/worker/src/unrelated.ts",
  ])("rejects nearby Wave 6 path %s", (changedFile) => {
    const result = evaluateMigration({
      changedFiles: [changedFile],
      intent: intent({
        ticketId: "EMBEROS-WAVE6-STAGING-PLATFORM-ADMIN-BREAK-GLASS-RECOVERY-02",
        wave: 6,
        changeKind: "SECURITY_REPAIR",
        sourceAuthority: "SECURITY_AUDIT",
        targetModule: "Platform Admin Recovery / Post-Bootstrap Grant Management",
        allowedSourcePaths: [],
        allowedTargetPaths: ["**"],
        protectedDomainsExpectedToChange: [],
        protectedDomainsMustNotChange: [],
        requiredTests: [],
      }),
      manifest,
    });
    expect(result.errors).toContain(`WAVE_6_SCOPE_VIOLATION:${changedFile}`);
  });

  it("does not grant the exact recovery paths to a different Wave 6 ticket", () => {
    const changedFile = "packages/db/src/queries/platform-admin-management.ts";
    const result = evaluateMigration({
      changedFiles: [changedFile],
      intent: intent({
        ticketId: "EMBEROS-WAVE6-UNRELATED-SECURITY-01",
        wave: 6,
        changeKind: "SECURITY_REPAIR",
        sourceAuthority: "SECURITY_AUDIT",
        targetModule: "Unrelated",
        allowedSourcePaths: [],
        allowedTargetPaths: [changedFile],
        protectedDomainsExpectedToChange: ["PLATFORM_ADMIN"],
        protectedDomainsMustNotChange: [],
        requiredTests: ["tests/sprint-3-phase-3-pr37-phase-e-http-security.integration.test.ts"],
      }),
      manifest,
    });
    expect(result.errors).toContain(`WAVE_6_SCOPE_VIOLATION:${changedFile}`);
  });
});
