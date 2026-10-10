import { withCertificationPlanningContext } from "@ceo-agent/agents";
import {
  CertificationPlanningAuthorityService,
  type CertificationPlanningIdentity,
} from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { CertificationEnvironmentSchema, type CertificationEnvironment } from "@ceo-agent/shared/server";

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

export type CampaignCertificationAuthority = {
  status: string;
  certificationRunId: string;
  environment: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string | null;
};

export type CertificationPlanningRoute =
  | { kind: "legacy" }
  | {
      kind: "certification";
      environment: CertificationEnvironment;
      certificationRunId: string;
    };

/**
 * A campaign with no certification row keeps the existing self-use path.
 * A campaign with a row must use that one aggregate ledger. Another episode,
 * a missing run, or an inactive row fails closed instead of falling through.
 */
export function classifyCertificationPlanningAuthorities(
  rows: readonly CampaignCertificationAuthority[],
  input: { orgId: string; workspaceId: string; campaignId: string; storyId: string },
): CertificationPlanningRoute {
  const campaignRows = rows.filter((row) =>
    row.orgId === input.orgId
    && row.workspaceId === input.workspaceId
    && row.campaignId === input.campaignId
  );
  if (campaignRows.length === 0) return { kind: "legacy" };
  const applicable = campaignRows.filter((row) => row.storyId === null || row.storyId === input.storyId);
  if (applicable.length === 0) {
    throw new Error("PLANNING_SCOPE_INVALID");
  }
  if (applicable.length > 1) throw new Error("PLANNING_AUTHORITY_CONFLICT");
  const authority = applicable[0];
  if (authority.status !== "ACTIVE") throw new Error("PLANNING_AUTHORITY_MISSING");
  if (!isUuid(authority.certificationRunId)) throw new Error("PLANNING_CERTIFICATION_RUN_ID_REQUIRED");
  return {
    kind: "certification",
    environment: CertificationEnvironmentSchema.parse(authority.environment),
    certificationRunId: authority.certificationRunId,
  };
}

export type PlanningCertificationScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  actorUserId: string;
  regenerationIdentity?: string | null;
  providerAttemptId?: string;
};

/** Reads the shared Web/Worker ledger. A read failure does not fall through to an uncapped call. */
export async function loadPlanningCertificationRoute(
  input: PlanningCertificationScope,
  listAuthorities: (scope: PlanningCertificationScope) => Promise<readonly CampaignCertificationAuthority[]> = (scope) =>
    new CertificationPlanningAuthorityService().listCampaignPlanningAuthorities(scope),
): Promise<CertificationPlanningRoute> {
  let rows: readonly CampaignCertificationAuthority[];
  try {
    rows = await listAuthorities(input);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PLANNING_")) throw error;
    throw new Error("PLANNING_LEDGER_UNAVAILABLE");
  }
  return classifyCertificationPlanningAuthorities(rows, input);
}

export async function runUnderPlanningCertification<T>(
  input: PlanningCertificationScope,
  run: () => Promise<T>,
  listAuthorities?: (scope: PlanningCertificationScope) => Promise<readonly CampaignCertificationAuthority[]>,
): Promise<T> {
  const route = await loadPlanningCertificationRoute(input, listAuthorities);
  if (route.kind === "legacy") return withConfiguredCertificationPlanningContext(input, run);
  if (input.regenerationIdentity && !isUuid(input.regenerationIdentity)) {
    throw new Error("PLANNING_REGENERATION_ID_INVALID");
  }
  const identity: CertificationPlanningIdentity & {
    logicalCallSuffix: string;
    providerAttemptId?: string;
  } = {
    environment: route.environment,
    certificationRunId: route.certificationRunId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    actorUserId: input.actorUserId,
    logicalCallSuffix: input.regenerationIdentity ?? "initial",
    providerAttemptId: input.providerAttemptId,
  };
  return withCertificationPlanningContext(identity, run);
}
