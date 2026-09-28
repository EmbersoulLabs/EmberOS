import type { StoryPlanningStage } from "@ceo-agent/shared";

export type StoryPlanningStageJobData = {
  campaignId: string;
  storyId: string;
  workspaceId: string;
  orgId: string;
  actorUserId: string;
  storyVersionId: string;
  stage: StoryPlanningStage;
  regenerationIdentity?: string | null;
};

/**
 * Runs the existing planning stage executor outside the web request.
 * The module path is computed so the worker build does not pull the Next.js
 * app into its compile root; tsx resolves it from the monorepo at runtime.
 */
export async function processStoryPlanningStage(data: StoryPlanningStageJobData) {
  const moduleUrl = new URL(
    "../../../../apps/web/src/lib/ai-story-planning-runner.ts",
    import.meta.url
  );
  const runner = (await import(moduleUrl.href)) as {
    executeQueuedPlanningStage: (input: StoryPlanningStageJobData) => Promise<{
      stage: StoryPlanningStage;
      reusedDurableResult?: boolean;
      completedStages: StoryPlanningStage[];
    }>;
  };
  return runner.executeQueuedPlanningStage(data);
}
