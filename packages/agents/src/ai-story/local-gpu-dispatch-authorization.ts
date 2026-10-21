import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  AiStoryLocalGenerationRepository,
  deterministicPersistenceUuid,
  findActiveSuperadminAssignment,
  getDb,
  listReleasedLocalPackagesAwaitingOutput,
  persistLocalGpuDispatchAuthority,
  schema,
} from "@ceo-agent/db";
import {
  AI_STORY_EXECUTION_UNIT_DURATION_SUCCESSOR_CONTRACT,
  AiStorySceneCompiledInstructionsSchema,
  type AiStoryLocalGenerationPackage,
} from "@ceo-agent/shared";
import { assertLocalGpuV2RuntimeCapabilities, LocalGpuContractError, readLocalGpuV2FirstFrameAuthorities } from "@ceo-agent/shared/server";
import { LocalGpuCloudAdapter } from "./local-gpu-adapter";
import { loadLocalGpuConfigFromEnv, type LocalGpuConfig } from "./local-gpu-config";
import { planLocalGpuRoute } from "./local-gpu-execution";
import {
  mapCanonicalPackageToLocalGpuContractV2,
  mapCanonicalPackageToLocalGpuNativeDialogueV3,
} from "./local-gpu-package-transport";

type Db = ReturnType<typeof getDb>;
type Env = Record<string, string | undefined>;

export const LOCAL_GPU_DISPATCH_AUTHORITY_TTL_MS = 15 * 60_000;

export class LocalGpuAuthorizationError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: 403 | 404 | 409 | 422 | 502 | 503,
    message: string,
  ) {
    super(message);
    this.name = "LocalGpuAuthorizationError";
  }
}

/** Storage and Desktop I/O. The Web route and Worker inject their own clients. */
export type LocalGpuAuthorizationPorts = {
  fetchCapabilities(input: { url: string; token: string }): Promise<{ status: number; body: unknown }>;
  createSignedUploadUrl(storagePath: string): Promise<string | null>;
  createSignedReadUrl(storagePath: string, expiresInSec: number): Promise<string | null>;
};

export type LocalGpuAuthorizationResult = {
  dispatchAuthorityId: string;
  executionIdentity: string;
  sceneExecutionId: string;
  packageId: string;
  runtimeAuthorizationId: string;
  status: string;
  outputAssetId: string;
  replayed: boolean;
  gpuSubmitted: false;
};

const PERSIST_ERRORS: Record<string, { status: 403 | 409; message: string }> = {
  LOCAL_GPU_SUPERADMIN_AUTHORITY_REQUIRED: { status: 403, message: "An active Platform Superadmin grant is required for LOCAL_GPU dispatch" },
  LOCAL_GPU_SCENE_RELEASE_NOT_ELIGIBLE: { status: 409, message: "The Scene release is no longer eligible for LOCAL_GPU dispatch" },
  LOCAL_GPU_IDEMPOTENCY_CONFLICT: { status: 409, message: "The idempotency key belongs to a different LOCAL_GPU execution" },
  LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED: { status: 409, message: "LOCAL_GPU dispatch authority for this execution was revoked" },
  LOCAL_GPU_EXECUTION_IDENTITY_MISMATCH: { status: 409, message: "LOCAL_GPU execution identity does not match the released package" },
  LOCAL_GPU_AUTHORITY_SCOPE_MISMATCH: { status: 409, message: "LOCAL_GPU authority scope does not match the package workspace" },
  LOCAL_GPU_RUNTIME_AUTHORIZATION_MISMATCH: { status: 409, message: "LOCAL_GPU runtime authorization does not match the package" },
};

/** Typed 403/409/503 errors for every known LOCAL_GPU failure; unknown failures stay unknown. */
export function toLocalGpuAuthorizationError(error: unknown): LocalGpuAuthorizationError | null {
  if (error instanceof LocalGpuAuthorizationError) return error;
  if (error instanceof LocalGpuContractError) {
    return new LocalGpuAuthorizationError(error.message, 409, "The released package does not satisfy the certified LOCAL_GPU contract");
  }
  if (!(error instanceof Error)) return null;
  const known = PERSIST_ERRORS[error.message];
  if (known) return new LocalGpuAuthorizationError(error.message, known.status, known.message);
  if (/^LOCAL_GPU_(ENVIRONMENT_REQUIRED|SIGNING_SECRET_REQUIRED|AGENCY_DISABLED|CONFIG_INVALID)/.test(error.message)) {
    return new LocalGpuAuthorizationError("LOCAL_GPU_CONFIG_UNAVAILABLE", 503, "LOCAL_GPU is not configured on this server");
  }
  return null;
}

export function localGpuOutputAssetId(input: { packageId: string; runtimeAuthorizationId: string }): string {
  // Callers pass wider authority rows; only these two fields define the reserved asset identity.
  return deterministicPersistenceUuid("local-gpu-output-asset", {
    packageId: input.packageId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
  });
}

/** Same prefix as manual local uploads so the canonical VALIDATE_OUTPUT path accepts Desktop bytes. */
export function localGpuOutputStoragePath(input: { workspaceId: string; packageId: string; assetId: string }): string {
  return `${input.workspaceId}/ai-story/local-generation/${input.packageId}/${input.assetId}.mp4`;
}

export function localGpuDispatchIdempotencyKey(input: { packageId: string; runtimeAuthorizationId: string }): string {
  return `local-gpu:${input.packageId}:${input.runtimeAuthorizationId}`;
}

function seedFor(packageId: string): number {
  return Number.parseInt(createHash("sha256").update(packageId).digest("hex").slice(0, 7), 16);
}

function requireProductionConfig(env: Env): LocalGpuConfig {
  let config: LocalGpuConfig;
  try {
    config = loadLocalGpuConfigFromEnv(env);
  } catch (error) {
    throw toLocalGpuAuthorizationError(error) ?? error;
  }
  if (!config.enabled || config.environment !== "production") {
    throw new LocalGpuAuthorizationError("LOCAL_GPU_PRODUCTION_DENIED", 503, "Production LOCAL_GPU authorization is disabled");
  }
  return config;
}

type BuiltDispatch = { route: Record<string, unknown>; request: Record<string, unknown> };

async function assertDispatchDuration(
  db: Db,
  pkg: AiStoryLocalGenerationPackage,
  orgId: string,
  workspaceId: string,
): Promise<void> {
  const [scene] = await db.select({
    instructionHash: schema.aiStorySceneExecutions.instructionHash,
  }).from(schema.aiStorySceneExecutions).where(and(
    eq(schema.aiStorySceneExecutions.id, pkg.sceneExecutionId),
    eq(schema.aiStorySceneExecutions.workspaceId, workspaceId),
    eq(schema.aiStorySceneExecutions.orgId, orgId),
  )).limit(1);
  const [snapshot] = scene ? await db.select({
    instructions: schema.aiStorySceneInstructionSnapshots.instructions,
  }).from(schema.aiStorySceneInstructionSnapshots).where(and(
    eq(schema.aiStorySceneInstructionSnapshots.contentHash, scene.instructionHash),
    eq(schema.aiStorySceneInstructionSnapshots.workspaceId, workspaceId),
    eq(schema.aiStorySceneInstructionSnapshots.orgId, orgId),
  )).limit(1) : [];
  const instructions = snapshot
    ? AiStorySceneCompiledInstructionsSchema.safeParse(snapshot.instructions)
    : null;
  const unitMs = instructions?.success ? instructions.data.durationMs : null;
  const shotMs = instructions?.success
    ? instructions.data.shots.reduce((sum, shot) => sum + shot.durationMs, 0)
    : null;
  if (unitMs === null || shotMs !== unitMs || pkg.durationSec * 1000 !== unitMs) {
    throw new LocalGpuAuthorizationError(
      "LOCAL_GENERATION_DURATION_CONFLICT",
      409,
      `Package duration is ${pkg.durationSec}s and the approved generation unit is ${unitMs === null ? "unavailable" : `${unitMs / 1000}s`}. Authorize ${AI_STORY_EXECUTION_UNIT_DURATION_SUCCESSOR_CONTRACT} before dispatch. The frozen duration was left unchanged.`,
    );
  }
}

async function buildDispatch(input: {
  db: Db;
  pkg: AiStoryLocalGenerationPackage;
  orgId: string;
  workspaceId: string;
  capabilities: unknown;
  upload: { environment: "production"; method: "PUT"; url: string; assetId: string };
  ports: LocalGpuAuthorizationPorts;
}): Promise<BuiltDispatch> {
  const { pkg, capabilities } = input;
  if (pkg.version !== "local-generation-package.v1") {
    const authority = pkg.sourceAuthority.generationAuthority;
    const characterIds = pkg.references.flatMap((reference) => {
      if ("role" in reference) return reference.role === "CHARACTER_IDENTITY" ? [reference.assetId] : [];
      return reference.authorityType === "CHARACTER" ? [reference.assetId] : [];
    });
    const visualStartId = pkg.version === "local-generation-package.v3" && pkg.visualStartAuthority.sourceType !== "NONE"
      ? pkg.visualStartAuthority.assetId
      : null;
    const expectedCharacterIds = authority.referenceSource === "CHARACTER_SYNTHETIC_ANCHOR"
      ? authority.effectiveReferenceIds.filter((assetId) => assetId !== visualStartId)
      : [];
    if (authority.referenceSource === "CHARACTER_SYNTHETIC_ANCHOR" && expectedCharacterIds.join(",") !== characterIds.join(",")) {
      throw new LocalGpuAuthorizationError(
        "LOCAL_GPU_REFERENCE_AUTHORITY_MISMATCH",
        409,
        "Canonical package does not preserve frozen character references in authority order",
      );
    }
    if (authority.referenceSource === "REFERENCE_FREE_T2V" && (authority.effectiveReferenceIds.length > 0 || characterIds.length > 0)) {
      throw new LocalGpuAuthorizationError(
        "LOCAL_GPU_REFERENCE_AUTHORITY_MISMATCH",
        409,
        "Reference-free execution cannot carry invented visual references",
      );
    }
  }
  await assertDispatchDuration(input.db, input.pkg, input.orgId, input.workspaceId);
  const references = pkg.references ?? [];
  const nativeDialogue = pkg.recommendedWorkflow === "MINIMAX_H3_NATIVE_DIALOGUE" || pkg.dialogue.some((line) => !line.offscreen);
  const qcExpectation = nativeDialogue
    ? "NATIVE_CHARACTER_DIALOGUE"
    : pkg.generateAudio && !pkg.audioBlocked ? "NO_DIALOGUE_WITH_AMBIENT_AUDIO" : "SILENT_OUTPUT";
  const noProductVisual = !pkg.productAuthority
    || ("selection" in pkg.productAuthority && pkg.productAuthority.selection === "NO_PRODUCT_VISUAL_INPUT");
  const zeroAsset = pkg.generationMode === "TEXT_TO_VIDEO" && references.length === 0 && !pkg.characterAuthority && noProductVisual;
  if (zeroAsset) {
    return {
      route: {
        assetMode: "WITHOUT_ASSET", assetRecommendationStatus: "CONFIRMED_NO_ASSETS",
        referenceCount: 0, imageReferenceCount: 0, preQc: "DISPATCH_ELIGIBLE",
        runtimeAuthorizationId: pkg.runtimeAuthorizationId, capabilities,
        generateAudio: pkg.generateAudio, audioBlocked: pkg.audioBlocked, qcExpectation,
      },
      request: {
        storyId: pkg.storyId, storyVersionId: pkg.storyVersionId,
        prompt: pkg.prompt.replace(/[\r\n]+/g, " | ").replace(/\s+/g, " ").trim(),
        plannedDurationMs: pkg.durationSec * 1000, aspectRatio: pkg.aspectRatio,
        seed: seedFor(pkg.packageId), megapixels: 0.5,
        audioPolicy: qcExpectation,
        upload: input.upload, assetRecommendationStatus: "CONFIRMED_NO_ASSETS",
        confirmationStoryId: pkg.storyId, confirmationStoryVersionId: pkg.storyVersionId,
        confirmationWorkspaceId: pkg.workspaceId, planningFrozen: true,
        preGenerationQcEvaluationId: pkg.sourceAuthority.preGenerationQcEvaluationId,
        runtimeAuthorizationId: pkg.runtimeAuthorizationId,
        director: null,
      },
    };
  }
  const assetIds = [...new Set(references.map((reference) => reference.assetId))];
  const assetRows = assetIds.length ? await input.db.select().from(schema.assets).where(and(
    eq(schema.assets.workspaceId, input.workspaceId),
    eq(schema.assets.orgId, input.orgId),
    eq(schema.assets.status, "ready"),
    inArray(schema.assets.id, assetIds),
    isNull(schema.assets.deletedAt),
  )) : [];
  // A stored asset may serve several canonical roles; it is signed and sent once.
  const resolvedAssets: { assetId: string; contentHash: string; workspaceId: string; assetUrl: string }[] = [];
  for (const reference of references) {
    const asset = assetRows.find((row) => row.id === reference.assetId && row.contentHash === reference.contentHash);
    if (!asset?.storagePath || !asset.contentHash) {
      throw new LocalGpuAuthorizationError("LOCAL_GPU_REFERENCE_WORKSPACE_MISMATCH", 409, "Authorized LOCAL_GPU reference is unavailable");
    }
    if (resolvedAssets.some((resolved) => resolved.assetId === asset.id && resolved.contentHash === asset.contentHash)) continue;
    const assetUrl = await input.ports.createSignedReadUrl(asset.storagePath, 900);
    if (!assetUrl) throw new LocalGpuAuthorizationError("STORAGE_ERROR", 502, "Unable to authorize LOCAL_GPU reference");
    resolvedAssets.push({ assetId: asset.id, contentHash: asset.contentHash, workspaceId: asset.workspaceId, assetUrl });
  }
  if (nativeDialogue) {
    const native = mapCanonicalPackageToLocalGpuNativeDialogueV3({
      package: pkg,
      assets: resolvedAssets,
      environment: "production",
      jobId: deterministicPersistenceUuid("local-gpu-job.v1", {
        environment: "production",
        workspaceId: pkg.workspaceId,
        sceneExecutionId: pkg.sceneExecutionId,
        packageId: pkg.packageId,
      }),
      upload: input.upload,
      seed: seedFor(pkg.packageId),
      megapixels: 0.5,
    });
    return {
      route: {
        assetMode: "WITH_ASSET", assetRecommendationStatus: "SATISFIED",
        referenceCount: references.length, imageReferenceCount: references.length,
        videoReferenceCount: 0, audioReferenceCount: 0,
        dialogueRequired: true, voiceDnaRequired: false, continuityFrameRequired: false,
        preQc: "DISPATCH_ELIGIBLE", runtimeAuthorizationId: pkg.runtimeAuthorizationId,
        capabilities, recommendedWorkflow: pkg.recommendedWorkflow,
        generateAudio: pkg.generateAudio, audioBlocked: pkg.audioBlocked, qcExpectation,
      },
      request: { body: native.body, creativeBinding: native.creativeBinding },
    };
  }
  const desktop = mapCanonicalPackageToLocalGpuContractV2({
    package: pkg, assets: resolvedAssets, environment: "production",
    jobId: deterministicPersistenceUuid("local-gpu-preview-job", { packageId: pkg.packageId }),
    upload: input.upload,
    firstFrameAuthorities: readLocalGpuV2FirstFrameAuthorities(capabilities),
  });
  const body = desktop.body;
  return {
    route: {
      assetMode: "WITH_ASSET", assetRecommendationStatus: "SATISFIED",
      referenceCount: references.length, preQc: "DISPATCH_ELIGIBLE",
      runtimeAuthorizationId: pkg.runtimeAuthorizationId, capabilities,
      recommendedWorkflow: pkg.recommendedWorkflow,
      generateAudio: pkg.generateAudio, audioBlocked: pkg.audioBlocked, qcExpectation,
    },
    request: {
      sceneExecutionId: body.sceneExecutionId,
      workspaceId: body.workspaceId,
      workflow: body.workflow,
      prompt: body.prompt,
      plannedDurationMs: body.durationSec * 1000,
      upload: body.upload,
      audioPolicy: body.audioPolicy,
      creative: body.creative,
      references: body.references,
      firstFrame: body.firstFrame ? {
        sourceAssetId: body.firstFrame.sourceAssetId,
        contentHash: body.firstFrame.contentHash,
        assetUrl: body.firstFrame.assetUrl,
        authoritySourceAssetId: body.firstFrame.sourceAssetId,
        authorityContentHash: body.firstFrame.contentHash,
      } : null,
      continuityRequired: body.firstFrame !== null,
      dialogueLineCount: 0,
      pinnedVoiceDna: false,
      structuredCamera: false,
      structuredMotion: false,
      textOnly: false,
    },
  };
}

/**
 * Server-derived, non-generating LOCAL_GPU dispatch authority for one released package.
 * Every authority field comes from the frozen package and the verified Superadmin
 * assignment. Replays for the same execution identity return the persisted row.
 */
export async function authorizeLocalGpuPackageDispatch(input: {
  db?: Db;
  env: Env;
  pkg: AiStoryLocalGenerationPackage;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  actorUserId: string;
  platformAdminAssignmentId: string;
  idempotencyKey: string;
  /** Explicit one-execution Production canary consent; ignored for every non-dialogue workflow. */
  nativeDialogueCanaryAuthorized?: boolean;
  ports: LocalGpuAuthorizationPorts;
}): Promise<LocalGpuAuthorizationResult> {
  try {
    return await authorizeUnmapped(input);
  } catch (error) {
    throw toLocalGpuAuthorizationError(error) ?? error;
  }
}

async function authorizeUnmapped(input: Parameters<typeof authorizeLocalGpuPackageDispatch>[0]): Promise<LocalGpuAuthorizationResult> {
  const db = input.db ?? getDb();
  const { pkg } = input;
  const nativeDialogue = pkg.recommendedWorkflow === "MINIMAX_H3_NATIVE_DIALOGUE" || pkg.dialogue.some((line) => !line.offscreen);
  if (input.nativeDialogueCanaryAuthorized && !nativeDialogue) {
    throw new LocalGpuAuthorizationError("LOCAL_GPU_NATIVE_DIALOGUE_CANARY_SCOPE_MISMATCH", 409, "Native Dialogue canary authority only applies to a Native Dialogue package");
  }
  const config = requireProductionConfig(input.env);
  const actor = {
    userId: input.actorUserId,
    workspaceId: input.workspaceId,
    organizationPlan: null,
    platformAdminStatus: "ACTIVE_GRANT" as const,
  };
  const adapter = new LocalGpuCloudAdapter(config, async () => {
    throw new Error("LOCAL_GPU_GENERATION_NOT_PERMITTED_DURING_AUTHORIZATION");
  });
  let capabilitiesResponse: { status: number; body: unknown };
  try {
    capabilitiesResponse = await input.ports.fetchCapabilities({
      url: `${config.baseUrl}/v1/capabilities`,
      token: adapter.capabilitiesToken({ actor, workspaceId: input.workspaceId }),
    });
  } catch {
    throw new LocalGpuAuthorizationError("LOCAL_GPU_CAPABILITIES_UNAVAILABLE", 502, "Desktop capabilities are unreachable");
  }
  if (capabilitiesResponse.status !== 200) {
    throw new LocalGpuAuthorizationError("LOCAL_GPU_CAPABILITIES_UNAVAILABLE", 502, "Desktop capabilities authorization failed");
  }
  const raw = capabilitiesResponse.body;
  const capabilities = raw && typeof raw === "object" && "capabilities" in raw ? (raw as { capabilities: unknown }).capabilities : raw;

  const outputAssetId = localGpuOutputAssetId({ packageId: pkg.packageId, runtimeAuthorizationId: pkg.runtimeAuthorizationId });
  const storagePath = localGpuOutputStoragePath({ workspaceId: input.workspaceId, packageId: pkg.packageId, assetId: outputAssetId });
  const uploadUrl = await input.ports.createSignedUploadUrl(storagePath);
  if (!uploadUrl) throw new LocalGpuAuthorizationError("STORAGE_ERROR", 502, "Unable to authorize LOCAL_GPU output upload");
  const upload = { environment: "production" as const, method: "PUT" as const, url: uploadUrl, assetId: outputAssetId };

  const built = await buildDispatch({
    db, pkg, orgId: input.orgId, workspaceId: input.workspaceId, capabilities, upload, ports: input.ports,
  });
  if (nativeDialogue && input.nativeDialogueCanaryAuthorized) {
    built.route.nativeDialogueCanaryAuthorized = true;
  }
  const planned = planLocalGpuRoute(built.route as never);
  if (!planned.eligible) {
    throw new LocalGpuAuthorizationError(planned.blocked ?? "LOCAL_GPU_WORKFLOW_UNSUPPORTED", 409, "LOCAL_GPU workflow is unsupported");
  }
  if (planned.contractVersion === 2) assertLocalGpuV2RuntimeCapabilities(capabilities as Parameters<typeof assertLocalGpuV2RuntimeCapabilities>[0]);

  const authority = await persistLocalGpuDispatchAuthority(db, {
    idempotencyKey: input.idempotencyKey, orgId: input.orgId, workspaceId: input.workspaceId, campaignId: input.campaignId,
    storyId: pkg.storyId, executionPlanId: pkg.executionPlanId, sceneExecutionId: pkg.sceneExecutionId, packageId: pkg.packageId,
    runtimeAuthorizationId: pkg.runtimeAuthorizationId,
    platformAdminAssignmentId: input.platformAdminAssignmentId,
    authorizedByUserId: input.actorUserId,
    snapshot: { contractVersion: nativeDialogue ? 2 : 1, actor, route: built.route, request: built.request, capabilities },
    expiresAt: new Date(Date.now() + LOCAL_GPU_DISPATCH_AUTHORITY_TTL_MS),
  });
  // The persisted authority is the fail-closed gate, so the output asset is created only
  // after it. The deterministic id keeps this idempotent across lost responses.
  await db.insert(schema.assets).values({
    id: outputAssetId, orgId: input.orgId, workspaceId: input.workspaceId, campaignId: input.campaignId,
    type: "video", storagePath, displayName: `LOCAL_GPU Unit ${pkg.order}`,
    originalFilename: `${pkg.packageId}.mp4`, status: "uploading", source: "ai_story_manual_local",
    uploadedBy: input.actorUserId, mimeType: "video/mp4",
    metadata: {
      localGenerationPackageId: pkg.packageId, localGenerationUnitId: pkg.unitId,
      executionPlanId: pkg.executionPlanId, sourceKind: "LOCAL_GPU_WORKER",
    },
  }).onConflictDoNothing();
  return {
    dispatchAuthorityId: authority.dispatchAuthorityId,
    executionIdentity: authority.executionIdentity,
    sceneExecutionId: pkg.sceneExecutionId,
    packageId: pkg.packageId,
    runtimeAuthorizationId: pkg.runtimeAuthorizationId,
    status: authority.status,
    outputAssetId,
    replayed: authority.replayed,
    gpuSubmitted: false,
  };
}

export type LocalGpuAutoAuthorization = {
  status: "AUTHORIZED" | "NOT_ELIGIBLE" | "NONE_RELEASED" | "FAILED";
  code: string | null;
  packages: { packageId: string; sceneExecutionId: string; dispatchAuthorityId: string | null; replayed: boolean; code: string | null }[];
};

async function planningSelectedProductionLocalGpu(db: Db, scope: { workspaceId: string; executionPlanId: string }): Promise<boolean> {
  const rows = await db.select({ payload: schema.aiStoryAnimationPackages.payload })
    .from(schema.aiStoryExecutionPlans)
    .innerJoin(schema.aiStoryAnimationPackages, and(
      eq(schema.aiStoryAnimationPackages.id, schema.aiStoryExecutionPlans.animationPackageId),
      eq(schema.aiStoryAnimationPackages.workspaceId, schema.aiStoryExecutionPlans.workspaceId),
    ))
    .where(and(
      eq(schema.aiStoryExecutionPlans.id, scope.executionPlanId),
      eq(schema.aiStoryExecutionPlans.workspaceId, scope.workspaceId),
    )).limit(1);
  const authority = (rows[0]?.payload as { executionCapabilityAuthority?: { executionEnvironment?: string; environment?: string } } | undefined)
    ?.executionCapabilityAuthority;
  return authority?.executionEnvironment === "LOCAL_GPU" && authority.environment === "production";
}

/**
 * Derives per-execution dispatch authority for every released, output-less package of one plan
 * when the releasing user holds the account-level Superadmin LOCAL_GPU entitlement and the
 * approved Planning froze a production LOCAL_GPU environment. Never throws: release has already
 * committed, and the manual Authorize action remains available for any package reported here.
 */
export async function autoAuthorizeReleasedLocalGpuPackages(input: {
  db?: Db;
  env: Env;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  executionPlanId: string;
  actorUserId: string;
  ports: LocalGpuAuthorizationPorts;
}): Promise<LocalGpuAutoAuthorization> {
  const db = input.db ?? getDb();
  try {
    const assignment = await findActiveSuperadminAssignment(db, input.actorUserId);
    if (!assignment) return { status: "NOT_ELIGIBLE", code: "LOCAL_GPU_SUPERADMIN_AUTHORITY_REQUIRED", packages: [] };
    const config = loadLocalGpuConfigFromEnv(input.env);
    if (!config.enabled || config.environment !== "production") {
      return { status: "NOT_ELIGIBLE", code: "LOCAL_GPU_PRODUCTION_DENIED", packages: [] };
    }
    if (!(await planningSelectedProductionLocalGpu(db, input))) {
      return { status: "NOT_ELIGIBLE", code: "LOCAL_GPU_PLANNING_ENVIRONMENT_NOT_SELECTED", packages: [] };
    }
    const released = await listReleasedLocalPackagesAwaitingOutput(db, input);
    if (released.length === 0) return { status: "NONE_RELEASED", code: null, packages: [] };
    const repository = new AiStoryLocalGenerationRepository(db);
    const packages: LocalGpuAutoAuthorization["packages"] = [];
    for (const row of released) {
      const pkg = row.packageId
        ? await repository.getExecutablePackage({ workspaceId: input.workspaceId, executionPlanId: input.executionPlanId, packageId: row.packageId })
        : null;
      if (!pkg || pkg.organizationId !== input.orgId || pkg.campaignId !== input.campaignId) {
        packages.push({ packageId: row.packageId ?? "", sceneExecutionId: row.sceneExecutionId, dispatchAuthorityId: null, replayed: false, code: "NOT_FOUND" });
        continue;
      }
      try {
        const result = await authorizeLocalGpuPackageDispatch({
          db, env: input.env, pkg, orgId: input.orgId, workspaceId: input.workspaceId, campaignId: input.campaignId,
          actorUserId: input.actorUserId, platformAdminAssignmentId: assignment.platformAdminAssignmentId,
          idempotencyKey: localGpuDispatchIdempotencyKey(pkg), ports: input.ports,
        });
        packages.push({ packageId: pkg.packageId, sceneExecutionId: pkg.sceneExecutionId, dispatchAuthorityId: result.dispatchAuthorityId, replayed: result.replayed, code: null });
      } catch (error) {
        const mapped = toLocalGpuAuthorizationError(error);
        packages.push({ packageId: pkg.packageId, sceneExecutionId: pkg.sceneExecutionId, dispatchAuthorityId: null, replayed: false, code: mapped?.code ?? "LOCAL_GPU_AUTHORIZATION_FAILED" });
      }
    }
    const failed = packages.find((item) => item.code !== null);
    return failed
      ? { status: "FAILED", code: failed.code, packages }
      : { status: "AUTHORIZED", code: null, packages };
  } catch (error) {
    const mapped = toLocalGpuAuthorizationError(error);
    return { status: "FAILED", code: mapped?.code ?? "LOCAL_GPU_AUTHORIZATION_FAILED", packages: [] };
  }
}
