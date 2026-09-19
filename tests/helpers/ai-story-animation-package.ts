import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  type AnimationPackagePayload,
} from "@ceo-agent/shared";

export function animationPackageFixture(
  status: AnimationPackagePayload["status"] = "review"
): AnimationPackagePayload {
  const story = {
    title: "Canonical package",
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
      characters: [{
        id: "hero",
        name: "Hero",
        role: "Customer",
        description: "Needs a meaningful gift.",
        motivation: "Make someone feel remembered.",
        visualNotes: "Smart casual.",
      }],
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
    storyBeats: [{
      id: "beat-001",
      name: "Opening",
      purpose: "Introduce need",
      order: 0,
      summary: "Hero realizes a gift is needed.",
    }],
    scenePlan: [{
      id: "scene-001",
      beatIds: ["beat-001"],
      purpose: "Need and discovery",
      durationSec: 6,
      transition: "Cut",
      continuityNotes: "Warm light",
      order: 0,
    }],
    shotPlan: [{
      id: "shot-001",
      sceneId: "scene-001",
      cameraType: "Close-up",
      cameraMovement: "Slow push",
      composition: "Product foreground",
      framing: "Vertical",
      lensSuggestion: "35mm",
      durationSec: 6,
      focus: "Gift box",
      emotion: "Relief",
      information: "Product solves the need",
      order: 0,
    }],
    characterContinuity: [{
      characterId: "hero",
      name: "Hero",
      appearance: "Smart casual",
      emotion: "Relief",
      costume: "Neutral shirt",
      accessories: "Phone",
      age: "Adult",
      pose: "Leaning toward product",
      identity: "Customer hero",
    }],
    worldContinuity: {
      location: "Apartment",
      lighting: "Soft morning light",
      environment: "Urban home",
      objects: ["gift box"],
      timeline: "Morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: {
      consistent: true,
      issues: [],
      links: [{ beatId: "beat-001", sceneIds: ["scene-001"], shotIds: ["shot-001"] }],
    },
    status,
  });
}
