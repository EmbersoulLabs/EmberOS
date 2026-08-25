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
});
