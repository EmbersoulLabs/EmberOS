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

export function applyRetryInputRevision(
  instructions: AiStorySceneCompiledInstructions,
  revision: SceneAttemptInputRevisionFact
): AiStorySceneCompiledInstructions {
  const direction = revision.creativeDirection;
  return {
    ...instructions,
    purpose: direction.visualRole,
    transition: direction.cameraInstruction,
    shots: instructions.shots.map((shot, index) => index === 0 ? {
      ...shot,
      cameraMovement: direction.cameraInstruction,
      focus: direction.focusProgression.join(" → "),
      information: direction.shotEmphasis,
      ...(direction.pacing ? { emotion: direction.pacing } : {}),
    } : shot),
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
