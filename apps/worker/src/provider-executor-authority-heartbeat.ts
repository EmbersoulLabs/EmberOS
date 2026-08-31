import {
  getAiProviderConfig,
  isAiProviderReady,
  type ProviderExecutorAuthority,
  type ProviderExecutorCapabilityAuthority,
} from "@ceo-agent/shared";
import type { ProviderCapabilityDeclaration } from "@ceo-agent/agents";
import {
  PROVIDER_EXECUTOR_AUTHORITY_TTL_SECONDS,
  publishProviderExecutorAuthority,
  resolveProviderExecutorEnvironment,
} from "@ceo-agent/queue";
import { createProductionAiStoryCanonicalAdapterRegistry } from "./ai-story-canonical-adapter-registry";

const HEARTBEAT_INTERVAL_MS = 10_000;

function workerDeploymentId(env: NodeJS.ProcessEnv): string {
  return (
    env.RAILWAY_DEPLOYMENT_ID?.trim() ||
    env.RAILWAY_SERVICE_ID?.trim() ||
    `local-worker-${process.pid}`
  );
}

export function buildProviderExecutorAuthority(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
  registeredDeclarations?: readonly ProviderCapabilityDeclaration[]
): ProviderExecutorAuthority {
  const config = getAiProviderConfig(env);
  const declarations =
    registeredDeclarations ??
    createProductionAiStoryCanonicalAdapterRegistry({ env })
      .describeRegisteredCapabilities();
  const grouped = new Map<string, ProviderExecutorCapabilityAuthority>();

  for (const declaration of declarations) {
    if (declaration.providerId !== "seedance" && declaration.providerId !== "minimax") {
      continue;
    }
    const provider = config.providers[declaration.providerId];
    const model = provider.defaultModel?.trim();
    if (!provider.enabled || !model || !isAiProviderReady(config, declaration.providerId)) {
      continue;
    }
    const existing = grouped.get(declaration.providerId);
    grouped.set(declaration.providerId, {
      providerId: declaration.providerId,
      adapterVersion: declaration.adapterVersion,
      productEnabled: true,
      executorRegistered: true,
      executorReady: true,
      capabilityIds: [...new Set([...(existing?.capabilityIds ?? []), declaration.capabilityId])].sort(),
      supportedModels: [...new Set([...(existing?.supportedModels ?? []), model])].sort(),
    });
  }

  return {
    contractVersion: "1.0.0",
    executorKind: "REMOTE_CANONICAL_WORKER_EXECUTOR",
    environment: resolveProviderExecutorEnvironment(env),
    workerDeploymentId: workerDeploymentId(env),
    publishedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + PROVIDER_EXECUTOR_AUTHORITY_TTL_SECONDS * 1_000
    ).toISOString(),
    capabilities: [...grouped.values()].sort((left, right) =>
      left.providerId.localeCompare(right.providerId)
    ),
  };
}

export function startProviderExecutorAuthorityHeartbeat(): () => void {
  let stopped = false;
  const publish = async () => {
    if (stopped) return;
    try {
      const authority = buildProviderExecutorAuthority();
      await publishProviderExecutorAuthority(authority);
      console.log(
        `[provider-executor-authority] environment=${authority.environment} registered=${authority.capabilities
          .map((capability) => capability.providerId)
          .join(",") || "none"}`
      );
    } catch (error) {
      console.warn(
        "[provider-executor-authority] heartbeat failed:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  };
  void publish();
  const timer = setInterval(() => void publish(), HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
