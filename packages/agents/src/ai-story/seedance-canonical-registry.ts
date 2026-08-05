/**
 * Sprint 3 PR 3.4A — Canonical Adapter registry wiring for Seedance only.
 * Business modules should resolve via registry, not import Seedance HTTP.
 */
import { CanonicalAdapterRegistry } from "./canonical-provider-adapter";
import {
  SeedanceCanonicalAdapter,
  type SeedanceCanonicalAdapterOptions,
} from "./seedance-canonical-adapter";
import {
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_PROVIDER_ID,
} from "./seedance-capability";
import { createPr33TestAdapterRegistry } from "./canonical-provider-test-adapters";

export function registerSeedanceCanonicalAdapter(
  registry: CanonicalAdapterRegistry,
  options: SeedanceCanonicalAdapterOptions
): CanonicalAdapterRegistry {
  registry.register(
    SEEDANCE_PROVIDER_ID,
    SEEDANCE_ADAPTER_VERSION,
    () => new SeedanceCanonicalAdapter(options)
  );
  return registry;
}

export function createSeedanceCanonicalAdapterRegistry(
  options: SeedanceCanonicalAdapterOptions
): CanonicalAdapterRegistry {
  const registry = new CanonicalAdapterRegistry();
  return registerSeedanceCanonicalAdapter(registry, options);
}

/**
 * Test registry: Seedance production adapter factory + optional PR33 test provider.
 * Registers only Seedance from this PR surface.
 */
export function createPr34aTestAdapterRegistry(
  options: SeedanceCanonicalAdapterOptions
): CanonicalAdapterRegistry {
  const registry = createPr33TestAdapterRegistry("accepted_async");
  registerSeedanceCanonicalAdapter(registry, options);
  return registry;
}
