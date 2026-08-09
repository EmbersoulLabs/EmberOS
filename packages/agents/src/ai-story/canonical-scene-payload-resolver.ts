/**
 * Production Canonical Scene Payload resolution for Provider Adapters.
 *
 * Scheduling persists an Execution Envelope whose normalizedPayloadReference is a
 * content-addressed identity, not an embedded Adapter payload body. Adapters must
 * reconstruct a Canonical Scene Payload from the frozen compiled instructions for
 * the Scene covered by the Envelope trace.
 */
import type {
  AiStorySceneCompiledInstructions,
  AiStorySceneExecutionIntent,
  ExecutionEnvelope,
} from "@ceo-agent/shared";
import type { MinimaxPayloadResolver } from "./minimax-request-mapping";
import type { SeedancePayloadResolver } from "./seedance-request-mapping";

export type CanonicalScenePayloadForAdapter = {
  readonly kind: "animation-video-generation";
  readonly prompt: string;
  readonly durationMs: number;
  readonly aspectRatio: "9:16";
  readonly resolution?: string;
  readonly identityConstraints: readonly string[];
  readonly shotMap: readonly {
    readonly shotId: string;
    readonly order: number;
    readonly durationMs: number;
  }[];
  /** Text-to-video only unless signed provider-accessible URIs are supplied. */
  readonly assetReferences: readonly [];
};

export function mapCompiledInstructionsToCanonicalScenePayload(input: {
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly intent?: AiStorySceneExecutionIntent;
  /** Provider-specific minimal-cost override (e.g. Seedance 480p, MiniMax 768P). */
  readonly resolution?: string;
}): CanonicalScenePayloadForAdapter {
  const instructions = input.instructions;
  const shotLines = [...instructions.shots]
    .sort(
      (left, right) =>
        left.order - right.order || left.shotId.localeCompare(right.shotId)
    )
    .map(
      (shot, index) =>
        `${index + 1}. ${shot.shotId}: ${shot.information} (${shot.cameraType}, ${shot.emotion})`
    );
  const promptParts = [
    instructions.purpose.trim(),
    instructions.continuityNotes?.trim()
      ? `Continuity: ${instructions.continuityNotes.trim()}`
      : "",
    shotLines.length > 0 ? `Shots:\n${shotLines.join("\n")}` : "",
  ].filter(Boolean);
  const prompt = promptParts.join("\n\n");
  if (!prompt.trim()) {
    throw new Error("Compiled instructions are missing a usable prompt/purpose");
  }

  const durationMs =
    input.intent?.plannedDurationMs ??
    instructions.durationMs ??
    instructions.shots.reduce((sum, shot) => sum + (shot.durationMs ?? 0), 0) ??
    4000;

  return {
    kind: "animation-video-generation",
    prompt,
    durationMs: durationMs > 0 ? durationMs : 4000,
    aspectRatio: "9:16",
    ...(input.resolution ? { resolution: input.resolution } : {}),
    identityConstraints: [...instructions.productIdentityConstraints],
    shotMap: [...instructions.shots]
      .sort(
        (left, right) =>
          left.order - right.order || left.shotId.localeCompare(right.shotId)
      )
      .map((shot) => ({
        shotId: shot.shotId,
        order: shot.order,
        durationMs: shot.durationMs,
      })),
    assetReferences: [],
  };
}

export type CompilationBackedPayloadResolverDeps = {
  readonly getEnvelopeByPayloadReference: (
    payloadReference: string
  ) => Promise<ExecutionEnvelope | null>;
  readonly getCompilationByExecutionPlanId: (executionPlanId: string) => Promise<{
    readonly intents: readonly AiStorySceneExecutionIntent[];
    readonly instructionsBySceneExecutionId: Readonly<
      Record<string, AiStorySceneCompiledInstructions>
    >;
  } | null>;
  /** Optional provider-owned resolution override for minimal-cost acceptance. */
  readonly resolution?: string;
};

/**
 * Resolve Adapter payload from Envelope → Execution Plan compilation → instructions.
 * Fail closed when ownership trace or frozen instructions are missing.
 */
export function createCompilationBackedCanonicalPayloadResolver(
  deps: CompilationBackedPayloadResolverDeps
): SeedancePayloadResolver & MinimaxPayloadResolver {
  return {
    async resolve(reference) {
      const envelope =
        (await deps.getEnvelopeByPayloadReference(reference.uri)) ??
        (await deps.getEnvelopeByPayloadReference(reference.contentHash));
      if (!envelope) {
        throw new Error(
          `Canonical payload Envelope not found for ${reference.uri}`
        );
      }

      const trace = envelope.executionContext.trace ?? {};
      const executionPlanId = trace.executionPlanId?.trim();
      const sceneExecutionId = trace.sceneExecutionId?.trim();
      if (!executionPlanId || !sceneExecutionId) {
        throw new Error(
          "Execution Envelope trace is missing executionPlanId/sceneExecutionId"
        );
      }

      const compilation =
        await deps.getCompilationByExecutionPlanId(executionPlanId);
      if (!compilation) {
        throw new Error(
          `Scene compilation not found for executionPlanId=${executionPlanId}`
        );
      }

      const instructions =
        compilation.instructionsBySceneExecutionId[sceneExecutionId];
      if (!instructions) {
        throw new Error(
          `Compiled instructions missing for sceneExecutionId=${sceneExecutionId}`
        );
      }

      const intent = compilation.intents.find(
        (candidate) => candidate.identity.sceneExecutionId === sceneExecutionId
      );

      return mapCompiledInstructionsToCanonicalScenePayload({
        instructions,
        intent,
        resolution: deps.resolution,
      });
    },
  };
}
