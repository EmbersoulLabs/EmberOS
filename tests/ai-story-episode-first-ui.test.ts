import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_EPISODE_ACTION_CERTIFICATION,
  AI_STORY_EPISODE_COPY,
  AI_STORY_EPISODE_PROGRESS_STEPS,
  BACKEND_GAP,
  SCENE_INTERNAL_AUTHORITY_PRESERVED,
  SCENE_USER_UI_REQUIRED,
  TAPAO_JOM_EPISODE_UX_FIXTURE,
  USER_FACING_AUTHORITY,
  classifyEpisodeMomentRepair,
  composeEpisodeOriginalIdea,
  describeEpisodePartialFailure,
  episodeCreateRequiresScene,
  episodeMomentMarker,
  episodeProgressStep,
  formatEpisodeActualCostUsd,
  formatEpisodeCostEstimateUsd,
  mapEpisodeTypeToOutlineProfile,
  mapInternalStoryStatusToEpisodeStatus,
  normalUserSceneLabelHidden,
  resolveEpisodeMomentFromTimeRange,
  resolveInternalRetryScopeFromEpisodeMoment,
  shouldExposeSceneDiagnostics,
} from "@ceo-agent/shared";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("AI Story Episode-first UI", () => {
  it("EPISODE_CREATE_UI maps types, duration, and copy without requiring Scene creation", () => {
    expect(AI_STORY_EPISODE_COPY.createEpisode).toBe("Create Episode");
    expect(AI_STORY_EPISODE_COPY.generateEpisode).toBe("Generate Episode");
    expect(episodeCreateRequiresScene()).toBe(false);
    expect(SCENE_USER_UI_REQUIRED).toBe(false);
    expect(mapEpisodeTypeToOutlineProfile("FOOD_STORY").profileId).toBe(
      "COMMERCIAL_STORY"
    );
    expect(mapEpisodeTypeToOutlineProfile("PRODUCT_STORY").profileId).toBe(
      "PRODUCT_STORY"
    );
    expect(mapEpisodeTypeToOutlineProfile("EMOTIONAL_STORY").profileId).toBe("CORE");
    const createPage = read(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/new/page.tsx"
    );
    const createForm = read("apps/web/src/components/ai-story/EpisodeCreateForm.tsx");
    expect(createPage).toContain("Create Episode");
    expect(createForm).toContain("AI_STORY_EPISODE_COPY.generateEpisode");
    expect(createPage).toContain("composeEpisodeOriginalIdea");
    expect(createPage).not.toContain("Create Scene");
    expect(createForm).toContain("episode-character-selector");
  });

  it("NO_SCENE_REQUIRED_FOR_USER_CREATION and hides Scene labels from normal users", () => {
    expect(USER_FACING_AUTHORITY).toBe("EPISODE");
    expect(normalUserSceneLabelHidden("Scene 1")).toBe(true);
    expect(normalUserSceneLabelHidden("Approve Scene")).toBe(true);
    expect(normalUserSceneLabelHidden("Regenerate this moment")).toBe(false);
    const createPage = read(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/new/page.tsx"
    );
    expect(createPage).not.toMatch(/Scene 1/);
    expect(createPage).not.toContain("Generate Story");
  });

  it("EPISODE_PROGRESS_UI uses moment language instead of Scene numbering", () => {
    expect(mapInternalStoryStatusToEpisodeStatus("executing")).toBe("Generating");
    expect(mapInternalStoryStatusToEpisodeStatus("execution_failed")).toBe("Needs Attention");
    expect(episodeProgressStep({
      planningComplete: false,
      charactersReady: false,
      generating: false,
      editing: false,
      finalizing: false,
    })).toBe("Planning your episode");
    expect(episodeProgressStep({
      planningComplete: true,
      charactersReady: true,
      generating: true,
      editing: false,
      finalizing: false,
    })).toBe("Generating episode moments");
    expect(AI_STORY_EPISODE_PROGRESS_STEPS).toContain("Finalizing audio and video");
    const runtime = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");
    expect(runtime).toContain("Generating episode moments");
    expect(runtime).not.toContain(">Scene generation<");
  });

  it("EPISODE_PREVIEW keeps certified preview copy and does not fake unsupported mutations", () => {
    const preview = read("apps/web/src/components/ai-story/EpisodePreviewPanel.tsx");
    expect(preview).toContain("Episode Preview");
    expect(preview).toContain("regenerateThisMoment");
    expect(preview).toContain("editDialogue");
    expect(preview).toContain("adjustEnding");
    expect(preview).toContain("adjustPacing");
    expect(preview).toContain("nativeCharacterDialogue");
    expect(preview).toContain("onEditDialogue");
    expect(preview).toContain("onAdjustEnding");
    expect(preview).toContain("onAdjustPacing");
    expect(preview).not.toContain("episode-edit-dialogue-gap");
    expect(preview).not.toContain("episode-adjust-ending-gap");
    expect(preview).not.toContain("episode-adjust-pacing-gap");
    expect(formatEpisodeCostEstimateUsd({ lowUsd: "3.20", highUsd: "3.80" })).toBe(
      "USD 3.20–3.80"
    );
    expect(formatEpisodeActualCostUsd("3.42")).toBe("USD 3.42");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.costEstimate).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.actualCost).toBe("CERTIFIED");
    const create = read("apps/web/src/components/ai-story/EpisodeCreateForm.tsx");
    expect(create).toContain("episode-cost-estimate");
    expect(create).not.toContain("episode-cost-confirmation");
    expect(create).not.toContain("3.20");
    expect(create).toContain("References");
    const runtime = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");
    expect(runtime).toContain("providerSpend");
    expect(runtime).not.toContain("lowUsd: \"3.20\"");
  });

  it("REGENERATE_MOMENT mapping is certified and execution stays on existing retry authority", () => {
    const moment = resolveEpisodeMomentFromTimeRange({
      startMs: 17_000,
      endMs: 24_000,
      moments: TAPAO_JOM_EPISODE_UX_FIXTURE.moments,
    });
    expect(moment?.marker).toBe("Product");
    expect(moment?.generationUnitId).toBe(
      "ae000000-0000-4000-8000-000000000092"
    );
    expect(moment?.sceneId).toBe("ae000000-0000-4000-8000-000000000032");
    expect(episodeMomentMarker(4, "REACTION")).toBe("Reaction");
    expect(resolveInternalRetryScopeFromEpisodeMoment(moment!).generationUnitId).toBe(
      moment?.generationUnitId
    );
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.timeRangeToInternalUnitMapping).toBe(
      "CERTIFIED"
    );
    expect(classifyEpisodeMomentRepair({
      sceneExecutionId: moment!.generationUnitId,
      runtimeState: "APPROVED",
      retryAuthorizationId: null,
    }).kind).toBe(BACKEND_GAP);
    expect(classifyEpisodeMomentRepair({
      sceneExecutionId: moment!.generationUnitId,
      runtimeState: "RETRY_AUTHORIZED",
      retryAuthorizationId: "ae000000-0000-4000-8000-000000000099",
    })).toMatchObject({
      kind: "RETRY_AUTHORIZED",
      retryAuthorizationId: "ae000000-0000-4000-8000-000000000099",
    });
    expect(classifyEpisodeMomentRepair({
      sceneExecutionId: moment!.generationUnitId,
      runtimeState: "PRE_DISPATCH_BLOCKED",
    }).kind).toBe("PRE_DISPATCH_RECOVERY");
    const runtime = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");
    expect(runtime).toContain("postGeneratedSceneReviewDecision");
    expect(runtime).toContain("postPreDispatchRecovery");
    expect(runtime).toContain("classifyEpisodeMomentRepair");
  });

  it("EDIT_DIALOGUE, ADJUST_ENDING, and cost estimate are certified through revision authority", () => {
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.editDialogue).toBe("DURABLE_RUNTIME_CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.adjustEnding).toBe("DURABLE_RUNTIME_CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.adjustPacing).toBe("DURABLE_RUNTIME_CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.replaceReference).toBe("DURABLE_RUNTIME_CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.costEstimate).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.costEstimateIsAuthorization).toBe(false);
    expect(AI_STORY_EPISODE_COPY.backendGap).toContain("existing backend authority");
    expect(composeEpisodeOriginalIdea({
      originalIdea: "A local shop host shows what you can tapao.",
      episodeType: "FOOD_STORY",
      durationSec: 45,
      aspectRatio: "9:16",
      language: "zh-MY",
      dialogueStyle: "Malaysian Chinese conversational",
      nativeCharacterDialogue: true,
      pacing: "NATURAL",
    })).toContain("Duration: 45s");
  });

  it("PARTIAL_FAILURE_RECOVERY uses real ready-count copy and existing retry only", () => {
    expect(describeEpisodePartialFailure({ readyCount: 5, totalCount: 6 })).toBe(
      "Most of your Episode is ready. One moment needs attention."
    );
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.partialFailureCopy).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.partialFailureRetry).toBe(
      "CERTIFIED_WITH_EXISTING_RETRY_AUTHORITY"
    );
    const preview = read("apps/web/src/components/ai-story/EpisodePreviewPanel.tsx");
    expect(preview).toContain("retryFailedMoment");
    expect(preview).not.toContain("Restart entire Episode");
    expect(preview).toContain("canRepair");
  });

  it("LEGACY_STORY_COMPATIBILITY keeps old Story routes as Episode wrappers", () => {
    const legacy = read(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx"
    );
    const episodeRoute = read(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/episodes/[episodeId]/page.tsx"
    );
    expect(legacy).toContain("LEGACY_SCENE_STORY");
    expect(episodeRoute).toContain("[storyId]/page");
    expect(SCENE_INTERNAL_AUTHORITY_PRESERVED).toBe(true);
    expect(read("apps/web/next.config.js")).toContain("/ai-stories/episodes/new");
  });

  it("SUPER_ADMIN_SCENE_DIAGNOSTICS remain available and hidden from normal users", () => {
    expect(shouldExposeSceneDiagnostics({ superAdmin: true, debugMode: false })).toBe(
      true
    );
    expect(shouldExposeSceneDiagnostics({ superAdmin: false, debugMode: false })).toBe(
      false
    );
    const debug = read("apps/web/src/components/ai-story/EpisodeDebugPanel.tsx");
    expect(debug).toContain("Generation Units");
    expect(debug).toContain("data-testid=\"episode-super-admin-diagnostics\"");
  });

  it("MOBILE_EPISODE_UI prioritizes video and collapses advanced controls", () => {
    const preview = read("apps/web/src/components/ai-story/EpisodePreviewPanel.tsx");
    expect(preview).toContain("md:hidden");
    expect(preview).toContain("video first");
    const create = read("apps/web/src/components/ai-story/EpisodeCreateForm.tsx");
    expect(create).toContain("Advanced options");
  });

  it("TAPAO_JOM_EPISODE_UX_FIXTURE describes the validated commercial workflow", () => {
    expect(TAPAO_JOM_EPISODE_UX_FIXTURE.title).toBe(
      "Tapao Jom by AWH Food Enterprise"
    );
    expect(TAPAO_JOM_EPISODE_UX_FIXTURE.workflow).toContain("Generate Episode");
    expect(TAPAO_JOM_EPISODE_UX_FIXTURE.hiddenFromNormalUser).toContain(
      "6 Generation Units"
    );
    expect(TAPAO_JOM_EPISODE_UX_FIXTURE.actualCostUsd).toBe("USD 3.42");
    const fixture = read("apps/web/src/components/ai-story/TapaoJomEpisodeUxFixture.tsx");
    expect(fixture).toContain("TAPAO_JOM_EPISODE_UX_FIXTURE.title");
  });

  it("INTERNAL_SCENE_AUTHORITY is not deleted from persistence contracts", () => {
    const scene = read("packages/shared/src/ai-story-scene.ts");
    const unit = read("packages/shared/src/ai-story-generation-unit.ts");
    const editorial = read("packages/shared/src/ai-story-narrative-editorial-plan.ts");
    expect(scene).toContain("AiStoryCanonicalSceneSchema");
    expect(unit).toContain("sceneId");
    expect(unit).toContain("directorShotId");
    expect(editorial).toContain("sceneId");
  });
});
