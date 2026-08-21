import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProductionVerificationStepTimeoutError,
  runProductionVerificationStep,
} from "../apps/web/src/lib/ai-story-production-verification-fixture";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const assemblyPath = "packages/db/src/queries/ai-story-execution-plan-assembly.ts";

describe("PROD-VERIFY-ASSEMBLY-CREATE-TIMEOUT-01", () => {
  it("reuses the active assembly transaction for creator authorization", () => {
    const source = read(assemblyPath);
    expect(source).not.toContain("getWorkspaceMembership(");
    expect(source).toContain(
      "assertCreatorAuthorized(plan.workspaceId, input.createdBy, tx)"
    );
    expect(source).toContain("db: QueryDb");
    expect(source).toContain("schema.workspaceMembers");
    expect(source).toContain("schema.workspaceMembers.workspaceId, workspaceId");
    expect(source).toContain("schema.workspaceMembers.userId, userId");
  });

  it("keeps workspace role and cross-workspace authorization fail closed", () => {
    const source = read(assemblyPath);
    expect(source).toContain("ROLE_HIERARCHY[member.role as WorkspaceRole]");
    expect(source).toContain("ROLE_HIERARCHY[CREATOR_MIN_ROLE]");
    expect(source).toContain("Creator is not a member of this workspace");
    expect(source).toContain("Creator lacks required workspace role");
  });

  it("preserves deterministic idempotent assembly replay", () => {
    const source = read(assemblyPath);
    expect(source).toContain("buildAssemblyDefinitionFingerprint");
    expect(source).toContain(".onConflictDoNothing()");
    expect(source).toContain("replayed: true");
    expect(source).toContain("replayed: false");
  });

  it("has no sibling global checkout reachable from the assembly transaction", () => {
    const source = read(assemblyPath);
    const transactionBody = source.slice(
      source.indexOf("return this.db.transaction(async (tx) =>"),
      source.indexOf("async getAssemblyDefinition(")
    );
    expect(transactionBody).not.toContain("getDb(");
    expect(transactionBody).not.toContain("getWorkspaceMembership(");
    expect(transactionBody.match(/this\.db\./g)).toHaveLength(1);
  });

  it("bounds an assembly DB stall and leaves provider scheduling unreachable", async () => {
    const timings: Array<{
      step: string;
      status: "PASS" | "FAIL" | "TIMEOUT";
      durationMs: number;
    }> = [];
    await expect(
      runProductionVerificationStep(
        "assembly_definition",
        () => new Promise<never>(() => undefined),
        { timeoutMs: 5, timings }
      )
    ).rejects.toBeInstanceOf(ProductionVerificationStepTimeoutError);
    expect(timings[0]).toMatchObject({
      step: "assembly_definition",
      status: "TIMEOUT",
    });

    const fixture = read(
      "apps/web/src/lib/ai-story-production-verification-fixture.ts"
    );
    expect(fixture.indexOf('step("assembly_definition"')).toBeLessThan(
      fixture.indexOf('step("canonical_verification_execute"')
    );
    expect(fixture).toContain(
      'runProductionVerificationStep("failure_classification"'
    );
    expect(fixture).toContain("externalAiCalls: 0");
  });
});
