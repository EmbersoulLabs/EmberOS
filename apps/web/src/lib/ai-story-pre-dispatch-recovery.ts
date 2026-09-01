import { and, eq } from "drizzle-orm";
import {
  PreDispatchRecoveryService,
  CREATIVE_T2V_MODE,
  ProductGroundingGateError,
  assertProductGroundingPreDispatch,
  createCompilationBackedCanonicalPayloadResolver,
  type CanonicalScenePayloadForAdapter,
  type ProductVisualAuthorityCertification,
} from "@ceo-agent/agents";
import {
  AiStoryPreDispatchRecoveryRepository,
  PreDispatchRecoveryRepositoryError,
  AiStorySceneExecutionPersistenceRepository,
  ExecutionEnvelopeRepository,
  DifferentiatedRetryRepository,
  getDb,
  schema,
} from "@ceo-agent/db";

export async function certifyVisualAuthority(input: {
  readonly productAssetId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
}): Promise<ProductVisualAuthorityCertification> {
  const [row] = await getDb()
    .select({
      assetId: schema.assets.id,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
      campaignId: schema.campaignAssetRefs.campaignId,
      storagePath: schema.assets.storagePath,
      mimeType: schema.assets.mimeType,
    })
    .from(schema.assets)
    .innerJoin(
      schema.campaignAssetRefs,
      eq(schema.campaignAssetRefs.assetId, schema.assets.id)
    )
    .where(
      and(
        eq(schema.assets.id, input.productAssetId),
        eq(schema.assets.orgId, input.orgId),
        eq(schema.assets.workspaceId, input.workspaceId),
        eq(schema.campaignAssetRefs.campaignId, input.campaignId)
      )
    )
    .limit(1);
  if (!row || !row.storagePath.trim() || !row.mimeType?.toLowerCase().startsWith("image/")) {
    throw new Error("PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED");
  }
  return {
    contractVersion: "1",
    certificationSource: "SERVER_AUTHORITY",
    status: "CERTIFIED",
    productAssetId: row.assetId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    campaignId: row.campaignId,
    executionPlanId: input.executionPlanId,
    sceneExecutionId: input.sceneExecutionId,
    assetExists: true,
    ownershipBound: true,
    campaignProductBinding: true,
    providerAccessibleFirstFrame: true,
    authorityConflictAbsent: true,
    previousSceneVisualAuthorityUsed: false,
  };
}

export async function certifyPreDispatchRecoveryGrounding(input: {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly orgId: string;
  readonly workspaceId: string;
}) {
  const db = getDb();
  const [correlation] = await db
    .select({ envelopeId: schema.aiStorySceneSchedulingCorrelations.envelopeId })
    .from(schema.aiStorySceneSchedulingCorrelations)
    .where(
      and(
        eq(schema.aiStorySceneSchedulingCorrelations.executionPlanId, input.executionPlanId),
        eq(schema.aiStorySceneSchedulingCorrelations.sceneExecutionId, input.sceneExecutionId),
        eq(schema.aiStorySceneSchedulingCorrelations.orgId, input.orgId),
        eq(schema.aiStorySceneSchedulingCorrelations.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (!correlation) throw new Error("RECOVERY_STATE_STALE");

  const envelopes = new ExecutionEnvelopeRepository();
  const envelope = await envelopes.getEnvelope(correlation.envelopeId);
  if (!envelope) throw new Error("RECOVERY_STATE_STALE");
  const resolver = createCompilationBackedCanonicalPayloadResolver({
    getEnvelopeByPayloadReference: (reference) =>
      envelopes.getEnvelopeByPayloadReference(reference),
    getCompilationByExecutionPlanId: (executionPlanId) =>
      new AiStorySceneExecutionPersistenceRepository().getByExecutionPlanId(executionPlanId),
    getRetryInputRevisionById: (retryInputRevisionId) =>
      new DifferentiatedRetryRepository().getRevision(retryInputRevisionId),
    certifyProductVisualAuthority: certifyVisualAuthority,
    resolution: "480p",
    productGroundedProviderMode: "FIRST_FRAME_I2V",
    productGroundedProviderModeCertified: true,
  });
  let payload: CanonicalScenePayloadForAdapter;
  try {
    payload = (await resolver.resolve(
      envelope.canonicalRequest.normalizedPayloadReference
    )) as CanonicalScenePayloadForAdapter;
    if (payload.generationMode === CREATIVE_T2V_MODE) {
      if (
        payload.assetReferences.length !== 0 ||
        payload.productGrounding ||
        payload.productIdentityCapsule.productReferencePresent
      ) {
        throw new PreDispatchRecoveryRepositoryError(
          "AUTHORITY_CONFLICT",
          "Reference-free T2V recovery authority conflicts with image conditioning"
        );
      }
      return {
        generationMode: "CREATIVE_T2V",
        visualAuthorityCertified: true,
        productAuthorityResolved: true,
        providerMode: "TEXT_TO_VIDEO",
        firstFramePresent: false,
        referenceAuthority: "REFERENCE_FREE_T2V",
        referenceCount: 0,
        directorSafe: true,
        preDispatchGate: "PASS",
      } as const;
    }
    if (!payload.productGrounding) throw new Error("PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED");
    assertProductGroundingPreDispatch({
      grounding: payload.productGrounding,
      visualAuthorityCertification: payload.visualAuthorityCertification,
      prompt: payload.prompt,
      assetReferences: payload.assetReferences,
    });
  } catch (error) {
    const blockers = error instanceof ProductGroundingGateError ? error.blockers : [];
    const code = blockers.includes("PRODUCT_VISUAL_AUTHORITY_CONFLICT")
      ? "AUTHORITY_CONFLICT"
      : blockers.some((item) => item.includes("PROVIDER_MODE") || item.includes("REFERENCE_T2V"))
        ? "PROVIDER_MODE_UNCERTIFIED"
        : blockers.includes("DIRECTOR_CAMERA_INCOMPATIBLE_WITH_PRODUCT_LOCK")
          ? "DIRECTOR_SHOT_UNSAFE"
          : "PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED";
    throw new PreDispatchRecoveryRepositoryError(
      code,
      `Pre-dispatch grounding revalidation failed: ${code}`
    );
  }
  const productReference = payload.assetReferences.find(
    (asset) => asset.role === "PRIMARY_PRODUCT"
  );
  if (!productReference) throw new Error("PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED");
  return {
    generationMode: "PRODUCT_GROUNDED_VIDEO",
    visualAuthorityCertified: true,
    productAuthorityResolved: true,
    providerMode: "FIRST_FRAME_I2V",
    firstFramePresent: true,
    referenceAuthority: "PRODUCT_GROUNDED",
    referenceCount: payload.assetReferences.length,
    directorSafe: true,
    preDispatchGate: "PASS",
  } as const;
}

export function createPreDispatchRecoveryService() {
  return new PreDispatchRecoveryService({
    repository: new AiStoryPreDispatchRecoveryRepository(),
    certifyGrounding: certifyPreDispatchRecoveryGrounding,
  });
}
