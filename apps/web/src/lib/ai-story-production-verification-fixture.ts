import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  createGenerateReview,
  authorizeAndExecuteExecutionPlan,
  authorizeAiStoryExecution,
  resolveCanonicalExecuteRoutingPolicy,
} from "@ceo-agent/agents";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
} from "@ceo-agent/shared";
import { createAiStoryVersion, freezeAiStoryVersion, setAiStoryStatus } from "@/lib/ai-story-service";
import { approveAnimationPackage, saveAnimationPackage } from "@/lib/ai-story-planning-service";
import { createCanonicalExecuteProviderRouter } from "@/lib/ai-story-canonical-execute-router";
import { AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION } from "@ceo-agent/db";

export const AI_STORY_PROD_VERIFY_FIXTURE_VERSION =
  "ai-story-prod-verify-fixture.v1" as const;

function fixturePackage() {
  const story = {
    title: "R2 Deterministic Verification Story",
    summary: "A three-scene production control-path verification using lilies.",
    objective: "Verify production control flow without provider dispatch.",
    targetAudience: "Production operators",
    tone: "Calm and precise",
    estimatedDuration: "9s",
    story: {
      opening: "A simple lily arrangement is presented as a hero product.",
      development: "The same arrangement is shown in an alternate composition.",
      ending: "A clean closing composition completes the sequence.",
    },
    keyMessages: ["Deterministic production verification"],
    cta: "No customer-facing call to action",
    assetReferences: [],
    warnings: [],
  };
  const creativeContext = CreativeContextSchema.parse({
    storyContext: {
      title: story.title,
      summary: story.summary,
      objective: story.objective,
      targetAudience: story.targetAudience,
      tone: story.tone,
      estimatedDuration: story.estimatedDuration,
      keyMessages: story.keyMessages,
      cta: story.cta,
    },
    characterContext: { characters: [], relationships: [] },
    worldContext: {
      locations: ["Private verification studio"],
      visualStyle: "Clean product photography",
      lighting: "Soft neutral light",
      environment: "Minimal studio",
      objects: ["lily arrangement"],
      timeline: "Single continuous session",
      worldRules: ["Preserve the same lily arrangement across all scenes"],
    },
    narrativeContext: {
      arc: "Hero to alternate to close",
      pacing: "Even",
      emotionalJourney: "Calm continuity",
      themes: ["clarity"],
      dialogue: [],
    },
    directorContext: {},
  });
  const directorThinking = DirectorThinkingSchema.parse({
    coreMessage: "The staged production control path is deterministic.",
    hero: "Lily arrangement",
    conflict: "Provider dispatch must remain impossible.",
    turningPoint: "Only Scene 1 is released.",
    climax: "The verification outbox is persisted non-dispatchable.",
    takeaway: "Control-path invariants hold without external AI.",
  });
  const beats = ["Hero", "Alternate", "Closing"].map((name, order) => ({
    id: `verify-beat-${order + 1}`,
    name,
    purpose: `Verification beat ${order + 1}`,
    order,
    summary: `${name} deterministic verification composition.`,
  }));
  const scenes = ["Hero lily shot", "Alternate lily composition", "Closing lily composition"].map(
    (purpose, order) => ({
      id: `verify-scene-${order + 1}`,
      beatIds: [`verify-beat-${order + 1}`],
      purpose,
      durationSec: 3,
      transition: order === 0 ? "Cut" : "Dissolve",
      continuityNotes: "Preserve the same arrangement and neutral studio.",
      order,
    })
  );
  const shots = scenes.map((scene, order) => ({
    id: `verify-shot-${order + 1}`,
    sceneId: scene.id,
    cameraType: order === 0 ? "Medium hero" : "Close-up",
    cameraMovement: "Static",
    composition: scene.purpose,
    framing: "Vertical",
    lensSuggestion: "50mm",
    durationSec: 3,
    focus: "Lily arrangement",
    emotion: "Calm",
    information: `Deterministic verification scene ${order + 1}`,
    order: 0,
  }));
  return AnimationPackagePayloadSchema.parse({
    story,
    characters: [],
    creativeContext: { ...creativeContext, directorContext: directorThinking },
    directorThinking,
    storyBeats: beats,
    scenePlan: scenes,
    shotPlan: shots,
    characterContinuity: [],
    worldContinuity: {
      location: "Private verification studio",
      lighting: "Soft neutral light",
      environment: "Minimal studio",
      objects: ["lily arrangement"],
      timeline: "Single continuous session",
      worldRules: ["Preserve the same lily arrangement across all scenes"],
    },
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: true, issues: [], links: [] },
    status: "review",
    usage: { input: 0, output: 0, costUsd: 0 },
  });
}

export async function createProductionVerificationFixture(input: {
  campaignId: string;
  user: { id: string; email?: string | null };
}) {
  const db = getDb();
  const runId = randomUUID();
  const [campaign] = await db.select().from(schema.campaigns)
    .where(eq(schema.campaigns.id, input.campaignId)).limit(1);
  if (!campaign) throw new Error("Campaign not found");

  let storyId: string | null = null;
  try {
    const [story] = await db.insert(schema.aiStories).values({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      title: "R2 Deterministic Verification Story",
      originalIdea: "PRODUCTION_CONTROL_PATH_VERIFICATION",
      status: "review",
      createdBy: input.user.id,
    }).returning();
    if (!story) throw new Error("Failed to persist verification Story");
    storyId = story.id;

    const payload = fixturePackage();
    const version = await createAiStoryVersion(db, {
      storyId: story.id,
      structuredContent: payload.story,
      sourceContextSnapshot: {
        verificationFixture: true,
        verificationFixtureVersion: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
        fixtureRunId: runId,
        purpose: "PRODUCTION_CONTROL_PATH_VERIFICATION",
      },
      aiMetadata: { externalAiCalls: 0, generatedBy: "DETERMINISTIC_SERVER_FIXTURE" },
      userEdited: false,
      createdBy: input.user.id,
    });
    await freezeAiStoryVersion(db, {
      storyId: story.id,
      versionId: version.id,
      frozenBy: input.user.id,
      fromStatus: "review",
    });
    const pkg = await saveAnimationPackage(db, {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      storyId: story.id,
      storyVersionId: version.id,
      payload,
    });
    await setAiStoryStatus(db, story.id, "ready_for_animation", "planning");
    await setAiStoryStatus(db, story.id, "planning", "planning_review");
    const approvedPackage = await approveAnimationPackage(db, {
      packageId: pkg.id,
      campaignId: campaign.id,
      storyId: story.id,
      workspaceId: campaign.workspaceId,
      approvedBy: input.user.id,
    });
    await setAiStoryStatus(db, story.id, "planning_review", "ready_for_execution");

    const generated = await createGenerateReview({
      db,
      campaignId: campaign.id,
      storyId: story.id,
      workspaceId: campaign.workspaceId,
      orgId: campaign.orgId,
    });
    if (generated.sceneExecutionIds.length !== 3 || !generated.storyExecutionId) {
      throw new Error("Verification fixture did not compile exactly three Scenes");
    }
    const review = new ExecutionPlanReviewRepository(db);
    await review.openReview({ executionPlanId: generated.storyExecutionId, openedBy: input.user.id });
    for (const sceneExecutionId of generated.sceneExecutionIds) {
      await review.appendSceneIntentDecision({
        executionPlanId: generated.storyExecutionId,
        sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: input.user.id,
        rationale: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
      });
    }
    await review.appendStoryDecision({
      executionPlanId: generated.storyExecutionId,
      decision: "APPROVED",
      reviewedBy: input.user.id,
      rationale: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
    });
    const assembly = await new ExecutionPlanAssemblyRepository(db).createOrReturnAssembly({
      executionPlanId: generated.storyExecutionId,
      createdBy: input.user.id,
      orderedSceneExecutionIds: generated.sceneExecutionIds,
    });
    const executionAuthorization = await authorizeAiStoryExecution({
      user: input.user,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      minRole: "operator",
      clientClaims: {},
    });
    if (executionAuthorization.authorizedBy !== "ACTIVE_PLATFORM_ADMIN") {
      throw new Error("Fixture execution requires ACTIVE_PLATFORM_ADMIN");
    }
    const executed = await authorizeAndExecuteExecutionPlan({
      executionPlanId: generated.storyExecutionId,
      actorUserId: input.user.id,
      ownership: {
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId: campaign.id,
        storyId: story.id,
        storyVersionId: version.id,
        animationPackageId: approvedPackage.id,
        executionPlanId: generated.storyExecutionId,
      },
      router: createCanonicalExecuteProviderRouter(),
      routingPolicy: resolveCanonicalExecuteRoutingPolicy(),
      executionAuthorization,
      productionVerification: {
        verificationMode: true,
        verificationPolicyVersion: AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION,
        authorizedBy: "ACTIVE_PLATFORM_ADMIN",
        createdBy: input.user.id,
      },
    });
    return {
      fixtureRunId: runId,
      fixtureVersion: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
      storyId: story.id,
      storyVersionId: version.id,
      animationPackageId: approvedPackage.id,
      executionPlanId: generated.storyExecutionId,
      sceneExecutionIds: generated.sceneExecutionIds,
      assemblyDefinitionId: assembly.definition.assemblyDefinitionId,
      assemblySceneCount: assembly.definition.sceneCount,
      execute: executed.response,
    };
  } catch (error) {
    if (storyId) {
      await db.update(schema.aiStories).set({ status: "failed", archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.aiStories.id, storyId));
    }
    throw error;
  }
}
