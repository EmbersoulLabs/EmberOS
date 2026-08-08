/**
 * Sprint 3 PR 3.7 Phase D — boundary verification (always runs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CanonicalExecuteRequestSchema,
  PHASE1_EXECUTION_LOCKED,
} from "@ceo-agent/shared";

const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function collectSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectSources(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) files.push(full);
  }
  return files;
}

describe("Sprint 3 PR 3.7 Phase D Canonical Execute boundaries", () => {
  it("adds canonical Execute service + API route", () => {
    expect(
      existsSync(
        join(ROOT, "packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts")
      )
    ).toBe(true);
    expect(
      existsSync(
        join(
          ROOT,
          "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"
        )
      )
    ).toBe(true);
    expect(read("packages/agents/src/ai-story/index.ts")).toContain(
      'export * from "./authorize-and-execute-execution-plan"'
    );
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
  });

  it("Execute request rejects Provider/Worker authority fields", () => {
    expect(CanonicalExecuteRequestSchema.safeParse({}).success).toBe(true);
    expect(
      CanonicalExecuteRequestSchema.safeParse({ providerId: "seedance" }).success
    ).toBe(false);
    expect(
      CanonicalExecuteRequestSchema.safeParse({ ready: true }).success
    ).toBe(false);
    expect(
      CanonicalExecuteRequestSchema.safeParse({ sceneIds: ["x"] }).success
    ).toBe(false);
  });

  it("legacy Execute / Retry / Regenerate / Export remain locked", () => {
    expect(read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/route.ts")).toContain(
      "assertPhase1ExecutionLocked"
    );
    expect(
      read(
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/retry/route.ts"
      )
    ).toContain("assertPhase1ExecutionLocked");
    expect(
      read(
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/[jobId]/regenerate/route.ts"
      )
    ).toContain("assertPhase1ExecutionLocked");
    expect(
      read(
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/regenerate-all/route.ts"
      )
    ).toContain("assertPhase1ExecutionLocked");
    expect(
      read(
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/export/route.ts"
      )
    ).toContain("assertPhase1ExecutionLocked");
    expect(read("packages/queue/src/index.ts")).toContain("assertPhase1ExecutionLocked");
    expect(read("apps/worker/src/processors/index.ts")).toContain(
      "assertPhase1ExecutionLocked"
    );
  });

  it("does not introduce Export / Publish; Phase E browser viewer is allowed", () => {
    const forbidden = [
      "packages/agents/src/ai-story/export-runtime.ts",
      "packages/agents/src/ai-story/publish-runtime.ts",
      "apps/web/src/app/(app)/campaigns/[id]/ai-stories/[storyId]/runtime/page.tsx",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    // Phase E may introduce FinalStoryResultViewer; Phase D forbade it until then.
    expect(
      existsSync(join(ROOT, "apps/web/src/components/ai-story/FinalStoryResultViewer.tsx"))
    ).toBe(true);
    const route = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"
    );
    expect(route).toMatch(/authorizeAndExecuteExecutionPlan/);
    expect(route).not.toMatch(/SceneProviderWorkerRuntime|runDeterministicAssemblyRuntime/);
    expect(route).not.toMatch(/FinalStoryResultProjector|adapter\.submit/);
    expect(route).not.toMatch(/assertPhase1ExecutionLocked/);
  });

  it("assertPhase1ExecutionLocked remains globally fail-closed", () => {
    const lock = read("packages/shared/src/ai-story-phase1-execution-lock.ts");
    expect(lock).toMatch(/throw new Phase1ExecutionLockedError/);
    expect(lock).not.toMatch(/process\.env|UNLOCK|bypass/i);
  });

  it("selective unlock is a narrow no-op path marker (not global state)", () => {
    const source = read(
      "packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts"
    );
    expect(source).toMatch(/enterCanonicalProductExecutePath/);
    expect(source).toMatch(/Intentional no-op/);
    expect(source).not.toMatch(/globalThis|process\.env\.|PHASE1_EXECUTION_UNLOCKED/);
    expect(source).not.toMatch(/disablePhase1|unlockPhase1/i);
    expect(read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/route.ts")).toContain(
      "assertPhase1ExecutionLocked"
    );
  });

  it("no second product Execute alias routes", () => {
    const webApi = collectSources(join(ROOT, "apps/web/src/app/api"))
      .filter((path) => path.replace(/\\/g, "/").endsWith("/execute/route.ts"))
      .map((path) => path.replace(/\\/g, "/"));
    expect(webApi).toEqual([
      expect.stringMatching(
        /campaigns\/\[id\]\/ai-stories\/\[storyId\]\/execution-plans\/\[executionPlanId\]\/execute\/route\.ts$/
      ),
    ]);
  });
});
