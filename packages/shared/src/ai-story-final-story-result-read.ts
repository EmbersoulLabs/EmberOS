/**
 * Sprint 3 PR 3.7 Phase E — Final Story Result browser read-model.
 *
 * Success-only. Signed playback URL is minted at GET time and never persisted.
 * Client-safe: does not import server-only persistence modules.
 */
import { z } from "zod";

export const FINAL_STORY_RESULT_READ_CONTRACT_VERSION = "1" as const;
/** Mirrors FINAL_STORY_RESULT_PERSISTENCE_CONTRACT_VERSION without importing server entry. */
export const FINAL_STORY_RESULT_READ_PERSISTENCE_VERSION = "1" as const;
export const FINAL_STORY_RESULT_READ_PROJECTION_VERSION = "1" as const;
export const FINAL_STORY_RESULT_PLAYBACK_TTL_SECONDS = 60 * 15;

/**
 * Product-safe FSR read payload. playbackUrl is ephemeral transport only.
 */
export const FinalStoryResultReadModelSchema = z.object({
  contractVersion: z.literal(FINAL_STORY_RESULT_READ_CONTRACT_VERSION),
  persistenceContractVersion: z.literal(
    FINAL_STORY_RESULT_READ_PERSISTENCE_VERSION
  ),
  projectionVersion: z.literal(FINAL_STORY_RESULT_READ_PROJECTION_VERSION),
  finalStoryResultId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  assemblyJobId: z.string().uuid(),
  assemblyArtifactId: z.string().uuid(),
  mediaType: z.literal("video/mp4"),
  durationMs: z.number().int().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  contentHash: z.string().min(1),
  acceptedAt: z.string().datetime(),
  /** Short-lived signed read URL. Never written to FSR persistence. */
  playbackUrl: z.string().url(),
  playbackUrlExpiresInSeconds: z.number().int().positive(),
});

export type FinalStoryResultReadModel = z.infer<
  typeof FinalStoryResultReadModelSchema
>;

export const FinalStoryResultDeliveryModelSchema = z.object({
  downloadUrl: z.string().url(),
  filename: z.string().min(1).max(180),
  expiresInSeconds: z.number().int().positive().max(60 * 60),
});

export type FinalStoryResultDeliveryModel = z.infer<
  typeof FinalStoryResultDeliveryModelSchema
>;
