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
  type SeedancePayloadResolver,
} from "@ceo-agent/agents";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionEnvelopeRepository,
} from "@ceo-agent/db";

export type ProductionAiStoryAdapterRegistryOptions = {
  /** Injected registry for tests (deterministic adapters). */
  readonly registry?: Registry;
  readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** When true, missing Provider config throws (strict production). */
  readonly requireEnabled?: boolean;
  readonly seedancePayloadResolver?: SeedancePayloadResolver;
  readonly minimaxPayloadResolver?: MinimaxPayloadResolver;
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
  options: { readonly resolution?: string } = {}
): SeedancePayloadResolver & MinimaxPayloadResolver {
  return createCompilationBackedCanonicalPayloadResolver({
    getEnvelopeByPayloadReference: (payloadReference) =>
      envelopes.getEnvelopeByPayloadReference(payloadReference),
    getCompilationByExecutionPlanId: (executionPlanId) =>
      persistence.getByExecutionPlanId(executionPlanId),
    resolution: options.resolution,
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
  // Minimal-cost defaults when product instructions omit resolution.
  const seedanceResolver =
    options.seedancePayloadResolver ??
    createEnvelopeBackedCanonicalPayloadResolver(
      new ExecutionEnvelopeRepository(),
      new AiStorySceneExecutionPersistenceRepository(),
      { resolution: "480p" }
    );
  const minimaxResolver =
    options.minimaxPayloadResolver ??
    createEnvelopeBackedCanonicalPayloadResolver(
      new ExecutionEnvelopeRepository(),
      new AiStorySceneExecutionPersistenceRepository(),
      { resolution: "768P" }
    );

  try {
    const seedance = loadSeedanceAdapterConfig(env, { requireEnabled });
    registerSeedanceCanonicalAdapter(registry, {
      config: seedance,
      payloadResolver: seedanceResolver,
    });
  } catch (error) {
    if (requireEnabled) throw error;
    console.warn(
      "[ai-story-adapters] Seedance not registered:",
      error instanceof Error ? error.message : error
    );
  }

  try {
    const minimax = loadMinimaxAdapterConfig(env, { requireEnabled });
    registerMinimaxCanonicalAdapter(registry, {
      config: minimax,
      payloadResolver: minimaxResolver,
    });
  } catch (error) {
    if (requireEnabled) throw error;
    console.warn(
      "[ai-story-adapters] MiniMax not registered:",
      error instanceof Error ? error.message : error
    );
  }

  return registry;
}
