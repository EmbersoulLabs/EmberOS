/**
 * Sprint 3 PR 3.7 Phase D — build ProviderRouter for canonical Scene Scheduling.
 * Used only by the canonical Execute product entrypoint.
 */
import {
  createCanonicalExecuteProviderRouter,
  createExplicitLocalGpuProviderRouter,
  resolveCanonicalExecuteRoutingPolicy,
  resolveExplicitLocalGpuProviderAuthority,
  type LocalGpuServerActor,
} from "@ceo-agent/agents";
import { readProviderExecutorAuthority } from "@ceo-agent/queue";

export { createCanonicalExecuteProviderRouter };

function localGpuProviderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOCAL_GPU_PROVIDER_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * Resolve Web scheduling from the canonical Worker's fresh, non-secret
 * capability heartbeat. If no heartbeat exists, the existing local-executor
 * behavior remains available for runtimes that legitimately own credentials.
 *
 * An explicit LOCAL_GPU request is decided here and nowhere else. Any other
 * request keeps the existing Seedance / MiniMax resolution.
 */
export async function resolveCanonicalWebExecuteProviderAuthority(input?: {
  readonly requestedProvider?: string | null;
  readonly actor?: LocalGpuServerActor;
  readonly providerEnabled?: boolean;
}) {
  const explicit = resolveExplicitLocalGpuProviderAuthority({
    requestedProvider: input?.requestedProvider,
    actor: input?.actor,
    providerEnabled: input?.providerEnabled ?? localGpuProviderEnabled(),
  });
  if (explicit.kind === "LOCAL_GPU") {
    const localGpu = createExplicitLocalGpuProviderRouter();
    return {
      workerAuthority: null,
      router: localGpu.router,
      routingPolicy: localGpu.routingPolicy,
      localGpu: explicit,
    };
  }
  const workerAuthority = await readProviderExecutorAuthority();
  const options = workerAuthority
    ? { executorAuthorities: workerAuthority.capabilities }
    : {};
  return {
    workerAuthority,
    router: createCanonicalExecuteProviderRouter(options),
    routingPolicy: resolveCanonicalExecuteRoutingPolicy(options),
    localGpu: explicit,
  };
}
