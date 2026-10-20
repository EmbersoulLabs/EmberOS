import { describe, expect, it } from "vitest";
import {
  AiStoryPlanningDialogueRevisionError,
  applyUserAuthoredDialogueToPlanningDraft,
} from "../apps/web/src/lib/ai-story-planning-service";
import type { CreativeContext, StoryPlanningDraft } from "@ceo-agent/shared";

const context: CreativeContext = {
  storyContext: { title: "B01", summary: "", objective: "", targetAudience: "", tone: "", estimatedDuration: "10 seconds", keyMessages: [], cta: "" },
  characterContext: { characters: [], relationships: [] },
  productAuthorities: [],
  worldContext: { locations: [], visualStyle: "", lighting: "", environment: "", objects: [], timeline: "", worldRules: [] },
  narrativeContext: { arc: "", pacing: "", emotionalJourney: "", themes: [], dialogue: [] },
  directorContext: {},
};

function draft(completedStages: StoryPlanningDraft["completedStages"]): StoryPlanningDraft {
  return {
    kind: "planning_draft",
    completedStages,
    story: { title: "B01", summary: "", objective: "", targetAudience: "", tone: "", estimatedDuration: "10 seconds", story: { opening: "", development: "", ending: "" }, keyMessages: [], cta: "", assetReferences: [], warnings: [] },
    creativeContext: context,
  };
}

describe("user-authored Planning dialogue", () => {
  it("replaces dialogue before Director Planning without changing other Creative Context facts", () => {
    const dialogue = [
      { speaker: "Daughter", line: "妈，你每天这样做，不累咩？", beatHint: "opening" },
      { speaker: "Fei Sao", line: "累啊，不然你来做咯。", beatHint: "reply" },
    ];
    const next = applyUserAuthoredDialogueToPlanningDraft(draft(["creative_context"]), {
      ...context,
      narrativeContext: { ...context.narrativeContext, dialogue },
    });
    expect(next.creativeContext?.narrativeContext.dialogue).toEqual(dialogue);
    expect(next.completedStages).toEqual(["creative_context"]);
    expect(next.creativeContext?.storyContext).toEqual(context.storyContext);
  });

  it("fails closed once Director authority exists", () => {
    expect(() => applyUserAuthoredDialogueToPlanningDraft(
      draft(["creative_context", "director_thinking"]), context
    )).toThrowError(AiStoryPlanningDialogueRevisionError);
  });
});
