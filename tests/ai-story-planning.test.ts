import { describe, expect, it } from "vitest";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  DirectorThinkingSchema,
  STORY_PLANNING_STAGE_ORDER,
  validatePlanningConsistency,
  type AnimationPackagePayload,
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
      relationships: ["Hero buys for a friend"],
    },
    worldContext: {
      locations: ["Apartment", "Store"],
      visualStyle: "Clean and bright",
      lighting: "Soft morning light",
      environment: "Urban home and product closeups",
      objects: ["gift box"],
      timeline: "One morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrativeContext: {
      arc: "Need to relief",
      pacing: "Quick discovery",
      emotionalJourney: "Concern to delight",
      themes: ["thoughtfulness"],
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
      {
        id: "beat-002",
        name: "CTA",
        purpose: "Drive action",
        order: 1,
        summary: "Invite viewers to shop.",
      },
    ],
    scenePlan: [
      {
        id: "scene-001",
        beatIds: ["beat-001", "beat-002"],
        purpose: "Need, discovery, and CTA",
        durationSec: 6,
        transition: "Cut",
        continuityNotes: "Merged beat-002 CTA into end card.",
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
        framing: "Vertical hero framing",
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
        appearance: "Smart casual outfit",
        emotion: "Concern then delight",
        costume: "Neutral shirt",
        accessories: "Phone",
        age: "Adult",
        pose: "Leaning toward product",
        identity: "Customer hero",
      },
    ],
    worldContinuity: {
      location: "Apartment and store",
      lighting: "Soft morning light",
      environment: "Urban home and product closeups",
      objects: ["gift box"],
      timeline: "One morning",
      worldRules: ["Keep brand colors visible"],
    },
    narrative: creativeContext.narrativeContext,
    narrativeIntegration: { consistent: true, issues: [], links: [] },
    status: "review",
  });
}

describe("AI Story planning domain", () => {
  it("validates Animation Package payloads", () => {
    expect(AnimationPackagePayloadSchema.safeParse(samplePackage()).success).toBe(true);
  });

  it("reports consistent packages with beat-scene-shot links", () => {
    const report = validatePlanningConsistency(samplePackage());
    expect(report.consistent).toBe(true);
    expect(report.links).toEqual([
      { beatId: "beat-001", sceneIds: ["scene-001"], shotIds: ["shot-001"] },
      { beatId: "beat-002", sceneIds: ["scene-001"], shotIds: ["shot-001"] },
    ]);
  });

  it("flags unreferenced beats, shotless scenes, unknown characters, and empty world fields", () => {
    const payload = samplePackage();
    payload.storyBeats.push({
      id: "beat-003",
      name: "Climax",
      purpose: "Shotless scene beat",
      order: 2,
      summary: "This beat is linked to a scene with no shots.",
    });
    payload.storyBeats.push({
      id: "beat-004",
      name: "Ending",
      purpose: "Unlinked beat",
      order: 3,
      summary: "This beat is missing from scenes.",
    });
    payload.scenePlan.push({
      id: "scene-002",
      beatIds: ["beat-003"],
      purpose: "No shot scene",
      durationSec: 2,
      transition: "Cut",
      continuityNotes: "",
      order: 1,
    });
    payload.characterContinuity.push({
      characterId: "unknown",
      name: "Stranger",
      appearance: "Unknown",
      emotion: "Unknown",
      costume: "",
      accessories: "",
      age: "",
      pose: "",
      identity: "Unknown",
    });
    payload.worldContinuity.objects = [];
    const report = validatePlanningConsistency(payload);
    expect(report.consistent).toBe(false);
    expect(report.issues.join("\n")).toContain("Story beat beat-004");
    expect(report.issues.join("\n")).toContain("Scene scene-002 has no shots");
    expect(report.issues.join("\n")).toContain("Stranger");
    expect(report.issues.join("\n")).toContain("World continuity fields");
  });

  it("documents the required planning stage order", () => {
    expect(STORY_PLANNING_STAGE_ORDER).toEqual([
      "creative_context",
      "director_thinking",
      "story_beats",
      "scene_plan",
      "shot_plan",
      "character_continuity",
      "world_continuity",
      "animation_package",
    ]);
  });
});
