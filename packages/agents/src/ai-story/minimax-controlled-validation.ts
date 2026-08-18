/**
 * Sprint 3 PR 3.4B — Controlled real MiniMax validation harness (opt-in only).
 *
 * Requires ALL of:
 * - AI_PROVIDER_MINIMAX_ENABLED=true
 * - AI_PROVIDER_MINIMAX_API_KEY set
 * - EMBEROS_MINIMAX_CONTROLLED_VALIDATION=1
 * - EMBEROS_MINIMAX_VALIDATION_CONFIRM=YES
 *
 * Never runs in the default test suite.
 * One submission only; no cross-provider fallback; no Finalizer.
 * Provider-native idempotency is unsupported — exactly one explicit submit per gate run.
 */
import {
  createMinimaxCanonicalAdapterRegistry,
} from "./minimax-canonical-registry";
import {
  createMemoryMinimaxPayloadResolver,
  MinimaxCanonicalAdapter,
} from "./minimax-canonical-adapter";
import { loadMinimaxAdapterConfig, redactMinimaxAdapterConfig } from "./minimax-config";
import { createExecutionEnvelope } from "@ceo-agent/shared";

export type MinimaxControlledValidationReport = {
  readonly ran: boolean;
  readonly skippedReason?: string;
  readonly billableRequestAccepted: boolean;
  readonly providerRequestId?: string;
  readonly terminalState?: string;
  readonly maxTestCostUsd: number;
  readonly submissions: number;
  readonly config?: ReturnType<typeof redactMinimaxAdapterConfig>;
  readonly error?: string;
};

const MAX_TEST_COST_USD = 0.5;

function envFlag(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function isMinimaxControlledValidationEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.EMBEROS_MINIMAX_CONTROLLED_VALIDATION === "1" &&
    env.EMBEROS_MINIMAX_VALIDATION_CONFIRM === "YES"
  );
}

export async function runMinimaxControlledValidation(
  env: NodeJS.ProcessEnv = process.env
): Promise<MinimaxControlledValidationReport> {
  if (!isMinimaxControlledValidationEnabled(env)) {
    return {
      ran: false,
      skippedReason:
        "Set EMBEROS_MINIMAX_CONTROLLED_VALIDATION=1 and EMBEROS_MINIMAX_VALIDATION_CONFIRM=YES to run",
      billableRequestAccepted: false,
      maxTestCostUsd: MAX_TEST_COST_USD,
      submissions: 0,
    };
  }

  try {
    const config = loadMinimaxAdapterConfig(env);
    const payloadUri = "memory://minimax-controlled/scene-a";
    const payload = {
      prompt: "Controlled validation clip: neutral product on white table, no logos invented.",
      durationSec: 4,
      aspectRatio: "9:16",
      resolution: "768P",
      identityConstraints: ["preserve product silhouette"],
      assetReferences: [],
    };
    const resolver = createMemoryMinimaxPayloadResolver({
      [payloadUri]: payload,
    });
    const adapter = new MinimaxCanonicalAdapter({
      config,
      payloadResolver: resolver,
    });
    // Registry wiring proof — MiniMax only.
    createMinimaxCanonicalAdapterRegistry({ config, payloadResolver: resolver });

    const envelope = await createExecutionEnvelope({
      version: "1",
      envelopeId: "envelope-minimax-controlled-validation",
      payloadReference: payloadUri,
      tenantId: "10000000-0000-4000-8000-000000000001",
      workspaceId: "10000000-0000-4000-8000-000000000002",
      executionContext: {
        executionId: "execution-minimax-controlled",
        correlationId: "10000000-0000-5000-8000-000000000701",
        pipelineRunId: "10000000-0000-4000-8000-000000000101",
        idempotencyKey: "minimax-controlled-validation-v1",
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
          executionId: "execution-minimax-controlled",
          tenantId: "10000000-0000-4000-8000-000000000001",
          workspaceId: "10000000-0000-4000-8000-000000000002",
          campaignId: "10000000-0000-4000-8000-000000000003",
          pipelineRunId: "10000000-0000-4000-8000-000000000101",
          capabilityId: "animation-video-generation",
          capabilityVersion: "1.0.0",
          idempotencyKey: "minimax-controlled-validation-v1",
          deterministicFingerprint:
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        requestSchemaVersion: "1.0.0",
        resultSchemaVersion: "1.0.0",
        normalizedPayloadReference: {
          uri: payloadUri,
          contentHash:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
          correlationId: "10000000-0000-5000-8000-000000000701",
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
      providerAttemptId: "attempt-minimax-controlled",
      dispatchId: "dispatch-minimax-controlled",
      idempotencyKey: "minimax-controlled-validation-v1",
      timeoutDeadline: envelope.executionContext.timeoutDeadline,
    });

    if (submitted.acceptanceClassification !== "ACCEPTED" || !submitted.providerRequestId) {
      return {
        ran: true,
        billableRequestAccepted: false,
        maxTestCostUsd: MAX_TEST_COST_USD,
        submissions: 1,
        config: redactMinimaxAdapterConfig(config),
        terminalState: submitted.canonicalProviderState,
        error: submitted.failureClassification?.sanitizedMessage,
      };
    }

    const deadline = Date.now() + 90_000;
    let lookup = await adapter.lookup({
      providerRequestId: submitted.providerRequestId,
      envelope,
      providerAttemptId: "attempt-minimax-controlled",
      dispatchId: "dispatch-minimax-controlled",
    });
    while (
      lookup.canonicalProviderState === "PROCESSING" &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      lookup = await adapter.lookup({
        providerRequestId: submitted.providerRequestId,
        envelope,
        providerAttemptId: "attempt-minimax-controlled",
        dispatchId: "dispatch-minimax-controlled",
      });
    }

    return {
      ran: true,
      billableRequestAccepted: true,
      providerRequestId: submitted.providerRequestId,
      terminalState: lookup.canonicalProviderState,
      maxTestCostUsd: MAX_TEST_COST_USD,
      submissions: 1,
      config: redactMinimaxAdapterConfig(config),
    };
  } catch (error) {
    return {
      ran: true,
      billableRequestAccepted: false,
      maxTestCostUsd: MAX_TEST_COST_USD,
      submissions: 0,
      error: String((error as { message?: string })?.message ?? error).slice(0, 300),
      skippedReason: envFlag("AI_PROVIDER_MINIMAX_API_KEY")
        ? undefined
        : "credentials or config invalid",
    };
  }
}
