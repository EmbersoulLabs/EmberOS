/**
 * EXEC-05 — load AI Story provider-attempt cost rows from existing ledger tables.
 * Additive read. No commercial settlement. No new cost table.
 */
import { eq } from "drizzle-orm";
import {
  reconstructAiStoryProviderSpend,
  type AiStoryProviderAttemptCostRecord,
  type AiStoryProviderSpendProjection,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

function failureCodeFromJson(failure: unknown): string | null {
  if (!failure || typeof failure !== "object" || Array.isArray(failure)) return null;
  const code = (failure as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : null;
}

export async function listAiStoryProviderAttemptCostRecords(
  executionPlanId: string,
  db: Db = getDb()
): Promise<AiStoryProviderAttemptCostRecord[]> {
  const rows = await db
    .select({
      storyId: schema.aiStorySceneSchedulingCorrelations.storyId,
      sceneExecutionId: schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
      executionPlanId: schema.aiStorySceneSchedulingCorrelations.executionPlanId,
      providerExecutionId:
        schema.aiStorySceneSchedulingCorrelations.providerExecutionId,
      attemptId: schema.providerAttempts.attemptId,
      attemptNumber: schema.providerAttempts.attemptNumber,
      providerId: schema.providerAttempts.providerId,
      modelVersion: schema.providerAttempts.modelVersion,
      providerRequestId: schema.providerAttempts.providerRequestId,
      status: schema.providerAttempts.status,
      startedAt: schema.providerAttempts.startedAt,
      completedAt: schema.providerAttempts.completedAt,
      createdAt: schema.providerAttempts.createdAt,
      failure: schema.providerAttempts.failure,
      cost: schema.providerAttemptCosts.cost,
      usage: schema.providerAttemptUsage.usage,
    })
    .from(schema.aiStorySceneSchedulingCorrelations)
    .innerJoin(
      schema.providerAttempts,
      eq(
        schema.providerAttempts.executionId,
        schema.aiStorySceneSchedulingCorrelations.providerExecutionId
      )
    )
    .leftJoin(
      schema.providerAttemptCosts,
      eq(schema.providerAttemptCosts.attemptId, schema.providerAttempts.attemptId)
    )
    .leftJoin(
      schema.providerAttemptUsage,
      eq(schema.providerAttemptUsage.attemptId, schema.providerAttempts.attemptId)
    )
    .where(
      eq(schema.aiStorySceneSchedulingCorrelations.executionPlanId, executionPlanId)
    );

  return rows.map((row) => ({
    storyId: row.storyId,
    sceneExecutionId: row.sceneExecutionId,
    executionPlanId: row.executionPlanId,
    providerExecutionId: row.providerExecutionId,
    attemptId: row.attemptId,
    attemptNumber: row.attemptNumber,
    providerId: row.providerId,
    modelVersion: row.modelVersion,
    providerRequestId: row.providerRequestId,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    failureCode: failureCodeFromJson(row.failure),
    cost: row.cost ?? null,
    usage: row.usage ?? null,
  }));
}

export async function reconstructAiStoryProviderSpendForPlan(
  executionPlanId: string,
  db: Db = getDb()
): Promise<AiStoryProviderSpendProjection> {
  const records = await listAiStoryProviderAttemptCostRecords(executionPlanId, db);
  return reconstructAiStoryProviderSpend(records).projection;
}
