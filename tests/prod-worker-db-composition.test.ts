import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderWorkerResultFinalizerBridge,
  type CanonicalAdapterRegistry,
} from "@ceo-agent/agents";
import { closeDb, getDb } from "@ceo-agent/db";
import {
  createProductionAiStoryContinuationCoordinator,
  runAiStoryProviderWorkerCycle,
} from "../apps/worker/src/ai-story-provider-worker-cycle";

const originalDatabaseUrl = process.env.DATABASE_URL;
const roots: string[] = [];

afterEach(async () => {
  await closeDb();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runtimeRoots() {
  const root = await mkdtemp(join(tmpdir(), "emberos-prod-worker-db-fix-"));
  roots.push(root);
  return {
    artifactRoot: join(root, "artifacts"),
    durableObjectRoot: join(root, "objects"),
  };
}

describe("production AI Story worker DB composition", () => {
  it("preserves ProviderLedgerRepository method binding through the finalizer bridge", async () => {
    class BoundLedger {
      readonly db = { authority: "canonical-db" };
      async listAttempts() {
        if (this.db.authority !== "canonical-db") throw new Error("DB binding lost");
        return [];
      }
      async appendAttempt() {
        throw new Error("not reached");
      }
    }

    const bridge = new ProviderWorkerResultFinalizerBridge({
      ledger: new BoundLedger() as never,
      outbox: {
        async findJob() { return null; },
        async releaseLease() { return undefined; },
        async claimOrRenewForFinalization() { return undefined; },
      },
    });

    await expect(
      (bridge as unknown as {
        resolveAttemptNumber(
          bundle: { providerExecutionId: string; correlation: { retryGeneration?: number } },
          attemptId: string
        ): Promise<number>;
      }).resolveAttemptNumber(
        { providerExecutionId: "execution", correlation: {} },
        "attempt"
      )
    ).resolves.toBe(1);
  });

  it("constructs the production continuation runtime from one explicit DB authority", async () => {
    const rootsForTest = await runtimeRoots();
    const fakeDb = {} as ReturnType<typeof getDb>;
    const adapters = { resolve: vi.fn(() => undefined) } as unknown as CanonicalAdapterRegistry;
    await expect(
      createProductionAiStoryContinuationCoordinator({
        ...rootsForTest,
        db: fakeDb,
        adapters,
        assemblyEngineSnapshotHash:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      })
    ).resolves.toBeTruthy();
    expect(adapters.resolve).not.toHaveBeenCalled();
  });

  it("fails closed deterministically when the production DB authority is unavailable", async () => {
    await closeDb();
    delete process.env.DATABASE_URL;
    await expect(
      createProductionAiStoryContinuationCoordinator({
        ...(await runtimeRoots()),
        assemblyEngineSnapshotHash:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      })
    ).rejects.toThrow("DATABASE_URL is not set");
  });

  it("completes an empty production worker cycle without constructing or invoking adapters", async () => {
    const dispatchNext = vi.fn(async () => ({
      status: "NO_JOB" as const,
      timestamp: new Date(0).toISOString(),
    }));
    const adapters = { resolve: vi.fn(() => undefined) } as unknown as CanonicalAdapterRegistry;
    await expect(
      runAiStoryProviderWorkerCycle({
        db: {} as ReturnType<typeof getDb>,
        adapters,
        dispatchNext,
      })
    ).resolves.toEqual({ dispatchStatus: "NO_JOB" });
    expect(dispatchNext).toHaveBeenCalledWith({ ownership: "AI_STORY_SCENE" });
    expect(adapters.resolve).not.toHaveBeenCalled();
  });
});
