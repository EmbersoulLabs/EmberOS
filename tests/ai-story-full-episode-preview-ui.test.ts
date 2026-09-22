import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_EPISODE_COPY,
  formatEpisodeClockDuration,
  fullEpisodePendingCopy,
  resolveEpisodeDurationLabel,
  resolveFullEpisodePreviewState,
} from "@ceo-agent/shared";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("AI Story Full Episode preview UX", () => {
  const runtime = read("apps/web/src/components/ai-story/StoryRuntimePanel.tsx");
  const preview = read("apps/web/src/components/ai-story/EpisodePreviewPanel.tsx");
  const viewer = read("apps/web/src/components/ai-story/FinalStoryResultViewer.tsx");
  const moments = read("apps/web/src/components/ai-story/SceneReviewWorkspacePanel.tsx");
  const debug = read("apps/web/src/components/ai-story/EpisodeDebugPanel.tsx");

  it("does not pass a generated Scene deliveryUrl to EpisodePreviewPanel as the Episode video", () => {
    expect(runtime).not.toMatch(/videoUrl=\{/);
    expect(runtime).not.toMatch(
      /generatedSceneReviews[\s\S]{0,180}deliveryUrl[\s\S]{0,80}EpisodePreviewPanel/
    );
    expect(runtime).not.toContain("generatedMedia?.deliveryUrl)?.generatedMedia?.deliveryUrl");
    expect(preview).not.toContain("videoUrl");
    expect(preview).not.toMatch(/<video[\s\S]*src=\{videoUrl\}/);
  });

  it("keeps Scene moment players in the moment review workspace only", () => {
    expect(moments).toContain("data-testid={`generated-scene-media-preview-${scene.sceneOrder}`}");
    expect(moments).toContain("Episode moments");
    expect(moments).toContain("Generated result");
    expect(runtime.indexOf("<FinalStoryResultViewer")).toBeLessThan(runtime.indexOf("<SceneReviewWorkspacePanel"));
  });

  it("renders FinalStoryResultViewer only when a Final Story Result exists", () => {
    expect(runtime).toContain('previewState === "FINAL_READY"');
    expect(runtime).toContain("showFinalEpisode ? (");
    expect(runtime).toContain("<FinalStoryResultViewer");
    expect(runtime).toContain("expectAcceptedResult");
    expect(viewer).toContain("model?.playbackUrl");
    expect(viewer).toContain('data-testid="final-story-video"');
  });

  it("does not duplicate the Full Episode player", () => {
    expect(runtime.split("<FinalStoryResultViewer").length - 1).toBe(1);
    expect(preview).not.toContain("<video");
    expect(preview).toContain("previewState === \"FINAL_READY\" ? null");
    expect(preview).toContain("full-episode-pending");
  });

  it("never falls back to Scene media for partial, assembly, or Final Story Result read failure", () => {
    expect(resolveFullEpisodePreviewState({
      hasFinalStoryResult: false,
      status: "SCENES_FAILED",
      assemblyState: "NONE",
      pendingReviewSceneCount: 0,
    })).toBe("GENERATING");
    expect(resolveFullEpisodePreviewState({
      hasFinalStoryResult: false,
      status: "ASSEMBLY_FAILED",
      assemblyState: "FAILED",
    })).toBe("ASSEMBLY_FAILED");
    expect(fullEpisodePendingCopy("ASSEMBLY_FAILED")).toContain("could not be assembled");
    expect(runtime).not.toMatch(/ASSEMBLY_FAILED[\s\S]{0,200}deliveryUrl/);
    expect(viewer).toContain("finalVideoTemporarilyUnavailable");
    expect(viewer).not.toContain("generatedMedia");
    expect(preview).not.toContain("generatedMedia");
  });

  it("removes hardcoded Tapao Jom 00:48 duration from StoryRuntimePanel", () => {
    expect(runtime).not.toContain("00:48");
    expect(runtime).toContain("resolveEpisodeDurationLabel");
    expect(preview).not.toContain("00:48");
  });

  it("formats authoritative durationMs and does not invent a null duration", () => {
    expect(formatEpisodeClockDuration(48_020)).toBe("00:48");
    expect(formatEpisodeClockDuration(61_000)).toBe("01:01");
    expect(resolveEpisodeDurationLabel(null)).toBe("Duration pending");
    expect(resolveEpisodeDurationLabel(undefined)).toBe("Duration pending");
    expect(resolveEpisodeDurationLabel(null, { expected: true })).toBe("Duration unavailable");
    expect(resolveEpisodeDurationLabel(48_020, { expected: true })).toBe("00:48");
  });

  it("uses pending copy before assembly and keeps normal-user moment language", () => {
    expect(resolveFullEpisodePreviewState({
      hasFinalStoryResult: false,
      status: "SCENES_COMPLETE",
      assemblyState: "NONE",
      pendingReviewSceneCount: 1,
    })).toBe("WAITING_FOR_REVIEW");
    expect(resolveFullEpisodePreviewState({
      hasFinalStoryResult: false,
      status: "SCENES_COMPLETE",
      assemblyState: "NONE",
      pendingReviewSceneCount: 0,
    })).toBe("ASSEMBLING");
    expect(fullEpisodePendingCopy("GENERATING")).toBe(AI_STORY_EPISODE_COPY.generatingMoments);
    expect(fullEpisodePendingCopy("WAITING_FOR_REVIEW")).toBe(AI_STORY_EPISODE_COPY.waitingForReview);
    expect(fullEpisodePendingCopy("ASSEMBLING")).toBe(AI_STORY_EPISODE_COPY.assembling);
    expect(preview).toContain("finalEpisodePending");
    expect(moments).toContain("Episode moments");
    expect(runtime).not.toMatch(/>Scene 1</);
    expect(debug).toContain("Generation Units");
    expect(debug).toContain("data-testid=\"episode-super-admin-diagnostics\"");
  });
});
