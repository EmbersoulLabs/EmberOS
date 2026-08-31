import { z } from "zod";

/**
 * Non-secret capability fact published by the canonical Provider executor.
 * Credential material and credential identifiers are deliberately absent.
 */
export const ProviderExecutorCapabilityAuthoritySchema = z
  .object({
    providerId: z.string().min(1),
    adapterVersion: z.string().min(1),
    productEnabled: z.boolean(),
    executorRegistered: z.boolean(),
    executorReady: z.boolean(),
    capabilityIds: z.array(z.string().min(1)).min(1),
    supportedModels: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type ProviderExecutorCapabilityAuthority = z.infer<
  typeof ProviderExecutorCapabilityAuthoritySchema
>;

export const ProviderExecutorAuthoritySchema = z
  .object({
    contractVersion: z.literal("1.0.0"),
    executorKind: z.literal("REMOTE_CANONICAL_WORKER_EXECUTOR"),
    environment: z.string().min(1),
    workerDeploymentId: z.string().min(1),
    publishedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    capabilities: z.array(ProviderExecutorCapabilityAuthoritySchema),
  })
  .strict();

export type ProviderExecutorAuthority = z.infer<
  typeof ProviderExecutorAuthoritySchema
>;

