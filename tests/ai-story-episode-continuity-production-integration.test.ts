import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertEpisodeContinuityConsumption,
  buildEpisodeContinuityPlanningContext,
  materializeEpisodeContinuityAuthority,
} from "@ceo-agent/shared/server";

const id = (n: number) =>
  `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const scope = {
  organizationId: id(1),
  workspaceId: id(2),
  campaignId: id(3),
  storyId: id(4),
};

function authority() {
  return materializeEpisodeContinuityAuthority({
    ...scope,
    fromEpisode: {
      episodeId: id(5),
      episodeVersion: 1,
      episodeOrder: 1,
      storyVersionId: id(5),
    },
    toEpisode: {
      episodeId: id(6),
      episodeVersion: 2,
      episodeOrder: 2,
      storyVersionId: id(6),
    },
    fromEpisodeScope: scope,
    toEpisodeScope: scope,
    characterStates: [
      {
        characterId: id(10),
        characterVersionId: id(11),
        characterFingerprint: hash("a"),
        reusableCharacterId: id(12),
        reusableCharacterVersionId: id(13),
        dnaVersionId: id(13),
        dnaFingerprint: hash("b"),
        castAuthorityRef: null,
        outfitState: "white blouse",
        appearanceDelta: null,
        physicalState: null,
        emotionalState: "calm",
        lastAction: "leaves the café",
        lastDialogue: "See you tomorrow.",
        voiceAuthorityRef: {
          characterId: id(10),
          voiceProfileVersion: 1,
          voiceFingerprint: hash("c"),
          language: "English",
          localeOrAccent: null,
          speechStyle: "warm",
        },
      },
    ],
    locationState: {
      stateKind: "PREVIOUS_FINAL_LOCATION",
      locationId: id(20),
      locationVersionId: null,
      locationFingerprint: null,
      state: "café",
      timeOfDay: "evening",
      temporaryFacts: [],
    },
    objectStates: [],
    narrativeState: {
      finalBeatId: id(30),
      completedBeatIds: [id(30)],
      unresolvedBeatIds: [id(31)],
      unresolvedPromises: ["the flower order remains open"],
      lastDialogue: "See you tomorrow.",
      lastSpeakerId: id(10),
      lastAction: "leaves the café",
      nextEpisodeRequiredFacts: ["arrange the waiting flowers"],
    },
    visualState: null,
    audioState: {
      lastSpeakerId: id(10),
      voiceAuthorityRefs: [
        {
          characterId: id(10),
          voiceProfileVersion: 1,
          voiceFingerprint: hash("c"),
          language: "English",
          localeOrAccent: null,
          speechStyle: "warm",
        },
      ],
      dialogueLanguage: "English",
      emotionalDeliveryState: "calm",
      speechStyleState: "warm",
    },
    createdFromResultAuthority: {
      finalStoryResultId: id(40),
      finalStoryResultIntegrityHash: hash("d"),
      finalMediaContentHash: hash("e"),
      storyVersionId: id(5),
      orderedSceneResultIds: [id(41)],
    },
    createdBy: id(50),
    frozenAt: "2026-09-25T12:00:00.000Z",
  });
}

describe("Episode Continuity production runtime integration", () => {
  it("materializes only after canonical Final Story Result projection", () => {
    const coordinator = readFileSync(
      "packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator.ts",
      "utf8"
    );
    const projectAt = coordinator.indexOf("projectFromSucceededAssembly");
    const assignmentAt = coordinator.lastIndexOf("const fsr = await", projectAt);
    const continuityAt = coordinator.indexOf("materializeEpisodeContinuity?.(fsr.result)");
    expect(assignmentAt).toBeGreaterThan(-1);
    expect(projectAt).toBeGreaterThan(assignmentAt);
    expect(projectAt).toBeGreaterThan(-1);
    expect(continuityAt).toBeGreaterThan(projectAt);
  });

  it("loads exact adjacent continuity before the semantic planning callback", () => {
    const runner = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    const loadAt = runner.indexOf(".loadForPlanning({");
    const semanticAt = runner.indexOf(
      "const runStage = () => withConfiguredCertificationPlanningContext"
    );
    expect(loadAt).toBeGreaterThan(-1);
    expect(semanticAt).toBeGreaterThan(loadAt);
    expect(runner).toContain("storyVersionId: loaded.currentVersion.id");
    expect(runner).toContain("export async function loadAiStoryPlanningContext");
    const planner = readFileSync(
      "packages/agents/src/ai-story/story-planning-service.ts",
      "utf8"
    );
    expect(planner).toContain("buildEpisodeContinuityPlanningPromptSection(episodeContinuity)");
  });

  it("wires the same runtime repository into Worker finalization and Web planning", () => {
    const worker = readFileSync("apps/worker/src/ai-story-provider-worker-cycle.ts", "utf8");
    const planner = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    expect(worker).toContain("new PgEpisodeContinuityRuntimeIntegration()");
    expect(worker).toContain("materializeAfterFinalStoryResult({ result })");
    expect(planner).toContain("new PgEpisodeContinuityRuntimeIntegration(");
    expect(planner).toContain("episodeContinuity: ctx.episodeContinuity");
  });

  it("preserves DNA and accepts approved white-blouse/café to blue-jacket/flower-shop transitions", () => {
    const frozen = authority();
    expect(() =>
      assertEpisodeContinuityConsumption({
        authority: frozen,
        expectedScope: scope,
        expectedFromEpisodeId: id(5),
        expectedFromEpisodeVersion: 1,
        toEpisode: { ...scope, episodeId: id(6), episodeVersion: 2, episodeOrder: 2, storyVersionId: id(6) },
        characterAuthorities: frozen.characterStates,
        retainedUnresolvedBeatIds: [id(31)],
        selectedLocationId: id(21),
        approvedLocationChange: true,
        approvedOutfitChanges: { [id(10)]: "blue jacket" },
      })
    ).not.toThrow();
    const context = buildEpisodeContinuityPlanningContext({
      authority: frozen,
      approvedCurrentEpisodeChanges: { outfit: "blue jacket", location: "flower shop" },
    });
    expect(context.previousEpisodeFacts.characterStates[0]?.dnaFingerprint).toBe(hash("b"));
    expect(context.previousEpisodeFacts.narrativeState.unresolvedPromises).toContain(
      "the flower order remains open"
    );
    expect(context.previousEpisodeFacts.audioState?.voiceAuthorityRefs).toHaveLength(1);
    expect(context.generationMode).toBeNull();
  });

  it("keeps production-path cross-Campaign, cross-Story, and non-adjacent failures closed", () => {
    const base = authority();
    expect(() =>
      materializeEpisodeContinuityAuthority({
        ...scope,
        fromEpisode: base.fromEpisode,
        toEpisode: base.toEpisode,
        fromEpisodeScope: scope,
        toEpisodeScope: { ...scope, campaignId: id(90) },
        characterStates: base.characterStates,
        locationState: base.locationState,
        objectStates: base.objectStates,
        narrativeState: base.narrativeState,
        visualState: base.visualState,
        audioState: base.audioState,
        createdFromResultAuthority: base.createdFromResultAuthority,
        createdBy: base.createdBy,
        frozenAt: base.frozenAt,
      })
    ).toThrowError(expect.objectContaining({ code: "CROSS_CAMPAIGN_CONTINUITY_FORBIDDEN" }));
    expect(() =>
      materializeEpisodeContinuityAuthority({
        ...scope,
        fromEpisode: base.fromEpisode,
        toEpisode: base.toEpisode,
        fromEpisodeScope: scope,
        toEpisodeScope: { ...scope, storyId: id(91) },
        characterStates: base.characterStates,
        locationState: base.locationState,
        objectStates: base.objectStates,
        narrativeState: base.narrativeState,
        visualState: base.visualState,
        audioState: base.audioState,
        createdFromResultAuthority: base.createdFromResultAuthority,
        createdBy: base.createdBy,
        frozenAt: base.frozenAt,
      })
    ).toThrowError(expect.objectContaining({ code: "CROSS_STORY_CONTINUITY_FORBIDDEN" }));
    expect(() =>
      materializeEpisodeContinuityAuthority({
        ...scope,
        fromEpisode: base.fromEpisode,
        toEpisode: { ...base.toEpisode, episodeOrder: 3 },
        fromEpisodeScope: scope,
        toEpisodeScope: scope,
        characterStates: base.characterStates,
        locationState: base.locationState,
        objectStates: base.objectStates,
        narrativeState: base.narrativeState,
        visualState: base.visualState,
        audioState: base.audioState,
        createdFromResultAuthority: base.createdFromResultAuthority,
        createdBy: base.createdBy,
        frozenAt: base.frozenAt,
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_EPISODE_ORDER" }));
  });

  it("contains no semantic or Provider work in continuity persistence/loading", () => {
    const runtime = readFileSync(
      "packages/db/src/queries/ai-story-episode-continuity-runtime.ts",
      "utf8"
    );
    expect(runtime).not.toMatch(/ProviderRouter\.route|AssetAnalysisService|callStage|openai|seedance.*submit|runway/i);
    expect(runtime).toContain("buildEpisodeContinuityPlanningContext");
  });
});
