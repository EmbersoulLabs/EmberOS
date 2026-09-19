import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse } from "@/lib/ai-story-execution-plan-access";
import { authorizeGeneratedSceneReviewWrite, createDifferentiatedRetryService } from "@/lib/ai-story-generated-scene-review-access";
import { certifyVisualAuthority } from "@/lib/ai-story-pre-dispatch-recovery";
import {
  AiStoryRetryModeAuthorityError,
  deriveAiStoryRetryProviderModeFromFrozenScene,
} from "@ceo-agent/shared";

type RouteParams={params:Promise<{id:string;storyId:string;executionPlanId:string;sceneExecutionId:string}>};
export async function POST(request:Request,{params}:RouteParams){
  try{
    const user=await requireAuth(); const {id:campaignId,storyId,executionPlanId,sceneExecutionId}=await params;
    const body=await request.json();
    const ctx=await authorizeGeneratedSceneReviewWrite({user,campaignId,storyId,executionPlanId,sceneExecutionId,clientClaims:body});
    const { AiStorySceneExecutionPersistenceRepository }=await import("@ceo-agent/db");
    const persisted=await new AiStorySceneExecutionPersistenceRepository().getByExecutionPlanId(executionPlanId);
    const intent=persisted?.intents.find((row)=>row.identity.sceneExecutionId===sceneExecutionId);
    const instructions=persisted?.instructionsBySceneExecutionId[sceneExecutionId];
    let retryMode: "REFERENCE_FREE_T2V" | "FIRST_FRAME_I2V";
    try {
      retryMode = deriveAiStoryRetryProviderModeFromFrozenScene({
        generationAuthority: intent?.generationAuthority ?? instructions?.generationAuthority,
      });
    } catch (error) {
      if (error instanceof AiStoryRetryModeAuthorityError) {
        return apiError(error.message, error.code, 409);
      }
      throw error;
    }
    if (retryMode === "REFERENCE_FREE_T2V") {
      if ((intent?.referencedAssetIds ?? []).length > 0 || (intent?.generationAuthority?.effectiveReferenceIds ?? []).length > 0) {
        return apiError("Reference-free retry cannot carry Product or first-frame material","RETRY_MODE_ESCALATION_DENIED",409);
      }
      return apiSuccess(await createDifferentiatedRetryService().createInputRevision({
        executionPlanId,sceneExecutionId,workspaceId:ctx.workspaceId,actorUserId:user.id,command:body,
      }));
    }
    const productAssetId=intent?.referencedAssetIds[0]; if(!productAssetId)return apiError("Campaign Product authority is missing","RETRY_PRODUCT_AUTHORITY_MISSING",409);
    const cert=await certifyVisualAuthority({productAssetId,orgId:ctx.orgId,workspaceId:ctx.workspaceId,campaignId,executionPlanId,sceneExecutionId});
    return apiSuccess(await createDifferentiatedRetryService().createInputRevision({executionPlanId,sceneExecutionId,workspaceId:ctx.workspaceId,actorUserId:user.id,command:body,visualAuthorityCertification:cert}));
  }catch(error){return executionPlanRouteErrorResponse(error)??handleApiError(error);}
}
