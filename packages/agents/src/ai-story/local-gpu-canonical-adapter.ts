import type {
  CanonicalAdapterErrorInput,
  CanonicalAdapterLookupInput,
  CanonicalAdapterLookupResult,
  CanonicalAdapterSubmitInput,
  CanonicalAdapterSubmitResult,
  CanonicalProviderAdapter,
} from "./canonical-provider-adapter";
import { CanonicalAdapterRegistry, failureFromCode } from "./canonical-provider-adapter";
import { LocalGpuCloudAdapter, type LocalGpuJobScope, type LocalGpuSubmitInput } from "./local-gpu-adapter";
import {
  buildLocalGpuCapabilityDeclaration,
  LOCAL_GPU_ADAPTER_VERSION,
} from "./local-gpu-execution-authority";
import { LOCAL_GPU_PROVIDER_ID, LOCAL_GPU_WORKER_WORKFLOW } from "@ceo-agent/shared";
import type { ProviderCallbackNormalizationInput, ProviderCallbackReceipt, WorkerFailureClassification } from "@ceo-agent/shared";

export type LocalGpuCanonicalAdapterOptions = {
  readonly cloud: LocalGpuCloudAdapter;
  readonly loadSubmit?: (input: CanonicalAdapterSubmitInput) => Promise<LocalGpuSubmitInput>;
  readonly loadScope?: (input: CanonicalAdapterLookupInput) => Promise<LocalGpuJobScope>;
};

/**
 * Canonical worker binding for the certified LocalGpuCloudAdapter.
 * Signing stays inside that adapter. This class only translates worker
 * submit/lookup calls and never selects another provider.
 */
export class LocalGpuCanonicalAdapter implements CanonicalProviderAdapter {
  readonly providerId = LOCAL_GPU_PROVIDER_ID;
  readonly adapterVersion = LOCAL_GPU_ADAPTER_VERSION;
  readonly cloud: LocalGpuCloudAdapter;

  constructor(private readonly options: LocalGpuCanonicalAdapterOptions) {
    this.cloud = options.cloud;
  }

  describeCapabilities() {
    return [buildLocalGpuCapabilityDeclaration()];
  }

  async submit(input: CanonicalAdapterSubmitInput): Promise<CanonicalAdapterSubmitResult> {
    if (!this.options.loadSubmit) {
      throw new Error("LOCAL_GPU_EXECUTION_PACKAGE_REQUIRED");
    }
    const prepared = await this.options.loadSubmit(input);
    const receipt = await this.cloud.submit(prepared);
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "SUBMITTED",
      providerRequestId: receipt.jobId,
      reconciliationRequired: false,
      operationalMetadata: {
        workflow: receipt.workflow,
        plannedDurationMs: receipt.plannedDurationMs,
        automaticGenerationRetry: receipt.automaticGenerationRetry,
        remoteProviderFallback: receipt.remoteProviderFallback,
      },
    };
  }

  async lookup(input: CanonicalAdapterLookupInput): Promise<CanonicalAdapterLookupResult> {
    const scope = this.options.loadScope
      ? await this.options.loadScope(input)
      : scopeFromEnvelope(input);
    const status = await this.cloud.status(input.providerRequestId, scope);
    if (status.state === "FAILED" || status.state === "CANCELLED") {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "FAILED",
        providerRequestId: input.providerRequestId,
        reconciliationRequired: false,
        failureClassification: failureFromCode("PROVIDER_FAILED", `LOCAL_GPU ${status.state}`, {
          retryable: false,
          terminal: true,
          reconciliationRequired: false,
        }),
      };
    }
    if (status.state !== "COMPLETED") {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "PROCESSING",
        providerRequestId: input.providerRequestId,
        reconciliationRequired: false,
      };
    }
    const result = await this.cloud.result(input.providerRequestId, scope);
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "SUCCEEDED",
      providerRequestId: input.providerRequestId,
      reconciliationRequired: false,
      terminalMedia: {
        mediaType: "video/mp4",
        contentHash: result.contentHash,
        durationMs: result.durationMs,
        ...(result.width ? { width: result.width } : {}),
        ...(result.height ? { height: result.height } : {}),
      },
      operationalMetadata: {
        workflow: LOCAL_GPU_WORKER_WORKFLOW,
        fps: result.fps,
        hasAudio: result.hasAudio,
        automaticGenerationRetry: 0,
        remoteProviderFallback: 0,
      },
    };
  }

  async normalizeCallback(
    _input: ProviderCallbackNormalizationInput,
  ): Promise<ProviderCallbackReceipt> {
    throw new Error("LOCAL_GPU_CALLBACKS_UNSUPPORTED");
  }

  classifyError(input: CanonicalAdapterErrorInput): WorkerFailureClassification {
    const message = input.error instanceof Error ? input.error.message : "LOCAL_GPU failed";
    return failureFromCode("PROVIDER_FAILED", message, {
      retryable: false,
      terminal: true,
      reconciliationRequired: false,
    });
  }
}

function scopeFromEnvelope(input: CanonicalAdapterLookupInput): LocalGpuJobScope {
  const trace = input.envelope.executionContext.trace;
  return {
    actor: {
      userId: trace.actorUserId || input.envelope.tenantId,
      workspaceId: input.envelope.workspaceId,
      organizationPlan: null,
      platformAdminStatus: "ACTIVE_GRANT",
    },
    workspaceId: input.envelope.workspaceId,
    workflow: trace.workflow || LOCAL_GPU_WORKER_WORKFLOW,
    ...(trace.sceneExecutionId ? { sceneExecutionId: trace.sceneExecutionId } : {}),
  };
}

export function registerLocalGpuCanonicalAdapter(
  registry: CanonicalAdapterRegistry,
  options: LocalGpuCanonicalAdapterOptions,
): CanonicalAdapterRegistry {
  registry.register(
    LOCAL_GPU_PROVIDER_ID,
    LOCAL_GPU_ADAPTER_VERSION,
    () => new LocalGpuCanonicalAdapter(options),
  );
  return registry;
}
