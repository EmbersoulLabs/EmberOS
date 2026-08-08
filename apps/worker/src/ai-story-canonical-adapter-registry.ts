/**
 * Sprint 3 PR 3.7 Phase C — production Canonical Adapter registry factory.
 * Registers Seedance + MiniMax when configured. Never accepts client Provider choice.
 */
import {
  CanonicalAdapterRegistry,
  registerMinimaxCanonicalAdapter,
  registerSeedanceCanonicalAdapter,
  loadMinimaxAdapterConfig,
  loadSeedanceAdapterConfig,
  type CanonicalAdapterRegistry as Registry,
  type MinimaxPayloadResolver,
  type SeedancePayloadResolver,
} from "@ceo-agent/agents";
import { ExecutionEnvelopeRepository } from "@ceo-agent/db";

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
 * Resolve canonical scene payloads from persisted Execution Envelopes.
 * Adapter mapping reads normalizedPayloadReference; we load the Envelope and
 * return its stored canonicalRequest payload body (no credentials).
 */
export function createEnvelopeBackedCanonicalPayloadResolver(
  envelopes: Pick<
    ExecutionEnvelopeRepository,
    "getEnvelopeByPayloadReference"
  > = new ExecutionEnvelopeRepository()
): SeedancePayloadResolver & MinimaxPayloadResolver {
  return {
    async resolve(reference) {
      const uri = reference.uri;
      const envelope =
        (await envelopes.getEnvelopeByPayloadReference(uri)) ??
        (await envelopes.getEnvelopeByPayloadReference(reference.contentHash));
      if (!envelope) {
        throw new Error(`Canonical payload Envelope not found for ${uri}`);
      }
      const request = envelope.canonicalRequest as Record<string, unknown>;
      const nested = request.payload ?? request.normalizedPayload ?? request;
      return nested;
    },
  };
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
  const payloadResolver =
    options.seedancePayloadResolver ??
    options.minimaxPayloadResolver ??
    createEnvelopeBackedCanonicalPayloadResolver();

  try {
    const seedance = loadSeedanceAdapterConfig(env, { requireEnabled });
    registerSeedanceCanonicalAdapter(registry, {
      config: seedance,
      payloadResolver,
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
      payloadResolver,
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
