import { describe, expect, it } from "vitest";
import { buildPromptPackage, buildGenerateReviewEstimate } from "../packages/agents/src/ai-story/prompt-builder";
import type { AnimationPackagePayload } from "@ceo-agent/shared";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
} from "@ceo-agent/shared";

function samplePackage(): AnimationPackagePayload {
  const story = {
    title: "Launch",
    summary: "A shopper discovers the brand.",
    objective: "Awareness",
    targetAudience: "Busy gift buyers",
    tone: "Warm",
    estimatedDuration: "30s",
    story: {
      opening: "The hero needs a gift.",
      development: "The brand solves the problem.",
      ending: "The hero shares the gift.",
    },
    keyMessages: ["Simple gifting"],
    cta: "Shop now",
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
    characterContext: {
      characters: [
        {
          id: "hero",
          name: "Hero",
          role: "Customer",
          description: "Needs a meaningful gift.",
          motivation: "Make someone feel remembered.",
          visualNotes: "Smart casual.",
        },
      ],
      relationships: [],
    },
    worldContext: {
      locations: ["Apartment"],
      visualStyle: "Clean",
      lighting: "Soft",
      environment: "Urban home",
      objects: ["gift box"],
      timeline: "Morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrativeContext: {
      arc: "Need to relief",
      pacing: "Quick",
      emotionalJourney: "Concern to delight",
      themes: ["thoughtfulness"],
      dialogue: [],
    },
    directorContext: {},
  });
  const directorThinking = DirectorThinkingSchema.parse({
    coreMessage: "Thoughtful gifting can be simple.",
    hero: "Hero",
    conflict: "No time to find a gift.",
    turningPoint: "Hero discovers the product.",
    climax: "Gift reveal lands emotionally.",
    takeaway: "Shop now for simple gifting.",
  });
  return AnimationPackagePayloadSchema.parse({
    story,
    characters: creativeContext.characterContext.characters,
    creativeContext: { ...creativeContext, directorContext: directorThinking },
    directorThinking,
    storyBeats: [
      {
        id: "beat-001",
        name: "Opening",
        purpose: "Introduce need",
        order: 0,
        summary: "Hero realizes a gift is needed.",
      },
    ],
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
    shotPlan: [
      {
        id: "shot-001",
        sceneId: "scene-001",
        cameraType: "Close-up",
        cameraMovement: "Slow push",
        composition: "Product foreground",
        framing: "Vertical",
        lensSuggestion: "35mm",
        durationSec: 3,
        focus: "Gift box",
        emotion: "Relief",
        information: "Product solves the gift need",
        order: 0,
      },
    ],
    characterContinuity: [
      {
        characterId: "hero",
        name: "Hero",
        appearance: "Smart casual",
        emotion: "Concern then delight",
        costume: "Neutral shirt",
        accessories: "Phone",
        age: "Adult",
        pose: "Leaning toward product",
        identity: "Customer hero",
      },
    ],
    worldContinuity: {
      location: "Apartment",
      lighting: "Soft morning light",
      environment: "Urban home",
      objects: ["gift box"],
      timeline: "One morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: true, issues: [], links: [] },
    status: "ready_for_execution",
  });
}

describe("Sprint 3 prompt builder", () => {
  it("builds generate review estimate without naming a vendor in the UI contract", () => {
    const estimate = buildGenerateReviewEstimate({
      animationPackage: samplePackage(),
      mediaKind: "video",
    });
    expect(estimate.targetOutputCount).toBe(5);
    expect(estimate.preferredCapabilityId).toBe("animation-video-generation");
    expect(estimate.aiSummary.toLowerCase()).not.toContain("seedance");
  });

  it("builds quality-first output briefs from Animation Package", () => {
    const pkg = buildPromptPackage({
      storyId: "11111111-1111-1111-1111-111111111111",
      animationPackageId: "22222222-2222-2222-2222-222222222222",
      animationPackage: samplePackage(),
      mediaKind: "video",
      now: new Date("2026-07-30T00:00:00.000Z"),
    });
    expect(pkg.outputBriefs.length).toBeGreaterThanOrEqual(3);
    expect(pkg.outputBriefs.length).toBeLessThanOrEqual(5);
    expect(pkg.outputBriefs[0]?.shotPrompts[0]?.prompt.length).toBeGreaterThan(10);
  });
});

describe("Sprint 3 provider adapters (mock)", () => {
  it("hides Seedance and Flux capabilities when API keys are missing", async () => {
    const prevSeedance = process.env.SEEDANCE_API_KEY;
    const prevFlux = process.env.FLUX_API_KEY;
    delete process.env.SEEDANCE_API_KEY;
    delete process.env.FLUX_API_KEY;
    try {
      const { SeedanceVideoAdapter } = await import(
        "../packages/agents/src/provider-adapters/seedance-video-adapter"
      );
      const { FluxImageAdapter } = await import(
        "../packages/agents/src/provider-adapters/flux-image-adapter"
      );
      const resolver = {
        resolve: async () => ({}),
      };
      expect(new SeedanceVideoAdapter(resolver).capabilities().size).toBe(0);
      expect(new FluxImageAdapter(resolver).capabilities().size).toBe(0);
    } finally {
      if (prevSeedance !== undefined) process.env.SEEDANCE_API_KEY = prevSeedance;
      if (prevFlux !== undefined) process.env.FLUX_API_KEY = prevFlux;
    }
  });
});
