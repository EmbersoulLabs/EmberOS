/**
 * Sprint 3 Phase 1 — provider-neutral Plan / Intent AI QC Layer.
 *
 * Pure validation: Scene Execution Intent → Validation Result.
 * Never mutates Intent, never invokes providers, never rewrites prompts.
 * Never inspects generated image/video/audio artifacts. A passed result is
 * Plan QC only and does not approve generated media (EXEC-06 Option B).
 */
import {
  AI_STORY_EXECUTION_CONTRACT_VERSION,
  AiStoryAiQcResultSchema,
  AiStorySceneCompiledInstructionsSchema,
  AiStorySceneExecutionIntentSchema,
  EXECUTION_CAPABILITY_IDS,
  type AiStoryAiQcFinding,
  type AiStoryAiQcResult,
  type AiStoryAiQcStatus,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";
import { integrityHash } from "./scene-execution-compiler";

export type AiQcAssetFact = {
  assetId: string;
  workspaceId: string;
  campaignId: string | null;
};

export type AiQcValidationContext = {
  /** Expected frozen Story Version clock / presence. */
  storyVersionFrozenAt: string | null;
  animationPackageStatus: string;
  workspaceId: string;
  campaignId: string;
  /** Resolved assets for referenced IDs (missing IDs absent from map). */
  assetsById: ReadonlyMap<string, AiQcAssetFact>;
  /**
   * Compiled instructions for this Intent (must match contentHash).
   * QC never regenerates or rewrites them.
   */
  instructions: AiStorySceneCompiledInstructions;
  /** Fixed timestamp for deterministic validatedAt in tests. */
  validatedAt?: string;
};

function finding(
  code: AiStoryAiQcFinding["code"],
  path: string,
  message: string,
  severity: AiStoryAiQcFinding["severity"] = "blocking"
): AiStoryAiQcFinding {
  return { code, path, message, severity };
}

function compareFindings(a: AiStoryAiQcFinding, b: AiStoryAiQcFinding): number {
  if (a.severity !== b.severity) {
    return a.severity === "blocking" ? -1 : 1;
  }
  const codeCmp = a.code.localeCompare(b.code);
  if (codeCmp !== 0) return codeCmp;
  const pathCmp = a.path.localeCompare(b.path);
  if (pathCmp !== 0) return pathCmp;
  return a.message.localeCompare(b.message);
}

function deriveStatus(errors: readonly AiStoryAiQcFinding[]): AiStoryAiQcStatus {
  if (errors.some((e) => e.severity === "blocking")) return "failed";
  if (errors.some((e) => e.severity === "warning")) return "warning";
  return "passed";
}

/**
 * Validate one Scene Execution Intent. Side-effect free; does not mutate inputs.
 */
export function validateSceneExecutionIntent(
  intentInput: AiStorySceneExecutionIntent,
  ctx: AiQcValidationContext
): AiStoryAiQcResult {
  // Deep parse copies — never mutate caller objects.
  const intent = AiStorySceneExecutionIntentSchema.parse(
    JSON.parse(JSON.stringify(intentInput))
  );
  const instructions = AiStorySceneCompiledInstructionsSchema.parse(
    JSON.parse(JSON.stringify(ctx.instructions))
  );

  const errors: AiStoryAiQcFinding[] = [];
  const id = intent.identity;
  const generationAuthority = intent.generationAuthority;
  const explicitReferenceFreeT2v =
    generationAuthority?.strategy === "TEXT_TO_VIDEO" &&
    generationAuthority.referenceSource === "REFERENCE_FREE_T2V" &&
    generationAuthority.effectiveReferenceIds.length === 0 &&
    generationAuthority.firstFrameAssetId === null;

  if (
    JSON.stringify(generationAuthority ?? null) !==
    JSON.stringify(instructions.generationAuthority ?? null)
  ) {
    errors.push(
      finding(
        "GENERATION_AUTHORITY_INVALID",
        "generationAuthority",
        "Scene Intent and compiled instructions do not share the same generation authority."
      )
    );
  }
  if (
    generationAuthority &&
    JSON.stringify(generationAuthority.effectiveReferenceIds) !==
      JSON.stringify(intent.referencedAssetIds)
  ) {
    errors.push(
      finding(
        "GENERATION_AUTHORITY_INVALID",
        "generationAuthority.effectiveReferenceIds",
        "Effective Scene references do not match the immutable Scene Intent references."
      )
    );
  }
  if (
    explicitReferenceFreeT2v &&
    generationAuthority.productVisualIdentityRequirement === "REQUIRED"
  ) {
    errors.push(
      finding(
        "T2V_PRODUCT_IDENTITY_AUTHORITY_CONFLICT",
        "generationAuthority.productVisualIdentityRequirement",
        "Reference-free TEXT_TO_VIDEO cannot satisfy required product visual identity authority."
      )
    );
  }
  if (
    generationAuthority &&
    generationAuthority.strategy !== "TEXT_TO_VIDEO" &&
    (!generationAuthority.firstFrameAssetId ||
      !generationAuthority.effectiveReferenceIds.includes(
        generationAuthority.firstFrameAssetId
      ))
  ) {
    errors.push(
      finding(
        "I2V_FIRST_FRAME_AUTHORITY_MISSING",
        "generationAuthority.firstFrameAssetId",
        "Image-conditioned execution requires a first-frame authority from the effective reference set."
      )
    );
  }

  // Story / package
  if (!intent.frozenStoryVersion.storyVersionId) {
    errors.push(
      finding("STORY_VERSION_MISSING", "frozenStoryVersion.storyVersionId", "Story Version is missing.")
    );
  }
  if (!ctx.storyVersionFrozenAt) {
    errors.push(
      finding(
        "STORY_VERSION_NOT_FROZEN",
        "frozenStoryVersion.frozenAt",
        "Story Version is not explicitly frozen for execution.",
        "warning"
      )
    );
  }
  if (!intent.animationPackage.animationPackageId) {
    errors.push(
      finding(
        "ANIMATION_PACKAGE_MISSING",
        "animationPackage.animationPackageId",
        "Animation Package is missing."
      )
    );
  }
  if (ctx.animationPackageStatus !== "ready_for_execution") {
    errors.push(
      finding(
        "ANIMATION_PACKAGE_NOT_APPROVED",
        "animationPackage.status",
        `Animation Package status must be ready_for_execution (got ${ctx.animationPackageStatus}).`
      )
    );
  }
  if (
    intent.animationPackage.storyVersionId !== intent.frozenStoryVersion.storyVersionId ||
    intent.animationPackage.storyId !== intent.frozenStoryVersion.storyId
  ) {
    errors.push(
      finding(
        "ANIMATION_PACKAGE_STORY_MISMATCH",
        "animationPackage.storyVersionId",
        "Animation Package identity does not match the frozen Story Version."
      )
    );
  }

  // Scene / shots
  if (id.sceneId !== instructions.sceneId) {
    errors.push(
      finding(
        "SCENE_NOT_IN_PACKAGE",
        "identity.sceneId",
        "Scene ID on Intent does not match compiled instructions."
      )
    );
  }
  if (id.sceneOrder !== instructions.sceneOrder || id.sceneOrder < 0) {
    errors.push(
      finding("SCENE_ORDER_INVALID", "identity.sceneOrder", "Scene order is invalid.")
    );
  }
  if (intent.shotReferences.length === 0 || instructions.shots.length === 0) {
    errors.push(finding("SHOT_MISSING", "shotReferences", "At least one Shot is required."));
  }
  const shotOrders = intent.shotReferences.map((s) => s.order);
  const sortedOrders = [...shotOrders].sort((a, b) => a - b);
  if (shotOrders.join(",") !== sortedOrders.join(",")) {
    errors.push(
      finding("SHOT_ORDER_INVALID", "shotReferences", "Shot order must be ascending.")
    );
  }
  for (let i = 0; i < intent.shotReferences.length; i++) {
    const shot = intent.shotReferences[i]!;
    if (shot.sceneId !== id.sceneId) {
      errors.push(
        finding(
          "SCENE_NOT_IN_PACKAGE",
          `shotReferences[${i}].sceneId`,
          "Shot does not belong to the Intent Scene."
        )
      );
    }
    if (shot.durationMs <= 0) {
      errors.push(
        finding(
          "SHOT_DURATION_INCONSISTENT",
          `shotReferences[${i}].durationMs`,
          "Shot duration must be positive."
        )
      );
    }
  }
  if (intent.plannedDurationMs <= 0 || instructions.durationMs <= 0) {
    errors.push(
      finding("SCENE_DURATION_INVALID", "plannedDurationMs", "Scene duration must be positive.")
    );
  }

  const world = instructions.worldContinuity ?? {};
  if (!world || Object.keys(world).length === 0) {
    errors.push(
      finding(
        "CONTINUITY_CONTEXT_MISSING",
        "instructions.worldContinuity",
        "Required world continuity context is missing.",
        "warning"
      )
    );
  }

  // Prompt / capability / forbidden instructions
  if (
    !instructions.purpose?.trim() ||
    instructions.shots.some(
      (s) =>
        !s.focus?.trim() ||
        !s.information?.trim() ||
        !s.cameraType?.trim() ||
        !s.cameraMovement?.trim()
    )
  ) {
    errors.push(
      finding(
        "PROMPT_CONTRACT_INVALID",
        "instructions.shots",
        "Required prompt contract fields are missing on one or more Shots."
      )
    );
  }
  if (instructions.shots.length === 0) {
    errors.push(
      finding(
        "COMPILED_INSTRUCTIONS_EMPTY",
        "instructions.shots",
        "Compiled execution instructions are empty."
      )
    );
  }
  if (instructions.capabilityId !== EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO) {
    errors.push(
      finding(
        "CAPABILITY_INVALID",
        "instructions.capabilityId",
        "Capability must be animation-video-generation."
      )
    );
  }

  const instructionBlob = JSON.stringify(instructions).toLowerCase();
  if (
    /marketing.?output|auto.?clip|targetoutputcount|pd-055/.test(instructionBlob)
  ) {
    errors.push(
      finding(
        "FORBIDDEN_MARKETING_INSTRUCTION",
        "instructions",
        "Marketing Output / Auto Clip instructions are not allowed on Scene Intents."
      )
    );
  }
  if (/flux|text-to-image|image-to-image|marketing-image/.test(instructionBlob)) {
    errors.push(
      finding(
        "FORBIDDEN_IMAGE_GENERATION_INSTRUCTION",
        "instructions",
        "Image-generation instructions are not allowed on Scene Intents."
      )
    );
  }

  // Assets
  if (intent.referencedAssetIds.length === 0 && !explicitReferenceFreeT2v) {
    errors.push(
      finding(
        "PRODUCT_IDENTITY_REFERENCE_MISSING",
        "referencedAssetIds",
        "Required product identity Campaign Asset references are missing."
      )
    );
  }
  intent.referencedAssetIds.forEach((assetId, index) => {
    const asset = ctx.assetsById.get(assetId);
    if (!asset) {
      errors.push(
        finding(
          "MISSING_CAMPAIGN_ASSET",
          `referencedAssetIds[${index}]`,
          "A required Campaign Asset could not be resolved."
        )
      );
      return;
    }
    if (asset.workspaceId !== ctx.workspaceId) {
      errors.push(
        finding(
          "ASSET_WORKSPACE_MISMATCH",
          `referencedAssetIds[${index}]`,
          "Asset does not belong to the current workspace."
        )
      );
    }
    if (asset.campaignId !== ctx.campaignId) {
      errors.push(
        finding(
          "ASSET_CAMPAIGN_UNAUTHORIZED",
          `referencedAssetIds[${index}]`,
          "Asset is not authorized for the current Campaign."
        )
      );
    }
  });

  if (instructions.productIdentityConstraints.length === 0) {
    errors.push(
      finding(
        "PRODUCT_IDENTITY_REFERENCE_MISSING",
        "instructions.productIdentityConstraints",
        "Product identity constraints are missing."
      )
    );
  }

  // Identity / determinism
  if (id.contractVersion !== AI_STORY_EXECUTION_CONTRACT_VERSION) {
    errors.push(
      finding("IDENTITY_UNSTABLE", "identity.contractVersion", "Contract version mismatch.")
    );
  }
  if (
    id.storyId !== intent.frozenStoryVersion.storyId ||
    id.storyVersionId !== intent.frozenStoryVersion.storyVersionId ||
    id.animationPackageId !== intent.animationPackage.animationPackageId
  ) {
    errors.push(
      finding(
        "IDENTITY_UNSTABLE",
        "identity",
        "Scene execution identity does not align with Story/Package references."
      )
    );
  }

  const expectedInstructionHash = integrityHash(instructions);
  if (intent.normalizedPayloadReference.contentHash !== expectedInstructionHash) {
    errors.push(
      finding(
        "DETERMINISM_HASH_MISMATCH",
        "normalizedPayloadReference.contentHash",
        "Compiled instruction content hash does not match the Intent reference."
      )
    );
  }

  if (
    !intent.normalizedPayloadReference.uri ||
    !intent.normalizedPayloadReference.mediaType
  ) {
    errors.push(
      finding(
        "EXECUTION_PARAMETER_INVALID",
        "normalizedPayloadReference",
        "Malformed execution payload reference parameters."
      )
    );
  }

  const ordered = [...errors].sort(compareFindings);
  const status = deriveStatus(ordered);
  const validatedAt = ctx.validatedAt ?? new Date().toISOString();

  return AiStoryAiQcResultSchema.parse({
    status,
    intentId: id.sceneExecutionId,
    sceneId: id.sceneId,
    validatedAt,
    contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
    errors: ordered,
  });
}

export function validateAllSceneExecutionIntents(
  intents: readonly AiStorySceneExecutionIntent[],
  instructionsBySceneExecutionId: Readonly<
    Record<string, AiStorySceneCompiledInstructions>
  >,
  ctx: Omit<AiQcValidationContext, "instructions">
): AiStoryAiQcResult[] {
  return intents.map((intent) => {
    const instructions = instructionsBySceneExecutionId[intent.identity.sceneExecutionId];
    if (!instructions) {
      return AiStoryAiQcResultSchema.parse({
        status: "failed",
        intentId: intent.identity.sceneExecutionId,
        sceneId: intent.identity.sceneId,
        validatedAt: ctx.validatedAt ?? new Date().toISOString(),
        contractVersion: AI_STORY_EXECUTION_CONTRACT_VERSION,
        errors: [
          finding(
            "COMPILED_INSTRUCTIONS_EMPTY",
            "instructions",
            "Compiled instructions missing for Scene Execution Intent."
          ),
        ],
      });
    }
    return validateSceneExecutionIntent(intent, { ...ctx, instructions });
  });
}

export function aggregateQcStatus(
  results: readonly AiStoryAiQcResult[]
): AiStoryAiQcStatus {
  if (results.some((r) => r.status === "failed")) return "failed";
  if (results.some((r) => r.status === "warning")) return "warning";
  return "passed";
}

/** Plan QC may allow scheduling. It does not approve generated media. */
export function qcAllowsExecution(results: readonly AiStoryAiQcResult[]): boolean {
  return aggregateQcStatus(results) !== "failed";
}
