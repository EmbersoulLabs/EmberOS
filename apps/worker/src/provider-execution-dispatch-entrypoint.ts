import {
  ExecutionDispatchRepository,
  ExecutionEnvelopeRepository,
} from "@ceo-agent/db";
import {
  ProviderExecutionDispatcher,
  type DispatcherOutcome,
} from "./provider-execution-dispatcher";
import type {
  ProviderExecutionWorker,
  ProviderWorkerOutcome,
} from "./provider-dispatch-worker";

let productionDispatcher: ProviderExecutionDispatcher | undefined;

function getProductionDispatcher(): ProviderExecutionDispatcher {
  productionDispatcher ??= new ProviderExecutionDispatcher(
    new ExecutionDispatchRepository(),
    new ExecutionEnvelopeRepository()
  );
  return productionDispatcher;
}

/**
 * Canonical production boundary for selecting and materializing one Dispatch.
 * PR-3A.5C.6.3 will make Workers consume its immutable Dispatch output.
 */
export async function dispatchNextProviderExecution(
  options: { readonly ownership?: "ANY" | "AI_STORY_SCENE" | "GENERIC_PROVIDER" } = {}
): Promise<DispatcherOutcome> {
  return getProductionDispatcher().dispatchNext(options);
}

export type ProviderExecutionCycleOutcome =
  | Readonly<{ status: "NO_JOB"; timestamp: string }>
  | ProviderWorkerOutcome;

export async function dispatchAndExecuteNextProviderExecution(
  worker: Pick<ProviderExecutionWorker, "execute">
): Promise<ProviderExecutionCycleOutcome> {
  const outcome = await dispatchNextProviderExecution();
  if (outcome.status === "NO_JOB") return outcome;
  return worker.execute(outcome.dispatch.dispatchId);
}
