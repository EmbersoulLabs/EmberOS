import {
  AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION,
  AiStoryLocalGenerationPackageSchema,
  type AiStoryLocalGenerationPackage,
  type AiStoryPostQcRequirement,
} from "@ceo-agent/shared";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import {
  validateAiStoryAuthorizedSchedulingAuthority,
  type AiStoryAuthorizedSchedulingAuthority,
} from "./asset-aware-execution-authority";
import { integrityHash } from "./scene-execution-compiler";

export class AiStoryLocalGenerationError extends Error {
  constructor(
    readonly code:
      | "LOCAL_GENERATION_AUTHORITY_INVALID"
      | "LOCAL_GENERATION_REFERENCE_HASH_MISSING"
      | "LOCAL_GENERATION_IMMUTABLE_CONFLICT"
      | "LOCAL_GENERATION_OUTPUT_INVALID"
      | "LOCAL_WORKFLOW_CERTIFICATION_REQUIRED",
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = "AiStoryLocalGenerationError";
  }
}

function sectionFacts(
  authority: AiStoryAuthorizedSchedulingAuthority,
  sections: readonly string[],
): string[] {
  return authority.compiledRequest.semanticPlan.sections
    .filter((section) => sections.includes(section.section))
    .flatMap((section) => section.facts);
}

function workflow(authority: AiStoryAuthorizedSchedulingAuthority) {
  const request = authority.compiledRequest;
  if (request.structuredRequest.generateAudio && request.characterDnaAuthority) {
    return "MINIMAX_H3_NATIVE_DIALOGUE" as const;
  }
  if (request.generationMode === "FIRST_FRAME_IMAGE_TO_VIDEO") {
    return "WAN_I2V" as const;
  }
  if (request.generationMode === "TEXT_TO_VIDEO") {
    return "WAN_T2V" as const;
  }
  return "GENERIC_LOCAL_VIDEO" as const;
}

function referenceHash(
  authority: AiStoryAuthorizedSchedulingAuthority,
  assetId: string,
): string {
  const analysis = authority.analysisAuthorities.find((item) => item.assetId === assetId);
  const selectedProduct = authority.compiledRequest.productMaterialSelection?.selectedMaterial;
  const hash = analysis?.contentHash ??
    (selectedProduct?.assetId === assetId ? selectedProduct.contentHash : null);
  if (!hash) {
    throw new AiStoryLocalGenerationError(
      "LOCAL_GENERATION_REFERENCE_HASH_MISSING",
      `Authorized local reference ${assetId} has no immutable content hash`,
    );
  }
  return hash;
}

function buildInstructions(input: {
  readonly order: number;
  readonly workflow: string;
  readonly prompt: string;
  readonly mustKeep: readonly string[];
  readonly continuity: readonly string[];
  readonly generateAudio: boolean;
}): string {
  return [
    `Generation Unit ${input.order}`,
    `Recommended local workflow: ${input.workflow}`,
    `Audio: ${input.generateAudio ? "generate native synchronized audio" : "video-only / supplied audio authority"}`,
    "",
    "PROMPT",
    input.prompt,
    "",
    "MUST KEEP",
    ...input.mustKeep.map((fact) => `- ${fact}`),
    "",
    "CONTINUITY",
    ...input.continuity.map((fact) => `- ${fact}`),
    "",
    "Render locally. Do not substitute references, generation mode, Product variant, or Character identity.",
  ].join("\n");
}

export function materializeLocalGenerationPackage(input: {
  readonly authority: AiStoryAuthorizedSchedulingAuthority;
  readonly runtimeAuthorizationId: string;
  readonly order: number;
  readonly createdAt: string;
  readonly unitContext?: {sceneId:string;planningAuthority:AiStoryLocalGenerationPackage["planningAuthority"]};
  readonly retryOfPackageId?: string | null;
  readonly retryNumber?: number;
}): AiStoryLocalGenerationPackage {
  const authority = validateAiStoryAuthorizedSchedulingAuthority(input.authority);
  const request = authority.compiledRequest;
  const recommendation = workflow(authority);
  const mustKeep = sectionFacts(authority, ["MUST_KEEP", "CAST_AUTHORITY", "PRODUCT_AUTHORITY"]);
  const mustAvoid = sectionFacts(authority, ["MUST_AVOID"]);
  const qcRequirements: AiStoryPostQcRequirement[] = [];
  const dimensions: Record<string, AiStoryPostQcRequirement["dimension"]> = {
    SCENE_PURPOSE:"SCENE_FIDELITY", SCRIPT_ACTION:"ACTION_COMPLETION", ACTION_PROGRESSION:"ACTION_COMPLETION",
    REQUIRED_EXIT_STATE:"END_STATE", LOCATION_AUTHORITY:"LOCATION_FIDELITY", DIRECTOR_VISUAL_TREATMENT:"DIRECTOR_EXECUTION",
    CAMERA:"DIRECTOR_EXECUTION", FOCUS:"DIRECTOR_EXECUTION", COMPOSITION:"DIRECTOR_EXECUTION", BLOCKING:"MOTION_EXECUTION",
    ENVIRONMENTAL_MOTION:"MOTION_EXECUTION", REQUIRED_EVIDENCE:"REQUIRED_EVIDENCE", MUST_AVOID:"MUST_AVOID",
    CINEMATIC_PROGRESSION:"CINEMATIC_PROGRESSION",
  };
  for (const section of request.semanticPlan.sections) {
    const dimension=dimensions[section.section]; if(!dimension) continue;
    for(const [index,fact] of section.facts.entries()) qcRequirements.push({requirementId:`semantic:${section.section}:${index}`,dimension,summary:fact,
      required:true,waiverPolicy:section.section==="MUST_AVOID"?"NON_WAIVABLE_INTEGRITY":"WAIVABLE_BY_HUMAN",
      sourceOwner:dimension==="DIRECTOR_EXECUTION"?"DIRECTOR":dimension==="MOTION_EXECUTION"?"MOTION":"SCENE",visuallyObservable:true});
  }
  const continuity = sectionFacts(authority, ["CONTINUITY", "TRANSITION"]);
  const previous = sectionFacts(authority, ["ENTRY_STATE"]);
  const expectedEnd = sectionFacts(authority, ["REQUIRED_EXIT_STATE"]);
  const currentStart = [...previous];
  const world = sectionFacts(authority, ["SCENE_CONTEXT", "LOCATION_AUTHORITY"]).join("\n");
  const references = request.referenceMappings.map((reference) => ({
    assetId: reference.assetId,
    contentHash: referenceHash(authority, reference.assetId),
    authorityType:
      reference.wireRole === "first_frame"
        ? ("FIRST_FRAME" as const)
        : reference.authorityType === "CAST"
          ? ("CHARACTER" as const)
          : reference.authorityType,
    authorityId: reference.authorityId,
    displayName: `${reference.authorityType.toLowerCase()} reference`,
    ...(reference.mediaType ? { mediaType: reference.mediaType } : {}),
    ...(reference.storagePath ? { storagePath: reference.storagePath } : {}),
    providerWireRole: reference.wireRole,
  }));
  const dialogue = "nativeAvRequest" in request
    ? [{
        speakerCharacterId: request.nativeAvRequest.dialogueAuthority.characterId,
        speakerLabel: "On-screen Character",
        text: request.nativeAvRequest.dialogueAuthority.exactText,
        offscreen: false,
      }]
    : [];
  const product = request.productMaterialSelection?.productAuthority ?? null;
  const generationMode = request.generationMode === "TEXT_TO_VIDEO"
    ? "TEXT_TO_VIDEO" as const
    : product
      ? "PRODUCT_GROUNDED_VIDEO" as const
      : "FIRST_FRAME_IMAGE_TO_VIDEO" as const;
  const unitId = authority.sceneExecutionId;
  const packageId = deterministicPersistenceUuid("ai-story-local-generation-package", {
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    schedulingAuthorityId: authority.schedulingAuthorityId,
    retryNumber: input.retryNumber ?? 0,
  });
  const unsigned = {
    version: AI_STORY_LOCAL_GENERATION_PACKAGE_VERSION,
    packageId,
    executionMode: "MANUAL_LOCAL" as const,
    organizationId: authority.orgId,
    workspaceId: authority.workspaceId,
    campaignId: authority.campaignId,
    storyId: authority.storyId,
    storyVersionId: authority.storyVersionId,
    executionPlanId: authority.executionPlanId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    unitId,
    sceneExecutionId: authority.sceneExecutionId,
    sceneId: input.unitContext?.sceneId ?? authority.sceneExecutionId,
    planningAuthority: input.unitContext?.planningAuthority ?? {planningLineageSource:"LEGACY_COMPILED_V1" as const,sceneVersion:1,scriptVersionId:null,handoffId:null,handoffFingerprint:null},
    order: input.order,
    durationSec: request.structuredRequest.duration,
    aspectRatio: request.structuredRequest.ratio,
    resolutionIntent: request.structuredRequest.resolution,
    recommendedWorkflow: recommendation,
    generationMode,
    prompt: request.compiledPrompt,
    negativePrompt: "",
    dialogue,
    generateAudio: request.structuredRequest.generateAudio,
    audioBlocked: request.blockedCapabilities.includes("AUDIO"),
    characterAuthority: request.characterDnaAuthority
      ? {
          characterId: request.characterDnaAuthority.reusableCharacterId,
          characterVersionId: request.characterDnaAuthority.reusableCharacterVersionId,
          dnaFingerprint: request.characterDnaAuthority.characterDnaFingerprint,
          sourcePhotoSentToVideoProvider: false as const,
        }
      : null,
    productAuthority: product
      ? {
          assetId: product.sourceAssetId,
          contentHash: product.sourceAssetContentHash,
          confirmedVariant: product.confirmedVariant ?? null,
        }
      : null,
    worldDescription: world,
    mustKeep,
    mustAvoid,
    qcRequirements,
    continuityRequirements: continuity,
    previousUnitEndState: previous,
    currentUnitStartState: currentStart,
    expectedEndState: expectedEnd,
    references,
    sourceAuthority: {
      schedulingAuthorityId: authority.schedulingAuthorityId,
      schedulingAuthorityFingerprint: authority.authorityFingerprint,
      plannerSnapshotId: authority.plannerSnapshot.plannerSnapshotId,
      compiledRequestId: request.compiledRequestId,
      compiledRequestFingerprint: request.requestFingerprint,
      sceneFingerprint: request.sceneFingerprint,
      semanticPlanFingerprint: request.semanticPlanFingerprint,
      preGenerationQcEvaluationId: request.qcEvaluationId,
      preGenerationQcFingerprint: request.qcFingerprint,
      directorFingerprint: request.directorFingerprint,
      motionFingerprint: request.motionFingerprint,
      castSnapshotFingerprint: request.castSnapshotFingerprint,
      locationSnapshotFingerprint: request.locationSnapshotFingerprint,
      productSnapshotFingerprint: request.productSnapshotFingerprint,
    },
    instructions: buildInstructions({
      order: input.order,
      workflow: recommendation,
      prompt: request.compiledPrompt,
      mustKeep,
      continuity,
      generateAudio: request.structuredRequest.generateAudio,
    }),
    state: "AWAITING_LOCAL_OUTPUT" as const,
    retryOfPackageId: input.retryOfPackageId ?? null,
    retryNumber: input.retryNumber ?? 0,
    createdAt: input.createdAt,
  };
  return AiStoryLocalGenerationPackageSchema.parse({
    ...unsigned,
    packageFingerprint: localGenerationPackageFingerprint(unsigned),
  });
}

export function localGenerationPackageFingerprint(value: Omit<AiStoryLocalGenerationPackage,"packageFingerprint">) {
  const {createdAt:_createdAt,...facts}=value;
  Reflect.deleteProperty(facts,"packageFingerprint");
  return integrityHash({kind:value.version,...facts});
}
