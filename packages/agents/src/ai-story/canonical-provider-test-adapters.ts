/**
 * Sprint 3 PR 3.3 — deterministic provider-neutral test adapters.
 * No external HTTP. No Seedance/MiniMax production request schemas.
 */
import {
  SCENE_ROUTER_VERSION,
  WORKER_RUNTIME_CONTRACT_VERSION,
  type ProviderCallbackNormalizationInput,
  type ProviderCallbackReceipt,
  type WorkerFailureClassification,
} from "@ceo-agent/shared";
import { canonicalPersistenceHash } from "@ceo-agent/db";
import type { ProviderCapabilityDeclaration } from "../provider-adapters/contracts";
import {
  failureFromCode,
  CanonicalAdapterRegistry,
  type CanonicalAdapterErrorInput,
  type CanonicalAdapterLookupInput,
  type CanonicalAdapterLookupResult,
  type CanonicalAdapterSubmitInput,
  type CanonicalAdapterSubmitResult,
  type CanonicalProviderAdapter,
} from "./canonical-provider-adapter";

export type DeterministicTestAdapterScenario =
  | "accepted_async"
  | "not_accepted"
  | "acceptance_unknown"
  | "processing_lookup"
  | "terminal_success"
  | "terminal_rejection"
  | "terminal_failure"
  | "transient_infrastructure_error"
  | "conflicting_replay";

const TEST_CAPABILITY: ProviderCapabilityDeclaration = {
  providerId: "test-provider",
  adapterVersion: "1.0.0",
  capabilityId: "animation-video-generation",
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["LOOKUP"],
  nativeIdempotency: true,
  lookup: true,
  cancellation: false,
  callbacks: true,
  streaming: false,
  routing: {
    costClass: "LOW",
    latencyClass: "FAST",
    qualityClass: "HIGH",
    reliabilityClass: "HIGH",
    regions: ["us-east-1"],
    modelFamilies: ["test"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: true,
    zeroRetention: false,
    maximumRetentionDays: 30,
    enterpriseControls: false,
  },
};

export class DeterministicCanonicalTestAdapter implements CanonicalProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;
  submitCount = 0;
  lookupCount = 0;
  private readonly acceptedRequestIds = new Map<string, string>();

  constructor(
    private readonly scenario: DeterministicTestAdapterScenario = "accepted_async",
    options?: { readonly providerId?: string; readonly adapterVersion?: string }
  ) {
    this.providerId = options?.providerId ?? "test-provider";
    this.adapterVersion = options?.adapterVersion ?? "1.0.0";
  }

  describeCapabilities(): ReadonlyArray<ProviderCapabilityDeclaration> {
    return [
      {
        ...TEST_CAPABILITY,
        providerId: this.providerId,
        adapterVersion: this.adapterVersion,
      },
    ];
  }

  async submit(input: CanonicalAdapterSubmitInput): Promise<CanonicalAdapterSubmitResult> {
    this.submitCount += 1;
    if (this.scenario === "transient_infrastructure_error" && this.submitCount === 1) {
      throw new Error("simulated infrastructure failure");
    }
    if (this.scenario === "not_accepted") {
      return {
        acceptanceClassification: "NOT_ACCEPTED",
        canonicalProviderState: "NOT_ACCEPTED",
        reconciliationRequired: false,
        failureClassification: failureFromCode(
          "PROVIDER_NOT_ACCEPTED",
          "Provider authoritatively rejected submission"
        ),
      };
    }
    if (this.scenario === "acceptance_unknown") {
      return {
        acceptanceClassification: "ACCEPTANCE_UNKNOWN",
        canonicalProviderState: "ACCEPTANCE_UNKNOWN",
        reconciliationRequired: true,
        failureClassification: failureFromCode(
          "PROVIDER_ACCEPTANCE_UNKNOWN",
          "Provider acceptance is unknown; reconciliation required",
          { terminal: false, reconciliationRequired: true }
        ),
      };
    }

    const providerRequestId = canonicalPersistenceHash({
      kind: "canonical-test-provider-request",
      dispatchId: input.dispatchId,
      providerAttemptId: input.providerAttemptId,
      envelopeId: input.envelope.envelopeId,
      scenario: this.scenario,
    });
    this.acceptedRequestIds.set(input.dispatchId, providerRequestId);
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "ACCEPTED",
      providerRequestId,
      reconciliationRequired: false,
      operationalMetadata: { async: true, scenario: this.scenario },
    };
  }

  async lookup(input: CanonicalAdapterLookupInput): Promise<CanonicalAdapterLookupResult> {
    this.lookupCount += 1;
    const known = this.acceptedRequestIds.get(input.dispatchId) ?? input.providerRequestId;
    if (known !== input.providerRequestId) {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "FAILED",
        providerRequestId: input.providerRequestId,
        reconciliationRequired: false,
        failureClassification: failureFromCode(
          "IDENTITY_CONFLICT",
          "Lookup providerRequestId conflicts with accepted request"
        ),
      };
    }

    if (this.scenario === "processing_lookup" || this.scenario === "accepted_async") {
      if (this.lookupCount < 2) {
        return {
          acceptanceClassification: "ACCEPTED",
          canonicalProviderState: "PROCESSING",
          providerRequestId: input.providerRequestId,
          reconciliationRequired: false,
        };
      }
    }
    if (this.scenario === "terminal_rejection") {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "REJECTED",
        providerRequestId: input.providerRequestId,
        reconciliationRequired: false,
        failureClassification: failureFromCode(
          "PROVIDER_REJECTED",
          "Provider rejected the accepted request"
        ),
      };
    }
    if (this.scenario === "terminal_failure") {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "FAILED",
        providerRequestId: input.providerRequestId,
        reconciliationRequired: false,
        failureClassification: failureFromCode(
          "PROVIDER_FAILED",
          "Provider failed the accepted request"
        ),
      };
    }
    if (this.scenario === "conflicting_replay") {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "SUCCEEDED",
        providerRequestId: input.providerRequestId,
        normalizedResultReference: `memory://test/conflict/${input.dispatchId}`,
        terminalMedia: {
          mediaType: "video/mp4",
          uriReference: `memory://test/conflict-media/${input.dispatchId}`,
          contentHash:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          durationMs: 1000,
        },
        reconciliationRequired: false,
      };
    }

    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "SUCCEEDED",
      providerRequestId: input.providerRequestId,
      normalizedResultReference: `memory://test/result/${input.dispatchId}`,
      terminalMedia: {
        mediaType: "video/mp4",
        uriReference: `memory://test/media/${input.dispatchId}`,
        contentHash:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        durationMs: 2500,
        width: 1080,
        height: 1920,
      },
      normalizedUsageFacts: { durationMs: 2500, units: 1, unitKind: "video" },
      normalizedCostMetadata: { currency: "USD", amount: 0, estimated: true },
      reconciliationRequired: false,
    };
  }

  async normalizeCallback(
    input: ProviderCallbackNormalizationInput
  ): Promise<ProviderCallbackReceipt> {
    const receiptHash = canonicalPersistenceHash({
      kind: "canonical-test-callback-receipt",
      providerId: this.providerId,
      rawEventReference: input.rawEventReference,
      receivedAt: input.receivedAt,
    });
    return {
      providerId: this.providerId,
      callbackEventId: canonicalPersistenceHash({
        kind: "callback-event",
        receiptHash,
      }).replace(/^sha256:/, "cb-"),
      providerRequestId:
        input.providerRequestId ??
        canonicalPersistenceHash({
          kind: "callback-request",
          receiptHash,
        }),
      signatureVerified: true,
      callbackTimestamp: input.receivedAt,
      receiptHash,
      contractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
    };
  }

  classifyError(input: CanonicalAdapterErrorInput): WorkerFailureClassification {
    const message = String((input.error as { message?: string })?.message ?? input.error);
    if (/infrastructure|timeout|network/i.test(message)) {
      return failureFromCode("PROVIDER_TIMEOUT", "Transient provider infrastructure error", {
        retryable: true,
        terminal: false,
      });
    }
    return failureFromCode("PROVIDER_FAILED", "Provider adapter failed", {
      retryable: false,
      terminal: true,
    });
  }
}

export function createPr33TestAdapterRegistry(
  scenario: DeterministicTestAdapterScenario = "accepted_async"
): CanonicalAdapterRegistry {
  const registry = new CanonicalAdapterRegistry();
  registry.register("test-provider", "1.0.0", () => new DeterministicCanonicalTestAdapter(scenario));
  registry.register("seedance", "1.0.0", () =>
    new DeterministicCanonicalTestAdapter(scenario, {
      providerId: "seedance",
      adapterVersion: "1.0.0",
    })
  );
  return registry;
}

/** Stable marker proving test adapters do not call external APIs. */
export const PR33_TEST_ADAPTER_HTTP_FORBIDDEN = true as const;
export const PR33_ROUTER_VERSION_FROZEN = SCENE_ROUTER_VERSION;
