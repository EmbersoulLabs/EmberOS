import { AiStoryLocalMediaJobRepository } from "@ceo-agent/db";
import type { AiStoryGenerationResult } from "@ceo-agent/shared";

/** Web authorizes an exact CPU job; extraction happens only in Worker. */
export async function deriveApprovedGenerationResultContinuity(result:AiStoryGenerationResult, actorUserId:string) {
  if(typeof result.inputAuthority.localPackageId!=="string")throw new Error("LOCAL_MEDIA_PACKAGE_NOT_FOUND");
  return new AiStoryLocalMediaJobRepository().enqueue({
    workspaceId:result.ownership.workspaceId, executionPlanId:result.ownership.executionPlanId,
    packageId:result.inputAuthority.localPackageId, actorUserId, kind:"EXTRACT_FRAME", generationResultId:result.generationResultId,
  });
}
