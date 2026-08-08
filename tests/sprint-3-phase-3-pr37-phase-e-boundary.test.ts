/**
 * Sprint 3 PR 3.7 Phase E — boundary verification (always runs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS,
  ProductRuntimeProjectionSchema,
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

describe("Sprint 3 PR 3.7 Phase E runtime read + browser boundaries", () => {
  it("adds runtime GET, FSR GET, derivation, and browser viewer", () => {
    expect(
      existsSync(
        join(
          ROOT,
          "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts"
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        join(
          ROOT,
          "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/final-story-result/route.ts"
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        join(ROOT, "packages/agents/src/ai-story/derive-product-runtime-projection.ts")
      )
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "apps/web/src/components/ai-story/FinalStoryResultViewer.tsx"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "apps/web/src/components/ai-story/StoryRuntimePanel.tsx"))
    ).toBe(true);
    expect(read("packages/agents/src/ai-story/index.ts")).toContain(
      'export * from "./derive-product-runtime-projection"'
    );
  });

  it("runtime GET is read-only and does not mutate runtime", () => {
    const route = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts"
    );
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function POST/);
    expect(route).toMatch(/deriveProductRuntimeProjection/);
    expect(route).not.toMatch(/authorizeAndExecuteExecutionPlan/);
    expect(route).not.toMatch(/SceneSchedulingCoordinator|scheduleAuthorizedScene/);
    expect(route).not.toMatch(/SceneProviderWorkerRuntime|runDeterministicAssemblyRuntime/);
    expect(route).not.toMatch(/FinalStoryResultProjector|acceptOrConverge/);
  });

  it("FSR GET mints playback URL without persisting it or projecting", () => {
    const route = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/final-story-result/route.ts"
    );
    expect(route).toMatch(/export async function GET/);
    expect(route).not.toMatch(/export async function POST/);
    expect(route).toMatch(/mintFinalStoryPlaybackUrl/);
    expect(route).not.toMatch(/FinalStoryResultProjector|acceptOrConverge/);
    expect(route).not.toMatch(/authorizeAndExecuteExecutionPlan/);
    const mint = read("apps/web/src/lib/ai-story-final-story-playback.ts");
    expect(mint).toMatch(/createSignedUrl/);
    expect(mint).not.toMatch(/insert\(|update\(|acceptOrConverge/);
  });

  it("browser UI only calls canonical Execute HTTP route", () => {
    const panel = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");
    const client = read("apps/web/src/lib/ai-story-runtime-client.ts");
    expect(panel).toMatch(/postCanonicalExecute/);
    expect(client).toMatch(/\/execute/);
    expect(panel).not.toMatch(/@ceo-agent\/agents|@ceo-agent\/db/);
    expect(client).not.toMatch(/@ceo-agent\/agents|@ceo-agent\/db/);
    expect(panel).not.toMatch(/data-testid=["']retry|Regenerate|Export|Publish/);
    expect(read("apps/web/src/components/ai-story/FinalStoryResultViewer.tsx")).not.toMatch(
      /Export|Publish|Regenerate|Retry/
    );
  });

  it("exactly one product Execute mutation entrypoint remains", () => {
    const webApi = collectSources(join(ROOT, "apps/web/src/app/api"))
      .filter((path) => path.replace(/\\/g, "/").endsWith("/execute/route.ts"))
      .map((path) => path.replace(/\\/g, "/"));
    expect(webApi).toEqual([
      expect.stringMatching(
        /campaigns\/\[id\]\/ai-stories\/\[storyId\]\/execution-plans\/\[executionPlanId\]\/execute\/route\.ts$/
      ),
    ]);
  });

  it("does not introduce Export / Publish / Retry / Phase F live provider gates", () => {
    const forbidden = [
      "packages/agents/src/ai-story/export-runtime.ts",
      "packages/agents/src/ai-story/publish-runtime.ts",
      "packages/agents/src/ai-story/retry-runtime.ts",
      "packages/agents/src/ai-story/regenerate-runtime.ts",
      "packages/agents/src/ai-story/cancellation-runtime.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
    expect(PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS).toContain("providerId");
    expect(
      ProductRuntimeProjectionSchema.safeParse({
        contractVersion: "1",
        executionPlanId: "00000000-0000-4000-8000-000000000001",
        runtimeAuthorizationId: null,
        status: "READY_FOR_EXECUTION",
        runtimeProjectionVersion: 1,
        requiredSceneCount: 1,
        succeededSceneCount: 0,
        failedSceneCount: 0,
        reconciliationCount: 0,
        assemblyState: "NONE",
        hasFinalStoryResult: false,
        canExecute: true,
        safeFailureSummary: null,
        derivedAt: "2026-08-09T00:00:00.000Z",
      }).success
    ).toBe(true);
  });

  it("legacy mutation routes remain PHASE1 locked", () => {
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
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/export/route.ts"
      )
    ).toContain("assertPhase1ExecutionLocked");
  });
});
