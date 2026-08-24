/**
 * Sprint 3 PR 3.7 Phase C — production Canonical Adapter registry factory.
 * Registers Seedance + MiniMax when configured. Never accepts client Provider choice.
 */
import {
  CanonicalAdapterRegistry,
  createCompilationBackedCanonicalPayloadResolver,
  registerMinimaxCanonicalAdapter,
  registerSeedanceCanonicalAdapter,
  loadMinimaxAdapterConfig,
  loadSeedanceAdapterConfig,
  type CanonicalAdapterRegistry as Registry,
  type MinimaxPayloadResolver,
  type MinimaxAssetAccessResolver,
  type SeedancePayloadResolver,
  type SeedanceAssetAccessResolver,
} from "@ceo-agent/agents";
import { getAiProviderConfig, isAiProviderReady } from "@ceo-agent/shared";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionEnvelopeRepository,
} from "@ceo-agent/db";
import {
  certifyWorkerProductVisualAuthority,
  createWorkerProviderAssetAccessResolver,
} from "./ai-story-provider-asset-access";

export type ProductionAiStoryAdapterRegistryOptions = {
  /** Injected registry for tests (deterministic adapters). */
  readonly registry?: Registry;
  readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** When true, missing Provider config throws (strict production). */
  readonly requireEnabled?: boolean;
  readonly seedancePayloadResolver?: SeedancePayloadResolver;
  readonly minimaxPayloadResolver?: MinimaxPayloadResolver;
  readonly assetAccessResolver?: SeedanceAssetAccessResolver & MinimaxAssetAccessResolver;
};

/**
 * Resolve canonical scene payloads from persisted Execution Envelopes +
 * frozen Scene compilation instructions (Adapter-ready prompt/duration/shots).
 */
export function createEnvelopeBackedCanonicalPayloadResolver(
  envelopes: Pick<
    ExecutionEnvelopeRepository,
    "getEnvelopeByPayloadReference"
  > = new ExecutionEnvelopeRepository(),
  persistence: Pick<
    AiStorySceneExecutionPersistenceRepository,
    "getByExecutionPlanId"
  > = new AiStorySceneExecutionPersistenceRepository(),
  options: {
    readonly resolution?: string;
    readonly productGroundedProviderMode?: "FIRST_FRAME_I2V";
    readonly productGroundedProviderModeCertified?: boolean;
  } = {}
): SeedancePayloadResolver & MinimaxPayloadResolver {
  return createCompilationBackedCanonicalPayloadResolver({
    getEnvelopeByPayloadReference: (payloadReference) =>
      envelopes.getEnvelopeByPayloadReference(payloadReference),
    getCompilationByExecutionPlanId: (executionPlanId) =>
      persistence.getByExecutionPlanId(executionPlanId),
    certifyProductVisualAuthority: certifyWorkerProductVisualAuthority,
    resolution: options.resolution,
    ...(options.productGroundedProviderMode
      ? { productGroundedProviderMode: options.productGroundedProviderMode }
      : {}),
    ...(options.productGroundedProviderModeCertified !== undefined
      ? {
          productGroundedProviderModeCertified:
            options.productGroundedProviderModeCertified,
        }
      : {}),
  });
}

/**
 * Build the production AI Story Canonical Adapter registry.
 * Unregistered Adapters fail closed at Worker resolve time (no silent fallback).
 */
export function createProductionAiStoryCanonicalAdapterRegistry(
  options: ProductionAiStoryAdapterRegistryOptions = {}
): CanonicalAdapterRegistry {
  if (options.registry) return options.registry;

  const registry = new CanonicalAdapterRegistry();
  const env = options.env ?? process.env;
  const requireEnabled = options.requireEnabled === true;
  const assetAccessResolver =
    options.assetAccessResolver ?? createWorkerProviderAssetAccessResolver();
  // Minimal-cost defaults when product instructions omit resolution.
  const seedanceResolver =
    options.seedancePayloadResolver ??
    createEnvelopeBackedCanonicalPayloadResolver(
      new ExecutionEnvelopeRepository(),
      new AiStorySceneExecutionPersistenceRepository(),
      {
        resolution: "480p",
        productGroundedProviderMode: "FIRST_FRAME_I2V",
        productGroundedProviderModeCertified: true,
      }
    );
  const minimaxResolver =
    options.minimaxPayloadResolver ??
    createEnvelopeBackedCanonicalPayloadResolver(
      new ExecutionEnvelopeRepository(),
      new AiStorySceneExecutionPersistenceRepository(),
      { resolution: "768P" }
    );

  try {
    const config = getAiProviderConfig(env);
    if (config.providers.seedance.enabled && isAiProviderReady(config, "seedance")) {
      const seedance = loadSeedanceAdapterConfig(env, { requireEnabled: true });
      registerSeedanceCanonicalAdapter(registry, {
        config: seedance,
        payloadResolver: seedanceResolver,
        assetAccessResolver,
      });
    } else {
      console.warn("[ai-story-adapters] Seedance not registered: disabled or not executable");
    }
  } catch (error) {
    if (requireEnabled) throw error;
    console.warn(
      "[ai-story-adapters] Seedance not registered:",
      error instanceof Error ? error.message : error
    );
  }

  try {
    const config = getAiProviderConfig(env);
    if (config.providers.minimax.enabled && isAiProviderReady(config, "minimax")) {
      const minimax = loadMinimaxAdapterConfig(env, { requireEnabled: true });
      registerMinimaxCanonicalAdapter(registry, {
        config: minimax,
        payloadResolver: minimaxResolver,
        assetAccessResolver,
      });
    } else {
      console.warn("[ai-story-adapters] MiniMax not registered: disabled or not executable");
    }
  } catch (error) {
    if (requireEnabled) throw error;
    console.warn(
      "[ai-story-adapters] MiniMax not registered:",
      error instanceof Error ? error.message : error
    );
  }

  return registry;
}
