import { withCertificationPlanningContext } from "@ceo-agent/agents";
import { isUuid } from "@ceo-agent/shared";
import { CertificationEnvironmentSchema } from "@ceo-agent/shared/server";

/** Explicitly enabled only for a separately authorized certification run. */
export function withConfiguredCertificationPlanningContext<T>(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  actorUserId: string;
  regenerationIdentity?: string | null;
  providerAttemptId?: string;
}, run: () => Promise<T>): Promise<T> {
  const configured = process.env.AI_STORY_CERTIFICATION_ENVIRONMENT?.trim();
  if (!configured) return run();
  const environment = CertificationEnvironmentSchema.parse(configured);
  const certificationRunId = process.env.AI_STORY_CERTIFICATION_RUN_ID?.trim();
  if (!certificationRunId || !isUuid(certificationRunId)) throw new Error("PLANNING_CERTIFICATION_RUN_ID_REQUIRED");
  if (input.regenerationIdentity && !isUuid(input.regenerationIdentity)) throw new Error("PLANNING_REGENERATION_ID_INVALID");
  return withCertificationPlanningContext({
    environment,
    certificationRunId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    actorUserId: input.actorUserId,
    logicalCallSuffix: input.regenerationIdentity ?? "initial",
    providerAttemptId: input.providerAttemptId,
  }, run);
}
