import { CommercialAuthorizationError } from "@ceo-agent/db";
import type { AiStoryExecutionAuthorization } from "@ceo-agent/shared";
import { commercialExecutionIdentityForPlan } from "@ceo-agent/shared/server";
import { CommercialAuthorizationService } from "../commercial/commercial-authorization-runtime";
import { StagedSceneReleaseError } from "./staged-scene-release-error";

export async function resolveStagedReleaseCommercialAuthorization(input: {
  readonly executionPlanId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly executionAuthorization: AiStoryExecutionAuthorization;
  readonly authorizedAt: Date;
  readonly service?: Pick<
    CommercialAuthorizationService,
    "authorizeExecutionPlanExecute"
  >;
}): Promise<string | undefined> {
  const nonCommercialOps =
    input.executionAuthorization.accessMode === "ops" &&
    input.executionAuthorization.settlementMode === "none";
  if (nonCommercialOps) return undefined;

  try {
    const commercial = await (
      input.service ?? new CommercialAuthorizationService()
    ).authorizeExecutionPlanExecute({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      executionPlanId: input.executionPlanId,
      authorizedAt: input.authorizedAt.toISOString(),
    });
    const authorization = commercial.authorization;
    if (
      authorization.orgId !== input.orgId ||
      authorization.workspaceId !== input.workspaceId ||
      authorization.capabilityKey !== "ai_story.execute" ||
      authorization.executionIdentity !==
        commercialExecutionIdentityForPlan(input.executionPlanId) ||
      !authorization.commercialAuthorizationId.trim()
    ) {
      throw new StagedSceneReleaseError(
        "COMMERCIAL_AUTH_DENIED",
        "Commercial Authorization does not match staged release authority",
        403
      );
    }
    return authorization.commercialAuthorizationId;
  } catch (error) {
    if (error instanceof CommercialAuthorizationError) {
      throw new StagedSceneReleaseError(error.code, error.message, error.status);
    }
    throw error;
  }
}
