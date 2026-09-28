import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  planningStageIsDurable,
  type StoryPlanningDraft,
} from "../apps/web/src/lib/ai-story-planning-runner";

function draft(overrides: Partial<StoryPlanningDraft> = {}): StoryPlanningDraft {
  return {
    kind: "planning_draft",
    completedStages: ["creative_context", "director_thinking"],
    story: { title: "The Cooling Comedy" },
    creativeContext: { directorContext: { coreMessage: "cooling" } },
    directorThinking: {
      coreMessage: "cooling",
      hero: "Yuki",
      conflict: "price",
      turningPoint: "boss",
      climax: "interrupt",
      takeaway: "continue",
    },
    ...overrides,
  } as StoryPlanningDraft;
}

describe("durable planning stage reuse", () => {
  it("treats a persisted Director Thinking result as durable for the current draft", () => {
    expect(planningStageIsDurable(draft(), "director_thinking")).toBe(true);
  });

  it("does not treat a missing or partial Director Thinking result as durable", () => {
    expect(
      planningStageIsDurable(
        draft({ directorThinking: undefined, completedStages: ["creative_context"] }),
        "director_thinking"
      )
    ).toBe(false);
    expect(
      planningStageIsDurable(
        draft({ completedStages: ["creative_context"] }),
        "director_thinking"
      )
    ).toBe(false);
  });

  it("refuses to reuse a later stage that was wiped by an earlier restart", () => {
    expect(planningStageIsDurable(draft(), "story_beats")).toBe(false);
  });

  it("checks the durable result before pruning or calling the director model", () => {
    const source = readFileSync(
      resolve("apps/web/src/lib/ai-story-planning-runner.ts"),
      "utf8"
    );
    const reuse = source.indexOf("const reused = await reuseDurablePlanningStage");
    const prune = source.indexOf("prunePlanningDraftAfterStage(draft, stage)");
    const model = source.indexOf("generateDirectorThinking(");
    expect(reuse).toBeGreaterThan(-1);
    expect(prune).toBeGreaterThan(reuse);
    expect(model).toBeGreaterThan(reuse);
  });

  it("keeps model execution on the worker job and returns the HTTP request after enqueue", () => {
    const stageRoute = readFileSync(
      resolve("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/stages/[stage]/route.ts"),
      "utf8"
    );
    const generateRoute = readFileSync(
      resolve("apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/generate/route.ts"),
      "utf8"
    );
    const worker = readFileSync(
      resolve("apps/worker/src/processors/index.ts"),
      "utf8"
    );
    const processor = readFileSync(
      resolve("apps/worker/src/processors/story-planning-stage.ts"),
      "utf8"
    );
    expect(stageRoute).toContain("enqueueStoryPlanningStage");
    expect(stageRoute).toContain("202");
    expect(stageRoute).not.toContain("runSinglePlanningStage");
    expect(generateRoute).not.toContain("for (const stage of STORY_PLANNING_STAGE_ORDER)");
    expect(worker).toContain('job.name === "agent.story_planning_stage"');
    expect(worker).toContain("processStoryPlanningStage");
    expect(processor).toContain("executeQueuedPlanningStage");
    expect(processor).not.toContain("maxDuration");
  });
});
