import { and, eq, inArray } from "drizzle-orm";
import {
  getDb,
  resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion,
  resolveCurrentFrozenCanonicalSceneSet,
  schema,
} from "@ceo-agent/db";
import {
  AiStoryCanonicalExecutionPlanSchema,
  AiStoryCanonicalSceneExecutionIntentSchema,
  AuthoritativeAnimationPackagePayloadSchema,
  resolveExplicitAiStorySceneGenerationAuthority,
  isUuid,
  type AiStoryAnimationPackageCanonicalSceneAuthority,
  type AiStoryCanonicalScene,
} from "@ceo-agent/shared";
import { sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import {
  ExecutionPlanRouteNotFoundError,
  ExecutionPlanRouteValidationError,
} from "@/lib/ai-story-execution-plan-access";

export class AmbiguousCurrentExecutionPlanError extends Error {
  readonly code = "EXECUTION_PLAN_IDENTITY_CONFLICT";
  readonly status = 409;

  constructor() {
    super("Current Execution Plan authority is ambiguous");
    this.name = "AmbiguousCurrentExecutionPlanError";
  }
}

export class CurrentExecutionPlanLineageError extends Error {
  readonly code = "CURRENT_EXECUTION_PLAN_LINEAGE_INVALID";
  readonly status = 409;

  constructor(message = "Persisted Execution Plan does not match current canonical authority") {
    super(message);
    this.name = "CurrentExecutionPlanLineageError";
  }
}

export function isCurrentCanonicalExecutionPlan(input: {
  plan: unknown;
  intents: readonly unknown[];
  animationPackageId: string;
  binding: AiStoryAnimationPackageCanonicalSceneAuthority;
  canonicalScenes: readonly AiStoryCanonicalScene[];
}): boolean {
  const parsed = AiStoryCanonicalExecutionPlanSchema.safeParse(input.plan);
  if (!parsed.success) return false;
  const plan = parsed.data;
  if (
    plan.animationPackage.animationPackageId !== input.animationPackageId ||
    plan.animationPackage.scriptVersionId !== input.binding.scriptVersionId ||
    plan.animationPackage.sceneSetFingerprint !== input.binding.sceneSetFingerprint ||
    plan.sceneExecutions.length !== input.canonicalScenes.length
  ) return false;
  const intents = input.intents.map((intent) =>
    AiStoryCanonicalSceneExecutionIntentSchema.safeParse(intent)
  );
  if (intents.length !== input.canonicalScenes.length || intents.some((intent) => !intent.success)) return false;
  const expectedModes = input.canonicalScenes.map((scene) => {
    try { return resolveExplicitAiStorySceneGenerationAuthority(scene.generationAuthority); }
    catch { return null; }
  });
  if (expectedModes.some((mode) => !mode)) return false;
  return input.canonicalScenes.every((scene, index) => {
    const identity = plan.sceneExecutions[index];
    const intent = intents[index];
    const binding = input.binding.scenes[index];
    const mode = expectedModes[index];
    return Boolean(
      identity && intent?.success && binding?.generationAuthority && mode && intent.data.generationAuthority &&
      sha256CanonicalIntegrityHash(binding.generationAuthority) === sha256CanonicalIntegrityHash(scene.generationAuthority) &&
      sha256CanonicalIntegrityHash(intent.data.generationAuthority) === sha256CanonicalIntegrityHash(mode) &&
      identity.sceneOrder === index &&
      identity.sceneId === scene.sceneId &&
      identity.sceneVersionId === scene.sceneVersionId &&
      identity.sceneFingerprint === scene.fingerprint &&
      identity.scriptVersionId === input.binding.scriptVersionId &&
      intent.data.identity.sceneExecutionId === identity.sceneExecutionId &&
      intent.data.identity.sceneOrder === identity.sceneOrder &&
      intent.data.identity.sceneId === identity.sceneId &&
      intent.data.identity.sceneVersionId === identity.sceneVersionId &&
      intent.data.identity.sceneFingerprint === identity.sceneFingerprint &&
      intent.data.identity.scriptVersionId === identity.scriptVersionId &&
      intent.data.identity.deterministicFingerprint === identity.deterministicFingerprint &&
      intent.data.animationPackage.animationPackageId === input.animationPackageId &&
      intent.data.animationPackage.scriptVersionId === input.binding.scriptVersionId &&
      intent.data.animationPackage.sceneSetFingerprint === input.binding.sceneSetFingerprint
    );
  });
}

/**
 * Read-only current-plan discovery. The canonical identity is the exact current
 * Story Version plus its current approved Animation Package. Ambiguity fails
 * closed; this function never compiles or persists a plan.
 */
export async function discoverCurrentExecutionPlan(input: {
  userId: string;
  campaignId: string;
  storyId: string;
}) {
  if (!isUuid(input.campaignId) || !isUuid(input.storyId)) {
    throw new ExecutionPlanRouteValidationError("Invalid id");
  }

  const db = getDb();
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) throw new ExecutionPlanRouteNotFoundError("Campaign not found");

  await authorizeAiStoryAccess({
    user: { id: input.userId },
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    minRole: "client_viewer",
  });

  const loaded = await loadCampaignAiStory(
    db,
    input.campaignId,
    input.storyId,
    campaign.workspaceId
  );
  const currentVersionId = loaded?.story.currentVersionId;
  if (!loaded || !currentVersionId) {
    if (!loaded) throw new ExecutionPlanRouteNotFoundError("AI Story not found");
    return { executionPlan: null } as const;
  }

  const authorityScope = {
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: currentVersionId,
  };
  const canonicalScenes = await resolveCurrentFrozenCanonicalSceneSet(db, authorityScope);
  if (!canonicalScenes) return { executionPlan: null } as const;
  const currentPackage = await resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion(db, authorityScope);

  if (!currentPackage) return { executionPlan: null } as const;

  const plans = await db
    .select({
      id: schema.aiStoryExecutionPlans.id,
      status: schema.aiStoryExecutionPlans.status,
      storyVersionId: schema.aiStoryExecutionPlans.storyVersionId,
      animationPackageId: schema.aiStoryExecutionPlans.animationPackageId,
      compiledAt: schema.aiStoryExecutionPlans.compiledAt,
      plan: schema.aiStoryExecutionPlans.plan,
    })
    .from(schema.aiStoryExecutionPlans)
    .where(
      and(
        eq(schema.aiStoryExecutionPlans.orgId, campaign.orgId),
        eq(schema.aiStoryExecutionPlans.workspaceId, campaign.workspaceId),
        eq(schema.aiStoryExecutionPlans.campaignId, input.campaignId),
        eq(schema.aiStoryExecutionPlans.storyId, input.storyId),
        eq(schema.aiStoryExecutionPlans.storyVersionId, currentVersionId),
        eq(schema.aiStoryExecutionPlans.animationPackageId, currentPackage.id)
      )
    )
  if (!plans.length) return { executionPlan: null } as const;

  const sceneRows = await db
    .select({
      id: schema.aiStorySceneExecutions.id,
      executionPlanId: schema.aiStorySceneExecutions.executionPlanId,
      sceneOrder: schema.aiStorySceneExecutions.sceneOrder,
      intent: schema.aiStorySceneExecutions.intent,
    })
    .from(schema.aiStorySceneExecutions)
    .where(
      and(
        inArray(schema.aiStorySceneExecutions.executionPlanId, plans.map((plan) => plan.id)),
        eq(schema.aiStorySceneExecutions.workspaceId, campaign.workspaceId),
        eq(schema.aiStorySceneExecutions.storyId, input.storyId)
      )
    );

  const packagePayload = AuthoritativeAnimationPackagePayloadSchema.parse(currentPackage.payload);
  const binding = packagePayload.canonicalSceneAuthority;
  const valid = plans.filter((row) => {
    const intents = sceneRows
      .filter((scene) => scene.executionPlanId === row.id)
      .sort((left, right) => left.sceneOrder - right.sceneOrder)
      .map((scene) => scene.intent);
    return isCurrentCanonicalExecutionPlan({
      plan: row.plan,
      intents,
      animationPackageId: currentPackage.id,
      binding,
      canonicalScenes,
    });
  });

  if (valid.length > 1) throw new AmbiguousCurrentExecutionPlanError();
  const plan = valid[0];
  if (!plan) throw new CurrentExecutionPlanLineageError();

  return {
    executionPlan: {
      executionPlanId: plan.id,
      status: plan.status,
      storyVersionId: plan.storyVersionId,
      animationPackageId: plan.animationPackageId,
      sceneIntentCount: canonicalScenes.length,
      compiledAt: plan.compiledAt.toISOString(),
    },
  } as const;
}
