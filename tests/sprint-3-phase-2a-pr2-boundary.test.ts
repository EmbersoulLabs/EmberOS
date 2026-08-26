/**
 * Sprint 3 Phase 2A PR2 — regression: execution stays FAIL CLOSED and
 * Persistence Service source never reaches forbidden runtime surfaces.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  assertPhase1ExecutionLocked,
  Phase1ExecutionLockedError,
} from "@ceo-agent/shared";
import {
  enqueueStoryExecution,
} from "../packages/queue/src/index";
import {
  regenerateSingleExecutionOutput,
  retryExecutionJob,
  runExecutionJob,
  startExecutionJob,
} from "../packages/agents/src/ai-story/story-execution-orchestrator";

describe("Sprint 3 Phase 2A PR2 boundary regression", () => {
  it("keeps Phase 1 execution lock fail-closed", async () => {
    expect(() => assertPhase1ExecutionLocked()).toThrow(Phase1ExecutionLockedError);
    await expect(Promise.resolve().then(() => startExecutionJob({} as never))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
      status: 409,
    });
    await expect(Promise.resolve().then(() => runExecutionJob("job"))).rejects.toMatchObject({
      code: PHASE1_EXECUTION_LOCKED,
    });
    await expect(
      Promise.resolve().then(() => retryExecutionJob(null as never, "job", "workspace"))
    ).rejects.toMatchObject({ code: PHASE1_EXECUTION_LOCKED });
    await expect(
      Promise.resolve().then(() => regenerateSingleExecutionOutput({} as never))
    ).rejects.toMatchObject({ code: PHASE1_EXECUTION_LOCKED });
    await expect(
      Promise.resolve().then(() => enqueueStoryExecution({} as never))
    ).rejects.toMatchObject({ code: PHASE1_EXECUTION_LOCKED });
  });

  it("Persistence Service source never imports forbidden runtime modules", () => {
    const serviceSource = readFileSync(
      resolve("packages/agents/src/ai-story/scene-execution-persistence-service.ts"),
      "utf8"
    );
    expect(serviceSource).not.toMatch(/from ["']@ceo-agent\/queue["']/);
    expect(serviceSource).not.toMatch(/provider-outbox|provider_outbox/);
    expect(serviceSource).not.toMatch(/CanonicalProviderRouter|ProviderRouter/);
    expect(serviceSource).not.toMatch(/seedance|minimax|upscale/i);
    expect(serviceSource).not.toMatch(/from ["'].*billing/);
    expect(serviceSource).not.toContain("assertPhase1ExecutionLocked");
    expect(serviceSource).toContain("AiStorySceneExecutionPersistenceRepository");
    expect(serviceSource).toContain("PHASE1_EXECUTION_LOCKED");
    expect(serviceSource).toContain("executionAllowed: false");
  });

  it("Generate Review route does not add a Persist Plan endpoint", () => {
    const reviewRoute = readFileSync(
      resolve(
        "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution/review/route.ts"
      ),
      "utf8"
    );
    expect(reviewRoute).toContain("createGenerateReview");
    expect(reviewRoute).toContain("persistenceStatus");
    expect(reviewRoute).toContain("executionAllowed");
    expect(reviewRoute).toContain("executionLockCode");
    expect(reviewRoute.toLowerCase()).not.toContain("persist plan");
  });

  it("UI exposes product-facing generation review and not legacy execution actions", () => {
    const page = readFileSync(
      resolve(
        "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx"
      ),
      "utf8"
    );
    expect(page).toContain("Generation review ready");
    expect(page).toContain("Generate Review");
    expect(page).not.toContain("Confirm Execute");
    expect(page).not.toContain("Regenerate One");
    expect(page).not.toContain("Export Approved");
  });
});
