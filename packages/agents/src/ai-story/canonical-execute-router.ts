/**
 * Sprint 3 PR 3.7 Phase D — ProviderRouter for canonical Execute scheduling.
 *
 * Declares Seedance + MiniMax animation-video capabilities for RoutingDecision
 * binding only. Does NOT perform Provider HTTP. Worker Adapters remain the
 * sole Provider submit/lookup authority after Dispatch.
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

/**
 * Build the canonical Scene Provider Router used by product Execute scheduling.
 */
export function createCanonicalExecuteProviderRouter(
  options: { readonly router?: ProviderRouter } = {}
): ProviderRouter {
  if (options.router) return options.router;

  const registry = new ProviderAdapterRegistry();
  registry.register(
    routingOnlyAdapter(
      SEEDANCE_PROVIDER_ID,
      SEEDANCE_ADAPTER_VERSION,
      buildSeedanceCapabilityDeclaration()
    )
  );
  registry.register(
    routingOnlyAdapter(
      MINIMAX_PROVIDER_ID,
      MINIMAX_ADAPTER_VERSION,
      buildMinimaxCapabilityDeclaration()
    )
  );
  return new CanonicalProviderRouter(registry);
}
