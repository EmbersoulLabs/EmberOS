import type {
  PipelineDependency,
  PipelineDependencyState,
  PipelineRoute,
} from "./workflow-contracts";

export interface DependencyEvaluation {
  state: PipelineDependencyState;
  ready: boolean;
  waiting: PipelineDependency[];
  retryableFailures: PipelineDependency[];
  terminalFailures: PipelineDependency[];
}

export function evaluateDependencies(
  dependencies: readonly PipelineDependency[]
): DependencyEvaluation {
  const required = dependencies.filter(
    (dependency) => dependency.required && dependency.state !== "NOT_REQUIRED"
  );
  const waiting = required.filter((dependency) => dependency.state === "WAITING");
  const retryableFailures = required.filter(
    (dependency) => dependency.state === "FAILED_RETRYABLE"
  );
  const terminalFailures = required.filter(
    (dependency) => dependency.state === "FAILED_TERMINAL"
  );
  const state: PipelineDependencyState =
    terminalFailures.length > 0
      ? "FAILED_TERMINAL"
      : retryableFailures.length > 0
        ? "FAILED_RETRYABLE"
        : waiting.length > 0
          ? "WAITING"
          : "READY";

  return {
    state,
    ready: state === "READY",
    waiting,
    retryableFailures,
    terminalFailures,
  };
}

export function dependenciesForRoute(
  route: PipelineRoute,
  dependencies: readonly PipelineDependency[]
): DependencyEvaluation {
  const ids = new Set(route.dependsOn);
  return evaluateDependencies(
    dependencies.filter((dependency) => ids.has(dependency.id))
  );
}

export function assertMarketingDependenciesReady(
  dependencies: readonly PipelineDependency[]
): void {
  const result = evaluateDependencies(dependencies);
  if (result.state === "FAILED_TERMINAL") {
    throw new Error(
      `Marketing dependencies failed terminally: ${result.terminalFailures
        .map((item) => item.id)
        .join(", ")}`
    );
  }
  if (result.state === "FAILED_RETRYABLE") {
    throw new Error(
      `Marketing dependencies failed retryably: ${result.retryableFailures
        .map((item) => item.id)
        .join(", ")}`
    );
  }
  if (!result.ready) {
    throw new Error(
      `Marketing dependencies are waiting: ${result.waiting
        .map((item) => item.id)
        .join(", ")}`
    );
  }
}
