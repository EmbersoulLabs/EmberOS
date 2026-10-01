import { and, asc, eq, inArray } from "drizzle-orm";
import {
  AiStoryLocalGenerationOutputSchema,
  AiStoryLocalGenerationPackageSchema,
  type AiStoryLocalGenerationOutput,
  type AiStoryLocalGenerationPackage,
  AiStoryPreGenerationQcEvaluationSchema,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export class AiStoryLocalGenerationPersistenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryLocalGenerationPersistenceError";
  }
}

export class AiStoryLocalGenerationRepository {
  constructor(private readonly db: Db = getDb()) {}

  async loadUnitContext(sceneExecutionId:string,qcEvaluationId:string,qcFingerprint:string) {
    const [scene]=await this.db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,sceneExecutionId)).limit(1);
    if(!scene)throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Exact persisted execution Unit is missing");
    const [row]=await this.db.select().from(schema.aiStoryPreGenerationQcEvaluations).where(eq(schema.aiStoryPreGenerationQcEvaluations.qcEvaluationId,qcEvaluationId)).limit(1);
    if(!row) {
      if(/^[a-f0-9-]{36}$/i.test(scene.sceneId))throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Canonical Scene is missing frozen Pre-QC lineage");
      return {sceneId:scene.sceneId,planningAuthority:{planningLineageSource:"LEGACY_COMPILED_V1" as const,sceneVersion:1,scriptVersionId:null,handoffId:null,handoffFingerprint:null}};
    }
    const qc=AiStoryPreGenerationQcEvaluationSchema.parse(row.evaluation);
    if(qc.sceneExecutionId!==sceneExecutionId||qc.storyVersionId!==scene.storyVersionId||qc.qcFingerprint!==qcFingerprint)throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Pre-QC lineage does not match this frozen execution Unit");
    const [handoff]=await this.db.select().from(schema.aiStoryScriptDirectorHandoffs).where(eq(schema.aiStoryScriptDirectorHandoffs.handoffId,qc.handoffId)).limit(1);
    const versions=qc.sceneVersionIds?.length?await this.db.select().from(schema.aiStoryCanonicalSceneVersions).where(and(
      inArray(schema.aiStoryCanonicalSceneVersions.sceneVersionId,qc.sceneVersionIds),
      eq(schema.aiStoryCanonicalSceneVersions.sceneId,scene.sceneId),
      eq(schema.aiStoryCanonicalSceneVersions.storyVersionId,scene.storyVersionId),
      eq(schema.aiStoryCanonicalSceneVersions.scriptVersionId,qc.scriptVersionId),
    )):[];
    if(!handoff||versions.length!==1)throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Exact frozen Scene-version/Handoff lineage is required");
    return {sceneId:scene.sceneId,planningAuthority:{planningLineageSource:"FROZEN_SCRIPT_DIRECTOR" as const,sceneVersion:versions[0]!.version,scriptVersionId:qc.scriptVersionId,handoffId:qc.handoffId,handoffFingerprint:handoff.handoffFingerprint}};
  }

  async insertOrConverge(input: {
    readonly packages: readonly AiStoryLocalGenerationPackage[];
    readonly createdBy: string;
  }): Promise<{ packages: readonly AiStoryLocalGenerationPackage[]; replayed: boolean }> {
    const requested = input.packages.map((item) => AiStoryLocalGenerationPackageSchema.parse(item));
    if (requested.length === 0) {
      throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_EMPTY", "At least one local Generation Unit is required");
    }
    const inserted = await this.db.transaction(async (tx) => {
      const accepted: AiStoryLocalGenerationPackage[] = [];
      let replayed = true;
      for (const item of requested) {
        const {packageFingerprint,createdAt:_createdAt,...facts}=item;
        if(packageFingerprint!==canonicalPersistenceHash({kind:item.version,...facts})) throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_IMMUTABLE_CONFLICT","Package fingerprint does not match frozen facts");
        const [scene]=await tx.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,item.sceneExecutionId)).limit(1);
        const [runtime]=await tx.select().from(schema.aiStoryRuntimeAuthorizedFacts).where(eq(schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,item.runtimeAuthorizationId)).limit(1);
        if(!scene||!runtime||scene.executionPlanId!==item.executionPlanId||runtime.executionPlanId!==item.executionPlanId||
          scene.sceneId!==item.sceneId||runtime.orgId!==item.organizationId||runtime.workspaceId!==item.workspaceId||
          runtime.campaignId!==item.campaignId||runtime.storyId!==item.storyId||runtime.storyVersionId!==item.storyVersionId||
          !runtime.orderedSceneExecutionIds.includes(item.sceneExecutionId)||
          scene.orgId!==item.organizationId||scene.workspaceId!==item.workspaceId||scene.campaignId!==item.campaignId||scene.storyId!==item.storyId||scene.storyVersionId!==item.storyVersionId) throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Package ownership does not match frozen Scene and Runtime authority");
        const rows = await tx.insert(schema.aiStoryLocalGenerationPackages).values({
          packageId: item.packageId,
          packageFingerprint: item.packageFingerprint,
          orgId: item.organizationId,
          workspaceId: item.workspaceId,
          campaignId: item.campaignId,
          storyId: item.storyId,
          storyVersionId: item.storyVersionId,
          executionPlanId: item.executionPlanId,
          runtimeAuthorizationId: item.runtimeAuthorizationId,
          sceneExecutionId: item.sceneExecutionId,
          unitId: item.unitId,
          unitOrder: item.order,
          retryOfPackageId: item.retryOfPackageId,
          retryNumber: item.retryNumber,
          contractVersion: item.version,
          package: item,
          createdBy: input.createdBy,
          createdAt: new Date(item.createdAt),
        }).onConflictDoNothing().returning();
        if (rows[0]) {
          accepted.push(AiStoryLocalGenerationPackageSchema.parse(rows[0].package));
          replayed = false;
          continue;
        }
        const existing = await tx.select().from(schema.aiStoryLocalGenerationPackages).where(and(
          eq(schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId, item.runtimeAuthorizationId),
          eq(schema.aiStoryLocalGenerationPackages.unitId, item.unitId),
          eq(schema.aiStoryLocalGenerationPackages.retryNumber, item.retryNumber),
        )).limit(1);
        const parsed = existing[0] ? AiStoryLocalGenerationPackageSchema.parse(existing[0].package) : null;
        if (!parsed || parsed.packageFingerprint !== item.packageFingerprint) {
          throw new AiStoryLocalGenerationPersistenceError(
            "LOCAL_GENERATION_IMMUTABLE_CONFLICT",
            "A different package already owns this local Generation Unit identity",
          );
        }
        accepted.push(parsed);
      }
      return { packages: accepted.sort((a, b) => a.order - b.order), replayed };
    });
    return inserted;
  }

  async listByExecutionPlan(input: {
    readonly workspaceId: string;
    readonly executionPlanId: string;
  }): Promise<readonly AiStoryLocalGenerationPackage[]> {
    const rows = await this.db.select().from(schema.aiStoryLocalGenerationPackages).where(and(
      eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
    )).orderBy(asc(schema.aiStoryLocalGenerationPackages.unitOrder));
    return rows.map((row) => AiStoryLocalGenerationPackageSchema.parse(row.package));
  }

  async getPackage(input: {
    readonly workspaceId: string;
    readonly executionPlanId: string;
    readonly packageId: string;
  }): Promise<AiStoryLocalGenerationPackage | null> {
    const rows = await this.db.select().from(schema.aiStoryLocalGenerationPackages).where(and(
      eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
      eq(schema.aiStoryLocalGenerationPackages.packageId, input.packageId),
    )).limit(1);
    return rows[0] ? AiStoryLocalGenerationPackageSchema.parse(rows[0].package) : null;
  }

  async insertOutput(outputInput: AiStoryLocalGenerationOutput): Promise<{ output: AiStoryLocalGenerationOutput; replayed: boolean }> {
    const output = AiStoryLocalGenerationOutputSchema.parse(outputInput);
    const [pkg]=await this.db.select().from(schema.aiStoryLocalGenerationPackages).where(eq(schema.aiStoryLocalGenerationPackages.packageId,output.packageId)).limit(1);
    const [asset]=await this.db.select().from(schema.assets).where(eq(schema.assets.id,output.assetId)).limit(1);
    if(!pkg||!asset||asset.status!=="ready"||pkg.unitId!==output.unitId||pkg.sceneExecutionId!==output.sceneExecutionId||asset.workspaceId!==pkg.workspaceId||asset.orgId!==pkg.orgId||asset.campaignId!==pkg.campaignId||asset.contentHash!==output.contentHash) throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_OUTPUT_WRONG_UNIT","Accepted media must match the exact package Unit and private Asset");
    const rows = await this.db.insert(schema.aiStoryLocalGenerationOutputs).values({
      outputId: output.outputId,
      packageId: output.packageId,
      unitId: output.unitId,
      sceneExecutionId: output.sceneExecutionId,
      assetId: output.assetId,
      contentHash: output.contentHash,
      mediaType: output.mediaType,
      durationSec: String(output.durationSec),
      width: output.width,
      height: output.height,
      qcState: output.qcState,
      continuityFrameAssetId: output.continuityFrameAssetId,
      uploadedBy: output.uploadedBy,
      uploadedAt: new Date(output.uploadedAt),
    }).onConflictDoNothing().returning();
    if (rows[0]) return { output, replayed: false };
    const existing = await this.db.select().from(schema.aiStoryLocalGenerationOutputs).where(
      eq(schema.aiStoryLocalGenerationOutputs.packageId, output.packageId),
    ).limit(1);
    if (!existing[0]) {
      throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_OUTPUT_CONFLICT", "Local output insert did not converge");
    }
    const parsed = AiStoryLocalGenerationOutputSchema.parse({
      outputId: existing[0].outputId,
      packageId: existing[0].packageId,
      unitId: existing[0].unitId,
      sceneExecutionId: existing[0].sceneExecutionId,
      assetId: existing[0].assetId,
      contentHash: existing[0].contentHash,
      mediaType: existing[0].mediaType,
      durationSec: Number(existing[0].durationSec),
      width: existing[0].width,
      height: existing[0].height,
      uploadedBy: existing[0].uploadedBy,
      uploadedAt: existing[0].uploadedAt.toISOString(),
      qcState: existing[0].qcState,
      continuityFrameAssetId: existing[0].continuityFrameAssetId,
    });
    if (parsed.contentHash !== output.contentHash || parsed.assetId !== output.assetId) {
      throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_OUTPUT_CONFLICT", "A different output is already bound to this Unit package");
    }
    return { output: parsed, replayed: true };
  }

  async listOutputs(input: { readonly workspaceId: string; readonly executionPlanId: string }) {
    const rows = await this.db.select({ output: schema.aiStoryLocalGenerationOutputs }).from(schema.aiStoryLocalGenerationOutputs)
      .innerJoin(schema.aiStoryLocalGenerationPackages, eq(schema.aiStoryLocalGenerationPackages.packageId, schema.aiStoryLocalGenerationOutputs.packageId))
      .where(and(
        eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
      ));
    return rows.map(({ output }) => AiStoryLocalGenerationOutputSchema.parse({
      outputId: output.outputId,
      packageId: output.packageId,
      unitId: output.unitId,
      sceneExecutionId: output.sceneExecutionId,
      assetId: output.assetId,
      contentHash: output.contentHash,
      mediaType: output.mediaType,
      durationSec: Number(output.durationSec),
      width: output.width,
      height: output.height,
      uploadedBy: output.uploadedBy,
      uploadedAt: output.uploadedAt.toISOString(),
      qcState: output.qcState,
      continuityFrameAssetId: output.continuityFrameAssetId,
    }));
  }
}
