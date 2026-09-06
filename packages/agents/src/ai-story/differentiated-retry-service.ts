import {
  CreateSceneRetryInputRevisionCommandSchema,
  RejectGeneratedSceneCreativeCommandSchema,
  AuthorizeSceneRetryCommandSchema,
  type AiStorySceneCompiledInstructions,
  type SceneAttemptInputRevisionFact,
} from "@ceo-agent/shared";
import {
  DifferentiatedRetryRepository,
  canonicalPersistenceHash,
} from "@ceo-agent/db";
import { evaluateProductGroundedCameraPolicy, type ProductVisualAuthorityCertification } from "./product-grounding-contract";
import { resolveActiveAuthorityProjection, type CreativeAuthorityLayer } from "./active-intent-world-state";

export function applyRetryInputRevision(
  instructions: AiStorySceneCompiledInstructions,
  revision: SceneAttemptInputRevisionFact,
  options: { readonly latestHumanReviewCorrection?: string | null } = {}
): AiStorySceneCompiledInstructions {
  const direction = revision.creativeDirection;
  const hasHumanReviewCorrection = Boolean(options.latestHumanReviewCorrection?.trim());
  // The immutable review rationale is evidence, not Provider prompt copy. It can
  // describe the rejected composition (for example "workbench presentation").
  // Projecting that prose verbatim would reactivate the very instruction the
  // reviewer rejected. Its presence authorizes the higher-precedence retry
  // target below; the historical rationale remains in the review ledger.
  const retryValues = {
    narrativePurpose: direction.visualRole,
    actions: [direction.shotEmphasis],
    changes: [direction.cameraInstruction],
    mustNotInherit: ["conflicting inherited Scene wording"],
  } as const;
  const layers: CreativeAuthorityLayer[] = [{
    authorityId: "historical-compiled-scene-instructions",
    kind: "CANONICAL_SCENE_INTENT",
    classification: "HISTORICAL_ONLY",
    governs: ["narrativePurpose", "actions", "changes", "mustNotInherit"],
    values: {
      narrativePurpose: instructions.purpose,
      actions: instructions.shots.map((shot) => shot.information),
      changes: [instructions.transition],
      mustNotInherit: [],
    },
  }, {
    authorityId: revision.retryInputRevisionId,
    kind: "REVIEW_RETRY_TARGET",
    classification: "ACTIVE",
    governs: ["narrativePurpose", "actions", "changes", "mustNotInherit"],
    values: retryValues,
  }];
  if (hasHumanReviewCorrection) {
    layers.push({
      // The correction identity is deliberately non-secret and the rationale
      // remains only in its immutable review record, never in Provider prose.
      authorityId: revision.sourceReviewId,
      kind: "HUMAN_REVIEW_CORRECTION",
      classification: "ACTIVE",
      governs: ["narrativePurpose", "actions", "changes", "mustNotInherit"],
      values: {
        ...retryValues,
        narrativePurpose: `Latest human review correction governs this retry and overrides conflicting inherited Scene wording.\nRetry creative target: ${direction.visualRole}`,
        actions: [`Latest human review correction governs this retry.\nRetry creative target: ${direction.shotEmphasis}`],
      },
    });
  }
  const active = resolveActiveAuthorityProjection(
    layers,
    ["narrativePurpose", "actions", "changes", "mustNotInherit"]
  ).values;
  const activePurpose = active.narrativePurpose!;
  const activeAction = active.actions![0]!;
  const firstShot = instructions.shots[0]!;
  return {
    ...instructions,
    purpose: activePurpose,
    transition: direction.cameraInstruction,
    // A review retry is a new active creative projection. Preserve the frozen
    // Scene snapshot as history, but do not carry rejected shot wording into
    // the Provider-facing request. The retry direction replaces that wording.
    shots: [{
      ...firstShot,
      cameraType: "review-directed retry",
      cameraMovement: direction.cameraInstruction,
      focus: direction.focusProgression.join(" → "),
      composition: direction.focusProgression.join(" → "),
      information: activeAction,
      ...(direction.pacing ? { emotion: direction.pacing } : {}),
    }],
  };
}

export class DifferentiatedRetryService {
  constructor(private readonly repository = new DifferentiatedRetryRepository()) {}

  async rejectCreative(input: {
    executionPlanId: string; sceneExecutionId: string; workspaceId: string; actorUserId: string; command: unknown;
  }) {
    const command = RejectGeneratedSceneCreativeCommandSchema.parse(input.command);
    return this.repository.rejectCreative({ ...input, reason: command.reason, ...(command.note ? { note: command.note } : {}) });
  }

  async createInputRevision(input: {
    executionPlanId: string; sceneExecutionId: string; workspaceId: string; actorUserId: string;
    command: unknown; visualAuthorityCertification: ProductVisualAuthorityCertification;
  }) {
    const command = CreateSceneRetryInputRevisionCommandSchema.parse(input.command);
    const policy = evaluateProductGroundedCameraPolicy({
      shots: [{ cameraType: "bounded human retry", cameraMovement: command.creativeDirection.cameraInstruction }] as never,
    });
    if (!policy.compatible) throw new Error("RETRY_DIRECTOR_CAMERA_UNSAFE");
    if (
      input.visualAuthorityCertification.status !== "CERTIFIED" ||
      input.visualAuthorityCertification.sceneExecutionId !== input.sceneExecutionId ||
      input.visualAuthorityCertification.workspaceId !== input.workspaceId ||
      input.visualAuthorityCertification.executionPlanId !== input.executionPlanId
    ) throw new Error("RETRY_PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED");
    return this.repository.createInputRevision({
      executionPlanId: input.executionPlanId, sceneExecutionId: input.sceneExecutionId,
      workspaceId: input.workspaceId, actorUserId: input.actorUserId,
      sourceReviewId: command.sourceReviewId, creativeDirection: command.creativeDirection,
      expectedProductAssetId: input.visualAuthorityCertification.productAssetId,
      productAuthorityHash: canonicalPersistenceHash({
        productAssetId: input.visualAuthorityCertification.productAssetId,
        campaignId: input.visualAuthorityCertification.campaignId,
        providerMode: "FIRST_FRAME_I2V",
      }),
      visualAuthorityCertificationHash: canonicalPersistenceHash(input.visualAuthorityCertification),
    });
  }

  async authorizeRetry(input: {
    executionPlanId: string; sceneExecutionId: string; workspaceId: string; actorUserId: string; command: unknown;
  }) {
    const command = AuthorizeSceneRetryCommandSchema.parse(input.command);
    return this.repository.authorizeRetry({ ...input, ...command });
  }
}
