import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AiStoryPostGenerationQcService,
  FakeAiStoryVisualEvidenceProvider,
  InMemoryAiStoryPostGenerationQcRepository,
} from "../packages/agents/src/ai-story/post-generation-qc-service";
import {
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_POST_QC_POLICY_VERSION,
  AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES,
  CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS,
  AiStoryEpisodeCharacterBindingSchema,
  AiStoryPostGenerationQcEvaluationSchema,
  assertReferencePackAnchorRole,
  createVisualStyleAuthority,
  localGenerationDurationSecFromPlannedDurationMs,
  plannedDurationMatchesRecommendedDuration,
  postQcAllowsHumanApproval,
  resolveCharacterReferencePackAnchor,
  resolvePinnedVoiceDna,
  resolveVisualDirection,
  type AiStoryPostQcRequirement,
  type RecommendedDurationResolveInput,
} from "@ceo-agent/shared";
import {
  buildAiStoryCharacterVoiceDna,
  buildAiStoryRecommendedDurationAuthority,
  buildAiStoryReusableCharacterVersion,
  buildCampaignProjectionFromReusableCharacter,
  buildEpisodeCharacterBinding,
  compileAiStoryAudioQcExpectation,
  evaluateAiStoryAudioQc,
  type VoiceDnaBuildInput,
} from "@ceo-agent/shared/server";

const id = (n: number) => `82000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (seed: string) => `sha256:${Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64)}`;
const NOW = "2026-10-06T00:00:00.000Z";

function voice(overrides: Partial<VoiceDnaBuildInput> = {}): VoiceDnaBuildInput {
  return {
    status: "FROZEN",
    orgId: id(1),
    workspaceId: id(2),
    reusableCharacterId: id(4),
    reusableCharacterVersionId: id(5),
    characterIdentityFingerprint: hash("identity"),
    primaryLocale: "zh-MY",
    allowedSecondaryLocales: ["en-MY"],
    codeSwitchPolicy: { mode: "SCRIPT_AUTHORIZED", allowedLocales: ["zh-MY", "en-MY"] },
    voicePresentation: { genderPresentation: "FEMININE", ageRangePresentation: "YOUNG_ADULT" },
    acousticProfile: {
      register: "MID",
      pitchIntent: "MEDIUM",
      resonance: "WARM",
      brightness: "BRIGHT",
      breathiness: "NATURAL",
      texture: "natural conversational texture",
    },
    speechProfile: {
      cadence: "natural Malaysian Mandarin cadence",
      defaultPace: "NATURAL",
      pauseStyle: "NATURAL",
      emphasisStyle: "EXPRESSIVE",
      articulation: "CLEAR",
      energy: "NATURAL",
    },
    accentProfile: {
      locale: "zh-MY",
      regionalIntent: "Malaysian Mandarin",
      prohibitedStylizations: ["announcer voice"],
    },
    defaultDeliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
    mustPreserve: ["Malaysian Mandarin cadence"],
    mustAvoid: ["announcer voice"],
    consistencyMode: "DESCRIPTIVE_VOICE_DNA",
    ...overrides,
  };
}

function character() {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: id(4),
    orgId: id(1),
    workspaceId: id(2),
    name: "Host",
    identityCore: {
      identityDescription: "A synthetic host.",
      faceIdentityDescription: "Oval face and dark eyes.",
      bodyIdentityDescription: "Average adult proportions.",
      distinctiveVisualFacts: ["small beauty mark"],
      mustPreserve: ["face identity"],
      mustNeverChange: ["canonical face identity"],
    },
    defaultLook: {
      wardrobe: "white outfit",
      makeup: null,
      accessories: null,
      hairstyle: null,
      hairColor: null,
    },
    mutableLookPolicy: {
      wardrobeAllowed: true,
      makeupAllowed: true,
      accessoriesAllowed: true,
      hairstyleAllowed: true,
      hairColorAllowed: false,
    },
    canonicalAssets: [{
      assetId: id(10),
      contentHash: hash("master"),
      role: "IDENTITY_MASTER",
      source: "USER_APPROVED",
    }],
    status: "ACTIVE",
    version: 1,
    supersedesReusableCharacterVersionId: null,
    createdBy: id(30),
    createdAt: NOW,
  });
}

function durationInput(): RecommendedDurationResolveInput {
  return {
    organizationId: id(1),
    workspaceId: id(2),
    campaignId: id(11),
    storyId: id(3),
    storyVersionId: id(12),
    animationPackageId: id(13),
    sceneId: id(14),
    planningSceneId: "scene-001",
    sceneOrder: 0,
    generationStrategy: "TEXT_TO_VIDEO",
    sceneProposedDurationSec: 6,
    shots: [
      { shotId: "shot-a", planningSceneId: "scene-001", durationSec: 3 },
      { shotId: "shot-b", planningSceneId: "scene-001", durationSec: 4 },
    ],
  };
}

describe("certified AI Story integration", () => {
  it("keeps Character Reference Pack and Voice DNA on one Character", () => {
    const page = readFileSync(resolve("apps/web/src/app/w/[slug]/characters/[characterId]/page.tsx"), "utf8");
    expect(page).toContain("Voice Identity");
    expect(page).toContain("CharacterReferencePackPanel");
    expect(page).toContain("CharacterDnaWizard");
    expect(page).toContain("CharacterVirtualizerWizard");
    const version = character();
    const dna = buildAiStoryCharacterVoiceDna(voice({
      reusableCharacterVersionId: version.reusableCharacterVersionId,
      characterIdentityFingerprint: version.identityFingerprint,
    }));
    const anchor = resolveCharacterReferencePackAnchor(version);
    expect(anchor.ok).toBe(true);
    if (!anchor.ok) return;
    expect(anchor.anchor.semanticRole).toBe("IDENTITY_MASTER");
    expect(() => assertReferencePackAnchorRole("CHARACTER_SOURCE_PORTRAIT")).toThrow();
    expect(CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS).toEqual(expect.arrayContaining(["ANCHOR", "FACE_FRONT", "PROFILE_90", "FULL_BODY_BACK"]));
    expect(AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES).toEqual(expect.arrayContaining(["FULL_BODY_BACK", "DETAIL_REFERENCE"]));
    expect(dna.reusableCharacterVersionId).toBe(version.reusableCharacterVersionId);
    expect(dna.characterIdentityFingerprint).toBe(version.identityFingerprint);
  });

  it("pins Voice DNA beside visual Character identity on an Episode binding", () => {
    const version = character();
    const pinned = buildAiStoryCharacterVoiceDna(voice({
      reusableCharacterVersionId: version.reusableCharacterVersionId,
      characterIdentityFingerprint: version.identityFingerprint,
    }));
    const later = buildAiStoryCharacterVoiceDna(voice({
      reusableCharacterVersionId: version.reusableCharacterVersionId,
      characterIdentityFingerprint: version.identityFingerprint,
      acousticProfile: { ...voice().acousticProfile, texture: "later texture" },
    }));
    const projection = buildCampaignProjectionFromReusableCharacter({
      reusable: version,
      campaignId: id(40),
      campaignCharacterId: id(41),
      createdBy: id(30),
      createdAt: NOW,
    });
    const bound = buildEpisodeCharacterBinding({
      storyId: id(42),
      reusable: version,
      projection: projection.projection,
      voiceDna: pinned,
      createdBy: id(30),
      createdAt: NOW,
    });
    const parsed = AiStoryEpisodeCharacterBindingSchema.parse(bound);
    expect(parsed.identityFingerprint).toBe(version.identityFingerprint);
    expect(parsed.reusableCharacterVersionId).toBe(version.reusableCharacterVersionId);
    expect(parsed.voiceDnaId).toBe(pinned.voiceDnaId);
    expect(resolvePinnedVoiceDna(parsed, [later, pinned])?.voiceDnaId).toBe(pinned.voiceDnaId);
    const historical = buildEpisodeCharacterBinding({
      storyId: id(43),
      reusable: version,
      projection: projection.projection,
      createdBy: id(30),
      createdAt: NOW,
    });
    expect(AiStoryEpisodeCharacterBindingSchema.parse(historical).voiceDnaId).toBeUndefined();
  });

  it("shows Recommended Duration and Visual Style on the same Story review", () => {
    const page = readFileSync(resolve("apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx"), "utf8");
    expect(page).toContain("VisualStyleAuthorityPreview");
    expect(page).toContain("ExecutionPlanReviewPanel");
    expect(page).toContain("recommendedDurationSec");
    const authority = buildAiStoryRecommendedDurationAuthority(durationInput());
    expect(authority.decision.plannedDurationMs).toBe(authority.decision.recommendedDurationSec * 1000);
    expect(plannedDurationMatchesRecommendedDuration(authority, authority.decision.plannedDurationMs)).toBe(true);
    expect(localGenerationDurationSecFromPlannedDurationMs(authority.decision.plannedDurationMs)).toBe(authority.decision.recommendedDurationSec);
    const style = createVisualStyleAuthority({
      authorityId: id(50),
      workspaceId: id(2),
      presetId: "brand-minimal",
    });
    const direction = resolveVisualDirection({
      character: ["keep the canonical face"],
      product: ["keep the canonical product shape"],
      brand: ["keep the canonical brand mark"],
    }, style);
    expect(direction.precedence).toEqual(["character", "product", "brand", "visual_style"]);
    expect(direction.identityConstraints.map((item) => item.authority)).toEqual(["character", "product", "brand"]);
  });

  it("stores Audio QC on Post-QC for a manual local result without changing approval or historical reads", async () => {
    const expectation = compileAiStoryAudioQcExpectation({
      applicability: "REQUIRED",
      expectationKind: "SILENT_OUTPUT",
      orgId: id(1),
      workspaceId: id(2),
      storyId: id(3),
      storyVersionId: id(12),
      sceneExecutionId: id(5),
      speakerRole: "NONE",
    });
    const evidence = {
      orgId: id(1),
      workspaceId: id(2),
      storyId: id(3),
      storyVersionId: id(12),
      sceneExecutionId: id(5),
      mediaAssetId: id(9),
      generationResultId: id(10),
      providerAttemptId: null,
      mediaFacts: {
        hasVideoStream: true,
        hasAudioStream: true,
        videoDurationMs: 5000,
        audioDurationMs: 5000,
        audioCodec: "aac",
        sampleRate: 48000,
        channelCount: 2,
        decodable: true,
        mediaContentHash: hash("media"),
      },
      nativeDurationToleranceMs: null,
      executedDialogueAuthorityId: null,
      executedDialogueFingerprint: null,
      durableVoiceDna: null,
      semanticInstructionFingerprint: null,
      ttsRequest: null,
      ttsResult: null,
      finalMix: null,
      detachedTtsUsed: false,
      humanReview: null,
    };
    const audio = evaluateAiStoryAudioQc({ expectation, evidence, evaluatedAt: NOW });
    expect(audio.overallResult).toBe("FAIL");
    expect(audio.blockingFindings.map((item) => item.code)).toContain("UNEXPECTED_AUDIO_STREAM");
    expect(audio.providerAttemptId).toBeNull();
    const requirement: AiStoryPostQcRequirement = {
      requirementId: "scene-purpose",
      dimension: "SCENE_FIDELITY",
      summary: "The generated media communicates the required Scene purpose.",
      required: true,
      waiverPolicy: "WAIVABLE_BY_HUMAN",
      sourceOwner: "SCENE",
      visuallyObservable: true,
    };
    const input = {
      postQcInputId: id(70),
      contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
      policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
      orgId: id(1),
      workspaceId: id(2),
      campaignId: id(71),
      storyId: id(3),
      storyVersionId: id(12),
      planningLineageSource: "LEGACY_COMPILED_V1" as const,
      scriptVersionId: null,
      handoffId: null,
      sceneExecutionId: id(5),
      sceneId: "scene-1",
      sceneVersion: 1,
      sceneFingerprint: hash("scene"),
      sceneExecutionFingerprint: hash("execution"),
      providerAttemptId: null,
      generationResultId: id(10),
      sourceKind: "MANUAL_LOCAL" as const,
      generationMode: "TEXT_TO_VIDEO" as const,
      privateMediaAssetId: id(9),
      privateMediaContentHash: hash("media"),
      compiledRequestId: id(72),
      compiledRequestFingerprint: hash("compiled"),
      semanticPlanFingerprint: hash("plan"),
      preGenerationQcEvaluationId: id(73),
      preGenerationQcFingerprint: hash("pre"),
      handoffFingerprint: null,
      directorFingerprint: hash("director"),
      motionFingerprint: hash("motion"),
      shotRecipeFingerprint: null,
      castSnapshotFingerprint: hash("cast"),
      locationSnapshotFingerprint: hash("location"),
      productSnapshotFingerprint: hash("product"),
      entryState: ["A holds Product"],
      scriptActions: ["A gives Product to B"],
      requiredExitState: ["B holds Product"],
      mustKeep: ["canonical Product shape"],
      mustAvoid: ["unwanted text"],
      newAudienceInformation: ["Product benefit"],
      requiredEvidence: ["Product usage"],
      requirements: [requirement],
      providerMetadata: {},
      media: { durableObjectReference: `${id(2)}/ai-story/result.mp4`, mediaType: "video/mp4" as const, byteSize: 4096, durationMs: 5000, width: 1280, height: 720, readable: true, decodable: true },
      createdAt: NOW,
    };
    const service = new AiStoryPostGenerationQcService({
      repository: new InMemoryAiStoryPostGenerationQcRepository(),
      evidenceProvider: new FakeAiStoryVisualEvidenceProvider([]),
      now: () => NOW,
    });
    const historical = await service.evaluate(input);
    expect(historical.evaluation.audioQcResult).toBeUndefined();
    expect(AiStoryPostGenerationQcEvaluationSchema.parse(JSON.parse(JSON.stringify(historical.evaluation))).postQcEvaluationId).toBe(historical.evaluation.postQcEvaluationId);
    const withAudio = await service.evaluate({ ...input, postQcInputId: id(74) }, 1, null, { expectation, evidence });
    expect(withAudio.evaluation.audioQcResult?.overallResult).toBe("FAIL");
    expect(withAudio.evaluation.aggregateStatus).toBe(historical.evaluation.aggregateStatus);
    expect(withAudio.evaluation.autoRetryAuthorized).toBe(false);
    expect(postQcAllowsHumanApproval(withAudio.evaluation)).toBe(postQcAllowsHumanApproval(historical.evaluation));
  });

  it("keeps the Voice DNA migration and does not rewrite Sequential Local V3 SQL", () => {
    const voiceSql = readFileSync(resolve("packages/db/sql/ai-story-character-voice-dna-v1.sql"), "utf8");
    const sequentialSql = readFileSync(resolve("packages/db/sql/ai-story-sequential-manual-local-package-v3.sql"), "utf8");
    expect(voiceSql).toContain("ai_story_character_voice_dna_authorities");
    expect(sequentialSql).toContain("local-generation-package.v3");
    expect(sequentialSql).not.toContain("audio_qc");
  });
});
