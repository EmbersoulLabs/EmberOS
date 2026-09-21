import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADJUST_ENDING,
  ADJUST_PACING,
  AI_STORY_EPISODE_ACTION_CERTIFICATION,
  AI_STORY_EPISODE_COPY,
  AI_STORY_EPISODE_REVISION_AUTHORITY,
  AiStoryScriptVersionSchema,
  COST_ESTIMATE_IS_NOT_AUTHORIZATION,
  DIALOGUE_SMALLEST_SCOPE_INVALIDATION,
  EDIT_DIALOGUE,
  ENDING_REVISION_SCOPE_GATE,
  LIVE_COST_ESTIMATE,
  REFERENCE_REVISION_IMPACT_GATE,
  REGENERATE_APPROVED_MOMENT,
  REGENERATE_APPROVED_MOMENT_DENIED,
  REPLACE_REFERENCE,
  REVISION_COST_ESTIMATE,
  SCENE_INTERNAL_AUTHORITY_PRESERVED,
  SIBLING_GENERATION_UNIT_PRESERVATION,
  aiStoryEpisodeRevisionCapability,
  revisionActionEnabled,
} from "@ceo-agent/shared";
import {
  CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
  AiStoryEpisodeRevisionError,
  applyAiStoryDialogueRevision,
  buildAiStoryScriptVersion,
  certifiedSeedanceEpisodePricingRule,
  compileAiStoryCharacterDialoguePerformanceAuthority,
  estimateAiStoryEpisodeCost,
  estimateProviderCostUsd,
  planAiStoryEpisodeRevision,
  plannedEpisodeCostFromUnitCount,
  sha256CanonicalIntegrityHash,
  type PlanAiStoryEpisodeRevisionInput,
} from "@ceo-agent/shared/server";
import { buildAssemblyV2Fixture } from "./helpers/ai-story-assembly-v2-fixture";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const id = (n: number) => `b2000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const BEFORE = "这个看起来真的不错。";
const AFTER = "这个看起来蛮不错的。";
const PRODUCT = id(9);
const PRODUCT_ASSET = id(10);
const ORG = id(11);
const WORKSPACE = id(12);
const OUTLINE = id(13);
const BEAT = id(14);
const ACTOR = id(1006);
const CREATED_AT = "2026-09-21T14:00:00.000Z";

function hash(value: unknown) {
  return sha256CanonicalIntegrityHash(value);
}

function episodeFixture() {
  const assembly = buildAssemblyV2Fixture({
    sources: Array.from({ length: 6 }, (_, index) => ({
      path: `fixture://episode-revision/${index}.mp4`,
      hash: hash({ source: index }),
      durationMs: 8000,
      width: 480,
      height: 854,
      frameRate: 24,
    })),
    entries: [
      { sourceIndex: 0, role: "ESTABLISH", durationSeconds: 3 },
      { sourceIndex: 1, role: "ACTION", durationSeconds: 3 },
      { sourceIndex: 2, role: "DETAIL", durationSeconds: 3 },
      { sourceIndex: 3, role: "DISCOVERY", durationSeconds: 3 },
      { sourceIndex: 4, role: "REACTION", durationSeconds: 3 },
      { sourceIndex: 5, role: "CTA", durationSeconds: 3 },
    ],
    nativeAudioSourceIndexes: [3],
    profileId: "COMMERCIAL_STORY",
    outputWidth: 480,
    outputHeight: 854,
  });
  const productUnits = [assembly.units[2]!, assembly.units[3]!];
  for (const unit of productUnits) {
    unit.sourceAuthority.productAuthorityIds.push(PRODUCT);
    unit.sourceAuthority.productSourceAssetIds.push(PRODUCT_ASSET);
    unit.sourceAuthority.productContentHashes.push(hash({ PRODUCT_ASSET }));
    unit.inheritedContinuity.productAuthorityIds.push(PRODUCT);
  }
  const dialogueEntryId = assembly.units[3]!.nativeDialogueEntryIds![0]!;
  const characterId = assembly.units[3]!.sourceAuthority.characterIds[0]!;
  const locationId = assembly.units[3]!.sourceAuthority.locationId;
  const draft = buildAiStoryScriptVersion({
    storyId: assembly.editorialPlan.storyId,
    storyVersionId: assembly.editorialPlan.storyVersionId,
    outlineVersionId: OUTLINE,
    orgId: ORG,
    workspaceId: WORKSPACE,
    version: 1,
    profileId: "COMMERCIAL_STORY",
    profileVersion: 1,
    outlineSourceHash: hash("outline"),
    scenes: [
      {
        scriptSceneId: assembly.units[3]!.sceneId,
        order: 0,
        outlineBeatClaims: [{ outlineBeatId: BEAT, claim: "Host reacts to the food" }],
        sceneFunction: "INTRODUCE",
        sceneFunctionRegistryVersion: 1,
        sceneStateIn: [],
        sceneStateDeltas: [],
        sceneStateOut: [],
        entries: [
          {
            entryId: id(300),
            order: 0,
            durationRange: { minSeconds: 1, maxSeconds: 2 },
            type: "ACTION",
            subjectId: characterId,
            action: "The host looks at the packed food.",
            storyEffect: "Motivates the spoken line.",
          },
          {
            entryId: dialogueEntryId,
            order: 1,
            durationRange: { minSeconds: 2, maxSeconds: 5 },
            type: "DIALOGUE",
            speakerId: characterId,
            line: BEFORE,
            deliveryOrSubtext: "Friendly local discovery",
            language: "zh-MY",
          },
        ],
        characterIds: [characterId],
        locationIds: [locationId],
        propIds: [],
        assetIds: [],
        productAuthorityRefs: [PRODUCT],
        targetDurationRange: { minSeconds: 4, maxSeconds: 8 },
        mustKeep: ["Exact dialogue"],
        mustAvoid: ["Detached narration"],
        newInformation: ["The food looks appealing"],
        newEvidence: [],
        newActionOutcomes: ["Host speaks"],
        productEvidence: ["Packed food is visible"],
      },
    ],
    authorityReferences: [
      { authorityType: "CHARACTER", authorityId: characterId },
      { authorityType: "LOCATION", authorityId: locationId },
      { authorityType: "PRODUCT", authorityId: PRODUCT },
    ],
    supersedesScriptVersionId: null,
    createdBy: ACTOR,
    createdAt: "2026-09-21T09:00:00.000Z",
  });
  const script = AiStoryScriptVersionSchema.parse({
    ...draft,
    status: "FROZEN",
    approvedBy: ACTOR,
    approvedAt: "2026-09-21T09:01:00.000Z",
    frozenAt: "2026-09-21T09:02:00.000Z",
  });
  for (const unit of assembly.units) {
    unit.sourceAuthority.scriptVersionId = script.scriptVersionId;
  }
  const unit4 = assembly.units[3]!;
  const dialogueAuthority = compileAiStoryCharacterDialoguePerformanceAuthority({
    script,
    generationUnit: unit4,
    scriptSceneId: unit4.sceneId,
    dialogueEntryId,
    primaryLocale: "zh-MY",
    secondaryLocales: [],
    codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
    deliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
    performanceIntent: "Friendly spontaneous discovery",
    emotionIntent: "Pleasantly surprised",
    speechIntensity: "NATURAL",
    paceIntent: "NATURAL",
  });
  return {
    assembly,
    script,
    dialogueEntryId,
    dialogueAuthority,
    unit4,
    guIds: assembly.units.map((unit) => unit.generationUnitId),
  };
}

function planRevision(
  fixture: ReturnType<typeof episodeFixture>,
  rest: Pick<
    PlanAiStoryEpisodeRevisionInput,
    "revisionType" | "target" | "requestedChange" | "commercialAuthorizationStatus"
  > &
    Partial<PlanAiStoryEpisodeRevisionInput>
) {
  return planAiStoryEpisodeRevision({
    script: fixture.script,
    units: fixture.assembly.units,
    generationPlans: fixture.assembly.generationPlans,
    editorialPlan: fixture.assembly.editorialPlan,
    acceptedSourceMedia: fixture.assembly.acceptedSourceMedia,
    assemblyCompileInput: fixture.assembly.compileInput,
    acceptedGenerationUnitIds: fixture.guIds,
    createdBy: ACTOR,
    createdAt: CREATED_AT,
    nativeDialogueAuthorities: [fixture.dialogueAuthority],
    aspectRatio: "9:16",
    resolution: "480p",
    durationSecondsByUnitId: Object.fromEntries(
      fixture.assembly.units.map((unit) => [unit.generationUnitId, 8])
    ),
    ...rest,
  });
}

describe("AI Story Episode revision authority", () => {
  it("EPISODE_REVISION_REQUEST_SCHEMA and REVISION_FINGERPRINT", () => {
    const fixture = episodeFixture();
    const planned = planRevision(fixture, {
      revisionType: "EDIT_DIALOGUE",
      target: { kind: "DIALOGUE_ENTRY", entryId: fixture.dialogueEntryId },
      requestedChange: {
        kind: "DIALOGUE_TEXT",
        entryId: fixture.dialogueEntryId,
        previousText: BEFORE,
        nextText: AFTER,
      },
      commercialAuthorizationStatus: "REQUIRED",
    });
    expect(planned.revisionRequest.contractVersion).toBe(
      "ai-story-episode-revision-authority.v1"
    );
    expect(planned.revisionRequest.revisionType).toBe("EDIT_DIALOGUE");
    expect(planned.revisionRequest.revisionFingerprint.startsWith("sha256:")).toBe(true);
    expect(planned.revisionRequest.supersedesRevisionRequestId).toBeNull();
    expect(planned.revisionRequest.sourceVersion).toBe(1);
    expect(planned.revisionRequest.revisionVersion).toBe(2);
    expect(AI_STORY_EPISODE_REVISION_AUTHORITY).toBe("CERTIFIED");
    expect(EDIT_DIALOGUE).toBe("CERTIFIED");
  });

  it("MANDATORY TEST 1 — DIALOGUE_DEPENDENCY_INVALIDATION and SCRIPT_REVISION_VERSIONING", () => {
    const fixture = episodeFixture();
    const originalLine = fixture.script.scenes[0]!.entries.find(
      (entry) => entry.entryId === fixture.dialogueEntryId
    );
    const planned = planRevision(fixture, {
      revisionType: "EDIT_DIALOGUE",
      target: { kind: "DIALOGUE_ENTRY", entryId: fixture.dialogueEntryId },
      requestedChange: {
        kind: "DIALOGUE_TEXT",
        entryId: fixture.dialogueEntryId,
        previousText: BEFORE,
        nextText: AFTER,
      },
      commercialAuthorizationStatus: "REQUIRED",
    });
    expect(originalLine).toMatchObject({ type: "DIALOGUE", line: BEFORE });
    expect(planned.previousScript.scriptVersionId).toBe(fixture.script.scriptVersionId);
    expect(planned.previousScript.scenes[0]!.entries.find((entry) => entry.type === "DIALOGUE")?.line).toBe(BEFORE);
    expect(planned.nextScript?.scriptVersionId).not.toBe(fixture.script.scriptVersionId);
    expect(planned.nextScript?.supersedesScriptVersionId).toBe(fixture.script.scriptVersionId);
    expect(planned.nextScript?.version).toBe(2);
    expect(planned.nextScript?.scenes[0]!.entries.find((entry) => entry.type === "DIALOGUE")?.line).toBe(AFTER);
    expect(planned.impact.impactedGenerationUnitIds).toEqual([fixture.unit4.generationUnitId]);
    expect(planned.impact.preservedGenerationUnitIds).toEqual(
      fixture.guIds.filter((id) => id !== fixture.unit4.generationUnitId)
    );
    expect(planned.impact.preservedGenerationUnitIds).toHaveLength(5);
    expect(planned.providerCalls).toBe(0);
    expect(planned.revisionCostEstimate?.unitBreakdown).toHaveLength(1);
    expect(planned.revisionCostEstimate?.unitBreakdown[0]?.generationUnitId).toBe(
      fixture.unit4.generationUnitId
    );
    expect(planned.liveEpisodeCostEstimate.unitBreakdown).toHaveLength(6);
    expect(Number(planned.revisionCostEstimate!.estimatedExpected)).toBeLessThan(
      Number(planned.liveEpisodeCostEstimate.estimatedExpected)
    );
    expect(planned.executionPlan.commercialAuthorizationStatus).toBe("REQUIRED");
    expect(planned.costEstimateAuthorizesSpend).toBe(false);
    expect(planned.revisionCostEstimate?.authorizesSpend).toBe(false);
    expect(planned.nextNativeDialogueAuthority?.exactText).toBe(AFTER);
    expect(planned.nextNativeDialogueAuthority?.dialogueFingerprint).not.toBe(
      planned.previousNativeDialogueAuthority?.dialogueFingerprint
    );
    expect(DIALOGUE_SMALLEST_SCOPE_INVALIDATION).toBe("CERTIFIED");
    expect(SIBLING_GENERATION_UNIT_PRESERVATION).toBe("CERTIFIED");
  });

  it("does not mutate the historical Script object and blocks in-place edits", () => {
    const fixture = episodeFixture();
    const snapshot = JSON.stringify(fixture.script);
    applyAiStoryDialogueRevision({
      script: fixture.script,
      entryId: fixture.dialogueEntryId,
      nextText: AFTER,
      createdBy: ACTOR,
      createdAt: CREATED_AT,
    });
    expect(JSON.stringify(fixture.script)).toBe(snapshot);
    expect(
      fixture.script.scenes[0]!.entries.find((entry) => entry.type === "DIALOGUE")?.line
    ).toBe(BEFORE);
  });

  it("rebuilds Editorial and Assembly after simulated authorized dialogue result", () => {
    const fixture = episodeFixture();
    const before = fixture.assembly.compile();
    const planned = planRevision(fixture, {
      revisionType: "EDIT_DIALOGUE",
      target: { kind: "DIALOGUE_ENTRY", entryId: fixture.dialogueEntryId },
      requestedChange: {
        kind: "DIALOGUE_TEXT",
        entryId: fixture.dialogueEntryId,
        previousText: BEFORE,
        nextText: AFTER,
      },
      commercialAuthorizationStatus: "AUTHORIZED",
      retryAuthorizationIds: [id(99)],
      simulateAuthorizedResult: true,
    });
    expect(planned.nextEditorialPlan.editorialPlanId).not.toBe(
      fixture.assembly.editorialPlan.editorialPlanId
    );
    expect(planned.nextEditorialPlan.supersedesEditorialPlanId).toBe(
      fixture.assembly.editorialPlan.editorialPlanId
    );
    expect(planned.assemblyPlan.assemblyFingerprint).not.toBe(before.assemblyFingerprint);
    const revisedSource = planned.assemblyPlan.resolvedTimeline.find(
      (entry) => entry.generationUnitId === fixture.unit4.generationUnitId
    );
    const originalSource = fixture.assembly.acceptedSourceMedia.find(
      (media) => media.generationUnitId === fixture.unit4.generationUnitId
    );
    expect(revisedSource?.sourceResultId).not.toBe(originalSource?.sourceResultId);
    const sibling = planned.assemblyPlan.resolvedTimeline.find(
      (entry) => entry.generationUnitId === fixture.guIds[0]
    );
    expect(sibling?.sourceResultId).toBe(
      fixture.assembly.acceptedSourceMedia[0]!.sourceResultId
    );
    expect(planned.providerCalls).toBe(0);
    expect(planned.userStatus).toBe("Ready for review");
  });

  it("MANDATORY TEST 2 — PACING_EDITORIAL_ONLY_REVISION is Provider-free", () => {
    const fixture = episodeFixture();
    const before = fixture.assembly.compile();
    const planned = planRevision(fixture, {
      revisionType: "ADJUST_PACING",
      target: { kind: "EPISODE_PACING" },
      requestedChange: {
        kind: "EPISODE_PACING",
        previousPacing: "NATURAL",
        nextPacing: "FAST",
      },
      commercialAuthorizationStatus: "NOT_REQUIRED",
    });
    expect(planned.providerCalls).toBe(0);
    expect(planned.impact.requiresProviderExecution).toBe(false);
    expect(planned.impact.preservedGenerationUnitIds).toEqual(fixture.guIds);
    expect(planned.impact.impactedGenerationUnitIds).toEqual([]);
    expect(planned.nextEditorialPlan.version).toBe(fixture.assembly.editorialPlan.version + 1);
    const beforeMax = fixture.assembly.editorialPlan.timeline[4]!.targetDurationRange.maxSeconds;
    const afterMax = planned.nextEditorialPlan.timeline[4]!.targetDurationRange.maxSeconds;
    expect(afterMax).toBeLessThan(beforeMax);
    expect(planned.assemblyPlan.expectedOutputDurationMs).toBeLessThan(
      before.expectedOutputDurationMs
    );
    expect(ADJUST_PACING).toBe("CERTIFIED");
  });

  it("MANDATORY TEST 3 — ENDING_REVISION_SCOPE preserves early Units", () => {
    const fixture = episodeFixture();
    const planned = planRevision(fixture, {
      revisionType: "ADJUST_ENDING",
      target: { kind: "ENDING" },
      requestedChange: {
        kind: "ENDING_INTENT",
        previousIntent: "brand-focused ending",
        nextIntent: "stronger CTA",
      },
      commercialAuthorizationStatus: "REQUIRED",
    });
    expect(planned.impact.endingScopeGate).toBe("PASS");
    expect(planned.impact.impactedGenerationUnitIds).toEqual([
      fixture.assembly.units[5]!.generationUnitId,
    ]);
    expect(planned.impact.preservedGenerationUnitIds).toEqual(
      fixture.guIds.slice(0, 5)
    );
    expect(planned.nextEditorialPlan.storyPacingIntent.notes.join(" ")).toContain(
      "stronger CTA"
    );
    expect(ADJUST_ENDING).toBe("CERTIFIED");
  });

  it("ENDING_REVISION_SCOPE_GATE blocks rewriting the entire Episode", () => {
    const fixture = episodeFixture();
    const poisoned = {
      ...fixture.assembly.editorialPlan,
      timeline: fixture.assembly.editorialPlan.timeline.map((entry) => ({
        ...entry,
        editorialRole: "CTA" as const,
      })),
    };
    expect(() =>
      planAiStoryEpisodeRevision({
        revisionType: "ADJUST_ENDING",
        target: { kind: "ENDING" },
        requestedChange: {
          kind: "ENDING_INTENT",
          previousIntent: "brand-focused ending",
          nextIntent: "stronger CTA",
        },
        script: fixture.script,
        units: fixture.assembly.units,
        generationPlans: fixture.assembly.generationPlans,
        editorialPlan: poisoned,
        acceptedSourceMedia: fixture.assembly.acceptedSourceMedia,
        assemblyCompileInput: fixture.assembly.compileInput,
        acceptedGenerationUnitIds: fixture.guIds,
        createdBy: ACTOR,
        createdAt: CREATED_AT,
        commercialAuthorizationStatus: "REQUIRED",
      })
    ).toThrowError(AiStoryEpisodeRevisionError);
    try {
      planAiStoryEpisodeRevision({
        revisionType: "ADJUST_ENDING",
        target: { kind: "ENDING" },
        requestedChange: {
          kind: "ENDING_INTENT",
          previousIntent: "brand-focused ending",
          nextIntent: "stronger CTA",
        },
        script: fixture.script,
        units: fixture.assembly.units,
        generationPlans: fixture.assembly.generationPlans,
        editorialPlan: poisoned,
        acceptedSourceMedia: fixture.assembly.acceptedSourceMedia,
        assemblyCompileInput: fixture.assembly.compileInput,
        acceptedGenerationUnitIds: fixture.guIds,
        createdBy: ACTOR,
        createdAt: CREATED_AT,
        commercialAuthorizationStatus: "REQUIRED",
      });
    } catch (error) {
      expect((error as AiStoryEpisodeRevisionError).code).toBe(ENDING_REVISION_SCOPE_GATE);
    }
  });

  it("MANDATORY TEST 4 — REFERENCE_REVISION_IMPACT invalidates only grounded Units", () => {
    const fixture = episodeFixture();
    const nextProduct = id(77);
    const planned = planRevision(fixture, {
      revisionType: "REPLACE_REFERENCE",
      target: { kind: "REFERENCE_BINDING", referenceKind: "PRODUCT", authorityId: PRODUCT },
      requestedChange: {
        kind: "REFERENCE_BINDING",
        referenceKind: "PRODUCT",
        previousAuthorityId: PRODUCT,
        nextAuthorityId: nextProduct,
        previousSourceAssetId: PRODUCT_ASSET,
        nextSourceAssetId: id(78),
      },
      commercialAuthorizationStatus: "REQUIRED",
    });
    expect(planned.impact.referenceImpactGate).toBe("PASS");
    expect(planned.impact.impactedGenerationUnitIds).toEqual([
      fixture.assembly.units[2]!.generationUnitId,
      fixture.assembly.units[3]!.generationUnitId,
    ]);
    expect(planned.impact.preservedGenerationUnitIds).toHaveLength(4);
    expect(planned.revisionCostEstimate?.unitBreakdown).toHaveLength(2);
    expect(planned.providerCalls).toBe(0);
    expect(planned.referenceBinding?.previousAuthorityId).toBe(PRODUCT);
    expect(planned.referenceBinding?.nextAuthorityId).toBe(nextProduct);
    expect(planned.referenceBinding?.supersedesId).toBeTruthy();
    expect(REPLACE_REFERENCE).toBe("CERTIFIED");
    expect(REFERENCE_REVISION_IMPACT_GATE).toBe("REFERENCE_REVISION_IMPACT_GATE");
  });

  it("MANDATORY TEST 5 — REGENERATE_APPROVED_MOMENT_AUTHORITY", () => {
    const fixture = episodeFixture();
    expect(() =>
      planRevision(fixture, {
        revisionType: "REGENERATE_MOMENT",
        target: { kind: "MOMENT", generationUnitId: fixture.unit4.generationUnitId },
        requestedChange: {
          kind: "REGENERATE_MOMENT",
          generationUnitId: fixture.unit4.generationUnitId,
        },
        commercialAuthorizationStatus: "REQUIRED",
        paidProviderCallOccurredByUnitId: { [fixture.unit4.generationUnitId]: true },
      })
    ).toThrowError(/Approved material cannot regenerate/);
    try {
      planRevision(fixture, {
        revisionType: "REGENERATE_MOMENT",
        target: { kind: "MOMENT", generationUnitId: fixture.unit4.generationUnitId },
        requestedChange: {
          kind: "REGENERATE_MOMENT",
          generationUnitId: fixture.unit4.generationUnitId,
        },
        commercialAuthorizationStatus: "REQUIRED",
        paidProviderCallOccurredByUnitId: { [fixture.unit4.generationUnitId]: true },
      });
    } catch (error) {
      expect((error as AiStoryEpisodeRevisionError).code).toBe(
        REGENERATE_APPROVED_MOMENT_DENIED
      );
    }
    const authorized = planRevision(fixture, {
      revisionType: "REGENERATE_MOMENT",
      target: { kind: "MOMENT", generationUnitId: fixture.unit4.generationUnitId },
      requestedChange: {
        kind: "REGENERATE_MOMENT",
        generationUnitId: fixture.unit4.generationUnitId,
      },
      commercialAuthorizationStatus: "AUTHORIZED",
      retryAuthorizationIds: [id(99)],
      paidProviderCallOccurredByUnitId: { [fixture.unit4.generationUnitId]: true },
    });
    expect(authorized.impact.impactedGenerationUnitIds).toEqual([
      fixture.unit4.generationUnitId,
    ]);
    expect(authorized.impact.preservedGenerationUnitIds).toHaveLength(5);
    expect(REGENERATE_APPROVED_MOMENT).toBe(
      "CERTIFIED_WITH_EXISTING_COMMERCIAL_RETRY_AUTHORITY"
    );
  });

  it("MANDATORY TEST 6 — PARTIAL_FAILURE_BOUNDED_RETRY preserves siblings", () => {
    const fixture = episodeFixture();
    const failed = fixture.guIds[5]!;
    const planned = planRevision(fixture, {
      revisionType: "REGENERATE_MOMENT",
      target: { kind: "MOMENT", generationUnitId: failed },
      requestedChange: { kind: "REGENERATE_MOMENT", generationUnitId: failed },
      commercialAuthorizationStatus: "AUTHORIZED",
      retryAuthorizationIds: [id(88)],
      acceptedGenerationUnitIds: fixture.guIds.slice(0, 5),
      failedGenerationUnitIds: [failed],
      paidProviderCallOccurredByUnitId: { [failed]: true },
    });
    expect(planned.impact.impactedGenerationUnitIds).toEqual([failed]);
    expect(planned.impact.preservedGenerationUnitIds).toEqual(fixture.guIds.slice(0, 5));
    expect(planned.providerCalls).toBe(0);
  });

  it("LIVE_COST_ESTIMATE and REVISION_COST_ESTIMATE derive from certified Provider rate", () => {
    const fixture = episodeFixture();
    const rule8 = certifiedSeedanceEpisodePricingRule({
      durationSeconds: 8,
      aspectRatio: "9:16",
      resolution: "480p",
      createdBy: ACTOR,
    });
    const oneUnit = estimateProviderCostUsd(rule8);
    const live = plannedEpisodeCostFromUnitCount({
      unitCount: 6,
      durationSeconds: 8,
      aspectRatio: "9:16",
      resolution: "480p",
      nativeAudio: true,
      createdBy: ACTOR,
      generatedAt: CREATED_AT,
    });
    expect(live.pricingVersion).toBe(CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION);
    expect(live.unitBreakdown).toHaveLength(6);
    expect(live.estimatedExpected).toBe(
      (Number(oneUnit) * 6).toFixed(2)
    );
    expect(live.authorizesSpend).toBe(false);
    expect(live.estimatedExpected).not.toBe("3.20");
    expect(`${live.estimatedMin}–${live.estimatedMax}`).not.toBe("3.20–3.80");
    const shorter = estimateAiStoryEpisodeCost({
      units: fixture.assembly.units,
      durationSecondsByUnitId: Object.fromEntries(
        fixture.assembly.units.map((unit) => [unit.generationUnitId, 4])
      ),
      aspectRatio: "9:16",
      resolution: "480p",
      createdBy: ACTOR,
      generatedAt: CREATED_AT,
    });
    expect(shorter.estimatedExpected).not.toBe(live.estimatedExpected);
    expect(rule8.usdPerMillionTokens).toBe(
      CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION
    );
    expect(LIVE_COST_ESTIMATE).toBe("CERTIFIED");
    expect(REVISION_COST_ESTIMATE).toBe("CERTIFIED");
    expect(COST_ESTIMATE_IS_NOT_AUTHORIZATION).toBe("CERTIFIED");
  });

  it("pre-dispatch recovery does not require paid retry authorization", () => {
    const fixture = episodeFixture();
    const planned = planRevision(fixture, {
      revisionType: "REGENERATE_MOMENT",
      target: { kind: "MOMENT", generationUnitId: fixture.unit4.generationUnitId },
      requestedChange: {
        kind: "REGENERATE_MOMENT",
        generationUnitId: fixture.unit4.generationUnitId,
      },
      commercialAuthorizationStatus: "REQUIRED",
      acceptedGenerationUnitIds: fixture.guIds.filter(
        (id) => id !== fixture.unit4.generationUnitId
      ),
      paidProviderCallOccurredByUnitId: { [fixture.unit4.generationUnitId]: false },
    });
    expect(planned.impact.impactedGenerationUnitIds).toEqual([
      fixture.unit4.generationUnitId,
    ]);
    expect(planned.providerCalls).toBe(0);
  });

  it("LEGACY_COMPATIBILITY resolves Scene/Shot identities without Episode-first history", () => {
    const fixture = episodeFixture();
    const planned = planRevision(fixture, {
      revisionType: "REGENERATE_MOMENT",
      target: {
        kind: "MOMENT",
        sceneId: fixture.unit4.sceneId,
        directorShotId: fixture.unit4.directorShotId,
      },
      requestedChange: {
        kind: "REGENERATE_MOMENT",
        generationUnitId: fixture.unit4.generationUnitId,
      },
      commercialAuthorizationStatus: "AUTHORIZED",
      retryAuthorizationIds: [id(99)],
    });
    expect(planned.impact.impactedGenerationUnitIds).toEqual([
      fixture.unit4.generationUnitId,
    ]);
    expect(SCENE_INTERNAL_AUTHORITY_PRESERVED).toBe(true);
  });

  it("SUPER_ADMIN_DIAGNOSTICS expose impact without being user-facing status", () => {
    const fixture = episodeFixture();
    const planned = planRevision(fixture, {
      revisionType: "EDIT_DIALOGUE",
      target: { kind: "DIALOGUE_ENTRY", entryId: fixture.dialogueEntryId },
      requestedChange: {
        kind: "DIALOGUE_TEXT",
        entryId: fixture.dialogueEntryId,
        previousText: BEFORE,
        nextText: AFTER,
      },
      commercialAuthorizationStatus: "REQUIRED",
    });
    expect(planned.userStatus).toBe("Cost confirmation required");
    expect(planned.historyEntry.summary).toBe("Dialogue updated");
    expect(planned.superAdminDiagnostics.invalidatedAuthorities.generationUnitIds).toEqual([
      fixture.unit4.generationUnitId,
    ]);
    expect(planned.superAdminDiagnostics.newFingerprints.script).toBe(
      planned.nextScript?.sourceHash
    );
    const preview = read("apps/web/src/components/ai-story/EpisodePreviewPanel.tsx");
    expect(preview).not.toContain("revisionFingerprint");
    const debug = read("apps/web/src/components/ai-story/EpisodeDebugPanel.tsx");
    expect(debug).toContain("revisionRequest");
  });

  it("EPISODE_FIRST_UI_INTEGRATION enables actions only through revision backend", () => {
    expect(revisionActionEnabled("EDIT_DIALOGUE")).toBe(true);
    expect(aiStoryEpisodeRevisionCapability().costEstimateAvailable).toBe(true);
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.editDialogue).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.adjustEnding).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.adjustPacing).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.replaceReference).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.costEstimate).toBe("CERTIFIED");
    expect(AI_STORY_EPISODE_ACTION_CERTIFICATION.costEstimateIsAuthorization).toBe(false);
    const preview = read("apps/web/src/components/ai-story/EpisodePreviewPanel.tsx");
    expect(preview).toContain("onEditDialogue");
    expect(preview).toContain("onAdjustEnding");
    expect(preview).toContain("onAdjustPacing");
    expect(preview).toContain("onReplaceReference");
    expect(preview).toContain("episode-revisions");
    expect(preview).not.toContain("episode-edit-dialogue-gap");
    const create = read("apps/web/src/components/ai-story/EpisodeCreateForm.tsx");
    expect(create).toContain("episode-cost-estimate");
    expect(create).toContain("/episode-cost-estimates");
    expect(create).not.toContain("episode-cost-estimate-gap");
    expect(create).not.toContain("3.20");
    const route = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/episode-revisions/route.ts"
    );
    expect(route).toContain("planAiStoryEpisodeRevision");
    expect(route).not.toMatch(/fetch\(|seedance|generate_audio/i);
    expect(AI_STORY_EPISODE_COPY.costConfirmationRequired).toContain(
      "not spend authorization"
    );
  });

  it("ordinary tests never hardcode the Tapao Jom spend range as live estimate", () => {
    const engine = read(
      "packages/shared/src/ai-story-episode-revision-authority.server.ts"
    );
    expect(engine).not.toContain("3.20");
    expect(engine).not.toContain("3.80");
    expect(engine).toContain("estimateProviderCostUsd");
    expect(engine).not.toMatch(/https?:\/\/ark\./);
  });
});
