/**
 * Sprint 3 PR 3.4B — Canonical Adapter registry wiring for MiniMax only.
 * Business modules should resolve via registry, not import MiniMax HTTP.
 */
import { CanonicalAdapterRegistry } from "./canonical-provider-adapter";
import {
  MinimaxCanonicalAdapter,
  type MinimaxCanonicalAdapterOptions,
} from "./minimax-canonical-adapter";
import {
  MINIMAX_ADAPTER_VERSION,
  MINIMAX_PROVIDER_ID,
} from "./minimax-capability";
import { createPr33TestAdapterRegistry } from "./canonical-provider-test-adapters";

export function registerMinimaxCanonicalAdapter(
  registry: CanonicalAdapterRegistry,
  options: MinimaxCanonicalAdapterOptions
): CanonicalAdapterRegistry {
  registry.register(
    MINIMAX_PROVIDER_ID,
    MINIMAX_ADAPTER_VERSION,
    () => new MinimaxCanonicalAdapter(options)
  );
  return registry;
}

export function createMinimaxCanonicalAdapterRegistry(
  options: MinimaxCanonicalAdapterOptions
): CanonicalAdapterRegistry {
  const registry = new CanonicalAdapterRegistry();
  return registerMinimaxCanonicalAdapter(registry, options);
}

/**
 * Test registry: MiniMax production adapter factory + optional PR33 test provider.
 * Registers only MiniMax from this PR surface.
 */
export function createPr34bTestAdapterRegistry(
  options: MinimaxCanonicalAdapterOptions
): CanonicalAdapterRegistry {
  const registry = createPr33TestAdapterRegistry("accepted_async");
  registerMinimaxCanonicalAdapter(registry, options);
  return registry;
}
