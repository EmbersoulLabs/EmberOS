/**
 * Sprint 3 PR 3.3 — provider-neutral Canonical Provider Adapter contract.
 *
 * Supports asynchronous video generation without Provider-specific production
 * payload schemas. Concrete Seedance/MiniMax behavior belongs in PR 3.4A/B.
 */
import type {
  CanonicalProviderState,
  CanonicalTerminalMediaMetadata,
  ExecutionEnvelope,
  NormalizedCostMetadata,
  NormalizedUsageFacts,
  ProviderAcceptanceClassification,
  ProviderCallbackNormalizationInput,
  ProviderCallbackReceipt,
  WorkerFailureClassification,
  WorkerRuntimeErrorCode,
} from "@ceo-agent/shared";
import type { ProviderCapabilityDeclaration } from "../provider-adapters/contracts";

export type CanonicalAdapterSubmitInput = {
  readonly envelope: ExecutionEnvelope;
  readonly providerAttemptId: string;
  readonly dispatchId: string;
  readonly idempotencyKey: string;
  readonly timeoutDeadline: string;
};

export type CanonicalAdapterSubmitResult = {
  readonly acceptanceClassification: ProviderAcceptanceClassification;
  readonly canonicalProviderState: CanonicalProviderState;
  readonly providerRequestId?: string;
  readonly operationalMetadata?: Readonly<Record<string, string | number | boolean>>;
  readonly failureClassification?: WorkerFailureClassification;
  readonly reconciliationRequired: boolean;
};

export type CanonicalAdapterLookupInput = {
  readonly providerRequestId: string;
  readonly envelope: ExecutionEnvelope;
  readonly providerAttemptId: string;
  readonly dispatchId: string;
};

export type CanonicalAdapterLookupResult = {
  readonly acceptanceClassification: ProviderAcceptanceClassification;
  readonly canonicalProviderState: CanonicalProviderState;
  readonly providerRequestId: string;
  readonly terminalMedia?: CanonicalTerminalMediaMetadata;
  readonly normalizedResultReference?: string;
  readonly normalizedUsageFacts?: NormalizedUsageFacts;
  readonly normalizedCostMetadata?: NormalizedCostMetadata;
  readonly failureClassification?: WorkerFailureClassification;
  readonly reconciliationRequired: boolean;
  readonly operationalMetadata?: Readonly<Record<string, string | number | boolean>>;
};

export type CanonicalAdapterErrorInput = {
  readonly error: unknown;
  readonly phase: "submit" | "lookup" | "callback";
};

/**
 * Provider-neutral Adapter interface for Phase 3 Worker runtime.
 * Infrastructure may map provider IDs → Adapter factories; Worker never reroutes.
 */
export interface CanonicalProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;

  describeCapabilities(): ReadonlyArray<ProviderCapabilityDeclaration>;

  submit(input: CanonicalAdapterSubmitInput): Promise<CanonicalAdapterSubmitResult>;

  lookup(input: CanonicalAdapterLookupInput): Promise<CanonicalAdapterLookupResult>;

  normalizeCallback(
    input: ProviderCallbackNormalizationInput
  ): Promise<ProviderCallbackReceipt>;

  classifyError(input: CanonicalAdapterErrorInput): WorkerFailureClassification;
}

export type CanonicalAdapterFactory = () => CanonicalProviderAdapter;

export class CanonicalAdapterRegistry {
  private readonly factories = new Map<string, CanonicalAdapterFactory>();

  register(providerId: string, adapterVersion: string, factory: CanonicalAdapterFactory): void {
    this.factories.set(bindingKey(providerId, adapterVersion), factory);
  }

  resolve(providerId: string, adapterVersion: string): CanonicalProviderAdapter | null {
    const factory = this.factories.get(bindingKey(providerId, adapterVersion));
    return factory ? factory() : null;
  }

  has(providerId: string, adapterVersion: string): boolean {
    return this.factories.has(bindingKey(providerId, adapterVersion));
  }

  /**
   * Non-secret Worker capability projection. Constructing an Adapter may read
   * executor-local configuration, but this projection contains declarations
   * only and never returns configuration or credential material.
   */
  describeRegisteredCapabilities(): ReadonlyArray<ProviderCapabilityDeclaration> {
    return [...this.factories.values()]
      .flatMap((factory) => factory().describeCapabilities())
      .map((declaration) => structuredClone(declaration))
      .sort(
        (left, right) =>
          left.providerId.localeCompare(right.providerId) ||
          left.adapterVersion.localeCompare(right.adapterVersion) ||
          left.capabilityId.localeCompare(right.capabilityId)
      );
  }
}

function bindingKey(providerId: string, adapterVersion: string): string {
  return `${providerId}::${adapterVersion}`;
}

export function failureFromCode(
  code: WorkerRuntimeErrorCode,
  sanitizedMessage: string,
  flags?: Partial<Pick<WorkerFailureClassification, "retryable" | "terminal" | "reconciliationRequired">>
): WorkerFailureClassification {
  return {
    code,
    sanitizedMessage,
    retryable: flags?.retryable ?? false,
    terminal: flags?.terminal ?? true,
    reconciliationRequired: flags?.reconciliationRequired ?? false,
  };
}
