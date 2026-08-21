import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  getDb,
  persistSameWorkspaceCampaignAssetRef,
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
  STORAGE_PATHS,
} from "@ceo-agent/shared";
import { createAiStoryVersion, freezeAiStoryVersion, setAiStoryStatus } from "@/lib/ai-story-service";
import { approveAnimationPackage, saveAnimationPackage } from "@/lib/ai-story-planning-service";
import { createCanonicalExecuteProviderRouter } from "@/lib/ai-story-canonical-execute-router";
import { AI_STORY_PRODUCTION_VERIFICATION_POLICY_VERSION } from "@ceo-agent/db";
import { createAdminClient } from "@/lib/supabase/admin";

export const AI_STORY_PROD_VERIFY_FIXTURE_VERSION =
  "ai-story-prod-verify-fixture.v1" as const;

export const AI_STORY_PROD_VERIFY_STEP_TIMEOUT_MS = 15_000;
export const AI_STORY_PROD_VERIFY_TOTAL_TIMEOUT_MS = 120_000;

export type ProductionVerificationStepTiming = {
  readonly step: string;
  readonly status: "PASS" | "FAIL" | "TIMEOUT";
  readonly durationMs: number;
};

export class ProductionVerificationStepTimeoutError extends Error {
  readonly code = "AI_STORY_PRODUCTION_VERIFICATION_STEP_TIMEOUT";

  constructor(readonly step: string, readonly timeoutMs: number) {
    super(`Production verification step ${step} exceeded ${timeoutMs}ms`);
    this.name = "ProductionVerificationStepTimeoutError";
  }
}

export async function runProductionVerificationStep<T>(
  step: string,
  operation: () => PromiseLike<T>,
  options: {
    readonly timeoutMs?: number;
    readonly timings?: ProductionVerificationStepTiming[];
  } = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? AI_STORY_PROD_VERIFY_STEP_TIMEOUT_MS;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  console.info(JSON.stringify({
    event: "AI_STORY_PROD_VERIFY_STEP_STARTED",
    step,
    timeoutMs,
  }));
  try {
    const result = await Promise.race([
      Promise.resolve(operation()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ProductionVerificationStepTimeoutError(step, timeoutMs)),
          timeoutMs
        );
      }),
    ]);
    const timing = { step, status: "PASS" as const, durationMs: Date.now() - startedAt };
    options.timings?.push(timing);
    console.info(JSON.stringify({ event: "AI_STORY_PROD_VERIFY_STEP_COMPLETED", ...timing }));
    return result;
  } catch (error) {
    const timing = {
      step,
      status: error instanceof ProductionVerificationStepTimeoutError
        ? "TIMEOUT" as const
        : "FAIL" as const,
      durationMs: Date.now() - startedAt,
    };
    options.timings?.push(timing);
    console.error(JSON.stringify({
      event: "AI_STORY_PROD_VERIFY_STEP_FAILED",
      ...timing,
      code: error instanceof ProductionVerificationStepTimeoutError
        ? error.code
        : "AI_STORY_PROD_VERIFY_STEP_FAILED",
    }));
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const FIXTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function fixturePackage(assetId: string) {
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
    assetReferences: [assetId],
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
  stepTimings?: ProductionVerificationStepTiming[];
}) {
  const db = getDb();
  const runId = randomUUID();
  const stepTimings = input.stepTimings ?? [];
  const fixtureDeadline = Date.now() + AI_STORY_PROD_VERIFY_TOTAL_TIMEOUT_MS;
  const step = <T>(name: string, operation: () => PromiseLike<T>, timeoutMs?: number) => {
    const remainingMs = fixtureDeadline - Date.now();
    if (remainingMs <= 0) {
      throw new ProductionVerificationStepTimeoutError(
        "fixture_total",
        AI_STORY_PROD_VERIFY_TOTAL_TIMEOUT_MS
      );
    }
    return runProductionVerificationStep(name, operation, {
      timeoutMs: Math.min(
        timeoutMs ?? AI_STORY_PROD_VERIFY_STEP_TIMEOUT_MS,
        remainingMs
      ),
      timings: stepTimings,
    });
  };
  const [campaign] = await step("campaign_authority", () =>
    db.select().from(schema.campaigns)
      .where(eq(schema.campaigns.id, input.campaignId)).limit(1)
  );
  if (!campaign) throw new Error("Campaign not found");

  let storyId: string | null = null;
  try {
    const assetId = randomUUID();
    const contentHash = `sha256:${createHash("sha256").update(FIXTURE_PNG).digest("hex")}`;
    const storagePath = STORAGE_PATHS.source(
      campaign.workspaceId,
      campaign.id,
      assetId,
      "png"
    );
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    const { error: uploadError } = await step("private_fixture_asset_upload", () =>
      createAdminClient().storage
        .from(bucket)
        .upload(storagePath, FIXTURE_PNG, {
          contentType: "image/png",
          upsert: false,
        })
    );
    if (uploadError) {
      throw new Error(`Failed to persist private verification asset: ${uploadError.message}`);
    }
    await step("fixture_asset_authority", () => db.transaction(async (tx) => {
      await tx.insert(schema.assets).values({
        id: assetId,
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId: campaign.id,
        type: "image",
        storagePath,
        mimeType: "image/png",
        width: 1,
        height: 1,
        fileSizeBytes: FIXTURE_PNG.byteLength,
        contentHash,
        metadata: {
          originalFilename: "ai-story-prod-verify-fixture-v1.png",
          verificationFixture: true,
          verificationFixtureVersion: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
          fixtureRunId: runId,
          purpose: "PRODUCTION_CONTROL_PATH_VERIFICATION",
        },
      });
      await persistSameWorkspaceCampaignAssetRef(tx, {
        campaignId: campaign.id,
        assetId,
        workspaceId: campaign.workspaceId,
        orgId: campaign.orgId,
      });
    }));
    const [story] = await step("story_persistence", () => db.insert(schema.aiStories).values({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      title: "R2 Deterministic Verification Story",
      originalIdea: "PRODUCTION_CONTROL_PATH_VERIFICATION",
      status: "review",
      createdBy: input.user.id,
    }).returning());
    if (!story) throw new Error("Failed to persist verification Story");
    storyId = story.id;

    const payload = fixturePackage(assetId);
    const version = await step("story_version_persistence", () => createAiStoryVersion(db, {
      storyId: story.id,
      structuredContent: payload.story,
      sourceContextSnapshot: {
        verificationFixture: true,
        verificationFixtureVersion: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
        fixtureRunId: runId,
        purpose: "PRODUCTION_CONTROL_PATH_VERIFICATION",
        verificationFixtureState: "CREATING",
      },
      aiMetadata: { externalAiCalls: 0, generatedBy: "DETERMINISTIC_SERVER_FIXTURE" },
      userEdited: false,
      createdBy: input.user.id,
    }));
    await step("story_version_freeze", () => freezeAiStoryVersion(db, {
      storyId: story.id,
      versionId: version.id,
      frozenBy: input.user.id,
      fromStatus: "review",
    }));
    const pkg = await step("animation_package_persistence", () => saveAnimationPackage(db, {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      storyId: story.id,
      storyVersionId: version.id,
      payload,
    }));
    await step("fixture_state_creating", async () => {
      await setAiStoryStatus(db, story.id, "ready_for_animation", "planning");
      await setAiStoryStatus(db, story.id, "planning", "planning_review");
    });
    const approvedPackage = await step("animation_package_approval", () => approveAnimationPackage(db, {
      packageId: pkg.id,
      campaignId: campaign.id,
      storyId: story.id,
      workspaceId: campaign.workspaceId,
      approvedBy: input.user.id,
    }));

    const generated = await step("scene_plan_persistence", () => createGenerateReview({
      db,
      campaignId: campaign.id,
      storyId: story.id,
      workspaceId: campaign.workspaceId,
      orgId: campaign.orgId,
    }));
    if (generated.sceneExecutionIds.length !== 3 || !generated.storyExecutionId) {
      throw new Error("Verification fixture did not compile exactly three Scenes");
    }
    const executionPlanId = generated.storyExecutionId;
    const review = new ExecutionPlanReviewRepository(db);
    await step("review_open", () => review.openReview({
      executionPlanId,
      openedBy: input.user.id,
    }));
    for (const sceneExecutionId of generated.sceneExecutionIds) {
      await step(`scene_intent_approval_${generated.sceneExecutionIds.indexOf(sceneExecutionId) + 1}`, () =>
        review.appendSceneIntentDecision({
        executionPlanId,
        sceneExecutionId,
        decision: "APPROVED",
        reviewedBy: input.user.id,
        rationale: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
        })
      );
    }
    await step("story_plan_approval", () => review.appendStoryDecision({
      executionPlanId,
      decision: "APPROVED",
      reviewedBy: input.user.id,
      rationale: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
    }));
    const assembly = await step("assembly_definition", () =>
      new ExecutionPlanAssemblyRepository(db).createOrReturnAssembly({
      executionPlanId,
      createdBy: input.user.id,
      orderedSceneExecutionIds: generated.sceneExecutionIds,
      })
    );
    const executionAuthorization = await step("execution_authorization", () => authorizeAiStoryExecution({
      user: input.user,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      minRole: "operator",
      clientClaims: {},
    }));
    if (executionAuthorization.authorizedBy !== "ACTIVE_PLATFORM_ADMIN") {
      throw new Error("Fixture execution requires ACTIVE_PLATFORM_ADMIN");
    }
    const executed = await step("canonical_verification_execute", () => authorizeAndExecuteExecutionPlan({
      executionPlanId,
      actorUserId: input.user.id,
      ownership: {
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId: campaign.id,
        storyId: story.id,
        storyVersionId: version.id,
        animationPackageId: approvedPackage.id,
        executionPlanId,
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
    }));
    // The Story is promoted only after canonical Execute atomically persists the
    // verification identity, staged-release ledger, routing and terminal outbox.
    await step("fixture_state_completed", () =>
      setAiStoryStatus(db, story.id, "planning_review", "ready_for_execution")
    );
    return {
      fixtureRunId: runId,
      fixtureVersion: AI_STORY_PROD_VERIFY_FIXTURE_VERSION,
      storyId: story.id,
      storyVersionId: version.id,
      animationPackageId: approvedPackage.id,
      executionPlanId,
      sceneExecutionIds: generated.sceneExecutionIds,
      assemblyDefinitionId: assembly.definition.assemblyDefinitionId,
      assemblySceneCount: assembly.definition.sceneCount,
      execute: executed.response,
      fixtureState: "COMPLETED" as const,
      stepTimings,
    };
  } catch (error) {
    if (storyId) {
      try {
        await runProductionVerificationStep("fixture_state_failed_incomplete", () =>
          db.update(schema.aiStories)
            .set({ status: "failed", archivedAt: new Date(), updatedAt: new Date() })
            .where(eq(schema.aiStories.id, storyId!)),
          { timeoutMs: 5_000, timings: stepTimings }
        );
      } catch {
        // Before the final promotion the Story remains planning_review, which is
        // deliberately non-execute-ready even if failure classification stalls.
      }
    }
    throw error;
  }
}
