/**
 * Sprint 3 PR 3.4A — Controlled real Seedance validation harness (opt-in only).
 *
 * Requires ALL of:
 * - AI_PROVIDER_SEEDANCE_ENABLED=true
 * - AI_PROVIDER_SEEDANCE_API_KEY set
 * - EMBEROS_SEEDANCE_CONTROLLED_VALIDATION=1
 * - EMBEROS_SEEDANCE_VALIDATION_CONFIRM=YES
 *
 * Never runs in the default test suite.
 * One submission only; no cross-provider fallback; no Finalizer.
 * Provider-native idempotency is unsupported — exactly one explicit submit per gate run.
 */
import {
  createSeedanceCanonicalAdapterRegistry,
} from "./seedance-canonical-registry";
import {
  createMemorySeedancePayloadResolver,
  SeedanceCanonicalAdapter,
} from "./seedance-canonical-adapter";
import { loadSeedanceAdapterConfig, redactSeedanceAdapterConfig } from "./seedance-config";
import { createExecutionEnvelope } from "@ceo-agent/shared";

export type SeedanceControlledValidationReport = {
  readonly ran: boolean;
  readonly skippedReason?: string;
  readonly billableRequestAccepted: boolean;
  readonly providerRequestId?: string;
  readonly terminalState?: string;
  readonly maxTestCostUsd: number;
  readonly submissions: number;
  readonly config?: ReturnType<typeof redactSeedanceAdapterConfig>;
  readonly error?: string;
};

const MAX_TEST_COST_USD = 0.5;

function envFlag(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function isSeedanceControlledValidationEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.EMBEROS_SEEDANCE_CONTROLLED_VALIDATION === "1" &&
    env.EMBEROS_SEEDANCE_VALIDATION_CONFIRM === "YES"
  );
}

export async function runSeedanceControlledValidation(
  env: NodeJS.ProcessEnv = process.env
): Promise<SeedanceControlledValidationReport> {
  if (!isSeedanceControlledValidationEnabled(env)) {
    return {
      ran: false,
      skippedReason:
        "Set EMBEROS_SEEDANCE_CONTROLLED_VALIDATION=1 and EMBEROS_SEEDANCE_VALIDATION_CONFIRM=YES to run",
      billableRequestAccepted: false,
      maxTestCostUsd: MAX_TEST_COST_USD,
      submissions: 0,
    };
  }

  try {
    const config = loadSeedanceAdapterConfig(env);
    const payloadUri = "memory://seedance-controlled/scene-a";
    const payload = {
      prompt: "Controlled validation clip: neutral product on white table, no logos invented.",
      durationSec: 4,
      aspectRatio: "9:16",
      resolution: "480p",
      identityConstraints: ["preserve product silhouette"],
      assetReferences: [],
    };
    const resolver = createMemorySeedancePayloadResolver({
      [payloadUri]: payload,
    });
    const adapter = new SeedanceCanonicalAdapter({
      config,
      payloadResolver: resolver,
    });
    // Registry wiring proof — Seedance only.
    createSeedanceCanonicalAdapterRegistry({ config, payloadResolver: resolver });

    const envelope = await createExecutionEnvelope({
      version: "1",
      envelopeId: "envelope-seedance-controlled-validation",
      payloadReference: payloadUri,
      tenantId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      executionContext: {
        executionId: "execution-seedance-controlled",
        correlationId: "10000000-0000-5000-8000-000000000601",
        pipelineRunId: "10000000-0000-4000-8000-000000000101",
        idempotencyKey: "seedance-controlled-validation-v1",
        timeoutDeadline: new Date(Date.now() + 120_000).toISOString(),
        dataHandling: {
          sensitiveData: false,
          externalProcessingAllowed: true,
          providerTrainingAllowed: false,
        },
        trace: { purpose: "controlled-validation" },
      },
      capabilityId: "animation-video-generation",
      capabilityVersion: "1.0.0",
      providerPolicySnapshot: { automaticFallbackEnabled: false },
      canonicalRequest: {
        contractVersion: "1",
        executionIdentity: {
          executionId: "execution-seedance-controlled",
          tenantId: "10000000-0000-4000-8000-000000000001",
          workspaceId: "10000000-0000-4000-8000-000000000002",
          campaignId: "10000000-0000-4000-8000-000000000003",
          pipelineRunId: "10000000-0000-4000-8000-000000000101",
          capabilityId: "animation-video-generation",
          capabilityVersion: "1.0.0",
          idempotencyKey: "seedance-controlled-validation-v1",
          deterministicFingerprint:
            "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        },
        requestSchemaVersion: "1.0.0",
        resultSchemaVersion: "1.0.0",
        normalizedPayloadReference: {
          uri: payloadUri,
          contentHash:
            "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          mediaType: "application/json",
        },
        outputSchema: {
          schemaId: "AnimationVideoResult",
          schemaVersion: "1.0.0",
        },
        contextVersions: {
          "ai-story-scene-instructions": "1.0.0",
          "ai-story-runtime-authorization": "1.0.0",
          "ai-story-scene-routing": "1.0.0",
        },
        correlation: {
          correlationId: "10000000-0000-5000-8000-000000000601",
          pipelineRunId: "10000000-0000-4000-8000-000000000101",
        },
        timeoutPolicy: { timeoutMs: 120_000, reconciliationDelayMs: 5_000 },
        retryPolicy: {
          maxAttempts: 1,
          initialDelayMs: 500,
          maximumDelayMs: 500,
          backoffMultiplier: 1,
        },
        providerConstraints: { executionLookupRequired: true },
      },
      createdAt: new Date().toISOString(),
    });

    const submitted = await adapter.submit({
      envelope,
      providerAttemptId: "attempt-seedance-controlled",
      dispatchId: "dispatch-seedance-controlled",
      idempotencyKey: "seedance-controlled-validation-v1",
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });

    if (submitted.acceptanceClassification !== "ACCEPTED" || !submitted.providerRequestId) {
      return {
        ran: true,
        billableRequestAccepted: false,
        maxTestCostUsd: MAX_TEST_COST_USD,
        submissions: 1,
        config: redactSeedanceAdapterConfig(config),
        terminalState: submitted.canonicalProviderState,
        error: submitted.failureClassification?.sanitizedMessage,
      };
    }

    const deadline = Date.now() + 90_000;
    let lookup = await adapter.lookup({
      providerRequestId: submitted.providerRequestId,
      envelope,
      providerAttemptId: "attempt-seedance-controlled",
      dispatchId: "dispatch-seedance-controlled",
    });
    while (
      lookup.canonicalProviderState === "PROCESSING" &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      lookup = await adapter.lookup({
        providerRequestId: submitted.providerRequestId,
        envelope,
        providerAttemptId: "attempt-seedance-controlled",
        dispatchId: "dispatch-seedance-controlled",
      });
    }

    return {
      ran: true,
      billableRequestAccepted: true,
      providerRequestId: submitted.providerRequestId,
      terminalState: lookup.canonicalProviderState,
      maxTestCostUsd: MAX_TEST_COST_USD,
      submissions: 1,
      config: redactSeedanceAdapterConfig(config),
    };
  } catch (error) {
    return {
      ran: true,
      billableRequestAccepted: false,
      maxTestCostUsd: MAX_TEST_COST_USD,
      submissions: 0,
      error: String((error as { message?: string })?.message ?? error).slice(0, 300),
      skippedReason: envFlag("AI_PROVIDER_SEEDANCE_API_KEY")
        ? undefined
        : "credentials or config invalid",
    };
  }
}
