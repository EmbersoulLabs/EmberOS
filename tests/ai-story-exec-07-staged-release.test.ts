import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("EXEC-07 durable staged Scene release", () => {
  it("persists an explicit release authority for every authorized Scene", () => {
    const schema = read("packages/db/src/schema/index.ts");
    expect(schema).toContain("aiStorySceneReleaseStates");
    expect(read("packages/db/src/queries/ai-story-scene-release.ts")).toContain("AUTHORIZED_NOT_RELEASED");
    expect(existsSync(join(root, "packages/db/sql/ai-story-staged-release-v1.sql"))).toBe(true);
  });

  it("initial Execute schedules only the canonical first Scene", () => {
    const source = read("packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts");
    expect(source).toContain("releases.initialize");
    expect(source).toContain("row.sceneOrder === 1");
    expect(source).toContain("[initialScene.sceneExecutionId]");
    expect(source).not.toContain("for (const sceneExecutionId of orderedSceneExecutionIds)");
  });

  it("denies transactional scheduling without an exact durable RELEASED authority", () => {
    const repository = read("packages/db/src/queries/ai-story-scene-scheduling.ts");
    const releaseGuard = repository.indexOf("const [releaseAuthority]");
    const providerExecutionWrite = repository.indexOf("createProviderExecution(", releaseGuard);
    const outboxWrite = repository.indexOf("createOutboxJobInTransaction", releaseGuard);

    expect(releaseGuard).toBeGreaterThan(-1);
    expect(repository).toContain("schema.aiStorySceneReleaseStates.releaseState, \"RELEASED\"");
    expect(repository).toContain("Durable RELEASED Scene authority is required");
    expect(providerExecutionWrite).toBeGreaterThan(releaseGuard);
    expect(outboxWrite).toBeGreaterThan(releaseGuard);
  });

  it("fails before scheduling when release-ledger initialization does not converge", () => {
    const source = read("packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts");
    const initialize = source.indexOf("await releases.initialize");
    const conflict = source.indexOf("STAGED_RELEASE_CONFLICT", initialize);
    const schedule = source.indexOf("scheduling.scheduleAuthorizedScene", initialize);

    expect(initialize).toBeGreaterThan(-1);
    expect(conflict).toBeGreaterThan(initialize);
    expect(schedule).toBeGreaterThan(conflict);
  });

  it("remaining release is server-derived and exact-approval gated", () => {
    const repo = read("packages/db/src/queries/ai-story-scene-release.ts");
    expect(repo).toContain("pg_advisory_xact_lock");
    expect(repo).toContain('decision, "APPROVED"');
    expect(repo).toContain('status, "SUCCEEDED"');
    expect(repo).toContain("gateProviderAttemptId");
    expect(repo).toContain("FIRST_SCENE_EXACT_ATTEMPT_REQUIRED");
    expect(repo).toContain("FIRST_SCENE_RETRY_OR_EXECUTION_IN_FLIGHT");
    expect(repo).toContain("providerAttempts.attemptId");
    expect(repo).toContain("result.providerExecutionId");
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/release-remaining-scenes/route.ts");
    expect(route).toContain("resolveAuthorizedExecutionPlan");
    expect(route).toContain("authorizeAiStoryExecution");
    expect(route).not.toMatch(/sceneExecutionId|providerId|accessMode|settlementMode/);
  });

  it("uses the canonical next-Scene-only action for the R3 operator flow", () => {
    const repo = read("packages/db/src/queries/ai-story-scene-release.ts");
    const service = read("packages/agents/src/ai-story/release-next-eligible-scene.ts");
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/release-next-scene/route.ts");
    const projection = read("packages/agents/src/ai-story/derive-product-runtime-projection.ts");
    const panel = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");

    expect(repo).toContain("releaseNextEligible");
    expect(repo).toContain("rows.find((row) => row.releaseState === \"AUTHORIZED_NOT_RELEASED\")");
    expect(repo).toContain("pg_advisory_xact_lock");
    expect(repo).toContain("row.sceneOrder < candidate.sceneOrder");
    const nextOnlyMethod = repo.slice(repo.indexOf("async releaseNextEligible"));
    expect(nextOnlyMethod).not.toContain("for (const row of held)");
    expect(service.match(/scheduleAuthorizedScene\(/g)).toHaveLength(1);
    expect(route).toContain("releaseNextEligibleScene");
    expect(route).not.toMatch(/sceneOrder.*request|sceneExecutionId.*request/);
    expect(projection).toContain("everyPriorSceneApproved");
    expect(projection).toContain("nextEligibleSceneOrder");
    expect(panel).toContain('data-testid="release-next-scene"');
    expect(panel).toContain("Release Scene");
    expect(panel).not.toContain('data-testid="release-remaining-scenes"');
  });

  it("keeps provider routing and unrelated frozen products outside the change", () => {
    const service = read("packages/agents/src/ai-story/release-remaining-scenes.ts");
    expect(service).not.toMatch(/seedance|minimax|photoroom|stripe|quota|publishing/i);
  });

  it("keeps the production Execute route on the single staged authority", () => {
    const route = read("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts");
    const agentsBarrel = read("packages/agents/src/index.ts");
    const aiStoryBarrel = read("packages/agents/src/ai-story/index.ts");

    expect(route).toContain("authorizeAndExecuteExecutionPlan");
    expect(agentsBarrel).toContain('export * from "./ai-story"');
    expect(aiStoryBarrel).toContain('export * from "./authorize-and-execute-execution-plan"');
    expect(route.match(/authorizeAndExecuteExecutionPlan\(/g)).toHaveLength(1);
  });

  it("resolves billable authority before release and always converges scheduling", () => {
    const source = read("packages/agents/src/ai-story/release-next-eligible-scene.ts");
    const commercial = source.indexOf("resolveStagedReleaseCommercialAuthorization");
    const release = source.indexOf("repo.releaseNextEligible", commercial);
    const schedule = source.indexOf("coordinator.scheduleAuthorizedScene", release);

    expect(commercial).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(commercial);
    expect(schedule).toBeGreaterThan(release);
    expect(source.slice(release, schedule)).not.toContain("released.newlyReleased) {");
    expect(source).toContain("commercialAuthorizationId,");
  });

  it("persists commercial authorization in immutable scheduling lineage", () => {
    const contract = read("packages/shared/src/ai-story-scene-scheduling.ts");
    const coordinator = read("packages/agents/src/ai-story/scene-scheduling-coordinator.ts");

    expect(contract).toContain("commercialAuthorizationId: z.string().uuid().nullable().optional()");
    expect(coordinator).toContain("commercialAuthorizationId: input.commercialAuthorizationId ?? null");
    expect(coordinator).toContain("commercialAuthorizationId: input.commercialAuthorizationId,");
  });

  it("keeps the certification convergence operation before paid execution", () => {
    const script = read("apps/worker/scripts/converge-certification-staged-release-dispatch.ts");
    expect(script).toContain("CERTIFICATION_NO_DISPATCH_HOLD_REQUIRED");
    expect(script).toContain("ProviderExecutionDispatcher");
    expect(script).not.toContain("ProviderExecutionWorker");
    expect(script).not.toContain("reserveForSceneExecution");
    expect(script).not.toContain("providerAttempts).values");
    expect(script).toContain("providerInvoked: false");
  });
});
