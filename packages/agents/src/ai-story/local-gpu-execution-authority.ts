import type { ProviderAdapter, ProviderCapabilityDeclaration } from "../provider-adapters/contracts";
import { ProviderAdapterRegistry } from "../provider-router/adapter-registry";
import {
  CanonicalProviderRouter,
  type ProviderRouter,
} from "../provider-router/provider-router";
import type { ProviderRoutingPolicy } from "../provider-router/contracts";
import {
  LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
  LOCAL_GPU_PROVIDER_ID,
  LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  LOCAL_GPU_WORKER_WORKFLOW,
} from "@ceo-agent/shared";
import { assertLocalGpuAccess, LocalGpuAccessError, type LocalGpuServerActor } from "./local-gpu-access";

export const LOCAL_GPU_ADAPTER_VERSION = "1.0.0" as const;
export const LOCAL_GPU_CAPABILITY_ID = "animation-video-generation" as const;

/**
 * Explicit LOCAL_GPU selection. Absent or non-LOCAL_GPU requests stay on the
 * existing Seedance / MiniMax authority. Denial never falls back.
 */
export function resolveExplicitLocalGpuProviderAuthority(input: {
  readonly requestedProvider?: string | null;
  readonly actor?: LocalGpuServerActor;
  readonly providerEnabled?: boolean;
}):
  | { readonly kind: "EXISTING" }
  | {
      readonly kind: "LOCAL_GPU";
      readonly providerId: typeof LOCAL_GPU_PROVIDER_ID;
      readonly workflow: typeof LOCAL_GPU_WORKER_WORKFLOW;
      readonly automaticGenerationRetry: 0;
      readonly remoteProviderFallback: 0;
      readonly autoApproved: false;
    } {
  const requested = input.requestedProvider?.trim() ?? "";
  if (requested !== LOCAL_GPU_PROVIDER_ID) return { kind: "EXISTING" };
  if (input.providerEnabled !== true) {
    throw new LocalGpuAccessError("LOCAL_GPU_PROVIDER_DISABLED");
  }
  if (!input.actor) throw new LocalGpuAccessError("LOCAL_GPU_ACCESS_DENIED");
  assertLocalGpuAccess(input.actor, { workspaceId: input.actor.workspaceId }, {
    agencyLocalGpuEnabled: false,
  });
  return {
    kind: "LOCAL_GPU",
    providerId: LOCAL_GPU_PROVIDER_ID,
    workflow: LOCAL_GPU_WORKER_WORKFLOW,
    automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
    remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
    autoApproved: false,
  };
}

export function buildLocalGpuCapabilityDeclaration(): ProviderCapabilityDeclaration {
  return Object.freeze({
    providerId: LOCAL_GPU_PROVIDER_ID,
    adapterVersion: LOCAL_GPU_ADAPTER_VERSION,
    capabilityId: LOCAL_GPU_CAPABILITY_ID,
    capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requiredProviderFeatures: ["LOOKUP"],
    nativeIdempotency: false,
    lookup: true,
    cancellation: true,
    callbacks: false,
    streaming: false,
    routing: {
      costClass: "LOW",
      estimatedCostUsd: 0,
      latencyClass: "SLOW",
      qualityClass: "HIGH",
      reliabilityClass: "HIGH",
      regions: ["desktop-worker"],
      modelFamilies: [LOCAL_GPU_WORKER_WORKFLOW],
      sensitiveDataAllowed: false,
      externalProcessing: true,
      trainingOptOut: true,
      zeroRetention: false,
      maximumRetentionDays: 1,
      enterpriseControls: false,
    },
  } satisfies ProviderCapabilityDeclaration);
}

function routingOnlyAdapter(
  providerId: string,
  adapterVersion: string,
  capability: ProviderCapabilityDeclaration,
): ProviderAdapter {
  return {
    providerId,
    adapterVersion,
    capabilities() {
      return new Set([capability]);
    },
    async execute() {
      throw new Error(
        `${providerId} routing-only adapter cannot execute; Worker Canonical Adapter owns Provider HTTP`,
      );
    },
  };
}

/** Router that can select only LOCAL_GPU. Seedance and MiniMax are denied. */
export function createExplicitLocalGpuProviderRouter(): {
  readonly router: ProviderRouter;
  readonly routingPolicy: ProviderRoutingPolicy;
} {
  const capability = buildLocalGpuCapabilityDeclaration();
  const registry = new ProviderAdapterRegistry();
  registry.register(routingOnlyAdapter(LOCAL_GPU_PROVIDER_ID, LOCAL_GPU_ADAPTER_VERSION, capability));
  return {
    router: new CanonicalProviderRouter(registry),
    routingPolicy: {
      policyVersion: "1.0.0",
      preferredProviders: [LOCAL_GPU_PROVIDER_ID],
      allowedProviders: [LOCAL_GPU_PROVIDER_ID],
      deniedProviders: ["seedance", "minimax"],
      requireTrainingOptOut: true,
    },
  };
}
