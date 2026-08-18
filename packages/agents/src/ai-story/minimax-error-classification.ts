/**
 * Sprint 3 PR 3.4B — MiniMax error → canonical Worker failure classification.
 * fallbackAllowed is always false for V1.
 */
import type { WorkerFailureClassification, WorkerRuntimeErrorCode } from "@ceo-agent/shared";
import { failureFromCode } from "./canonical-provider-adapter";
import { MinimaxConfigError } from "./minimax-config";
import { MinimaxHttpTransportError } from "./minimax-http-client";
import { MinimaxMappingError } from "./minimax-request-mapping";

export type MinimaxErrorClass =
  | "INFRASTRUCTURE_TRANSIENT"
  | "INFRASTRUCTURE_TERMINAL"
  | "PROVIDER_NOT_ACCEPTED"
  | "PROVIDER_ACCEPTANCE_UNKNOWN"
  | "PROVIDER_REJECTED"
  | "PROVIDER_MODERATION_REJECTED"
  | "PROVIDER_FAILED"
  | "PROVIDER_TIMEOUT"
  | "BUSINESS_VALIDATION_FAILED";

export type MinimaxErrorPolicy = {
  readonly class: MinimaxErrorClass;
  readonly retrySameProvider: boolean;
  readonly lookupOrReconciliationRequired: boolean;
  readonly terminal: boolean;
  readonly fallbackAllowed: false;
  readonly safeUserMessage: string;
  readonly workerCode: WorkerRuntimeErrorCode;
};

const POLICIES: Record<MinimaxErrorClass, MinimaxErrorPolicy> = {
  INFRASTRUCTURE_TRANSIENT: {
    class: "INFRASTRUCTURE_TRANSIENT",
    retrySameProvider: true,
    lookupOrReconciliationRequired: false,
    terminal: false,
    fallbackAllowed: false,
    safeUserMessage: "Temporary provider infrastructure error",
    workerCode: "PROVIDER_TIMEOUT",
  },
  INFRASTRUCTURE_TERMINAL: {
    class: "INFRASTRUCTURE_TERMINAL",
    retrySameProvider: false,
    lookupOrReconciliationRequired: false,
    terminal: true,
    fallbackAllowed: false,
    safeUserMessage: "Provider infrastructure failed",
    workerCode: "PROVIDER_FAILED",
  },
  PROVIDER_NOT_ACCEPTED: {
    class: "PROVIDER_NOT_ACCEPTED",
    retrySameProvider: false,
    lookupOrReconciliationRequired: false,
    terminal: true,
    fallbackAllowed: false,
    safeUserMessage: "Provider rejected the submission",
    workerCode: "PROVIDER_NOT_ACCEPTED",
  },
  PROVIDER_ACCEPTANCE_UNKNOWN: {
    class: "PROVIDER_ACCEPTANCE_UNKNOWN",
    retrySameProvider: false,
    lookupOrReconciliationRequired: true,
    terminal: false,
    fallbackAllowed: false,
    safeUserMessage: "Provider acceptance is unknown; reconciliation required",
    workerCode: "PROVIDER_ACCEPTANCE_UNKNOWN",
  },
  PROVIDER_REJECTED: {
    class: "PROVIDER_REJECTED",
    retrySameProvider: false,
    lookupOrReconciliationRequired: false,
    terminal: true,
    fallbackAllowed: false,
    safeUserMessage: "Provider rejected the request",
    workerCode: "PROVIDER_REJECTED",
  },
  PROVIDER_MODERATION_REJECTED: {
    class: "PROVIDER_MODERATION_REJECTED",
    retrySameProvider: false,
    lookupOrReconciliationRequired: false,
    terminal: true,
    fallbackAllowed: false,
    safeUserMessage: "Provider moderation rejected the request",
    workerCode: "PROVIDER_MODERATION_REJECTED",
  },
  PROVIDER_FAILED: {
    class: "PROVIDER_FAILED",
    retrySameProvider: false,
    lookupOrReconciliationRequired: false,
    terminal: true,
    fallbackAllowed: false,
    safeUserMessage: "Provider failed the request",
    workerCode: "PROVIDER_FAILED",
  },
  PROVIDER_TIMEOUT: {
    class: "PROVIDER_TIMEOUT",
    retrySameProvider: false,
    lookupOrReconciliationRequired: true,
    terminal: false,
    fallbackAllowed: false,
    safeUserMessage: "Provider timed out with uncertain acceptance",
    workerCode: "PROVIDER_TIMEOUT",
  },
  BUSINESS_VALIDATION_FAILED: {
    class: "BUSINESS_VALIDATION_FAILED",
    retrySameProvider: false,
    lookupOrReconciliationRequired: false,
    terminal: true,
    fallbackAllowed: false,
    safeUserMessage: "Request failed validation before Provider submission",
    workerCode: "PROVIDER_NOT_ACCEPTED",
  },
};

export function minimaxErrorPolicy(errorClass: MinimaxErrorClass): MinimaxErrorPolicy {
  return POLICIES[errorClass];
}

export function classifyMinimaxError(
  error: unknown,
  phase: "submit" | "lookup" | "callback"
): {
  readonly policy: MinimaxErrorPolicy;
  readonly failure: WorkerFailureClassification;
} {
  if (error instanceof MinimaxMappingError) {
    const policy = POLICIES.BUSINESS_VALIDATION_FAILED;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage, {
        retryable: policy.retrySameProvider,
        terminal: policy.terminal,
        reconciliationRequired: policy.lookupOrReconciliationRequired,
      }),
    };
  }
  if (error instanceof MinimaxConfigError) {
    const policy = POLICIES.INFRASTRUCTURE_TERMINAL;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage, {
        retryable: false,
        terminal: true,
        reconciliationRequired: false,
      }),
    };
  }
  if (error instanceof MinimaxHttpTransportError) {
    const policy = POLICIES.INFRASTRUCTURE_TRANSIENT;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage, {
        retryable: true,
        terminal: false,
        reconciliationRequired: phase === "submit",
      }),
    };
  }

  const message = String((error as { message?: string })?.message ?? error);
  const status = Number((error as { status?: number })?.status ?? NaN);

  // MiniMax sensitive content codes include 1026 / 1027 and HTTP 422.
  if (
    /moderation|safety|content.?policy|sensitive/i.test(message) ||
    /\(1026\)|\(1027\)/.test(message) ||
    status === 422
  ) {
    const policy = POLICIES.PROVIDER_MODERATION_REJECTED;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage),
    };
  }
  if (status === 400 || status === 401 || status === 403 || /not.?accepted|invalid.?request|invalid params/i.test(message)) {
    const policy = POLICIES.PROVIDER_NOT_ACCEPTED;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage),
    };
  }
  if (status === 408 || status === 504 || /timeout|timed out/i.test(message)) {
    const policy = POLICIES.PROVIDER_TIMEOUT;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage, {
        retryable: false,
        terminal: false,
        reconciliationRequired: true,
      }),
    };
  }
  if (status === 429 || status >= 500 || /unavailable|network|econnreset|rate limit/i.test(message)) {
    const policy = POLICIES.INFRASTRUCTURE_TRANSIENT;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage, {
        retryable: true,
        terminal: false,
        reconciliationRequired: phase === "submit",
      }),
    };
  }
  if (/acceptance.?unknown|uncertain/i.test(message)) {
    const policy = POLICIES.PROVIDER_ACCEPTANCE_UNKNOWN;
    return {
      policy,
      failure: failureFromCode(policy.workerCode, policy.safeUserMessage, {
        retryable: false,
        terminal: false,
        reconciliationRequired: true,
      }),
    };
  }

  const policy = POLICIES.PROVIDER_FAILED;
  return {
    policy,
    failure: failureFromCode(policy.workerCode, policy.safeUserMessage),
  };
}

export function assertMinimaxFallbackDisabled(policy: MinimaxErrorPolicy): void {
  if (policy.fallbackAllowed !== false) {
    throw new Error("MiniMax Adapter must never allow cross-provider fallback");
  }
}
