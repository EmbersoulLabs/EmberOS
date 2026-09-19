/**
 * Sprint 3 PR 3.7 Phase D — build ProviderRouter for canonical Scene Scheduling.
 * Used only by the canonical Execute product entrypoint.
 */
import {
  createCanonicalExecuteProviderRouter,
  resolveCanonicalExecuteRoutingPolicy,
} from "@ceo-agent/agents";
import { readProviderExecutorAuthority } from "@ceo-agent/queue";

export { createCanonicalExecuteProviderRouter };

/**
 * Resolve Web scheduling from the canonical Worker's fresh, non-secret
 * capability heartbeat. If no heartbeat exists, the existing local-executor
 * behavior remains available for runtimes that legitimately own credentials.
 */
export async function resolveCanonicalWebExecuteProviderAuthority() {
  const workerAuthority = await readProviderExecutorAuthority();
  const options = workerAuthority
    ? { executorAuthorities: workerAuthority.capabilities }
    : {};
  return {
    workerAuthority,
    router: createCanonicalExecuteProviderRouter(options),
    routingPolicy: resolveCanonicalExecuteRoutingPolicy(options),
  };
}
