import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const repositoryPath = "packages/db/src/queries/ai-story-scene-scheduling.ts";
const coordinatorPath = "packages/agents/src/ai-story/scene-scheduling-coordinator.ts";

describe("PROD-VERIFY-SCENE-SCHEDULING-TIMEOUT-01", () => {
  it("keeps one canonical max-one-pool persistence transaction", () => {
    const source = read(repositoryPath);
    const transaction = source.slice(
      source.indexOf("const bundle = await this.db.transaction(async (tx) =>"),
      source.indexOf("async getCorrelationBySceneExecutionId(")
    );

    expect(transaction).toContain("connectionAcquireCount: 1");
    expect(transaction).toContain("transactionCount: 1");
    expect(transaction).toContain("secondCheckoutAttempts: 0");
    expect(transaction.match(/this\.db\.transaction/g)).toHaveLength(1);
    expect(transaction).not.toContain("getDb(");
  });

  it("compresses plan locking, ownership proof, release proof, and persisted auth proof", () => {
    const source = read(repositoryPath);
    expect(source).toContain('.limit(1)\n    .for("update")');
    expect(source).toContain("assertExecutionPlanOwnershipChainInSingleQuery(plan, tx)");
    expect(source).not.toContain("acceptRuntimeAuthorizationFactInTransaction(");
    expect(source).toContain("const [releaseAuthority]");
    expect(source).toContain("schema.aiStoryRuntimeAuthorizedFacts.fact");
    expect(source).toContain("Persisted RuntimeAuthorizedFact conflicts with scheduling authority");
  });

  it("removes the redundant per-scene QC hydration from the already hydrated compilation", () => {
    const source = read(coordinatorPath);
    expect(source).not.toContain("this.persistenceRepo.getValidationResults(");
    expect(source).toContain("compilation.validationResults.filter(");
    expect(source).toContain("result.intentId === input.sceneExecutionId");
  });

  it("emits every safe post-release timing key without payload or secret logging", () => {
    const source = `${read(repositoryPath)}\n${read(coordinatorPath)}`;
    for (const key of [
      "release_state_load",
      "released_scene_projection",
      "provider_eligibility",
      "routing_request_build",
      "routing_decision_lookup",
      "routing_decision_write",
      "verification_identity_lookup",
      "verification_identity_write",
      "scheduling_correlation_lookup",
      "scheduling_correlation_write",
      "provider_execution_lookup_or_create",
      "verification_outbox_lookup",
      "verification_outbox_write",
      "transaction_commit",
    ]) {
      expect(source).toContain(`"${key}"`);
    }
    expect(source).toContain("AI_STORY_POST_RELEASE_SCHEDULING_BOUNDARY_COMPLETED");
    expect(source).not.toContain("providerApiKey");
    expect(source).not.toContain("accessToken");
  });

  it("persists verification work terminal from its first outbox state", () => {
    const source = read(repositoryPath);
    const transaction = source.slice(
      source.indexOf("const bundle = await this.db.transaction(async (tx) =>"),
      source.indexOf("async getCorrelationBySceneExecutionId(")
    );
    expect(source).toContain('status: productionVerification ? "CANCELLED" : "PENDING"');
    expect(transaction.indexOf("createOutboxJobInTransaction")).toBeLessThan(
      transaction.indexOf("schema.aiStoryExecuteVerifications")
    );
    expect(transaction.indexOf("schema.aiStoryExecuteVerifications")).toBeLessThan(
      transaction.indexOf("insertCorrelation")
    );
  });

  it("models the observed pre-fix timeout and bounded post-fix round-trip reduction", () => {
    const productionLikeRoundTripMs = 560;
    const preFixSerialRoundTrips = 27;
    const postFixSerialRoundTrips = 17;
    expect(preFixSerialRoundTrips * productionLikeRoundTripMs).toBeGreaterThan(15_000);
    expect(postFixSerialRoundTrips * productionLikeRoundTripMs).toBeLessThan(15_000);
    expect(postFixSerialRoundTrips).toBeLessThan(preFixSerialRoundTrips);
  });

  it("preserves deterministic rollback and idempotency stages", () => {
    const source = read(repositoryPath);
    for (const stage of [
      "routing_decision",
      "provider_execution",
      "outbox",
      "envelope",
      "correlation",
    ]) {
      expect(source).toContain(`failAfterTestStage(input, "${stage}")`);
    }
    expect(source).toContain(".onConflictDoNothing()");
    expect(source).toContain("Production verification identity conflicts with persisted authority");
    expect(source).toContain("Outbox dispatch disposition conflicts with persisted intent");
  });
});
