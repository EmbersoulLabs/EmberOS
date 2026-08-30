/**
 * Canonical Execute ProviderRouter for Scene Scheduling.
 *
 * Registers routing-only capability declarations solely for providers that
 * are eligible under ProviderExecutionEligibility. Source-code adapters that
 * are disabled or not executable never enter the candidate set.
 *
 * Does NOT perform Provider HTTP. Worker Canonical Adapters remain the sole
 * Provider submit/lookup authority after Dispatch.
 */
import type { ProviderAdapter, ProviderCapabilityDeclaration } from "../provider-adapters/contracts";
import { ProviderAdapterRegistry } from "../provider-router/adapter-registry";
import {
  CanonicalProviderRouter,
  type ProviderRouter,
} from "../provider-router/provider-router";
import {
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_PROVIDER_ID,
  buildSeedanceCapabilityDeclaration,
} from "./seedance-capability";
import {
  MINIMAX_ADAPTER_VERSION,
  MINIMAX_PROVIDER_ID,
  buildMinimaxCapabilityDeclaration,
} from "./minimax-capability";
import {
  type CanonicalVideoProviderId,
  type ProviderExecutionEligibilityInput,
  routableCanonicalVideoProviderIds,
} from "./provider-execution-eligibility";

function routingOnlyAdapter(
  providerId: string,
  adapterVersion: string,
  capability: ProviderCapabilityDeclaration
): ProviderAdapter {
  return {
    providerId,
    adapterVersion,
    capabilities() {
      return new Set([capability]);
    },
    async execute() {
      throw new Error(
        `${providerId} routing-only adapter cannot execute; Worker Canonical Adapter owns Provider HTTP`
      );
    },
  };
}

const ROUTING_DECLARATIONS: Record<
  CanonicalVideoProviderId,
  {
    readonly providerId: string;
    readonly adapterVersion: string;
    readonly capability: () => ProviderCapabilityDeclaration;
  }
> = {
  seedance: {
    providerId: SEEDANCE_PROVIDER_ID,
    adapterVersion: SEEDANCE_ADAPTER_VERSION,
    capability: () => buildSeedanceCapabilityDeclaration(),
  },
  minimax: {
    providerId: MINIMAX_PROVIDER_ID,
    adapterVersion: MINIMAX_ADAPTER_VERSION,
    capability: () => buildMinimaxCapabilityDeclaration(),
  },
};

export type CanonicalExecuteProviderRouterOptions = ProviderExecutionEligibilityInput & {
  readonly router?: ProviderRouter;
};

/**
 * Build the canonical Scene Provider Router used by product Execute scheduling.
 * Disabled / unregistered providers are omitted from the registry snapshot.
 */
export function createCanonicalExecuteProviderRouter(
  options: CanonicalExecuteProviderRouterOptions = {}
): ProviderRouter {
  if (options.router) return options.router;

  const registry = new ProviderAdapterRegistry();
  const routable = routableCanonicalVideoProviderIds(options);
  for (const providerId of routable) {
    const declaration = ROUTING_DECLARATIONS[providerId];
    registry.register(
      routingOnlyAdapter(
        declaration.providerId,
        declaration.adapterVersion,
        declaration.capability()
      )
    );
  }
  return new CanonicalProviderRouter(registry);
}
