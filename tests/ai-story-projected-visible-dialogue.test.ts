import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acceptAiStoryEpisodeIntent } from "@ceo-agent/shared";
import {
  CommercialVisibleDialogueProjectionError,
  projectEpisodeProjectedVisibleDialogue,
} from "@ceo-agent/shared/server";
import type { AiStoryCanonicalScene } from "@ceo-agent/shared";
import type { AiStoryEpisodeProjectedDirectorPlan, AiStoryEpisodeProjectedMotionPlan } from "@ceo-agent/shared";
import type { AiStoryScriptVersion } from "@ceo-agent/shared";

const id = (n: number) => `92000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const HASH = `sha256:${"b".repeat(64)}`;
const STORY = id(1);
const STORY_VERSION = id(2);
const SCRIPT = id(3);
const SCENE = id(4);
const SCRIPT_SCENE = id(5);
const SPEAKER = id(6);
const OTHER = id(7);
const ENTRY = id(8);
const DIRECTOR = id(9);
const MOTION = id(10);
const LINE = "Come and look at the counter.";

function intent(spokenLanguage: "en-SG" | "en-MY" = "en-SG") {
  return acceptAiStoryEpisodeIntent({
    episodeType: "COMMERCIAL_STORY",
    requestedDurationSec: 30,
    aspectRatio: "9:16",
    spokenLanguage,
    dialogueStyle: "natural",
    nativeCharacterDialogue: true,
    pacing: "NATURAL",
    cta: null,
    visualTextLanguages: ["en"],
    visualTextPolicy: { criticalSurfacePolicy: "PROVIDER_NON_LEGIBLE" },
  }, "2026-09-28T00:00:00.000Z");
}

function script(language = "en-SG", speakerId = SPEAKER, withDialogue = true): AiStoryScriptVersion {
  return {
    status: "FROZEN",
    storyId: STORY,
    storyVersionId: STORY_VERSION,
    scriptVersionId: SCRIPT,
    sourceHash: HASH,
    scenes: [{
      scriptSceneId: SCRIPT_SCENE,
      entries: withDialogue
        ? [{ type: "DIALOGUE", entryId: ENTRY, speakerId, line: LINE, language, order: 0, durationRange: { minSeconds: 1, maxSeconds: 2 } }]
        : [{ type: "ACTION", entryId: ENTRY, subjectId: speakerId, action: "The shopkeeper sets the plate down.", order: 0, durationRange: { minSeconds: 1, maxSeconds: 2 }, storyEffect: "The plate is present" }],
    }],
  } as AiStoryScriptVersion;
}

function canonical(speakerId = SPEAKER): AiStoryCanonicalScene {
  return {
    sceneId: SCENE,
    scriptVersionId: SCRIPT,
    sourceScriptSceneIds: [SCRIPT_SCENE],
    castBindings: [{ id: speakerId, scope: "CAMPAIGN_CHARACTER", authorityVersionId: id(11), authorityFingerprint: HASH }],
  } as AiStoryCanonicalScene;
}

function plans(options: { shots?: boolean; motion?: boolean } = {}) {
  const directorPlan = {
    status: "FROZEN",
    directorPlanId: DIRECTOR,
    sceneDirections: [{
      scriptSceneId: SCRIPT_SCENE,
      canonicalSceneId: SCENE,
      sceneOrder: 0,
      shots: options.shots === false ? [] : [{ shotId: "shot-001", order: 0 }],
    }],
  } as AiStoryEpisodeProjectedDirectorPlan;
  const motionPlan = {
    status: "FROZEN",
    motionPlanId: MOTION,
    sceneMotionPlans: options.motion === false ? [] : [{ scriptSceneId: SCRIPT_SCENE, sceneOrder: 0 }],
  } as AiStoryEpisodeProjectedMotionPlan;
  return { directorPlan, motionPlan };
}

describe("projected visible dialogue authority", () => {
  it("produces exact frozen dialogue authority without classic director or motion", () => {
    const authority = projectEpisodeProjectedVisibleDialogue({
      intent: intent(),
      script: script(),
      canonicalScene: canonical(),
      ...plans(),
    });
    expect(authority).toMatchObject({
      exactText: LINE,
      characterId: SPEAKER,
      dialogueEntryId: ENTRY,
      primaryLocale: "en-SG",
      scriptSceneId: SCRIPT_SCENE,
      onScreenSpeaker: true,
      detachedTtsPermitted: false,
      nativeAvRequired: true,
    });
    expect(authority?.mustPreserve).toContain(LINE);
  });

  it("blocks a speaker who is not bound to the canonical scene", () => {
    expect(() => projectEpisodeProjectedVisibleDialogue({
      intent: intent(),
      script: script(),
      canonicalScene: canonical(OTHER),
      ...plans(),
    })).toThrow(CommercialVisibleDialogueProjectionError);
  });

  it("blocks a dialogue locale that differs from the episode spoken language", () => {
    expect(() => projectEpisodeProjectedVisibleDialogue({
      intent: intent("en-SG"),
      script: script("en-MY"),
      canonicalScene: canonical(),
      ...plans(),
    })).toThrow(/spoken locale/);
  });

  it("blocks when the projected motion binding is missing", () => {
    expect(() => projectEpisodeProjectedVisibleDialogue({
      intent: intent(),
      script: script(),
      canonicalScene: canonical(),
      ...plans({ motion: false }),
    })).toThrow(/Motion binding/);
  });

  it("does not fabricate dialogue authority for a scene without dialogue", () => {
    expect(projectEpisodeProjectedVisibleDialogue({
      intent: intent(),
      script: script("en-SG", SPEAKER, false),
      canonicalScene: canonical(),
      ...plans(),
    })).toBeNull();
  });

  it("passes projected plans into episode repair without inserting script product facts", () => {
    const repair = readFileSync("packages/db/src/queries/ai-story-episode-repair-qc.ts", "utf8");
    const qc = readFileSync("packages/db/src/queries/ai-story-pre-generation-qc.ts", "utf8");
    expect(repair).toContain("projectEpisodeProjectedVisibleDialogue");
    expect(qc).toContain("projectedDirectorPlan:projectedDirector.success?projectedDirector.data:null");
    expect(qc).toContain("projectedMotionPlan:projectedMotion.success?projectedMotion.data:null");
    expect(repair).not.toContain("productStoryContribution");
    expect(repair).not.toContain("commercialContribution");
  });
});
