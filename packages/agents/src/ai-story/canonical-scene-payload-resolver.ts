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
import { integrityHash } from "./scene-execution-compiler";
import {
  buildProductGroundingContract,
  CREATIVE_T2V_MODE,
  PRIMARY_PRODUCT_REFERENCE_ROLE,
  PRODUCT_GROUNDED_VIDEO_MODE,
  PRODUCT_LOCK_PROMPT,
  type ProductAuthorityAssessment,
  type ProductVisualAuthorityCertification,
  type ProductGroundedProviderMode,
  type ProductGroundingContract,
} from "./product-grounding-contract";
import { applyRetryInputRevision } from "./differentiated-retry-service";

export const CANONICAL_PRODUCT_REFERENCE_ROLE = PRIMARY_PRODUCT_REFERENCE_ROLE;

export type CanonicalProductReference = {
  readonly assetId: string;
  readonly role: typeof CANONICAL_PRODUCT_REFERENCE_ROLE;
  readonly continuityScope: "STORY";
};

export type ProductIdentityCapsule = {
  readonly productAssetId?: string;
  readonly productReferencePresent: boolean;
  readonly continuityFromSceneId?: string;
  readonly referenceRoles: readonly [typeof CANONICAL_PRODUCT_REFERENCE_ROLE] | readonly [];
  readonly identityFingerprint: string;
};

export type CanonicalScenePayloadForAdapter = {
  readonly kind: "animation-video-generation";
  readonly generationMode:
    | typeof PRODUCT_GROUNDED_VIDEO_MODE
    | typeof CREATIVE_T2V_MODE;
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
  /** Stable Campaign Asset identities only. Provider access is resolved just-in-time. */
  readonly assetReferences: readonly CanonicalProductReference[];
  readonly productIdentityCapsule: ProductIdentityCapsule;
  readonly productGrounding?: ProductGroundingContract;
  readonly visualAuthorityCertification?: ProductVisualAuthorityCertification;
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function assertCrossSceneProductAssetContinuity(
  intents: readonly AiStorySceneExecutionIntent[]
): void {
  const ordered = [...intents].sort(
    (left, right) => left.identity.sceneOrder - right.identity.sceneOrder
  );
  const expected = sortedUnique(ordered[0]?.referencedAssetIds ?? []);
  for (const intent of ordered.slice(1)) {
    const actual = sortedUnique(intent.referencedAssetIds);
    if (!sameValues(expected, actual)) {
      throw new Error(
        `Cross-Scene product asset mismatch at sceneId=${intent.identity.sceneId}`
      );
    }
  }
}

export function mapCompiledInstructionsToCanonicalScenePayload(input: {
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly intent?: AiStorySceneExecutionIntent;
  readonly continuityFromSceneId?: string;
  /** Server-certified visual comparison. Missing comparison fails closed for later Scenes. */
  readonly productAuthorityAssessment?: ProductAuthorityAssessment;
  /** Server-authoritative proof; never supplied by browser/client input. */
  readonly visualAuthorityCertification?: ProductVisualAuthorityCertification;
  /** Provider-mode certification is explicit; generic reference T2V is never inferred as exact. */
  readonly productGroundedProviderMode?: ProductGroundedProviderMode;
  readonly productGroundedProviderModeCertified?: boolean;
  /** Provider-specific minimal-cost override (e.g. Seedance 480p, MiniMax 768P). */
  readonly resolution?: string;
}): CanonicalScenePayloadForAdapter {
  const instructions = input.instructions;
  const instructionAssetIds = sortedUnique(instructions.referencedAssetIds);
  const intentAssetIds = input.intent
    ? sortedUnique(input.intent.referencedAssetIds)
    : instructionAssetIds;
  if (!sameValues(instructionAssetIds, intentAssetIds)) {
    throw new Error("Compiled Scene intent and instruction product assets do not match");
  }
  const assetReferences: CanonicalProductReference[] = intentAssetIds.map((assetId) => ({
    assetId,
    role: CANONICAL_PRODUCT_REFERENCE_ROLE,
    continuityScope: "STORY",
  }));
  const productIdentityCapsule: ProductIdentityCapsule = {
    ...(intentAssetIds[0] ? { productAssetId: intentAssetIds[0] } : {}),
    productReferencePresent: intentAssetIds.length > 0,
    ...(input.continuityFromSceneId
      ? { continuityFromSceneId: input.continuityFromSceneId }
      : {}),
    referenceRoles: intentAssetIds.length > 0 ? [CANONICAL_PRODUCT_REFERENCE_ROLE] : [],
    identityFingerprint: integrityHash({
      kind: "ai-story-product-identity-capsule",
      productAssetIds: intentAssetIds,
      continuityFromSceneId: input.continuityFromSceneId ?? null,
    }),
  };
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
    intentAssetIds.length > 0
      ? "Image 1 = the canonical Campaign Product Asset and PRIMARY_PRODUCT authority."
      : "",
    instructions.purpose.trim(),
    instructions.continuityNotes?.trim()
      ? `Continuity: ${instructions.continuityNotes.trim()}`
      : "",
    shotLines.length > 0 ? `Shots:\n${shotLines.join("\n")}` : "",
    intentAssetIds.length > 0 ? PRODUCT_LOCK_PROMPT : "",
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
    generationMode:
      intentAssetIds.length > 0 ? PRODUCT_GROUNDED_VIDEO_MODE : CREATIVE_T2V_MODE,
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
    assetReferences,
    productIdentityCapsule,
    ...(intentAssetIds[0]
      ? {
          productGrounding: buildProductGroundingContract({
            productAssetId: intentAssetIds[0],
            instructions,
            ...(input.continuityFromSceneId
              ? { continuityFromSceneId: input.continuityFromSceneId }
              : {}),
            ...(input.visualAuthorityCertification
              ? {
                  previousSceneVisualAuthorityUsed:
                    input.visualAuthorityCertification
                      .previousSceneVisualAuthorityUsed,
                }
              : {}),
            ...(input.productAuthorityAssessment
              ? { authorityAssessment: input.productAuthorityAssessment }
              : {}),
            ...(input.productGroundedProviderMode
              ? { providerMode: input.productGroundedProviderMode }
              : {}),
            ...(input.productGroundedProviderModeCertified !== undefined
              ? {
                  providerModeCertified:
                    input.productGroundedProviderModeCertified,
                }
              : {}),
          }),
          ...(input.visualAuthorityCertification
            ? {
                visualAuthorityCertification:
                  input.visualAuthorityCertification,
              }
            : {}),
        }
      : {}),
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
  readonly getRetryInputRevisionById?: (
    retryInputRevisionId: string
  ) => Promise<import("@ceo-agent/shared").SceneAttemptInputRevisionFact | null>;
  /** Optional provider-owned resolution override for minimal-cost acceptance. */
  readonly resolution?: string;
  /** Provider-owned request-shape certification; authority assessment remains separate. */
  readonly productGroundedProviderMode?: ProductGroundedProviderMode;
  readonly productGroundedProviderModeCertified?: boolean;
  readonly certifyProductVisualAuthority?: (input: {
    readonly productAssetId: string;
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly executionPlanId: string;
    readonly sceneExecutionId: string;
  }) => Promise<ProductVisualAuthorityCertification>;
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

      const baseInstructions =
        compilation.instructionsBySceneExecutionId[sceneExecutionId];
      if (!baseInstructions) {
        throw new Error(
          `Compiled instructions missing for sceneExecutionId=${sceneExecutionId}`
        );
      }
      const retryInputRevisionId = trace.retryInputRevisionId?.trim();
      const retryInputRevision = retryInputRevisionId
        ? await deps.getRetryInputRevisionById?.(retryInputRevisionId)
        : null;
      if (retryInputRevisionId && (!retryInputRevision || retryInputRevision.sceneExecutionId !== sceneExecutionId || retryInputRevision.executionPlanId !== executionPlanId || retryInputRevision.workspaceId !== envelope.workspaceId || retryInputRevision.providerModeRequirement !== "FIRST_FRAME_I2V")) {
        throw new Error("Retry input revision authority is missing or conflicts with the Execution Envelope");
      }
      const instructions = retryInputRevision
        ? applyRetryInputRevision(baseInstructions, retryInputRevision)
        : baseInstructions;

      const intent = compilation.intents.find(
        (candidate) => candidate.identity.sceneExecutionId === sceneExecutionId
      );
      if (!intent) {
        throw new Error(
          `Compiled intent missing for sceneExecutionId=${sceneExecutionId}`
        );
      }
      assertCrossSceneProductAssetContinuity(compilation.intents);
      const previousIntent = [...compilation.intents]
        .filter(
          (candidate) =>
            candidate.identity.sceneOrder < intent.identity.sceneOrder
        )
        .sort(
          (left, right) => right.identity.sceneOrder - left.identity.sceneOrder
        )[0];
      const productAssetId = sortedUnique(intent.referencedAssetIds)[0];
      const visualAuthorityCertification =
        productAssetId && deps.certifyProductVisualAuthority
          ? await deps.certifyProductVisualAuthority({
              productAssetId,
              orgId: intent.identity.tenantId,
              workspaceId: intent.identity.workspaceId,
              campaignId: intent.identity.campaignId,
              executionPlanId,
              sceneExecutionId,
            })
          : undefined;

      return mapCompiledInstructionsToCanonicalScenePayload({
        instructions,
        intent,
        ...(previousIntent
          ? { continuityFromSceneId: previousIntent.identity.sceneId }
          : {}),
        ...(visualAuthorityCertification
          ? {
              productAuthorityAssessment: { status: "RESOLVED" as const },
              visualAuthorityCertification,
            }
          : {}),
        ...(deps.productGroundedProviderMode
          ? { productGroundedProviderMode: deps.productGroundedProviderMode }
          : {}),
        ...(deps.productGroundedProviderModeCertified !== undefined
          ? {
              productGroundedProviderModeCertified:
                deps.productGroundedProviderModeCertified,
            }
          : {}),
        resolution: deps.resolution,
      });
    },
  };
}
