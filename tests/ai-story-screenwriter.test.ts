import { describe, expect, it, vi } from "vitest";

describe("AI Story screenwriter helpers", () => {
  it("rewrites a Story Draft with validated structure", async () => {
    vi.resetModules();
    vi.doMock("../packages/agents/src/llm", () => ({
      callJsonModel: vi.fn(async () => ({
        result: {
          title: "Rewritten Launch",
          summary: "A clearer gift story.",
          objective: "Awareness",
          targetAudience: "Gift buyers",
          tone: "Warm",
          estimatedDuration: "30s",
          story: {
            opening: "Need",
            development: "Discovery",
            ending: "Delight",
          },
          keyMessages: ["Simple gifting"],
          cta: "Shop now",
          assetReferences: [],
          warnings: [],
        },
        usage: { input: 5, output: 5, costUsd: 0.01 },
      })),
    }));

    const { rewriteAiStoryDraft } = await import(
      "../packages/agents/src/ai-story/story-screenwriter-service"
    );
    const result = await rewriteAiStoryDraft({
      draft: {
        title: "Launch",
        summary: "Summary",
        objective: "Awareness",
        targetAudience: "Gift buyers",
        tone: "Warm",
        estimatedDuration: "30s",
        story: { opening: "A", development: "B", ending: "C" },
        keyMessages: ["Simple gifting"],
        cta: "Shop now",
        assetReferences: [],
        warnings: [],
      },
      originalIdea: "A gift story",
      campaign: { name: "Spring" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.title).toBe("Rewritten Launch");
    }
  });

  it("generates dialogue and merges into Creative Context", async () => {
    vi.resetModules();
    vi.doMock("../packages/agents/src/llm", () => ({
      callJsonModel: vi.fn(async () => ({
        result: {
          dialogue: [
            {
              speaker: "Hero",
              line: "This is the one.",
              beatHint: "climax",
            },
          ],
        },
        usage: { input: 3, output: 3, costUsd: 0.01 },
      })),
    }));

    const {
      generateStoryDialogue,
      mergeDialogueIntoCreativeContext,
    } = await import("../packages/agents/src/ai-story/story-screenwriter-service");
    const { CreativeContextSchema } = await import("@ceo-agent/shared");

    const creativeContext = CreativeContextSchema.parse({
      storyContext: {
        title: "Launch",
        summary: "Summary",
        objective: "Awareness",
        targetAudience: "Gift buyers",
        tone: "Warm",
        estimatedDuration: "30s",
        keyMessages: ["Simple gifting"],
        cta: "Shop now",
      },
      characterContext: {
        characters: [
          {
            id: "hero",
            name: "Hero",
            role: "Customer",
            description: "Needs a gift",
            motivation: "Delight a friend",
            visualNotes: "Smart casual",
          },
        ],
        relationships: [],
      },
      worldContext: {
        locations: ["Apartment"],
        visualStyle: "Bright",
        lighting: "Soft",
        environment: "Urban home",
        objects: ["gift box"],
        timeline: "Morning",
        worldRules: ["Keep brand colors visible"],
      },
      narrativeContext: {
        arc: "Need to delight",
        pacing: "Quick",
        emotionalJourney: "Concern to relief",
        themes: ["thoughtfulness"],
        dialogue: [],
      },
      directorContext: {},
    });

    const generated = await generateStoryDialogue({
      story: {
        title: "Launch",
        summary: "Summary",
        objective: "Awareness",
        targetAudience: "Gift buyers",
        tone: "Warm",
        estimatedDuration: "30s",
        story: { opening: "A", development: "B", ending: "C" },
        keyMessages: ["Simple gifting"],
        cta: "Shop now",
        assetReferences: [],
        warnings: [],
      },
      creativeContext,
      campaign: { name: "Spring" },
    });
    const merged = mergeDialogueIntoCreativeContext(creativeContext, generated.dialogue);
    expect(merged.narrativeContext.dialogue).toHaveLength(1);
    expect(merged.narrativeContext.dialogue[0]?.speaker).toBe("Hero");
  });
});
