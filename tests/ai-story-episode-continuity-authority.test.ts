import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  EpisodeContinuityAuthorityError,
  assertEpisodeContinuityConsumption,
  buildEpisodeContinuityPlanningContext,
  materializeEpisodeContinuityAuthority,
} from "@ceo-agent/shared/server";
import { EpisodeContinuityPlanningService } from "@ceo-agent/agents";

const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const scope = { organizationId: id(1), workspaceId: id(2), campaignId: id(3), storyId: id(4) };
const fromEpisode = { episodeId: id(5), episodeVersion: 2, episodeOrder: 1, storyVersionId: id(7) };
const toEpisode = { episodeId: id(6), episodeVersion: null, episodeOrder: 2, storyVersionId: null };
const character = {
  characterId: id(10), characterVersionId: id(11), characterFingerprint: hash("a"),
  reusableCharacterId: id(12), reusableCharacterVersionId: id(13),
  dnaVersionId: id(14), dnaFingerprint: hash("b"), castAuthorityRef: id(15),
  outfitState: "white blouse", appearanceDelta: null, physicalState: "healthy",
  emotionalState: "concerned", lastAction: "leaves the café", lastDialogue: "I have to go.",
  voiceAuthorityRef: { characterId: id(10), voiceProfileVersion: 3, voiceFingerprint: hash("c"), language: "English", localeOrAccent: "Singapore English", speechStyle: "warm, measured" },
};

function fixture(overrides: Record<string, unknown> = {}) {
  return materializeEpisodeContinuityAuthority({
    ...scope,
    fromEpisode,
    toEpisode,
    fromEpisodeScope: scope,
    toEpisodeScope: scope,
    characterStates: [character],
    locationState: { stateKind: "PREVIOUS_FINAL_LOCATION", locationId: id(20), locationVersionId: id(21), locationFingerprint: hash("d"), state: "café closing", timeOfDay: "evening", temporaryFacts: ["order remains on counter"] },
    objectStates: [{ objectId: id(30), objectAuthorityVersion: null, objectAuthorityFingerprint: null, finalState: "unfulfilled order", holderCharacterId: null, locationId: id(20) }],
    narrativeState: { finalBeatId: id(40), completedBeatIds: [id(41)], unresolvedBeatIds: [id(42)], unresolvedPromises: ["customer order remains unresolved"], lastDialogue: "I have to go.", lastSpeakerId: id(10), lastAction: "leaves the café", nextEpisodeRequiredFacts: ["urgent phone call received"] },
    visualState: { endingShotId: id(50), endingGenerationUnitId: id(51), endingMediaAssetId: id(52), endingFrameAssetId: id(53), compositionState: "doorway exit", cameraState: "locked medium shot" },
    audioState: { lastSpeakerId: id(10), voiceAuthorityRefs: [character.voiceAuthorityRef], dialogueLanguage: "English", emotionalDeliveryState: "urgent", speechStyleState: "quiet urgency" },
    createdFromResultAuthority: { finalStoryResultId: id(60), finalStoryResultIntegrityHash: hash("e"), finalMediaContentHash: hash("f"), storyVersionId: id(7), orderedSceneResultIds: [id(61)] },
    createdBy: id(70), frozenAt: "2026-09-25T10:00:00.000Z",
    ...overrides,
  });
}

function consumption(authority = fixture(), overrides: Record<string, unknown> = {}) {
  return {
    authority,
    expectedScope: scope,
    expectedFromEpisodeId: fromEpisode.episodeId,
    expectedFromEpisodeVersion: 2,
    toEpisode: { ...toEpisode, ...scope },
    characterAuthorities: [character],
    retainedUnresolvedBeatIds: [id(42)],
    selectedLocationId: id(20),
    currentObjectStates: authority.objectStates,
    ...overrides,
  };
}

describe("EPISODE_CONTINUITY_AUTHORITY_V1", () => {
  it("materializes a deterministic adjacent Episode 1 → Episode 2 authority", () => {
    const first = fixture();
    const replay = fixture({ frozenAt: "2026-09-25T11:00:00.000Z" });
    expect(first.contractVersion).toBe("ai-story-episode-continuity-authority.v1");
    expect(replay.fingerprint).toBe(first.fingerprint);
    expect(replay.continuityAuthorityId).toBe(first.continuityAuthorityId);
    expect(first.status).toBe("FROZEN");
  });

  it("forbids same Character and Asset continuity across Campaigns", () => {
    expect(() => fixture({ toEpisodeScope: { ...scope, campaignId: id(99) } })).toThrowError(expect.objectContaining({ code: "CROSS_CAMPAIGN_CONTINUITY_FORBIDDEN" }));
  });

  it("forbids continuity across Stories and Workspaces", () => {
    expect(() => fixture({ toEpisodeScope: { ...scope, storyId: id(98) } })).toThrowError(expect.objectContaining({ code: "CROSS_STORY_CONTINUITY_FORBIDDEN" }));
    expect(() => fixture({ toEpisodeScope: { ...scope, workspaceId: id(97) } })).toThrowError(expect.objectContaining({ code: "CROSS_WORKSPACE_CONTINUITY_FORBIDDEN" }));
    expect(() => fixture({ toEpisodeScope: { ...scope, organizationId: id(96) } })).toThrowError(expect.objectContaining({ code: "CROSS_ORGANIZATION_CONTINUITY_FORBIDDEN" }));
  });

  it("rejects non-adjacent Episode order and stale previous Episode version", () => {
    expect(() => fixture({ toEpisode: { ...toEpisode, episodeOrder: 4 } })).toThrowError(expect.objectContaining({ code: "INVALID_EPISODE_ORDER" }));
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), { expectedFromEpisodeVersion: 1 }))).toThrowError(expect.objectContaining({ code: "STALE_PREVIOUS_EPISODE_AUTHORITY" }));
  });

  it("fails closed on stale Character or DNA authority", () => {
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), { characterAuthorities: [{ ...character, characterVersionId: id(90) }] }))).toThrowError(expect.objectContaining({ code: "STALE_CHARACTER_AUTHORITY" }));
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), { characterAuthorities: [{ ...character, dnaFingerprint: hash("9") }] }))).toThrowError(expect.objectContaining({ code: "DNA_CONTINUITY_MISMATCH" }));
  });

  it("allows approved outfit and location transitions without changing DNA", () => {
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), {
      selectedLocationId: id(22), approvedLocationChange: true,
      approvedOutfitChanges: { [character.characterId]: "blue jacket" },
    }))).not.toThrow();
  });

  it("retains unresolved beats and rejects silent omission", () => {
    expect(() => assertEpisodeContinuityConsumption(consumption())).not.toThrow();
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), { retainedUnresolvedBeatIds: [] }))).toThrowError(expect.objectContaining({ code: "UNRESOLVED_BEAT_DROPPED" }));
  });

  it("preserves voice identity while allowing Episode emotional delivery to change", () => {
    expect(() => assertEpisodeContinuityConsumption(consumption())).not.toThrow();
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), { characterAuthorities: [{ ...character, emotionalState: "hopeful", voiceAuthorityRef: { ...character.voiceAuthorityRef, voiceFingerprint: hash("8") } }] }))).toThrowError(expect.objectContaining({ code: "VOICE_AUTHORITY_MISMATCH" }));
  });

  it("requires explicit Object state change authority", () => {
    const next = [{ ...fixture().objectStates[0]!, finalState: "order delivered" }];
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), { currentObjectStates: next }))).toThrowError(expect.objectContaining({ code: "OBJECT_STATE_CONTINUITY_MISMATCH" }));
    expect(() => assertEpisodeContinuityConsumption(consumption(fixture(), { currentObjectStates: next, approvedObjectChanges: [id(30)] }))).not.toThrow();
  });

  it("does not resolve generation mode from ending image or video references", () => {
    const context = buildEpisodeContinuityPlanningContext({ authority: fixture(), approvedCurrentEpisodeChanges: {} });
    expect(context.generationMode).toBeNull();
    expect(context.previousEpisodeFacts.visualState?.endingFrameAssetId).toBe(id(53));
    expect(context.previousEpisodeFacts.visualState?.endingMediaAssetId).toBe(id(52));
  });

  it("loads exact lineage for planning without LLM or Provider dependencies", async () => {
    const authority = fixture();
    const repository = { insertOrConverge: vi.fn(), loadPreviousEpisodeContinuityAuthority: vi.fn().mockResolvedValue(authority) };
    const service = new EpisodeContinuityPlanningService(repository);
    const context = await service.loadPreviousEpisodeContinuityAuthority({
      ...scope, expectedFromEpisodeId: fromEpisode.episodeId, expectedFromEpisodeVersion: 2,
      toEpisode, characterAuthorities: [character], retainedUnresolvedBeatIds: [id(42)],
      selectedLocationId: id(22), approvedLocationChange: true,
      approvedOutfitChanges: { [character.characterId]: "blue jacket" },
      approvedCurrentEpisodeChanges: { outfit: "blue jacket", location: "flower shop" },
    });
    expect(repository.loadPreviousEpisodeContinuityAuthority).toHaveBeenCalledWith(expect.objectContaining(scope));
    expect(context.previousEpisodeFacts.fingerprint).toBe(authority.fingerprint);
    expect(context.approvedCurrentEpisodeChanges).toEqual({ outfit: "blue jacket", location: "flower shop" });
  });

  it("sanitized café → flower shop regression preserves DNA and exposes prior narrative facts", () => {
    const authority = fixture();
    assertEpisodeContinuityConsumption(consumption(authority, {
      selectedLocationId: id(22), approvedLocationChange: true,
      approvedOutfitChanges: { [character.characterId]: "blue jacket" },
    }));
    expect(authority.characterStates[0]?.outfitState).toBe("white blouse");
    expect(authority.characterStates[0]?.dnaFingerprint).toBe(character.dnaFingerprint);
    expect(authority.narrativeState.nextEpisodeRequiredFacts).toContain("urgent phone call received");
  });

  it("changes fingerprint when frozen facts differ", () => {
    const changed = fixture({ narrativeState: { ...fixture().narrativeState, lastAction: "stays in the café" } });
    expect(changed.fingerprint).not.toBe(fixture().fingerprint);
  });

  it("keeps the migration additive, RLS-protected, and free of destructive DDL", () => {
    const sql = readFileSync("packages/db/sql/ai-story-episode-continuity-authority-v1.sql", "utf8");
    expect(sql).toContain("CREATE TABLE ai_story_episode_continuity_authorities");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+\w+\s+DROP/i);
    expect(sql).toContain("EPISODE_CONTINUITY_AUTHORITY_IMMUTABLE");
  });
});
