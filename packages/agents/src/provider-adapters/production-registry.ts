import { OpenAIJsonCompatibilityAdapter } from "./openai-json-adapter";
import { SeedanceVideoAdapter } from "./seedance-video-adapter";
import {
  DeterministicSeedanceTestAdapter,
  testProvidersEnabled,
} from "./deterministic-seedance-test-adapter";
import type { ProviderAdapter, ProviderPayloadResolver } from "./contracts";
import { ProviderAdapterRegistry } from "../provider-router/adapter-registry";

export type { ProviderPayloadResolver };

/** In-memory payload store for execution references. */
export class MemoryPayloadResolver implements ProviderPayloadResolver {
  private readonly payloads = new Map<string, unknown>();

  put(reference: string, payload: unknown): void {
    this.payloads.set(reference, payload);
  }

  async resolve(
    reference: { uri: string } | string,
    _context?: unknown
  ): Promise<unknown> {
    const key = typeof reference === "string" ? reference : reference.uri;
    if (!this.payloads.has(key)) {
      throw new Error(`Payload reference not found: ${key}`);
    }
    return this.payloads.get(key);
  }
}

export function createProductionProviderRegistry(
  payloadResolver: ProviderPayloadResolver
): ProviderAdapterRegistry {
  const registry = new ProviderAdapterRegistry();
  const seedance = new SeedanceVideoAdapter(payloadResolver);
  const adapters: ProviderAdapter[] = [
    new OpenAIJsonCompatibilityAdapter(payloadResolver),
    seedance,
  ];
  // When Seedance is undeclared (no API key) and test providers are enabled,
  // register a deterministic animation-video adapter so E2E does not skip.
  if (seedance.capabilities().size === 0 && testProvidersEnabled()) {
    adapters.push(new DeterministicSeedanceTestAdapter(payloadResolver));
  }
  for (const adapter of adapters) {
    if (adapter.capabilities().size === 0) continue;
    registry.register(adapter);
  }
  return registry;
}
