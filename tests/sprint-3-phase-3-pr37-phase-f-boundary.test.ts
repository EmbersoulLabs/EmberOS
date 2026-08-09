/**
 * Sprint 3 PR 3.7 Phase F — boundary + product bypass + final checklist (always runs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";

const ROOT = process.cwd();

function isPhaseFLiveGateEnabled(env: NodeJS.ProcessEnv = {}): boolean {
  return (
    env.EMBEROS_PR37_PHASE_F_LIVE_GATE === "1" &&
    env.EMBEROS_PR37_PHASE_F_LIVE_CONFIRM === "YES"
  );
}

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

describe("Sprint 3 PR 3.7 Phase F boundaries + bypass", () => {
  it("live gate helper is opt-in and skipped by default", () => {
    expect(existsSync(join(ROOT, "tests/helpers/ai-story-pr37-phase-f-live.ts"))).toBe(
      true
    );
    expect(isPhaseFLiveGateEnabled({})).toBe(false);
    expect(isPhaseFLiveGateEnabled({ EMBEROS_PR37_PHASE_F_LIVE_GATE: "1" })).toBe(
      false
    );
    const helper = read("tests/helpers/ai-story-pr37-phase-f-live.ts");
    expect(helper).toMatch(/runPhaseFLiveFullChainGate/);
    expect(helper).toMatch(/createLiveCanonicalAdapterRegistry|registerSeedanceCanonicalAdapter/);
    expect(helper).toMatch(/createCompilationBackedCanonicalPayloadResolver/);
    expect(helper).not.toMatch(/request\.payload \?\? request\.normalizedPayload \?\? request/);
    expect(helper).toMatch(/registerMinimaxCanonicalAdapter/);
    expect(helper).not.toMatch(/createPhaseCAdapterRegistry\(/);
    expect(helper).not.toMatch(/DeterministicCanonicalTestAdapter/);
  });

  it("exactly one product Execute mutation entrypoint", () => {
    const webApi = collectSources(join(ROOT, "apps/web/src/app/api"))
      .filter((path) => path.replace(/\\/g, "/").endsWith("/execute/route.ts"))
      .map((path) => path.replace(/\\/g, "/"));
    expect(webApi).toEqual([
      expect.stringMatching(
        /campaigns\/\[id\]\/ai-stories\/\[storyId\]\/execution-plans\/\[executionPlanId\]\/execute\/route\.ts$/
      ),
    ]);
    const execute = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"
    );
    expect(execute).toMatch(/authorizeAndExecuteExecutionPlan/);
  });

  it("product bypass: browser never calls runtime internals", () => {
    const webSrc = collectSources(join(ROOT, "apps/web/src/components")).concat(
      collectSources(join(ROOT, "apps/web/src/lib")).filter((p) =>
        p.replace(/\\/g, "/").includes("ai-story-runtime")
      )
    );
    for (const file of webSrc) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/RuntimeAuthorizationService/);
      expect(source).not.toMatch(/SceneSchedulingCoordinator/);
      expect(source).not.toMatch(/processDispatch/);
      expect(source).not.toMatch(/runDeterministicAssemblyRuntime/);
      expect(source).not.toMatch(/FinalStoryResultProjector/);
      expect(source).not.toMatch(/SeedanceCanonicalAdapter|MinimaxCanonicalAdapter/);
    }
    const runtimeGet = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts"
    );
    const fsrGet = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/final-story-result/route.ts"
    );
    expect(runtimeGet).toMatch(/export async function GET/);
    expect(runtimeGet).not.toMatch(/authorizeAndExecuteExecutionPlan/);
    expect(fsrGet).toMatch(/export async function GET/);
    expect(fsrGet).not.toMatch(/FinalStoryResultProjector|acceptOrConverge/);
  });

  it("legacy Execute / Retry / Export / story_execution remain locked", () => {
    expect(PHASE1_EXECUTION_LOCKED).toBeTruthy();
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
    expect(read("packages/queue/src/index.ts")).toContain("assertPhase1ExecutionLocked");
    expect(read("apps/worker/src/processors/index.ts")).toContain(
      "assertPhase1ExecutionLocked"
    );
  });

  it("Sprint 3 final checklist — no Export/Publish/Retry/Regenerate/Cancellation/Video Studio handoff", () => {
    const forbidden = [
      "packages/agents/src/ai-story/export-runtime.ts",
      "packages/agents/src/ai-story/publish-runtime.ts",
      "packages/agents/src/ai-story/retry-runtime.ts",
      "packages/agents/src/ai-story/regenerate-runtime.ts",
      "packages/agents/src/ai-story/cancellation-runtime.ts",
      "packages/agents/src/ai-story/video-studio-handoff.ts",
    ];
    for (const path of forbidden) {
      expect(existsSync(join(ROOT, path))).toBe(false);
    }
    const panel = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");
    expect(panel).not.toMatch(/data-testid=["'](?:export|publish|regenerate|retry|cancel)/i);
    expect(panel).toMatch(/postCanonicalExecute/);
  });

  it("continuation polls live Provider lookups; HTTPS media port exists", () => {
    const continuation = read(
      "packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator.ts"
    );
    expect(continuation).toMatch(/EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS/);
    expect(continuation).toMatch(/mode: "lookup"/);
    const media = read("packages/agents/src/ai-story/assembly-runtime-media-access.ts");
    expect(media).toMatch(/createHttpsProviderMediaAccessPort/);
  });

  it("production payload resolver reconstructs Adapter payload from compilation", async () => {
    const {
      mapCompiledInstructionsToCanonicalScenePayload,
    } = await import(
      "../packages/agents/src/ai-story/canonical-scene-payload-resolver"
    );
    const payload = mapCompiledInstructionsToCanonicalScenePayload({
      instructions: {
        contractVersion: "1",
        capabilityId: "animation-video-generation",
        sceneId: "scene-a",
        sceneOrder: 0,
        purpose: "Neutral product on white table",
        transition: "cut",
        continuityNotes: "Keep silhouette",
        beatIds: ["beat-0"],
        durationMs: 3000,
        shots: [
          {
            shotId: "shot-0",
            order: 0,
            durationMs: 3000,
            cameraType: "medium",
            cameraMovement: "static",
            composition: "centered",
            framing: "subject",
            lensSuggestion: "35mm",
            focus: "subject",
            emotion: "calm",
            information: "hero product",
          },
        ],
        characterReferences: [],
        referencedAssetIds: [],
        worldContinuity: { location: "studio" },
        productIdentityConstraints: ["preserve silhouette"],
      },
      resolution: "480p",
    });
    expect(payload.prompt).toMatch(/Neutral product on white table/);
    expect(payload.resolution).toBe("480p");
    expect(payload.aspectRatio).toBe("9:16");
    expect(payload.assetReferences).toEqual([]);
    expect(payload.identityConstraints).toContain("preserve silhouette");
  });
});
