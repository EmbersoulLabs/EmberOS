import { describe, expect, it, vi } from "vitest";

describe("AI Story planning pipeline assembly", () => {
  it("runs planning stages in order and returns a review Animation Package", async () => {
    vi.resetModules();
    const callJsonModel = vi.fn(async () => {
      const usage = { input: 10, output: 5, costUsd: 0.01 };
      const calls = callJsonModel.mock.calls.length;
      if (calls === 1) {
        return {
          result: {
            creativeContext: {
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
                dialogue: [
                  {
                    speaker: "Hero",
                    line: "This gift will land.",
                    beatHint: "climax",
                  },
                ],
              },
              directorContext: {},
            },
          },
          usage,
        };
      }
      if (calls === 2) {
        return {
          result: {
            directorThinking: {
              coreMessage: "Gifting is simple.",
              hero: "Hero",
              conflict: "No time",
              turningPoint: "Discovers brand",
              climax: "Gift reveal",
              takeaway: "Shop now",
            },
          },
          usage,
        };
      }
      if (calls === 3) {
        return {
          result: {
            storyBeats: [
              {
                id: "beat-001",
                name: "Opening",
                purpose: "Introduce need",
                order: 0,
                summary: "Hero needs a gift.",
              },
            ],
          },
          usage,
        };
      }
      if (calls === 4) {
        return {
          result: {
            scenePlan: [
              {
                id: "scene-001",
                beatIds: ["beat-001"],
                purpose: "Need and discovery",
                durationSec: 6,
                transition: "Cut",
                continuityNotes: "",
                order: 0,
              },
            ],
          },
          usage,
        };
      }
      if (calls === 5) {
        return {
          result: {
            shotPlan: [
              {
                id: "shot-001",
                sceneId: "scene-001",
                cameraType: "Close-up",
                cameraMovement: "Push in",
                composition: "Product foreground",
                framing: "Vertical",
                lensSuggestion: "35mm",
                durationSec: 3,
                focus: "Gift box",
                emotion: "Relief",
                information: "Product solves need",
                order: 0,
              },
            ],
          },
          usage,
        };
      }
      if (calls === 6) {
        return {
          result: {
            characterContinuity: [
              {
                characterId: "hero",
                name: "Hero",
                appearance: "Smart casual",
                emotion: "Concern to relief",
                costume: "Neutral shirt",
                accessories: "Phone",
                age: "Adult",
                pose: "Holding gift",
                identity: "Customer hero",
              },
            ],
          },
          usage,
        };
      }
      return {
        result: {
          worldContinuity: {
            location: "Apartment",
            lighting: "Soft morning",
            environment: "Urban home",
            objects: ["gift box"],
            timeline: "Morning",
            worldRules: ["Keep brand colors visible"],
          },
        },
        usage,
      };
    });
    vi.doMock("../packages/agents/src/llm", () => ({ callJsonModel }));

    const { runFullStoryPlanningPipeline } = await import(
      "../packages/agents/src/ai-story/story-planning-service"
    );
    const payload = await runFullStoryPlanningPipeline({
      storyDraft: {
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
      campaign: { name: "Spring" },
      brand: { brandName: "Ember" },
      assetLabels: ["hero.jpg"],
    });

    expect(callJsonModel).toHaveBeenCalledTimes(7);
    expect(payload.status).toBe("review");
    expect(payload.narrativeIntegration.consistent).toBe(true);
    expect(payload.usage).toEqual({ input: 70, output: 35, costUsd: 0.07 });
  });
});
