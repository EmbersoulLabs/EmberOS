import { describe, expect, it } from "vitest";
import { AiStoryGenerationResultSchema, AiStoryLocalGenerationPackageSchema } from "@ceo-agent/shared";
import { DurableSceneMediaAttestationSchema } from "@ceo-agent/shared/server";
import { materializeGenerationResult, validateGenerationResult, projectApprovedGenerationResult } from "@ceo-agent/db";
import { materializeLocalGenerationResult, buildGenerationResultPostQcInput, assertGenerationResultApproval, materializeLocalRetryPackage, materializeGenerationResultDurableAttestation } from "../packages/agents/src/ai-story/generation-result-service";
import { assertDistinctSceneMediaContent } from "../packages/agents/src/ai-story/local-generation-media";
import { AiStoryPostGenerationQcService, FakeAiStoryVisualEvidenceProvider, InMemoryAiStoryPostGenerationQcRepository } from "../packages/agents/src/ai-story/post-generation-qc-service";

const id = (n: number) => `${String(n).padStart(8,"0")}-0000-4000-8000-000000000000`;
const hash = `sha256:${"a".repeat(64)}`;
const now = "2026-10-01T00:00:00.000Z";
function pkg() {
  return AiStoryLocalGenerationPackageSchema.parse({
    version: "local-generation-package.v1", packageId:id(1), packageFingerprint:hash, executionMode:"MANUAL_LOCAL",
    organizationId:id(2), workspaceId:id(3), campaignId:id(4), storyId:id(5), storyVersionId:id(6), executionPlanId:id(7), runtimeAuthorizationId:id(8),
    unitId:id(9), sceneExecutionId:id(9), sceneId:"scene-1", order:1, durationSec:4, aspectRatio:"9:16", resolutionIntent:"720p", recommendedWorkflow:"WAN_T2V",
    generationMode:"TEXT_TO_VIDEO", prompt:"A deterministic synthetic Scene.", negativePrompt:"", dialogue:[], generateAudio:false, audioBlocked:true,
    characterAuthority:null, productAuthority:null, worldDescription:"Synthetic room", mustKeep:[], mustAvoid:[], qcRequirements:[], continuityRequirements:[], previousUnitEndState:[], currentUnitStartState:[], expectedEndState:[], references:[],
    sourceAuthority:{ schedulingAuthorityId:id(10), schedulingAuthorityFingerprint:hash, plannerSnapshotId:id(11), compiledRequestId:id(12), compiledRequestFingerprint:hash,
      sceneFingerprint:hash, semanticPlanFingerprint:hash, preGenerationQcEvaluationId:id(13), preGenerationQcFingerprint:hash, directorFingerprint:hash, motionFingerprint:hash, castSnapshotFingerprint:hash, locationSnapshotFingerprint:hash, productSnapshotFingerprint:hash },
    planningAuthority:{planningLineageSource:"LEGACY_COMPILED_V1",sceneVersion:1,scriptVersionId:null,handoffId:null,handoffFingerprint:null},
    instructions:"Render locally", state:"AWAITING_LOCAL_OUTPUT", retryOfPackageId:null, retryNumber:0, createdAt:now,
  });
}
function local(outputId = id(14)) {
  const item = pkg();
  return materializeLocalGenerationResult({ package:item, output:{outputId, packageId:item.packageId,unitId:item.unitId,sceneExecutionId:item.sceneExecutionId,assetId:id(15),contentHash:hash,mediaType:"video/mp4",durationSec:4,width:720,height:1280,uploadedBy:id(16),uploadedAt:now,qcState:"PENDING",continuityFrameAssetId:null},
    animationPackageId:id(17),sceneId:"scene-1",sceneOrder:0,storagePath:`${item.workspaceId}/ai-story/local/output.mp4`,byteSize:2000,decodable:true });
}
async function qc(result = local(), violated = false) {
  const input = buildGenerationResultPostQcInput(result,pkg());
  if (violated) input.media.decodable=false;
  return (await new AiStoryPostGenerationQcService({ repository:new InMemoryAiStoryPostGenerationQcRepository(),evidenceProvider:new FakeAiStoryVisualEvidenceProvider([]),now:()=>now }).evaluate(input)).evaluation;
}
function decision(result=local()) { return {decisionId:id(18),generationResultId:result.generationResultId,postQcEvaluationId:id(19),decision:"APPROVED" as const,actorUserId:id(16),rationale:"Reviewed synthetic media",decidedAt:now}; }

describe("Provider-neutral Generation Result",()=>{
  it("accepts manual output without any Provider Attempt",()=>{expect(local().source.providerAttemptId).toBeNull();expect(validateGenerationResult(local())).toEqual(local());});
  it("rejects a fake Provider Attempt on local media",()=>{const result=local();expect(AiStoryGenerationResultSchema.safeParse({...result,source:{...result.source,providerAttemptId:id(21)}}).success).toBe(false);});
  it("blocks a successor Scene that repeats another Scene Execution's video bytes",()=>{
    const scene = local();
    expect(() => assertDistinctSceneMediaContent({
      sceneExecutionId: id(99),
      contentHash: scene.media.contentHash,
      peers: [{ sceneExecutionId: scene.sceneExecutionId, contentHash: scene.media.contentHash }],
    })).toThrow("LOCAL_GENERATION_DUPLICATE_SCENE_CONTENT");
    expect(() => assertDistinctSceneMediaContent({
      sceneExecutionId: scene.sceneExecutionId,
      contentHash: scene.media.contentHash,
      peers: [{ sceneExecutionId: scene.sceneExecutionId, contentHash: scene.media.contentHash }],
    })).not.toThrow();
  });
  it("rejects output bound to a different Scene Execution Unit",()=>{
    const item = pkg();
    expect(() => materializeLocalGenerationResult({
      package: item,
      output: { outputId: id(14), packageId: item.packageId, unitId: item.unitId, sceneExecutionId: id(90), assetId: id(15), contentHash: hash, mediaType: "video/mp4", durationSec: 4, width: 720, height: 1280, uploadedBy: id(16), uploadedAt: now, qcState: "PENDING", continuityFrameAssetId: null },
      animationPackageId: id(17), sceneId: "scene-1", sceneOrder: 0, storagePath: `${item.workspaceId}/ai-story/local/output.mp4`, byteSize: 2000, decodable: true,
    })).toThrow("GENERATION_RESULT_LOCAL_SOURCE_MISMATCH");
  });
  it("rejects both missing and multiple source references",()=>{const result=local();for(const source of [{...result.source,localGenerationOutputId:null},{...result.source,localWorkerOutputId:id(22)}]) expect(AiStoryGenerationResultSchema.safeParse({...result,source}).success).toBe(false);});
  it("reprocessing identical source converges to deterministic identity",()=>{expect(local().generationResultId).toBe(local().generationResultId);expect(local().fingerprint).toBe(local().fingerprint);});
  it("retry output has new identity and preserves original immutable result",()=>{const original=local();expect(local(id(23)).generationResultId).not.toBe(original.generationResultId);expect(original).toEqual(local());});
  it("detects a modified frozen media hash",()=>{expect(()=>validateGenerationResult({...local(),media:{...local().media,contentHash:`sha256:${"b".repeat(64)}`}})).toThrow("IMMUTABLE_CONFLICT");});
  it("rejects private media traversal or transport URLs",()=>{for(const path of [`${id(3)}/../foreign.mp4`,"https://example.invalid/video.mp4",`${id(3)}/%2e%2e/video.mp4`]) expect(AiStoryGenerationResultSchema.safeParse({...local(),media:{...local().media,storagePath:path,durableObjectReference:path}}).success).toBe(false);});
  it("rejects missing hash, bytes or decode authority",()=>{for(const media of [{...local().media,contentHash:""},{...local().media,byteSize:0},{...local().media,decodable:false}]) expect(AiStoryGenerationResultSchema.safeParse({...local(),media}).success).toBe(false);});
  it("projects remote provenance without deleting Provider lineage",()=>{const {generationResultId:_,fingerprint:__,contractVersion:___,...facts}=local();const result=materializeGenerationResult({...facts,source:{sourceKind:"REMOTE_PROVIDER",providerAttemptId:"historical-attempt",localGenerationOutputId:null,localWorkerOutputId:null}});expect(result.source.providerAttemptId).toBe("historical-attempt");});
  it("supports a future local-worker source with no fake Provider",()=>{const {generationResultId:_,fingerprint:__,contractVersion:___,...facts}=local();expect(materializeGenerationResult({...facts,source:{sourceKind:"LOCAL_GPU_WORKER",providerAttemptId:null,localGenerationOutputId:null,localWorkerOutputId:id(25)}}).source.sourceKind).toBe("LOCAL_GPU_WORKER");});
  it("runs actual Post-QC on a manual result",async()=>{const evaluation=await qc();expect(evaluation.generationResultId).toBe(local().generationResultId);expect(evaluation.providerAttemptId).toBeNull();expect(evaluation.aggregateStatus).toBe("POST_QC_PASS");});
  it("rejects cross-Story and cross-Unit QC",()=>{for(const altered of [{...pkg(),storyId:id(26)},{...pkg(),unitId:id(27)}]) expect(()=>buildGenerationResultPostQcInput(local(),altered)).toThrow("MISMATCH");});
  it("requires actual QC before human approval",()=>{expect(()=>assertGenerationResultApproval(local(),null)).toThrow("POST_QC_REQUIRED");});
  it("allows explicit human approval only after valid QC",async()=>{expect(()=>assertGenerationResultApproval(local(),undefined as never)).toThrow();assertGenerationResultApproval(local(),await qc());});
  it("hard QC rejection blocks approval and produces only a local retry",async()=>{const evaluation=await qc(local(),true);expect(()=>assertGenerationResultApproval(local(),evaluation)).toThrow("POST_QC_REQUIRED");const retry=materializeLocalRetryPackage(pkg(),local(),evaluation);expect(retry.retryOfPackageId).toBe(pkg().packageId);expect(retry.unitId).toBe(pkg().unitId);expect(retry.sourceAuthority).toEqual(pkg().sourceAuthority);expect(retry.executionMode).toBe("MANUAL_LOCAL");expect(retry.instructions).toContain("LOCAL REGENERATION REQUIRED");});
  it("approved result projects the existing Scene Result assembly contract",()=>{const scene=projectApprovedGenerationResult(local(),decision());expect(scene.status).toBe("SUCCEEDED");expect(scene.mediaReference?.contentHash).toBe(hash);expect(scene.ownership).toEqual(local().ownership);});
  it("unapproved media cannot enter Scene Result projection",()=>{expect(()=>projectApprovedGenerationResult(local(),{...decision(),decision:"REJECTED"})).toThrow("APPROVAL_REQUIRED");});
  it("reuses durable-media authority without a signed URL or Provider identity",()=>{const media=DurableSceneMediaAttestationSchema.parse(materializeGenerationResultDurableAttestation(local(),decision()));expect(media.sourceMediaReference).toEqual({scheme:"generation-result",generationResultId:local().generationResultId});expect(media.contentHash).toBe(hash);expect(media.durableObjectReference).toBe(local().media.storagePath);});
});
