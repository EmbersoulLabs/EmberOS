import { apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse } from "@/lib/ai-story-execution-plan-access";
import { authorizeGeneratedSceneReviewWrite, createDifferentiatedRetryService } from "@/lib/ai-story-generated-scene-review-access";

type RouteParams={params:Promise<{id:string;storyId:string;executionPlanId:string;sceneExecutionId:string}>};
export async function POST(request:Request,{params}:RouteParams){
  try{
    const user=await requireAuth(); const {id:campaignId,storyId,executionPlanId,sceneExecutionId}=await params; const body=await request.json();
    const ctx=await authorizeGeneratedSceneReviewWrite({user,campaignId,storyId,executionPlanId,sceneExecutionId,clientClaims:body});
    return apiSuccess(await createDifferentiatedRetryService().authorizeRetry({executionPlanId,sceneExecutionId,workspaceId:ctx.workspaceId,actorUserId:user.id,command:body}));
  }catch(error){return executionPlanRouteErrorResponse(error)??handleApiError(error);}
}
