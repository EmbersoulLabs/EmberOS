import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  AiStoryCharacterVirtualizerError,
  AiStoryCharacterVirtualizationJobSchema,
  CHARACTER_SOURCE_PORTRAIT,
  CHARACTER_VIRTUALIZATION_OUTPUT,
  VIRTUAL_CHARACTER_CANDIDATE,
  characterVirtualizationCostEstimate,
  characterVirtualizationUserSafeFailure,
  compileVirtualizationLineage,
  evaluateSourcePortraitDeletion,
  sourcePortraitCannotReplaceCanonicalOutput,
  validateCharacterSourcePortrait,
  type AiStoryCharacterVirtualStyle,
  type AiStoryCharacterVirtualizationJob,
  type CharacterVirtualizationProvider,
} from "@ceo-agent/shared";
import {
  applyProviderFailureToJob,
  applyProviderSuccessToJob,
  buildAiStoryCharacterVirtualizationJob,
  compileCharacterVirtualizationPrompt,
  defaultVirtualCharacterLook,
  defaultVirtualMutableLookPolicy,
  deriveAcceptedVirtualIdentityCore,
  markJobAccepted,
  resolveCharacterVirtualizationProvider,
} from "@ceo-agent/shared/server";
import { STORAGE_PATHS } from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  AiStoryReusableCharacterError,
  AiStoryReusableCharacterService,
  type AiStoryReusableCharacterScope,
} from "./ai-story-reusable-character";

export { AiStoryCharacterVirtualizerError };

type Db = ReturnType<typeof getDb>;
type Scope = AiStoryReusableCharacterScope;
type SourceBytesLoader = (input: {
  storagePath: string;
  contentHash: string;
  mimeType: string;
}) => Promise<Uint8Array>;
type OutputBytesPersister = (input: {
  storagePath: string;
  bytes: Buffer;
  mimeType: string;
}) => Promise<void>;

async function assertWorkspaceScope(db: Pick<Db, "execute">, scope: Scope, mutation: boolean) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from workspaces w where w.id=${scope.workspaceId}::uuid and w.org_id=${scope.orgId}::uuid
      and exists(
        select 1 from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid
          and wm.user_id=${scope.actorUserId}::uuid
          and (${mutation}=false or wm.role in ('admin','operator'))
      )
  ) as ok`);
  if (!rows[0]?.ok) {
    throw new AiStoryCharacterVirtualizerError(
      "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE",
      "Character Virtualizer Workspace authority does not resolve"
    );
  }
}

function parseJob(row: typeof schema.aiStoryCharacterVirtualizationJobs.$inferSelect) {
  return AiStoryCharacterVirtualizationJobSchema.parse(row.snapshot);
}

function jobRow(job: AiStoryCharacterVirtualizationJob) {
  return {
    jobId: job.id,
    orgId: job.orgId,
    workspaceId: job.workspaceId,
    sourceAssetId: job.sourceAssetId,
    sourceContentHash: job.sourceContentHash,
    sourceSemantic: job.sourceSemantic,
    style: job.style,
    visualClass: job.visualClass,
    creativeDirection: job.creativeDirection,
    permissionConfirmed: job.permissionConfirmed,
    status: job.status,
    acceptanceStatus: job.acceptanceStatus,
    provider: job.provider,
    providerModel: job.providerModel,
    providerAttemptId: job.providerAttemptId,
    promptFingerprint: job.promptFingerprint,
    outputAssetId: job.outputAssetId,
    outputContentHash: job.outputContentHash,
    outputSemantic: job.outputSemantic,
    costCategory: job.costCategory,
    costUsd: job.costUsd,
    parentJobId: job.parentJobId,
    automaticRetry: job.automaticRetry,
    reusableCharacterId: job.reusableCharacterId,
    reusableCharacterVersionId: job.reusableCharacterVersionId,
    seedanceVideoCalls: job.seedanceVideoCalls,
    realImageProviderCalls: job.realImageProviderCalls,
    userSafeError: job.userSafeError,
    snapshot: job,
    createdBy: job.createdBy,
    createdAt: new Date(job.createdAt),
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
  };
}

export class AiStoryCharacterVirtualizerService {
  constructor(private readonly db: Db = getDb()) {}

  estimate(style: AiStoryCharacterVirtualStyle) {
    return characterVirtualizationCostEstimate(style);
  }

  async registerSourcePortrait(scope: Scope, assetId: string) {
    await assertWorkspaceScope(this.db, scope, true);
    const rows = await this.db.select().from(schema.assets).where(and(
      eq(schema.assets.id, assetId),
      eq(schema.assets.orgId, scope.orgId),
      eq(schema.assets.workspaceId, scope.workspaceId),
    )).limit(1);
    const asset = rows[0];
    if (!asset || asset.deletedAt) {
      throw new AiStoryCharacterVirtualizerError("SOURCE_PORTRAIT_MISSING", "Source portrait was not found in this Workspace");
    }
    const valid = validateCharacterSourcePortrait({
      type: asset.type,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes,
      semantic: ((asset.metadata ?? {}) as Record<string, unknown>).characterAssetSemantic as string | undefined,
    });
    if (!valid.ok) throw new AiStoryCharacterVirtualizerError(valid.code, valid.message);
    if (!asset.contentHash) {
      throw new AiStoryCharacterVirtualizerError("SOURCE_PORTRAIT_NOT_FINAL", "Source portrait must be a finalized Workspace asset");
    }
    const metadata = { ...(asset.metadata ?? {}), characterAssetSemantic: CHARACTER_SOURCE_PORTRAIT };
    const [updated] = await this.db.update(schema.assets).set({ metadata, updatedAt: new Date() })
      .where(eq(schema.assets.id, asset.id)).returning();
    return updated;
  }

  async readJob(scope: Scope, jobId: string) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCharacterVirtualizationJobs).where(and(
      eq(schema.aiStoryCharacterVirtualizationJobs.jobId, jobId),
      eq(schema.aiStoryCharacterVirtualizationJobs.orgId, scope.orgId),
      eq(schema.aiStoryCharacterVirtualizationJobs.workspaceId, scope.workspaceId),
    )).limit(1);
    if (!rows[0]) throw new AiStoryCharacterVirtualizerError("VIRTUALIZATION_JOB_NOT_FOUND", "Virtualization job was not found");
    return parseJob(rows[0]);
  }

  async latestAcceptedForCharacter(scope: Scope, reusableCharacterId: string) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCharacterVirtualizationJobs).where(and(
      eq(schema.aiStoryCharacterVirtualizationJobs.reusableCharacterId, reusableCharacterId),
      eq(schema.aiStoryCharacterVirtualizationJobs.workspaceId, scope.workspaceId),
      eq(schema.aiStoryCharacterVirtualizationJobs.acceptanceStatus, "ACCEPTED"),
    )).orderBy(desc(schema.aiStoryCharacterVirtualizationJobs.createdAt)).limit(1);
    return rows[0] ? parseJob(rows[0]) : null;
  }

  async generate(scope: Scope, input: {
    sourceAssetId: string;
    style: AiStoryCharacterVirtualStyle;
    creativeDirection?: string | null;
    permissionConfirmed: true;
    costAuthorized: true;
    parentJobId?: string | null;
    provider?: CharacterVirtualizationProvider;
    sourceBytes?: Uint8Array;
    loadSourceBytes?: SourceBytesLoader;
    persistOutputBytes?: OutputBytesPersister;
    now?: string;
  }) {
    if (input.costAuthorized !== true) {
      throw new AiStoryCharacterVirtualizerError("COST_AUTHORIZATION_REQUIRED", "Generate Again requires a new paid authorization");
    }
    const source = await this.registerSourcePortrait(scope, input.sourceAssetId);
    const now = input.now ?? new Date().toISOString();
    const provider = input.provider ?? resolveCharacterVirtualizationProvider();
    const job = buildAiStoryCharacterVirtualizationJob({
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      sourceAssetId: source.id,
      sourceContentHash: source.contentHash!,
      style: input.style,
      creativeDirection: input.creativeDirection,
      permissionConfirmed: true,
      createdBy: scope.actorUserId,
      createdAt: now,
      parentJobId: input.parentJobId ?? null,
      provider: provider.providerId,
      providerModel: provider.providerModel,
    });
    await this.db.insert(schema.aiStoryCharacterVirtualizationJobs).values(jobRow({ ...job, status: "RUNNING" }));

    let sourceBytes = input.sourceBytes;
    if (!sourceBytes && input.loadSourceBytes) {
      sourceBytes = await input.loadSourceBytes({
        storagePath: source.storagePath,
        contentHash: source.contentHash!,
        mimeType: source.mimeType ?? "image/png",
      });
    }

    const compiledPrompt = compileCharacterVirtualizationPrompt({
      style: job.style,
      creativeDirection: job.creativeDirection,
    });
    let result: Awaited<ReturnType<CharacterVirtualizationProvider["virtualizeCharacter"]>>;
    try {
      result = await provider.virtualizeCharacter({
        sourceImage: {
          assetId: source.id,
          contentHash: source.contentHash!,
          mimeType: source.mimeType ?? "image/png",
          width: source.width,
          height: source.height,
          ...(sourceBytes ? { bytes: sourceBytes } : {}),
        },
        style: job.style,
        creativeDirection: job.creativeDirection,
        compiledPrompt,
        outputRequirements: {
          mimeType: CHARACTER_VIRTUALIZATION_OUTPUT.mimeType,
          width: CHARACTER_VIRTUALIZATION_OUTPUT.width,
          height: CHARACTER_VIRTUALIZATION_OUTPUT.height,
        },
        authorization: {
          authorizationId: job.id,
          executionIdentity: job.id,
          idempotencyKey: job.id,
          scope: { tenantId: scope.orgId, workspaceId: scope.workspaceId },
          authorizedBy: scope.actorUserId,
          authorizedAt: now,
          maximumProviderCalls: 1,
        },
      });
    } catch {
      const failed = applyProviderFailureToJob(
        { ...job, status: "RUNNING" },
        {
          ok: false,
          code: "PROVIDER_UNAVAILABLE",
          userSafeMessage: characterVirtualizationUserSafeFailure("PROVIDER_UNAVAILABLE"),
          provider: provider.providerId,
          providerModel: provider.providerModel,
          providerAttemptId: randomUUID(),
          realImageProviderCalls: 0,
        },
        new Date().toISOString()
      );
      await this.db.update(schema.aiStoryCharacterVirtualizationJobs).set(jobRow(failed))
        .where(eq(schema.aiStoryCharacterVirtualizationJobs.jobId, job.id));
      return failed;
    }

    const completedAt = new Date().toISOString();
    if (!result.ok) {
      const failed = applyProviderFailureToJob({ ...job, status: "RUNNING" }, result, completedAt);
      await this.db.update(schema.aiStoryCharacterVirtualizationJobs).set(jobRow(failed))
        .where(eq(schema.aiStoryCharacterVirtualizationJobs.jobId, job.id));
      return failed;
    }
    if (result.contentHash === source.contentHash) {
      const failed = applyProviderFailureToJob(
        { ...job, status: "RUNNING" },
        {
          ok: false,
          code: "PROVIDER_RESULT_INVALID",
          userSafeMessage: characterVirtualizationUserSafeFailure("PROVIDER_RESULT_INVALID"),
          provider: result.provider,
          providerModel: result.providerModel,
          providerAttemptId: result.providerAttemptId,
          realImageProviderCalls: result.realImageProviderCalls,
        },
        completedAt
      );
      await this.db.update(schema.aiStoryCharacterVirtualizationJobs).set(jobRow(failed))
        .where(eq(schema.aiStoryCharacterVirtualizationJobs.jobId, job.id));
      return failed;
    }
    const outputAssetId = randomUUID();
    const storagePath = STORAGE_PATHS.library(scope.workspaceId, outputAssetId, "png");
    try {
      if (input.persistOutputBytes) {
        await input.persistOutputBytes({
          storagePath,
          bytes: Buffer.from(result.bytes),
          mimeType: result.mimeType,
        });
      }
      await this.db.insert(schema.assets).values({
        id: outputAssetId,
        orgId: scope.orgId,
        workspaceId: scope.workspaceId,
        campaignId: null,
        type: "image",
        storagePath,
        displayName: "Virtual Character candidate",
        originalFilename: "virtual-character.png",
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
        fileSizeBytes: result.bytes.byteLength,
        status: "ready",
        source: "character_virtualization",
        uploadedBy: scope.actorUserId,
        contentHash: result.contentHash,
        metadata: { characterAssetSemantic: VIRTUAL_CHARACTER_CANDIDATE, virtualStyle: job.style },
      });
      const succeeded = applyProviderSuccessToJob(
        { ...job, status: "RUNNING" },
        result,
        outputAssetId,
        completedAt,
        result.costUsd ?? "0.0000"
      );
      await this.db.update(schema.aiStoryCharacterVirtualizationJobs).set(jobRow(succeeded))
        .where(eq(schema.aiStoryCharacterVirtualizationJobs.jobId, job.id));
      return succeeded;
    } catch {
      const failed = applyProviderFailureToJob(
        { ...job, status: "RUNNING" },
        {
          ok: false,
          code: "PROVIDER_UNAVAILABLE",
          userSafeMessage: characterVirtualizationUserSafeFailure("PROVIDER_UNAVAILABLE"),
          provider: result.provider,
          providerModel: result.providerModel,
          providerAttemptId: result.providerAttemptId,
          realImageProviderCalls: 0,
        },
        completedAt
      );
      await this.db.update(schema.aiStoryCharacterVirtualizationJobs).set(jobRow(failed))
        .where(eq(schema.aiStoryCharacterVirtualizationJobs.jobId, job.id));
      return failed;
    }
  }

  async generateAgain(scope: Scope, input: {
    parentJobId: string;
    costAuthorized: true;
    permissionConfirmed: true;
    provider?: CharacterVirtualizationProvider;
    sourceBytes?: Uint8Array;
    loadSourceBytes?: SourceBytesLoader;
    persistOutputBytes?: OutputBytesPersister;
  }) {
    const parent = await this.readJob(scope, input.parentJobId);
    return this.generate(scope, {
      sourceAssetId: parent.sourceAssetId,
      style: parent.style,
      creativeDirection: parent.creativeDirection,
      permissionConfirmed: true,
      costAuthorized: true,
      parentJobId: parent.id,
      provider: input.provider,
      sourceBytes: input.sourceBytes,
      loadSourceBytes: input.loadSourceBytes,
      persistOutputBytes: input.persistOutputBytes,
    });
  }

  async accept(scope: Scope, input: {
    jobId: string;
    name: string;
    targetReusableCharacterId?: string | null;
    now?: string;
  }) {
    await assertWorkspaceScope(this.db, scope, true);
    const job = await this.readJob(scope, input.jobId);
    if (job.status !== "SUCCEEDED" || job.acceptanceStatus !== VIRTUAL_CHARACTER_CANDIDATE) {
      throw new AiStoryCharacterVirtualizerError("CANDIDATE_ACCEPTANCE_REQUIRED", "Use This Character requires an explicit accepted virtual result");
    }
    if (!job.outputAssetId || !job.outputContentHash) {
      throw new AiStoryCharacterVirtualizerError("VIRTUAL_OUTPUT_MISSING", "Virtual Character output is missing");
    }
    if (!sourcePortraitCannotReplaceCanonicalOutput({
      sourceAssetId: job.sourceAssetId,
      sourceContentHash: job.sourceContentHash,
      identityMasterAssetId: job.outputAssetId,
      identityMasterContentHash: job.outputContentHash,
    })) {
      throw new AiStoryCharacterVirtualizerError(
        "SOURCE_PORTRAIT_NOT_IDENTITY_MASTER",
        "The source portrait cannot become Character identity"
      );
    }
    await this.db.update(schema.assets).set({
      metadata: {
        characterAssetSemantic: "ACCEPTED_VIRTUAL_IDENTITY_MASTER",
        virtualStyle: job.style,
        visualClass: job.visualClass,
      },
      displayName: input.name,
      updatedAt: new Date(),
    }).where(eq(schema.assets.id, job.outputAssetId));
    const characters = new AiStoryReusableCharacterService(this.db);
    const identityCore = deriveAcceptedVirtualIdentityCore({
      name: input.name,
      style: job.style,
      creativeDirection: job.creativeDirection,
    });
    const payload = {
      name: input.name,
      identityCore,
      defaultLook: defaultVirtualCharacterLook(),
      mutableLookPolicy: defaultVirtualMutableLookPolicy(),
      canonicalAssets: [{ assetId: job.outputAssetId, role: "IDENTITY_MASTER" as const }],
    };
    let version;
    if (input.targetReusableCharacterId) {
      const current = await characters.readCurrent(scope, input.targetReusableCharacterId, true);
      version = await characters.edit(scope, input.targetReusableCharacterId, {
        ...payload,
        canonicalAssets: [
          { assetId: job.outputAssetId, role: "IDENTITY_MASTER" },
          ...current.canonicalAssets
            .filter((asset) => asset.role !== "IDENTITY_MASTER")
            .map((asset) => ({ assetId: asset.assetId, role: asset.role, source: asset.source })),
        ],
      }, current.version, input.now);
    } else {
      version = await characters.create(scope, payload, randomUUID(), input.now);
    }
    const accepted = markJobAccepted(job, {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
      completedAt: input.now ?? new Date().toISOString(),
    });
    const updated = await this.db.update(schema.aiStoryCharacterVirtualizationJobs).set(jobRow(accepted))
      .where(and(
        eq(schema.aiStoryCharacterVirtualizationJobs.jobId, job.id),
        eq(schema.aiStoryCharacterVirtualizationJobs.acceptanceStatus, VIRTUAL_CHARACTER_CANDIDATE),
      )).returning();
    if (!updated[0]) {
      throw new AiStoryCharacterVirtualizerError("CANDIDATE_ACCEPTANCE_REQUIRED", "This virtual result was already used");
    }
    return { job: accepted, character: version, lineage: compileVirtualizationLineage(accepted) };
  }

  async lineage(scope: Scope, jobId: string) {
    return compileVirtualizationLineage(await this.readJob(scope, jobId));
  }

  async evaluateAssetDeletion(scope: Scope, assetId: string) {
    await assertWorkspaceScope(this.db, scope, true);
    const jobs = await this.db.select().from(schema.aiStoryCharacterVirtualizationJobs).where(and(
      eq(schema.aiStoryCharacterVirtualizationJobs.workspaceId, scope.workspaceId),
      eq(schema.aiStoryCharacterVirtualizationJobs.sourceAssetId, assetId),
    ));
    const asOutput = await this.db.select().from(schema.aiStoryCharacterVirtualizationJobs).where(and(
      eq(schema.aiStoryCharacterVirtualizationJobs.workspaceId, scope.workspaceId),
      eq(schema.aiStoryCharacterVirtualizationJobs.outputAssetId, assetId),
    ));
    const acceptedOutput = asOutput.map(parseJob).find((job) => job.acceptanceStatus === "ACCEPTED");
    if (acceptedOutput) {
      return evaluateSourcePortraitDeletion({
        sourceAssetId: assetId,
        identityMasterAssetId: acceptedOutput.outputAssetId,
        acceptedCharacterExists: true,
      });
    }
    const acceptedSource = jobs.map(parseJob).find((job) => job.acceptanceStatus === "ACCEPTED");
    if (acceptedSource) {
      return evaluateSourcePortraitDeletion({
        sourceAssetId: assetId,
        identityMasterAssetId: acceptedSource.outputAssetId,
        acceptedCharacterExists: true,
      });
    }
    const versions = await this.db.select({ snapshot: schema.aiStoryReusableCharacterVersions.snapshot })
      .from(schema.aiStoryReusableCharacterVersions)
      .where(eq(schema.aiStoryReusableCharacterVersions.workspaceId, scope.workspaceId));
    const usedAsMaster = versions.some((row) =>
      (row.snapshot.canonicalAssets ?? []).some((asset) => asset.role === "IDENTITY_MASTER" && asset.assetId === assetId)
    );
    if (usedAsMaster) {
      return { allowed: false, characterPreserved: true, code: "IDENTITY_MASTER_RETAINED" };
    }
    return { allowed: true, characterPreserved: true, code: "SOURCE_PORTRAIT_ONLY" };
  }
}

export { AiStoryReusableCharacterError };
