import { OpenAIJsonCompatibilityAdapter } from "./openai-json-adapter";
import { SeedanceVideoAdapter } from "./seedance-video-adapter";
import { FluxImageAdapter } from "./flux-image-adapter";
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
    reference: { uri: string } | string
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
  const adapters: ProviderAdapter[] = [
    new OpenAIJsonCompatibilityAdapter(payloadResolver),
    new SeedanceVideoAdapter(payloadResolver),
    new FluxImageAdapter(payloadResolver),
  ];
  for (const adapter of adapters) {
    if (adapter.capabilities().size === 0) continue;
    registry.register(adapter);
  }
  return registry;
}
