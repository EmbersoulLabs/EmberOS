/**
 * Sprint 3 PR 3.7 Phase F — opt-in live Provider full-chain acceptance helper.
 *
 * Requires ALL of:
 * - RUN_DB_INTEGRATION_TESTS=1 + DATABASE_URL
 * - EMBEROS_PR37_PHASE_F_LIVE_GATE=1
 * - EMBEROS_PR37_PHASE_F_LIVE_CONFIRM=YES
 * - provider-specific enable + API key (+ MiniMax base URL/model)
 *
 * Never runs in default CI. Uses REAL Canonical Adapters (no test adapters).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionEnvelopeRepository,
} from "@ceo-agent/db";
import { resetAiProviderConfigCache } from "@ceo-agent/shared";
import { authorizeAndExecuteExecutionPlan } from "../../packages/agents/src/ai-story/authorize-and-execute-execution-plan";
import { createHttpsProviderMediaAccessPort } from "../../packages/agents/src/ai-story/assembly-runtime-media-access";
import { createCompilationBackedCanonicalPayloadResolver } from "../../packages/agents/src/ai-story/canonical-scene-payload-resolver";
import { CanonicalAdapterRegistry } from "../../packages/agents/src/ai-story/canonical-provider-adapter";
import { deriveProductRuntimeProjection } from "../../packages/agents/src/ai-story/derive-product-runtime-projection";
import { loadMinimaxAdapterConfig } from "../../packages/agents/src/ai-story/minimax-config";
import { registerMinimaxCanonicalAdapter } from "../../packages/agents/src/ai-story/minimax-canonical-registry";
import { loadSeedanceAdapterConfig } from "../../packages/agents/src/ai-story/seedance-config";
import { registerSeedanceCanonicalAdapter } from "../../packages/agents/src/ai-story/seedance-canonical-registry";
import { PHASE_2A_IDS } from "./ai-story-phase-2a";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  cleanupPr32Tenant,
  seedPr32Tenant,
} from "./ai-story-pr32-scheduling";
import { prepareReadyForCanonicalExecute } from "./ai-story-pr37-phase-d-execute";
import {
  countRows,
  createPhaseCCoordinator,
  ffmpegAvailable,
  scheduleAndDispatchScene,
} from "./ai-story-pr37-phase-c-e2e";

export type PhaseFLiveProvider = "seedance" | "minimax";

export type PhaseFLiveGateReport = {
  readonly ran: boolean;
  readonly skippedReason?: string;
  readonly provider: PhaseFLiveProvider;
  readonly executionPlanId?: string;
  readonly runtimeAuthorizationId?: string;
  readonly dispatchId?: string;
  readonly counts?: Record<string, number>;
  readonly productStatus?: string;
  readonly hasFinalStoryResult?: boolean;
  readonly billableUsageRows?: number;
  readonly billableCostRows?: number;
  readonly continuationStatus?: string;
  readonly workerState?: string;
  readonly providerRequestId?: string | null;
  readonly error?: string;
};

export function isPhaseFLiveGateEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.EMBEROS_PR37_PHASE_F_LIVE_GATE === "1" &&
    env.EMBEROS_PR37_PHASE_F_LIVE_CONFIRM === "YES"
  );
}

export function phaseFProviderReady(
  provider: PhaseFLiveProvider,
  env: NodeJS.ProcessEnv = process.env
): { readonly ok: boolean; readonly reason?: string } {
  if (provider === "seedance") {
    if (env.AI_PROVIDER_SEEDANCE_ENABLED !== "true") {
      return { ok: false, reason: "AI_PROVIDER_SEEDANCE_ENABLED must be true" };
    }
    if (!env.AI_PROVIDER_SEEDANCE_API_KEY?.trim()) {
      return { ok: false, reason: "AI_PROVIDER_SEEDANCE_API_KEY missing" };
    }
    if (!env.AI_PROVIDER_SEEDANCE_BASE_URL?.trim()) {
      return { ok: false, reason: "AI_PROVIDER_SEEDANCE_BASE_URL missing" };
    }
    if (!env.AI_PROVIDER_SEEDANCE_DEFAULT_MODEL?.trim()) {
      return { ok: false, reason: "AI_PROVIDER_SEEDANCE_DEFAULT_MODEL missing" };
    }
    return { ok: true };
  }
  if (env.AI_PROVIDER_MINIMAX_ENABLED !== "true") {
    return { ok: false, reason: "AI_PROVIDER_MINIMAX_ENABLED must be true" };
  }
  if (!env.AI_PROVIDER_MINIMAX_API_KEY?.trim()) {
    return { ok: false, reason: "AI_PROVIDER_MINIMAX_API_KEY missing" };
  }
  if (!env.AI_PROVIDER_MINIMAX_BASE_URL?.trim()) {
    return { ok: false, reason: "AI_PROVIDER_MINIMAX_BASE_URL missing" };
  }
  if (!env.AI_PROVIDER_MINIMAX_DEFAULT_MODEL?.trim()) {
    return { ok: false, reason: "AI_PROVIDER_MINIMAX_DEFAULT_MODEL missing" };
  }
  return { ok: true };
}

function createLiveCanonicalAdapterRegistry(env: NodeJS.ProcessEnv): CanonicalAdapterRegistry {
  const envelopes = new ExecutionEnvelopeRepository();
  const persistence = new AiStorySceneExecutionPersistenceRepository();
  const seedanceResolver = createCompilationBackedCanonicalPayloadResolver({
    getEnvelopeByPayloadReference: (ref) =>
      envelopes.getEnvelopeByPayloadReference(ref),
    getCompilationByExecutionPlanId: (id) => persistence.getByExecutionPlanId(id),
    resolution: "480p",
  });
  const minimaxResolver = createCompilationBackedCanonicalPayloadResolver({
    getEnvelopeByPayloadReference: (ref) =>
      envelopes.getEnvelopeByPayloadReference(ref),
    getCompilationByExecutionPlanId: (id) => persistence.getByExecutionPlanId(id),
    resolution: "768P",
  });
  const registry = new CanonicalAdapterRegistry();
  registerSeedanceCanonicalAdapter(registry, {
    config: loadSeedanceAdapterConfig(env, { requireEnabled: true }),
    payloadResolver: seedanceResolver,
  });
  registerMinimaxCanonicalAdapter(registry, {
    config: loadMinimaxAdapterConfig(env, { requireEnabled: true }),
    payloadResolver: minimaxResolver,
  });
  return registry;
}

export async function runPhaseFLiveFullChainGate(input: {
  readonly sql: Sql;
  readonly provider: PhaseFLiveProvider;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<PhaseFLiveGateReport> {
  const env = input.env ?? process.env;
  if (!isPhaseFLiveGateEnabled(env)) {
    return {
      ran: false,
      provider: input.provider,
      skippedReason:
        "Set EMBEROS_PR37_PHASE_F_LIVE_GATE=1 and EMBEROS_PR37_PHASE_F_LIVE_CONFIRM=YES",
    };
  }
  const ready = phaseFProviderReady(input.provider, env);
  if (!ready.ok) {
    return {
      ran: false,
      provider: input.provider,
      skippedReason: ready.reason,
    };
  }
  if (!ffmpegAvailable()) {
    return {
      ran: false,
      provider: input.provider,
      skippedReason: "ffmpeg/ffprobe required for Assembly/FSR gate",
    };
  }

  const artifactRoot = await mkdtemp(join(tmpdir(), `pr37f-${input.provider}-`));
  const previousLookupPoll = env.EMBEROS_AI_STORY_LOOKUP_POLL_MS;
  const previousLookupDeadline = env.EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS;
  // Live providers routinely take minutes; pin a Phase-F floor unless caller overrides higher.
  if (!env.EMBEROS_AI_STORY_LOOKUP_POLL_MS) {
    env.EMBEROS_AI_STORY_LOOKUP_POLL_MS = "5000";
  }
  if (
    !env.EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS ||
    Number(env.EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS) < 600_000
  ) {
    env.EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS = "900000";
  }
  try {
    resetAiProviderConfigCache();
    await cleanupPr32Tenant(input.sql);
    await seedPr32Tenant(input.sql, undefined, PR32_USER_A, `pr37f-${input.provider}`);

    const prepared = await prepareReadyForCanonicalExecute({
      purpose: `pr37f-live-${input.provider}`,
      ids: PHASE_2A_IDS,
      userId: PR32_USER_A,
      sceneOrder: [0],
    });

    const adapterVersion =
      input.provider === "minimax"
        ? env.AI_PROVIDER_MINIMAX_ADAPTER_VERSION?.trim() || "1.0.0"
        : env.AI_PROVIDER_SEEDANCE_ADAPTER_VERSION?.trim() || "1.0.0";

    const router = new FixedSeedanceRouter({
      selectedProviderId: input.provider,
      selectedAdapterVersion: adapterVersion,
    });

    const executed = await authorizeAndExecuteExecutionPlan({
      executionPlanId: prepared.executionPlanId,
      actorUserId: PR32_USER_A,
      ownership: prepared.ownership,
      router,
    });

    const adapters = createLiveCanonicalAdapterRegistry(env);
    let mediaAccessError: string | undefined;
    const baseMediaAccess = createHttpsProviderMediaAccessPort({
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });
    const mediaAccess = {
      resolveToLocalPath: async (
        resolveInput: Parameters<typeof baseMediaAccess.resolveToLocalPath>[0]
      ) => {
        try {
          return await baseMediaAccess.resolveToLocalPath(resolveInput);
        } catch (error) {
          mediaAccessError = String(
            (error as { message?: string; classification?: string })?.message ??
              error
          ).slice(0, 300);
          throw error;
        }
      },
    };
    const { coordinator } = await createPhaseCCoordinator({
      adapters,
      artifactRoot,
      pathByUri: new Map(),
      mediaAccess,
      expectedOwnership: {
        orgId: PHASE_2A_IDS.orgId,
        workspaceId: PHASE_2A_IDS.workspaceId,
      },
    });

    const { dispatch } = await scheduleAndDispatchScene({
      sql: input.sql,
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId: executed.runtimeAuthorizationId,
      router,
    });

    const outcome = await coordinator.continueFromDispatch(dispatch.dispatchId);
    const projection = await deriveProductRuntimeProjection({
      executionPlanId: prepared.executionPlanId,
      callerRole: "operator",
    });
    const counts = await countRows(
      input.sql,
      PHASE_2A_IDS.workspaceId,
      PHASE_2A_IDS.orgId
    );
    const workerResult =
      outcome && "workerResult" in outcome ? outcome.workerResult : undefined;
    const workerState = workerResult?.workerState;
    const providerRequestId = workerResult?.providerRequestId ?? null;
    const assembly =
      outcome && "assembly" in outcome ? outcome.assembly : undefined;
    const assemblyFailure =
      assembly && assembly.status === "FAILED"
        ? `${assembly.classification}:${assembly.message}`
        : assembly
          ? `assemblyStatus=${assembly.status}`
          : "n/a";

    if (projection.status !== "SUCCEEDED" || counts.finalStoryResult !== 1) {
      return {
        ran: true,
        provider: input.provider,
        executionPlanId: prepared.executionPlanId,
        runtimeAuthorizationId: executed.runtimeAuthorizationId,
        dispatchId: dispatch.dispatchId,
        counts,
        productStatus: projection.status,
        hasFinalStoryResult: counts.finalStoryResult >= 1,
        billableUsageRows: counts.usage,
        billableCostRows: counts.cost,
        continuationStatus: outcome.status,
        workerState,
        providerRequestId,
        error: `Gate did not reach SUCCEEDED/FSR (outcome=${outcome.status}, workerState=${workerState ?? "n/a"}, providerState=${workerResult?.canonicalProviderState ?? "n/a"}, acceptance=${workerResult?.acceptanceClassification ?? "n/a"}, providerRequestId=${providerRequestId ?? "null"}, failure=${workerResult?.failureClassification?.sanitizedMessage ?? "n/a"}, assembly=${assemblyFailure}, mediaAccessError=${mediaAccessError ?? "n/a"}, assemblyDetail=${assembly ? JSON.stringify(assembly).slice(0, 400) : "n/a"}, status=${projection.status})`,
      };
    }

    if (counts.usage !== 1 || counts.cost !== 1) {
      return {
        ran: true,
        provider: input.provider,
        executionPlanId: prepared.executionPlanId,
        runtimeAuthorizationId: executed.runtimeAuthorizationId,
        dispatchId: dispatch.dispatchId,
        counts,
        productStatus: projection.status,
        hasFinalStoryResult: true,
        billableUsageRows: counts.usage,
        billableCostRows: counts.cost,
        error: `Expected exactly one usage/cost row (usage=${counts.usage}, cost=${counts.cost})`,
      };
    }

    return {
      ran: true,
      provider: input.provider,
      executionPlanId: prepared.executionPlanId,
      runtimeAuthorizationId: executed.runtimeAuthorizationId,
      dispatchId: dispatch.dispatchId,
      counts,
      productStatus: projection.status,
      hasFinalStoryResult: true,
      billableUsageRows: counts.usage,
      billableCostRows: counts.cost,
    };
  } catch (error) {
    return {
      ran: true,
      provider: input.provider,
      error: String((error as { message?: string })?.message ?? error).slice(0, 500),
    };
  } finally {
    if (previousLookupPoll === undefined) {
      delete env.EMBEROS_AI_STORY_LOOKUP_POLL_MS;
    } else {
      env.EMBEROS_AI_STORY_LOOKUP_POLL_MS = previousLookupPoll;
    }
    if (previousLookupDeadline === undefined) {
      delete env.EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS;
    } else {
      env.EMBEROS_AI_STORY_LOOKUP_DEADLINE_MS = previousLookupDeadline;
    }
    resetAiProviderConfigCache();
    await rm(artifactRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
