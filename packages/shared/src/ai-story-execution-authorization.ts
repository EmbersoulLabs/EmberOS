/**
 * EXEC-03 — AI Story product execution authorization contract.
 *
 * Product authorization is separate from commercial settlement.
 * This module is contracts only: no Stripe, no credit mutation, no provider calls.
 */
import { z } from "zod";

export const AI_STORY_EXECUTION_AUTHORIZATION_POLICY_VERSION =
  "ai-story-exec-03.v1" as const;

export const AiStoryExecutionAccessModeSchema = z.enum(["ops", "commercial"]);
export type AiStoryExecutionAccessMode = z.infer<
  typeof AiStoryExecutionAccessModeSchema
>;

export const AiStoryExecutionSettlementModeSchema = z.enum(["none", "credits"]);
export type AiStoryExecutionSettlementMode = z.infer<
  typeof AiStoryExecutionSettlementModeSchema
>;

export const AiStoryExecutionAuthorizedBySchema = z.enum([
  "ACTIVE_PLATFORM_ADMIN",
  "AGENCY_PLAN_CAPABILITY",
]);
export type AiStoryExecutionAuthorizedBy = z.infer<
  typeof AiStoryExecutionAuthorizedBySchema
>;

/**
 * Reconstructable evidence persisted with RuntimeAuthorizedFact JSON.
 * Not part of RuntimeAuthorizedFact integrity hash.
 * settlementMode=none does NOT mean providerCost=0.
 */
export const AiStoryExecutionAuthorizationEvidenceSchema = z
  .object({
    accessMode: AiStoryExecutionAccessModeSchema,
    settlementMode: AiStoryExecutionSettlementModeSchema,
    authorizedBy: AiStoryExecutionAuthorizedBySchema,
    policyVersion: z.literal(AI_STORY_EXECUTION_AUTHORIZATION_POLICY_VERSION),
    reason: z.string().trim().min(1),
    providerCostAccounting: z.literal("ALLOWED"),
  })
  .strict();

export type AiStoryExecutionAuthorizationEvidence = z.infer<
  typeof AiStoryExecutionAuthorizationEvidenceSchema
>;

export type AiStoryExecutionAuthorization = AiStoryExecutionAuthorizationEvidence & {
  readonly allowed: true;
};

export const AI_STORY_EXECUTION_DENIED = "AI_STORY_EXECUTION_DENIED" as const;

export class AiStoryExecutionDeniedError extends Error {
  readonly code = AI_STORY_EXECUTION_DENIED;
  readonly status = 403;

  constructor(message = "AI Story execution denied") {
    super(message);
    this.name = "AiStoryExecutionDeniedError";
  }
}

export function toAiStoryExecutionAuthorizationEvidence(
  authorization: AiStoryExecutionAuthorization
): AiStoryExecutionAuthorizationEvidence {
  return AiStoryExecutionAuthorizationEvidenceSchema.parse({
    accessMode: authorization.accessMode,
    settlementMode: authorization.settlementMode,
    authorizedBy: authorization.authorizedBy,
    policyVersion: authorization.policyVersion,
    reason: authorization.reason,
    providerCostAccounting: authorization.providerCostAccounting,
  });
}
