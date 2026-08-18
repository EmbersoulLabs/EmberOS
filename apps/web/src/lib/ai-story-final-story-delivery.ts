import { AssemblyArtifactRepositoryImpl, FinalStoryResultRepositoryImpl } from "@ceo-agent/db";
import {
  FINAL_STORY_RESULT_PLAYBACK_TTL_SECONDS,
  FinalStoryResultDeliveryModelSchema,
  type FinalStoryResultDeliveryModel,
} from "@ceo-agent/shared";
import {
  resolveAuthorizedExecutionPlan,
  type AuthorizedExecutionPlanContext,
} from "@/lib/ai-story-execution-plan-access";
import { mintFinalStoryDownloadUrl } from "@/lib/ai-story-final-story-playback";

export class FinalStoryDeliveryError extends Error {
  constructor(readonly code: "FINAL_STORY_RESULT_NOT_READY" | "FINAL_STORY_MEDIA_UNAVAILABLE", readonly status: 404 | 409) {
    super(code === "FINAL_STORY_RESULT_NOT_READY" ? "Final Story Result is not ready" : "Final Story video is unavailable");
    this.name = "FinalStoryDeliveryError";
  }
}

function safeFilename(title: string): string {
  const stem = title.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return `${stem || "final-story"}-final.mp4`;
}

type Dependencies = {
  authorize: typeof resolveAuthorizedExecutionPlan;
  getResult: FinalStoryResultRepositoryImpl["getByExecutionPlanId"];
  getArtifact: AssemblyArtifactRepositoryImpl["getByArtifactId"];
  mint: typeof mintFinalStoryDownloadUrl;
};

const defaults: Dependencies = {
  authorize: resolveAuthorizedExecutionPlan,
  getResult: (id) => new FinalStoryResultRepositoryImpl().getByExecutionPlanId(id),
  getArtifact: (id) => new AssemblyArtifactRepositoryImpl().getByArtifactId(id),
  mint: mintFinalStoryDownloadUrl,
};

export async function createFinalStoryDelivery(
  input: { userId: string; campaignId: string; storyId: string; executionPlanId: string },
  deps: Dependencies = defaults
): Promise<FinalStoryResultDeliveryModel> {
  const ctx: AuthorizedExecutionPlanContext = await deps.authorize({ ...input, minRole: "client_viewer" });
  const result = await deps.getResult(ctx.executionPlanId);
  if (!result) throw new FinalStoryDeliveryError("FINAL_STORY_RESULT_NOT_READY", 404);
  const owned = result.orgId === ctx.orgId && result.workspaceId === ctx.workspaceId &&
    result.campaignId === ctx.campaignId && result.storyId === ctx.storyId &&
    result.executionPlanId === ctx.executionPlanId && result.ownership.orgId === ctx.orgId &&
    result.ownership.workspaceId === ctx.workspaceId && result.ownership.executionPlanId === ctx.executionPlanId;
  if (!owned) throw new FinalStoryDeliveryError("FINAL_STORY_RESULT_NOT_READY", 404);

  const artifact = await deps.getArtifact(result.assemblyArtifactId);
  const mediaReady = artifact && artifact.artifactId === result.assemblyArtifactId &&
    artifact.assemblyJobId === result.assemblyJobId && artifact.executionPlanId === result.executionPlanId &&
    artifact.ownership.orgId === result.orgId && artifact.ownership.workspaceId === result.workspaceId &&
    artifact.artifactReference === result.outputMediaReference && artifact.contentHash === result.contentHash &&
    artifact.mediaType === "video/mp4";
  if (!mediaReady) throw new FinalStoryDeliveryError("FINAL_STORY_MEDIA_UNAVAILABLE", 409);

  const filename = safeFilename(ctx.storyTitle);
  const signed = await deps.mint({ workspaceId: ctx.workspaceId, outputMediaReference: result.outputMediaReference, filename, expiresInSeconds: FINAL_STORY_RESULT_PLAYBACK_TTL_SECONDS });
  return FinalStoryResultDeliveryModelSchema.parse({ ...signed, filename });
}
