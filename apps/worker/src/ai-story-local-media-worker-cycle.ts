import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema, AiStoryLocalMediaJobRepository, AiStoryLocalGenerationRepository,
  AiStoryGenerationResultRepository, deterministicPersistenceUuid, type LocalMediaJob } from "@ceo-agent/db";
import { assertDistinctSceneMediaContent, assertLocalGenerationDuration, inspectLocalGenerationMp4, validateLocalGenerationMedia,
  extractLocalGenerationEndFrame, materializeLocalGenerationResult,
  AiStoryLocalGenerationService } from "@ceo-agent/agents";
import { CanonicalAdapterRegistry } from "@ceo-agent/agents";
import { downloadStorageBytes, uploadStorageBytesImmutable } from "./storage";

/** Authorized private-media CPU processing; no generation adapter or commercial dispatch. */
export async function processAiStoryLocalMediaJob(job:LocalMediaJob) {
  const db=getDb();
  const packages=new AiStoryLocalGenerationRepository(db), results=new AiStoryGenerationResultRepository(db);
  const pkg=await packages.getExecutablePackage(job);
  if(!pkg)throw new Error("LOCAL_MEDIA_PACKAGE_NOT_FOUND");
  if(job.kind==="VALIDATE_OUTPUT") {
    const [asset]=await db.select().from(schema.assets).where(and(eq(schema.assets.id,job.assetId!),
      eq(schema.assets.orgId,pkg.organizationId),eq(schema.assets.workspaceId,pkg.workspaceId),
      eq(schema.assets.campaignId,pkg.campaignId),isNull(schema.assets.deletedAt))).limit(1);
    if(!asset||asset.source!=="ai_story_manual_local"||asset.mimeType!=="video/mp4"||
      asset.metadata?.localGenerationPackageId!==pkg.packageId||asset.metadata?.localGenerationUnitId!==pkg.unitId||
      asset.metadata?.executionPlanId!==pkg.executionPlanId||asset.uploadedBy!==job.actorUserId||
      !asset.storagePath.startsWith(`${pkg.workspaceId}/ai-story/local-generation/${pkg.packageId}/`))
      throw new Error("LOCAL_GENERATION_OUTPUT_WRONG_UNIT");
    const bytes=await downloadStorageBytes(asset.storagePath);
    if(bytes.length>100_000_000||bytes.length!==asset.fileSizeBytes)throw new Error("LOCAL_GENERATION_MEDIA_SIZE_INVALID");
    const inspected=inspectLocalGenerationMp4(bytes);
    if(asset.status==="ready"&&asset.contentHash!==inspected.contentHash)throw new Error("GENERATION_RESULT_CONTENT_MISMATCH");
    const peers=await db.select({
      sceneExecutionId:schema.aiStoryGenerationResults.sceneExecutionId,
      contentHash:schema.aiStoryGenerationResults.contentHash,
    }).from(schema.aiStoryGenerationResults).where(eq(schema.aiStoryGenerationResults.executionPlanId,pkg.executionPlanId));
    assertDistinctSceneMediaContent({
      sceneExecutionId:pkg.sceneExecutionId,
      contentHash:inspected.contentHash,
      peers,
    });
    const probe=await validateLocalGenerationMedia(bytes,inspected.contentHash,pkg.generateAudio);
    assertLocalGenerationDuration({actualSec:probe.durationMs/1000,targetSec:pkg.durationSec});
    const [scene]=await db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,pkg.sceneExecutionId)).limit(1);
    const [plan]=await db.select().from(schema.aiStoryExecutionPlans).where(eq(schema.aiStoryExecutionPlans.id,pkg.executionPlanId)).limit(1);
    if(!scene||!plan||scene.executionPlanId!==plan.id||scene.workspaceId!==pkg.workspaceId)throw new Error("GENERATION_RESULT_UNIT_MISMATCH");
    const now=new Date();
    await db.update(schema.assets).set({status:"ready",contentHash:inspected.contentHash,durationSec:String(probe.durationMs/1000),
      width:probe.width,height:probe.height,updatedAt:now}).where(eq(schema.assets.id,asset.id));
    const accepted=await packages.insertOutput({
      outputId:deterministicPersistenceUuid("ai-story-local-output",{packageId:pkg.packageId,assetId:asset.id}),
      packageId:pkg.packageId,unitId:pkg.unitId,sceneExecutionId:pkg.sceneExecutionId,assetId:asset.id,contentHash:inspected.contentHash,
      mediaType:"video/mp4",durationSec:probe.durationMs/1000,width:probe.width,height:probe.height,
      uploadedBy:job.actorUserId,uploadedAt:now.toISOString(),qcState:"PENDING",continuityFrameAssetId:null,
    });
    await results.accept(materializeLocalGenerationResult({
      package:pkg,output:accepted.output,animationPackageId:plan.animationPackageId,sceneId:scene.sceneId,sceneOrder:scene.sceneOrder,
      storagePath:asset.storagePath,byteSize:bytes.length,decodable:true,
    }));
    return;
  }
  const result=await results.get(job.workspaceId,job.generationResultId!);
  if(!result||result.ownership.executionPlanId!==pkg.executionPlanId||result.inputAuthority.localPackageId!==pkg.packageId||
    (await results.decision(result.generationResultId))?.decision!=="APPROVED")throw new Error("GENERATION_RESULT_APPROVAL_REQUIRED");
  const existingFrame=await results.continuityFrame(job.workspaceId,result.generationResultId);
  if(existingFrame) {
    await releaseImmediateSuccessor(result,pkg,existingFrame,job.actorUserId);
    await continueApprovedLocalAssembly(result);
    return;
  }
  const bytes=await downloadStorageBytes(result.media.storagePath);
  const frame=await extractLocalGenerationEndFrame(bytes,result.media.contentHash);
  const frameAssetId=deterministicPersistenceUuid("ai-story-generation-result-end-frame",{generationResultId:result.generationResultId,contentHash:frame.contentHash});
  const storagePath=`${job.workspaceId}/ai-story/continuity/${result.generationResultId}/${frame.contentHash.slice(7)}.png`;
  const uploaded=await uploadStorageBytesImmutable(storagePath,frame.bytes,"image/png");
  if(uploaded==="already_exists") {
    const stored=await downloadStorageBytes(storagePath);
    if(`sha256:${createHash("sha256").update(stored).digest("hex")}`!==frame.contentHash)throw new Error("GENERATION_RESULT_FRAME_STORAGE_CONFLICT");
  }
  await db.insert(schema.assets).values({id:frameAssetId,orgId:result.ownership.orgId,workspaceId:job.workspaceId,campaignId:result.ownership.campaignId,
    type:"image",mimeType:"image/png",contentHash:frame.contentHash,storagePath,status:"ready",source:"ai_story_generation_result_continuity",
    uploadedBy:job.actorUserId,fileSizeBytes:frame.bytes.length,displayName:"Approved Generation Unit end frame",
    metadata:{generationResultId:result.generationResultId,sourceContentHash:result.media.contentHash,generationUnitId:result.generationUnitId},
  }).onConflictDoNothing();
  const acceptedFrame=await results.acceptContinuityFrame(result,{
    frameAssetId,
    contentHash:frame.contentHash,
    sourceContentHash:result.media.contentHash,
    extractionContractVersion:"ai-story-continuity-frame-extraction.v1",
    extractedAt:new Date(),
  });
  await releaseImmediateSuccessor(result,pkg,acceptedFrame,job.actorUserId);
  await continueApprovedLocalAssembly(result);
}

async function releaseImmediateSuccessor(
  result:import("@ceo-agent/shared").AiStoryGenerationResult,
  pkg:import("@ceo-agent/shared").AiStoryLocalGenerationPackage,
  frame:typeof schema.aiStoryGenerationResultContinuityFrames.$inferSelect,
  actorUserId:string,
) {
  if(pkg.version!=="local-generation-package.v3")return;
  const db=getDb();
  const results=new AiStoryGenerationResultRepository(db);
  const [postQc,decision,runtime]=await Promise.all([
    results.latestQc(result.ownership.workspaceId,result.generationResultId),
    results.decision(result.generationResultId),
    db.select().from(schema.aiStoryRuntimeAuthorizedFacts).where(and(
      eq(schema.aiStoryRuntimeAuthorizedFacts.workspaceId,result.ownership.workspaceId),
      eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId,result.ownership.executionPlanId),
      eq(schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,result.runtimeAuthorizationId),
    )).limit(1).then(rows=>rows[0]??null),
  ]);
  if(!postQc||!decision||!runtime||!frame.extractionContractVersion) {
    throw new Error("SEQUENTIAL_LOCAL_PREDECESSOR_NOT_READY");
  }
  await new AiStoryLocalGenerationService().releaseImmediateSuccessor({
    orgId:result.ownership.orgId,
    workspaceId:result.ownership.workspaceId,
    campaignId:result.ownership.campaignId,
    storyId:result.ownership.storyId,
    storyVersionId:result.ownership.storyVersionId,
    executionPlanId:result.ownership.executionPlanId,
    runtimeAuthorizationId:result.runtimeAuthorizationId,
    orderedSceneExecutionIds:runtime.orderedSceneExecutionIds,
    actorUserId,
    createdAt:new Date().toISOString(),
    predecessor:{
      predecessorPackage:pkg,
      generationResult:result,
      postQc,
      decision,
      frame:{
        frameAssetId:frame.frameAssetId,
        contentHash:frame.contentHash,
        sourceContentHash:frame.sourceContentHash,
        extractionContractVersion:frame.extractionContractVersion,
        extractedAt:frame.extractedAt.toISOString(),
      },
    },
  });
}

async function continueApprovedLocalAssembly(result:import("@ceo-agent/shared").AiStoryGenerationResult) {
  // Reuse existing assembly readiness/approval/durable-media gates, with NO generation adapters.
  const {createProductionAiStoryContinuationCoordinator}=await import("./ai-story-provider-worker-cycle");
  const coordinator=await createProductionAiStoryContinuationCoordinator({adapters:new CanonicalAdapterRegistry()});
  await coordinator.continueAssemblyAndFinalStoryResult({
    executionPlanId:result.ownership.executionPlanId,runtimeAuthorizationId:result.runtimeAuthorizationId,ownership:result.ownership,
  });
}

export async function runAiStoryLocalMediaWorkerCycle(dependencies:{
  repository:Pick<AiStoryLocalMediaJobRepository,"claim"|"finish">;
  process:(job:LocalMediaJob)=>Promise<void>;
}={
  repository:new AiStoryLocalMediaJobRepository(), process:processAiStoryLocalMediaJob,
}) {
  const job=await dependencies.repository.claim();
  if(!job)return {status:"IDLE" as const};
  try {
    await dependencies.process(job);
    await dependencies.repository.finish(job,null);
    return {status:"SUCCEEDED" as const,jobId:job.jobId};
  } catch(error) {
    const code=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:"LOCAL_MEDIA_PROCESSING_FAILED";
    await dependencies.repository.finish(job,code);
    return {status:"FAILED" as const,jobId:job.jobId,errorCode:code};
  }
}
