import { and, eq, sql } from "drizzle-orm";
import {
  AI_STORY_CHARACTER_DNA_COPY,
  AiStoryCharacterDnaAnalysisJobSchema,
  AiStoryCharacterDnaError,
  AiStoryCharacterDnaSchema,
  CHARACTER_SOURCE_PORTRAIT,
  characterDnaAnalysisCostEstimate,
  defaultCharacterDnaLook,
  defaultCharacterDnaMutableLookPolicy,
  mapCharacterDnaToIdentityCore,
  publicCharacterDnaJob,
  validateCharacterSourcePortrait,
  type AiStoryCharacterDna,
  type AiStoryCharacterDnaAnalysisJob,
} from "@ceo-agent/shared";
import {
  applyCharacterDnaAnalysisFailure,
  applyCharacterDnaAnalysisSuccess,
  approveCharacterDna,
  buildAiStoryCharacterDnaAnalysisJob,
  computeCharacterDnaFingerprint,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";

export type CharacterDnaAnalysisExecutor = (input: {
  sourceAssetId: string;
  sourceContentHash: string;
  imageDataUrl: string;
  createdAt: string;
}) => Promise<{
  dna: AiStoryCharacterDna;
  provider: string;
  providerModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  imageGenerationCalls: 0;
  gptImageCalls: 0;
}>;
import {
  AiStoryReusableCharacterError,
  AiStoryReusableCharacterService,
  type AiStoryReusableCharacterScope,
} from "./ai-story-reusable-character";
import { AiStoryCharacterVirtualizerService } from "./ai-story-character-virtualizer";

export { AiStoryCharacterDnaError };

type Db = ReturnType<typeof getDb>;
type Scope = AiStoryReusableCharacterScope;

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
    throw new AiStoryCharacterDnaError(
      "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE",
      "Character DNA Workspace authority does not resolve"
    );
  }
}

function parseJob(row: typeof schema.aiStoryCharacterDnaAnalysisJobs.$inferSelect) {
  return AiStoryCharacterDnaAnalysisJobSchema.parse(row.snapshot);
}

function jobRow(job: AiStoryCharacterDnaAnalysisJob) {
  return {
    jobId: job.id,
    orgId: job.orgId,
    workspaceId: job.workspaceId,
    sourceAssetId: job.sourceAssetId,
    sourceContentHash: job.sourceContentHash,
    sourceSemantic: job.sourceSemantic,
    permissionConfirmed: job.permissionConfirmed,
    status: job.status,
    approvalStatus: job.approvalStatus,
    provider: job.provider,
    providerModel: job.providerModel,
    providerAttemptId: job.providerAttemptId,
    inputTokens: job.inputTokens,
    outputTokens: job.outputTokens,
    costCategory: job.costCategory,
    costUsd: job.costUsd,
    imageGenerationCalls: job.imageGenerationCalls,
    gptImageCalls: job.gptImageCalls,
    seedanceVideoCalls: job.seedanceVideoCalls,
    reusableCharacterId: job.reusableCharacterId,
    reusableCharacterVersionId: job.reusableCharacterVersionId,
    userSafeError: job.userSafeError,
    snapshot: job,
    createdBy: job.createdBy,
    createdAt: new Date(job.createdAt),
    completedAt: job.completedAt ? new Date(job.completedAt) : null,
  };
}

export class AiStoryCharacterDnaService {
  constructor(private readonly db: Db = getDb()) {}

  estimate() {
    return characterDnaAnalysisCostEstimate();
  }

  async registerSourcePortrait(scope: Scope, assetId: string) {
    const asset = await new AiStoryCharacterVirtualizerService(this.db).registerSourcePortrait(scope, assetId);
    const semantic = ((asset.metadata ?? {}) as Record<string, unknown>).characterAssetSemantic;
    if (semantic !== CHARACTER_SOURCE_PORTRAIT) {
      throw new AiStoryCharacterDnaError("SOURCE_PORTRAIT_NOT_FINAL", "Source portrait must remain CHARACTER_SOURCE_PORTRAIT");
    }
    return { sourceAssetId: asset.id, semantic: CHARACTER_SOURCE_PORTRAIT, contentHash: asset.contentHash };
  }

  async readJob(scope: Scope, jobId: string) {
    await assertWorkspaceScope(this.db, scope, false);
    const rows = await this.db.select().from(schema.aiStoryCharacterDnaAnalysisJobs).where(and(
      eq(schema.aiStoryCharacterDnaAnalysisJobs.jobId, jobId),
      eq(schema.aiStoryCharacterDnaAnalysisJobs.orgId, scope.orgId),
      eq(schema.aiStoryCharacterDnaAnalysisJobs.workspaceId, scope.workspaceId),
    )).limit(1);
    if (!rows[0]) throw new AiStoryCharacterDnaError("CHARACTER_DNA_JOB_NOT_FOUND", "Character DNA analysis was not found");
    return parseJob(rows[0]);
  }

  async analyze(scope: Scope, input: {
    sourceAssetId: string;
    permissionConfirmed: true;
    imageDataUrl?: string;
    analyze: CharacterDnaAnalysisExecutor;
    now?: string;
  }) {
    await assertWorkspaceScope(this.db, scope, true);
    if (input.permissionConfirmed !== true) {
      throw new AiStoryCharacterDnaError("CHARACTER_PERMISSION_REQUIRED", "Photo permission must be confirmed");
    }
    const source = await this.db.select().from(schema.assets).where(and(
      eq(schema.assets.id, input.sourceAssetId),
      eq(schema.assets.orgId, scope.orgId),
      eq(schema.assets.workspaceId, scope.workspaceId),
    )).limit(1);
    const asset = source[0];
    if (!asset || asset.deletedAt || !asset.contentHash) {
      throw new AiStoryCharacterDnaError("SOURCE_PORTRAIT_MISSING", "Source portrait was not found in this Workspace");
    }
    const valid = validateCharacterSourcePortrait({
      type: asset.type,
      mimeType: asset.mimeType,
      fileSizeBytes: asset.fileSizeBytes,
      semantic: ((asset.metadata ?? {}) as Record<string, unknown>).characterAssetSemantic as string | undefined,
    });
    if (!valid.ok) throw new AiStoryCharacterDnaError(valid.code, valid.message);
    const now = input.now ?? new Date().toISOString();
    let job = buildAiStoryCharacterDnaAnalysisJob({
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      sourceAssetId: asset.id,
      sourceContentHash: asset.contentHash,
      permissionConfirmed: true,
      createdBy: scope.actorUserId,
      createdAt: now,
    });
    await this.db.insert(schema.aiStoryCharacterDnaAnalysisJobs).values(jobRow(job));
    try {
      const result = await input.analyze({
        sourceAssetId: asset.id,
        sourceContentHash: asset.contentHash,
        imageDataUrl: input.imageDataUrl ?? "data:image/png;base64,AA==",
        createdAt: now,
      });
      if (result.imageGenerationCalls !== 0 || result.gptImageCalls !== 0) {
        throw new AiStoryCharacterDnaError("CHARACTER_DNA_IMAGE_GENERATION_BLOCKED", "Character DNA analysis cannot call image generation.");
      }
      job = applyCharacterDnaAnalysisSuccess(job, {
        dna: result.dna,
        provider: result.provider,
        providerModel: result.providerModel,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        completedAt: new Date().toISOString(),
      });
    } catch {
      job = applyCharacterDnaAnalysisFailure(job, new Date().toISOString());
    }
    await this.db.update(schema.aiStoryCharacterDnaAnalysisJobs).set(jobRow(job))
      .where(eq(schema.aiStoryCharacterDnaAnalysisJobs.jobId, job.id));
    return publicCharacterDnaJob(job);
  }

  async save(scope: Scope, input: {
    jobId: string;
    name: string;
    approvedDna: AiStoryCharacterDna;
    targetReusableCharacterId?: string | null;
    now?: string;
  }) {
    const job = await this.readJob(scope, input.jobId);
    const approved = approveCharacterDna(job, AiStoryCharacterDnaSchema.parse(input.approvedDna));
    const now = input.now ?? new Date().toISOString();
    const characters = new AiStoryReusableCharacterService(this.db);
    const identityCore = mapCharacterDnaToIdentityCore(approved.dna);
    const payload = {
      name: input.name.trim(),
      identityCore,
      defaultLook: defaultCharacterDnaLook(),
      mutableLookPolicy: defaultCharacterDnaMutableLookPolicy(),
      canonicalAssets: [{
        assetId: approved.dna.sourceAssetId,
        role: "CHARACTER_SOURCE_PORTRAIT" as const,
      }],
      identityMode: "CHARACTER_DNA" as const,
      characterDna: approved.dna,
      characterDnaFingerprint: computeCharacterDnaFingerprint(approved.dna),
    };
    const character = input.targetReusableCharacterId
      ? await characters.edit(
          scope,
          input.targetReusableCharacterId,
          payload,
          (await characters.readCurrent(scope, input.targetReusableCharacterId, true)).version,
          now
        )
      : await characters.create(scope, payload, undefined, now);
    const saved: AiStoryCharacterDnaAnalysisJob = {
      ...approved.job,
      reusableCharacterId: character.reusableCharacterId,
      reusableCharacterVersionId: character.reusableCharacterVersionId,
    };
    await this.db.update(schema.aiStoryCharacterDnaAnalysisJobs).set(jobRow(saved))
      .where(and(
        eq(schema.aiStoryCharacterDnaAnalysisJobs.jobId, saved.id),
        eq(schema.aiStoryCharacterDnaAnalysisJobs.workspaceId, scope.workspaceId),
      ));
    if (character.identityMode !== "CHARACTER_DNA") {
      throw new AiStoryCharacterDnaError("CHARACTER_DNA_IDENTITY_REQUIRED", AI_STORY_CHARACTER_DNA_COPY.saveRequiresApprovedDna);
    }
    if (character.canonicalAssets.some((asset) => asset.role === "IDENTITY_MASTER")) {
      throw new AiStoryReusableCharacterError("SOURCE_PORTRAIT_NOT_IDENTITY_MASTER", "Source portrait cannot become IDENTITY_MASTER");
    }
    return { job: publicCharacterDnaJob(saved), character };
  }
}
