import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bindingVisibleAtFrozenCutoff,
  evaluateStoryVersionFreezeContinuity,
} from "@ceo-agent/shared";
import {
  assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent,
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  canonicalAiStorySceneIdV1,
  finalizeAiStoryCanonicalScene,
} from "@ceo-agent/shared/server";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";
import {
  lateBindingSuccessorDecision,
  rebuildSuccessorAnimationPackage,
  reissueFrozenCanonicalScenes,
  reissueFrozenOutline,
  reissueFrozenScript,
} from "../apps/web/src/lib/ai-story-successor-authority";

const ORG = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const STORY = "48a93abc-a054-4ee1-bd99-e03ef2528ca6";
const HISTORICAL = "b7844bbd-ee4f-4257-8f18-4faa806b5e48";
const SUCCESSOR = "77777777-7777-4777-8777-777777777777";
const ACTOR = "88888888-8888-4888-8888-888888888888";
const CHARACTER = "99999999-9999-4999-8999-999999999999";
const CHARACTER_VERSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BEAT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UNIT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SCRIPT_SCENE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ENTRY = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const VOICE = "b1f20f12-e7b5-524a-805b-033a1905fc81";
const VOICE_FINGERPRINT = "sha256:48f92a49095f469ebead8bddbb49830e6b8da85e52b731c1c17bfd761083b9b2";
const BINDING_AT = "2026-10-06T14:55:30.088Z";
const HISTORICAL_FROZEN_AT = "2026-10-06T14:31:27.923Z";
const SUCCESSOR_FROZEN_AT = "2026-10-06T16:40:00.000Z";
const FINGERPRINT = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MODE = {
  strategy: "TEXT_TO_VIDEO" as const,
  referenceSource: "REFERENCE_FREE_T2V" as const,
  referenceAssetIds: [] as string[],
  firstFrameAssetId: null,
  productVisualIdentityRequirement: "NONE" as const,
};

function authorityChain() {
  const outlineDraft = buildAiStoryOutlineVersion({
    storyId: STORY,
    storyVersionId: HISTORICAL,
    orgId: ORG,
    workspaceId: WORKSPACE,
    version: 1,
    profile: { profileId: "CORE", profileVersion: 1 },
    premise: "Premise",
    coreClaim: "Claim",
    storyUnits: [{ storyUnitId: UNIT, order: 0, purpose: "Purpose", summary: "Summary", requiredBeatIds: [BEAT] }],
    beats: [{
      id: BEAT, storyUnitId: UNIT, order: 0, classification: "MAJOR", name: "Beat",
      purpose: "Purpose", summary: "Summary", required: true, ownershipPolicy: "EXCLUSIVE",
      authorityReferences: [{
        authorityType: "CHARACTER", authorityId: CHARACTER, authorityVersionId: CHARACTER_VERSION, authorityFingerprint: FINGERPRINT,
      }],
    }],
    hooks: [],
    setupPayoffs: [],
    requiredSceneOutcomes: [],
    authorityReferences: [{
      authorityType: "CHARACTER", authorityId: CHARACTER, authorityVersionId: CHARACTER_VERSION, authorityFingerprint: FINGERPRINT,
    }],
    upstreamAuthorityId: HISTORICAL,
    supersedesOutlineVersionId: null,
    createdBy: ACTOR,
    createdAt: HISTORICAL_FROZEN_AT,
  });
  const outline = { ...outlineDraft, status: "FROZEN" as const, approvedBy: ACTOR, approvedAt: HISTORICAL_FROZEN_AT, frozenAt: HISTORICAL_FROZEN_AT };
  const scriptDraft = buildAiStoryScriptVersion({
    storyId: STORY,
    storyVersionId: HISTORICAL,
    outlineVersionId: outline.outlineVersionId,
    orgId: ORG,
    workspaceId: WORKSPACE,
    version: 1,
    profileId: "CORE",
    profileVersion: 1,
    outlineSourceHash: outline.sourceHash,
    semanticInputFingerprint: `sha256:${"e".repeat(64)}`,
    scenes: [{
      scriptSceneId: SCRIPT_SCENE,
      order: 0,
      outlineBeatClaims: [{ outlineBeatId: BEAT, claim: "Exact claim" }],
      sceneFunction: "DEMONSTRATE",
      sceneFunctionRegistryVersion: 1,
      sceneStateIn: [],
      sceneStateDeltas: [],
      sceneStateOut: [],
      entries: [{
        entryId: ENTRY, order: 0, type: "ACTION", subjectId: CHARACTER, action: "Ada demonstrates.",
        storyEffect: "Evidence appears.", durationRange: { minSeconds: 4, maxSeconds: 4 },
      }],
      characterIds: [CHARACTER],
      locationIds: [],
      propIds: [],
      assetIds: [],
      productAuthorityRefs: [],
      targetDurationRange: { minSeconds: 4, maxSeconds: 4 },
      mustKeep: [],
      mustAvoid: [],
      newInformation: [],
      newEvidence: [],
      newActionOutcomes: [],
      productEvidence: [],
    }],
    authorityReferences: [{
      authorityType: "CHARACTER", authorityId: CHARACTER, authorityVersionId: CHARACTER_VERSION, authorityFingerprint: FINGERPRINT,
    }],
    supersedesScriptVersionId: null,
    createdBy: ACTOR,
    createdAt: HISTORICAL_FROZEN_AT,
  });
  const script = { ...scriptDraft, status: "FROZEN" as const, approvedBy: ACTOR, approvedAt: HISTORICAL_FROZEN_AT, frozenAt: HISTORICAL_FROZEN_AT };
  const sceneId = canonicalAiStorySceneIdV1(STORY, HISTORICAL, 0);
  const scene = {
    ...finalizeAiStoryCanonicalScene({
      sceneId,
      orgId: ORG,
      workspaceId: WORKSPACE,
      campaignId: CAMPAIGN,
      storyId: STORY,
      storyVersionId: HISTORICAL,
      scriptVersionId: script.scriptVersionId,
      version: 1,
      order: 0,
      sourceScriptSceneIds: [SCRIPT_SCENE],
      sourceScriptEntryIds: [ENTRY],
      sceneFunction: "DEMONSTRATE",
      sceneRole: "DEMONSTRATE",
      importance: "MAJOR",
      locationBinding: {
        scope: "EPHEMERAL_ENVIRONMENT",
        id: canonicalAiStorySceneIdV1(STORY, sceneId, 0),
        storyId: STORY,
        sceneId,
        displayName: "Studio",
        environmentDescription: "Studio environment",
        visualIdentityRequirement: "NONE",
      },
      locationState: { temporaryFacts: [] },
      castBindings: [{
        scope: "CAMPAIGN_CHARACTER",
        id: CHARACTER,
        campaignId: CAMPAIGN,
        authorityVersionId: CHARACTER_VERSION,
        authorityFingerprint: FINGERPRINT,
        visualIdentityRequirement: "PREFERRED",
      }],
      productBindings: [],
      entryState: [],
      events: script.scenes[0]!.entries,
      exitState: [],
      generationAuthority: MODE,
      continuityFacts: [],
      timeRelation: "UNSPECIFIED",
      discontinuity: null,
      mustKeep: [],
      mustAvoid: [],
      lineageOperation: "CREATE",
      parentSceneVersionIds: [],
      createdBy: ACTOR,
      createdAt: HISTORICAL_FROZEN_AT,
    }),
    status: "FROZEN" as const,
    approvedBy: ACTOR,
    approvedAt: HISTORICAL_FROZEN_AT,
    frozenAt: HISTORICAL_FROZEN_AT,
  };
  const payload = animationPackageFixture("ready_for_execution");
  payload.scenePlan[0]!.durationSec = 4;
  payload.shotPlan[0]!.durationSec = 4;
  payload.scenePlan[0]!.generationAuthority = MODE;
  return { outline, script, scene, payload };
}

describe("authority-preserving successor story version", () => {
  it("repairs generate_review without rewinding or repeating a covered binding", () => {
    expect(lateBindingSuccessorDecision({
      status: "generate_review",
      frozenAt: HISTORICAL_FROZEN_AT,
      bindingCreatedAt: BINDING_AT,
    })).toBe("PRESERVE_AUTHORITY");
    expect(lateBindingSuccessorDecision({
      status: "ready_for_execution",
      frozenAt: HISTORICAL_FROZEN_AT,
      bindingCreatedAt: BINDING_AT,
    })).toBe("PRESERVE_AUTHORITY");
    expect(lateBindingSuccessorDecision({
      status: "execution_failed",
      frozenAt: HISTORICAL_FROZEN_AT,
      bindingCreatedAt: BINDING_AT,
    })).toBe("PRESERVE_AUTHORITY");
    expect(lateBindingSuccessorDecision({
      status: "executing",
      frozenAt: HISTORICAL_FROZEN_AT,
      bindingCreatedAt: BINDING_AT,
    })).toBe("NONE");
    expect(lateBindingSuccessorDecision({
      status: "generate_review",
      frozenAt: SUCCESSOR_FROZEN_AT,
      bindingCreatedAt: BINDING_AT,
    })).toBe("IDEMPOTENT");
  });

  it("carries frozen scenes and an approved package onto the successor without mutating history", () => {
    const historical = authorityChain();
    const before = JSON.stringify(historical);
    const outline = reissueFrozenOutline(historical.outline, {
      successorStoryVersionId: SUCCESSOR,
      version: 2,
      actorUserId: ACTOR,
      frozenAt: SUCCESSOR_FROZEN_AT,
    });
    const script = reissueFrozenScript(historical.script, outline, {
      successorStoryVersionId: SUCCESSOR,
      version: 2,
      actorUserId: ACTOR,
      frozenAt: SUCCESSOR_FROZEN_AT,
    });
    const scenes = reissueFrozenCanonicalScenes({
      historicalScenes: [historical.scene],
      script,
      actorUserId: ACTOR,
      frozenAt: SUCCESSOR_FROZEN_AT,
    });
    const payload = rebuildSuccessorAnimationPackage({
      historicalPayload: historical.payload,
      storyId: STORY,
      successorStoryVersionId: SUCCESSOR,
      scenes,
    });
    expect(JSON.stringify(historical)).toBe(before);
    expect(historical.outline.storyVersionId).toBe(HISTORICAL);
    expect(historical.scene.sceneVersionId).not.toBe(scenes[0]!.sceneVersionId);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({
      status: "FROZEN",
      storyVersionId: SUCCESSOR,
      sceneId: canonicalAiStorySceneIdV1(STORY, SUCCESSOR, 0),
      order: 0,
    });
    expect(payload.status).toBe("ready_for_execution");
    expect(payload.scenePlan[0]!.durationSec).toBe(4);
    expect(payload.shotPlan[0]!.durationSec).toBe(4);
    expect(payload.storyBeats).toEqual(historical.payload.storyBeats);
    expect(payload.canonicalSceneAuthority?.sceneSetFingerprint).not.toBeUndefined();
    expect(() => assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({
      storyId: STORY,
      storyVersionId: SUCCESSOR,
      scenePlan: payload.scenePlan,
      canonicalScenes: scenes,
      authority: payload.canonicalSceneAuthority,
    })).not.toThrow();
    expect(payload.canonicalSceneAuthority?.scriptVersionId).toBe(script.scriptVersionId);
    expect(script.storyVersionId).toBe(SUCCESSOR);
    expect(outline.supersedesOutlineVersionId).toBe(historical.outline.outlineVersionId);
  });

  it("sees the exact Voice DNA pin at the successor cutoff and not at the historical cutoff", () => {
    const scenes = [
      { persistentCharacterIds: [CHARACTER], voiceCharacterIds: [CHARACTER] },
      { persistentCharacterIds: [CHARACTER], voiceCharacterIds: [CHARACTER] },
    ];
    const pinned = {
      orgId: ORG,
      workspaceId: WORKSPACE,
      campaignCharacterId: CHARACTER,
      reusableCharacterId: "44444444-4444-4444-8444-444444444444",
      reusableCharacterVersionId: "55555555-5555-4555-8555-555555555555",
      identityFingerprint: FINGERPRINT,
      voiceDnaId: VOICE,
      voiceDnaFingerprint: VOICE_FINGERPRINT,
      createdAt: BINDING_AT,
    };
    expect(bindingVisibleAtFrozenCutoff(BINDING_AT, HISTORICAL_FROZEN_AT)).toBe(false);
    expect(evaluateStoryVersionFreezeContinuity({
      orgId: ORG, workspaceId: WORKSPACE, freezeAt: HISTORICAL_FROZEN_AT, scenes, bindings: [pinned],
    }).reasonCode).toBe("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
    expect(bindingVisibleAtFrozenCutoff(BINDING_AT, SUCCESSOR_FROZEN_AT)).toBe(true);
    expect(SUCCESSOR_FROZEN_AT >= BINDING_AT).toBe(true);
    const repaired = evaluateStoryVersionFreezeContinuity({
      orgId: ORG, workspaceId: WORKSPACE, freezeAt: SUCCESSOR_FROZEN_AT, scenes, bindings: [pinned],
    });
    expect(repaired).toEqual({ status: "PASS", reasonCode: "PASS" });
    expect(repaired.reasonCode).not.toBe("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
    expect(repaired.reasonCode).not.toBe("VOICE_DNA_AUTHORITY_REQUIRED");
  });

  it("keeps Generate Review on the current version and does not change Sequential V3 release", () => {
    const review = readFileSync(resolve("packages/agents/src/ai-story/story-execution-orchestrator.ts"), "utf8");
    expect(review).toContain("storyVersionId: story.currentVersionId");
    expect(review).toContain("resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion");
    const sequential = readFileSync(resolve("packages/agents/src/ai-story/sequential-local-generation.ts"), "utf8");
    expect(sequential).toContain("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
    expect(sequential).toContain('decision.decision !== "APPROVED"');
    const repair = readFileSync(resolve("apps/web/src/lib/ai-story-service.ts"), "utf8");
    const successor = readFileSync(resolve("apps/web/src/lib/ai-story-successor-authority.ts"), "utf8");
    expect(repair).toContain("pg_advisory_xact_lock");
    expect(successor).toContain("late_character_authority_successor");
    expect(successor).not.toContain("CREATE TABLE");
  });
});
