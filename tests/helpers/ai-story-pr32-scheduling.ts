import type { Sql } from "postgres";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  RuntimeAuthorizationPersistenceRepository,
  canonicalPersistenceHash,
  type ScheduleAcceptedBundleInput,
} from "@ceo-agent/db";
import { RuntimeAuthorizationService } from "../../packages/agents/src/ai-story/runtime-authorization-service";
import {
  SceneSchedulingCoordinator,
  type SceneSchedulingCoordinatorDependencies,
} from "../../packages/agents/src/ai-story/scene-scheduling-coordinator";
import type {
  ProviderRouter,
  ProviderRoutingDecision,
  ProviderRoutingPolicy,
  ProviderRoutingRequest,
} from "../../packages/agents/src/provider-router";
import type { ProviderCapabilityDeclaration } from "../../packages/agents/src/provider-adapters/contracts";
import {
  makePhase2aCompilation,
  PHASE_2A_IDS,
  type Phase2aIdSet,
} from "./ai-story-phase-2a";

export const PR32_USER_A = "10000000-0000-4000-8000-000000000040";
export const PR32_USER_B = "20000000-0000-4000-8000-000000000040";

const SCENE_PLAN_PAYLOAD = {
  scenePlan: [
    {
      id: "scene-a",
      beatIds: ["beat-0"],
      purpose: "A",
      durationSec: 3,
      transition: "cut",
      continuityNotes: "",
      order: 0,
    },
    {
      id: "scene-b",
      beatIds: ["beat-1"],
      purpose: "B",
      durationSec: 3,
      transition: "cut",
      continuityNotes: "",
      order: 1,
    },
  ],
};

export async function seedPr32Tenant(
  sql: Sql,
  ids: Phase2aIdSet = PHASE_2A_IDS,
  userId = PR32_USER_A,
  label = "pr32"
): Promise<void> {
  const suffix = crypto.randomUUID().slice(0, 8);
  await sql`
    INSERT INTO organizations (id, name, slug)
    VALUES (${ids.orgId}, ${`Sprint 3 ${label}`}, ${`sprint-3-${label}-${suffix}`})
  `;
  await sql`
    INSERT INTO workspaces (id, org_id, name, slug)
    VALUES (${ids.workspaceId}, ${ids.orgId}, ${`Sprint 3 ${label}`}, ${`s3-${label}-${suffix}`})
  `;
  await sql`
    INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
    VALUES (${ids.orgId}, ${ids.workspaceId}, ${userId}, 'operator')
  `;
  await sql`
    INSERT INTO campaigns (id, org_id, workspace_id, name)
    VALUES (${ids.campaignId}, ${ids.orgId}, ${ids.workspaceId}, ${`Sprint 3 ${label}`})
  `;
  await sql`
    INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea)
    VALUES (${ids.storyId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'Story', 'Idea')
  `;
  await sql`
    INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at)
    VALUES (${ids.storyVersionId}, ${ids.storyId}, 1, ${sql.json({})}, NOW())
  `;
  await sql`
    INSERT INTO ai_story_animation_packages (
      id, org_id, workspace_id, campaign_id, story_id, story_version_id, status, payload
    ) VALUES (
      ${ids.animationPackageId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId},
      ${ids.storyId}, ${ids.storyVersionId}, 'ready_for_execution',
      ${sql.json(SCENE_PLAN_PAYLOAD)}
    )
  `;
  await sql`
    INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path)
    VALUES (
      ${ids.assetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId},
      'image', ${`${ids.workspaceId}/sprint-3-${label}/asset.png`}
    )
  `;
  await sql`
    INSERT INTO campaign_asset_refs (campaign_id, asset_id)
    VALUES (${ids.campaignId}, ${ids.assetId})
  `;
}

export async function cleanupPr32Tenant(
  sql: Sql,
  ids: Phase2aIdSet = PHASE_2A_IDS
): Promise<void> {
  await sql`DELETE FROM ai_story_scene_scheduling_correlations WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_routing_decisions WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_runtime_authorized_facts WHERE org_id = ${ids.orgId}`;
  await sql`
    DELETE FROM provider_outbox_jobs
    WHERE execution_id IN (
      SELECT execution_id FROM provider_executions WHERE workspace_id = ${ids.workspaceId}
    )
  `;
  await sql`DELETE FROM provider_execution_envelopes WHERE workspace_id = ${ids.workspaceId}`;
  await sql`DELETE FROM provider_executions WHERE workspace_id = ${ids.workspaceId}`;
  await sql`DELETE FROM ai_story_assembly_scene_memberships WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_assembly_definitions WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_story_review_facts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_review_facts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_review_opened_facts WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_intent_validation_results WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_executions WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_execution_plans WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM ai_story_scene_instruction_snapshots WHERE org_id = ${ids.orgId}`;
  await sql`DELETE FROM workspace_members WHERE workspace_id = ${ids.workspaceId}`;
  await sql`DELETE FROM campaign_asset_refs WHERE campaign_id = ${ids.campaignId}`;
  await sql`DELETE FROM assets WHERE id = ${ids.assetId}`;
  await sql`DELETE FROM ai_story_animation_packages WHERE id = ${ids.animationPackageId}`;
  await sql`DELETE FROM ai_story_versions WHERE id = ${ids.storyVersionId}`;
  await sql`DELETE FROM ai_stories WHERE id = ${ids.storyId}`;
  await sql`DELETE FROM campaigns WHERE id = ${ids.campaignId}`;
  await sql`DELETE FROM workspaces WHERE id = ${ids.workspaceId}`;
  await sql`DELETE FROM organizations WHERE id = ${ids.orgId}`;
}

export async function prepareAuthorizedSchedulingPlan(input: {
  readonly purpose: string;
  readonly ids?: Phase2aIdSet;
  readonly userId?: string;
  readonly persistAuthorization?: boolean;
}) {
  const ids = input.ids ?? PHASE_2A_IDS;
  const userId = input.userId ?? PR32_USER_A;
  const persisted = await new AiStorySceneExecutionPersistenceRepository()
    .persistCompilation(
      makePhase2aCompilation({
        ids,
        instructionPurpose: `${input.purpose}-${crypto.randomUUID()}`,
      })
    );
  const executionPlanId = persisted.plan.storyExecutionId;
  const sceneExecutionIds = persisted.intents.map(
    (intent) => intent.identity.sceneExecutionId
  );

  const review = new ExecutionPlanReviewRepository();
  await review.openReview({ executionPlanId, openedBy: userId });
  for (const sceneExecutionId of sceneExecutionIds) {
    await review.appendSceneIntentDecision({
      executionPlanId,
      sceneExecutionId,
      decision: "APPROVED",
      reviewedBy: userId,
    });
  }
  const storyDecision = await review.appendStoryDecision({
    executionPlanId,
    decision: "APPROVED",
    reviewedBy: userId,
  });

  const assembly = await new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
    executionPlanId,
    createdBy: userId,
    orderedSceneExecutionIds: sceneExecutionIds,
  });
  const ownership = {
    orgId: ids.orgId,
    workspaceId: ids.workspaceId,
    campaignId: ids.campaignId,
    storyId: ids.storyId,
    storyVersionId: ids.storyVersionId,
    animationPackageId: ids.animationPackageId,
    executionPlanId,
  };
  const issued = new RuntimeAuthorizationService().authorize({
    ownership,
    reviewDecisionId: storyDecision.factId,
    reviewHash: storyDecision.deterministicFingerprint,
    reviewDecision: "APPROVED",
    assemblyDefinitionId: assembly.definition.assemblyDefinitionId,
    assemblyHash: assembly.definition.deterministicFingerprint,
    orderedSceneExecutionIds: sceneExecutionIds,
    qcResults: sceneExecutionIds.map((sceneExecutionId, index) => ({
      qcResultId: crypto.randomUUID(),
      sceneExecutionId,
      status: "passed",
      resultHash: canonicalPersistenceHash({
        executionPlanId,
        sceneExecutionId,
        qc: index,
      }),
    })),
    authorizedBy: userId,
    authorizedAt: "2026-08-04T12:00:00.000Z",
    derivedReadiness: "READY_FOR_EXECUTION",
  });
  const acceptedAuthorization =
    input.persistAuthorization === false
      ? { fact: issued.fact, converged: false }
      : await new RuntimeAuthorizationPersistenceRepository().acceptOrReturn(
          issued.fact
        );

  return {
    persisted,
    executionPlanId,
    sceneExecutionIds,
    assembly,
    issuedAuthorization: issued.fact,
    acceptedAuthorization: acceptedAuthorization.fact,
    userId,
  };
}

const SEEDANCE_CAPABILITY: ProviderCapabilityDeclaration = {
  providerId: "seedance",
  adapterVersion: "1.0.0",
  capabilityId: "animation-video-generation",
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["LOOKUP"],
  nativeIdempotency: true,
  lookup: true,
  cancellation: false,
  callbacks: false,
  streaming: false,
  routing: {
    costClass: "LOW",
    latencyClass: "FAST",
    qualityClass: "HIGH",
    reliabilityClass: "HIGH",
    regions: ["us-east-1"],
    modelFamilies: ["seedance"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: true,
    zeroRetention: false,
    maximumRetentionDays: 30,
    enterpriseControls: false,
  },
};

export class FixedSeedanceRouter implements ProviderRouter {
  routeCount = 0;

  constructor(
    private readonly overrides: Partial<
      Pick<
        ProviderRoutingDecision,
        | "selectedProviderId"
        | "selectedAdapterVersion"
        | "registrySnapshotHash"
        | "decisionHash"
      >
    > = {}
  ) {}

  async route(
    request: ProviderRoutingRequest,
    _policy: ProviderRoutingPolicy
  ): Promise<ProviderRoutingDecision> {
    this.routeCount += 1;
    const selectedProviderId =
      this.overrides.selectedProviderId ?? "seedance";
    const selectedAdapterVersion =
      this.overrides.selectedAdapterVersion ?? "1.0.0";
    const registrySnapshotHash =
      this.overrides.registrySnapshotHash ??
      canonicalPersistenceHash({
        providerId: selectedProviderId,
        adapterVersion: selectedAdapterVersion,
        requestId: request.routingRequestId,
      });
    return {
      routingRequestId: request.routingRequestId,
      selectedProviderId,
      selectedAdapterVersion,
      selectedCapability: {
        ...SEEDANCE_CAPABILITY,
        providerId: selectedProviderId,
        adapterVersion: selectedAdapterVersion,
      },
      policyVersion: request.policyVersion,
      registrySnapshotHash,
      score: {
        preferredProviderRank: 0,
        quality: 2,
        cost: 2,
        latency: 2,
        reliability: 2,
        residency: 1,
        nativeIdempotency: 1,
        lookup: 1,
        cancellation: 0,
        total: 30,
      },
      selectionReasons: ["fixed-seedance-test-route"],
      excludedCandidates: [],
      decisionHash:
        this.overrides.decisionHash ??
        canonicalPersistenceHash({
          routingRequestId: request.routingRequestId,
          selectedProviderId,
          selectedAdapterVersion,
          registrySnapshotHash,
        }),
      createdAt: "2026-08-04T12:10:00.000Z",
    };
  }
}

export async function captureScheduleAcceptedBundleInput(input: {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly runtimeAuthorizationId: string;
  readonly actorUserId?: string;
  readonly router?: ProviderRouter;
  readonly authRepo?: SceneSchedulingCoordinatorDependencies["authRepo"];
}): Promise<ScheduleAcceptedBundleInput> {
  let captured: ScheduleAcceptedBundleInput | null = null;
  const sentinel = new Error("captured scheduleAcceptedBundle input");
  const coordinator = new SceneSchedulingCoordinator({
    router: input.router ?? new FixedSeedanceRouter(),
    authRepo: input.authRepo,
    schedulingRepo: {
      getAcceptedBundleBySceneExecutionId: async () => null,
      getRoutingDecisionBySceneExecutionId: async () => null,
      scheduleAcceptedBundle: async (bundleInput) => {
        captured = bundleInput;
        throw sentinel;
      },
    },
  });

  try {
    await coordinator.scheduleAuthorizedScene({
      executionPlanId: input.executionPlanId,
      sceneExecutionId: input.sceneExecutionId,
      runtimeAuthorizationId: input.runtimeAuthorizationId,
      actorUserId: input.actorUserId ?? PR32_USER_A,
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  if (!captured) {
    throw new Error("SceneSchedulingCoordinator did not reach scheduleAcceptedBundle");
  }
  return captured;
}
