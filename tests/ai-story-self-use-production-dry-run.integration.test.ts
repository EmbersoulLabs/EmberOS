/**
 * Isolated, zero-network three-Scene authority chain. The media/Provider side is
 * deliberately synthetic; this does not certify visual quality or release.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import type { AiStorySceneGenerationAuthority } from "@ceo-agent/shared";
import {
  AiStoryCanonicalSceneAuthorityService,
  AiStoryOutlineAuthorityService,
  AiStoryScriptAuthorityService,
  AiStorySceneExecutionPersistenceRepository,
  AiStoryPostGenerationQcRepository,
  BoundAiStoryPostGenerationQcRepository,
  DurableSceneMediaAttestationRepositoryImpl,
  AiStoryProviderRuntimeRepository,
  AiStorySceneReleaseRepository,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  RuntimeAuthorizationPersistenceRepository,
  GeneratedSceneReviewRepository,
  FinalStoryResultRepositoryImpl,
  canonicalPersistenceHash,
  closeDb,
  getDb,
  resolveCurrentFrozenCanonicalSceneSet,
} from "@ceo-agent/db";
import {
  buildAiStoryAnimationPackageCanonicalSceneAuthorityV1,
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  canonicalAiStorySceneIdV1,
  finalizeAiStoryCanonicalScene,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import { compileSceneExecutionIntents } from "../packages/agents/src/ai-story/scene-execution-compiler";
import { RuntimeAuthorizationService } from "../packages/agents/src/ai-story/runtime-authorization-service";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import { GeneratedSceneReviewService } from "../packages/agents/src/ai-story/generated-scene-review-service";
import {
  AiStoryPostGenerationQcService,
  FakeAiStoryVisualEvidenceProvider,
  buildAiStoryPostGenerationQcInputFromCompiledAuthority,
  postQcAllowsHumanApproval,
} from "../packages/agents/src/ai-story/post-generation-qc-service";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";
import {
  PR32_USER_A,
  FixedSeedanceRouter,
  cleanupPr32Tenant,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import { PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import {
  blockedExternalNetworkAttempts,
  installCertificationNetworkIsolation,
} from "./helpers/certification-network-isolation";
import { acceptCommercialAuthorizationFixture } from "./helpers/commercial-billable-execute";
import {
  createPhaseCAdapterRegistry,
  createPhaseCCoordinator,
  ffmpegAvailable,
  generateFixtureClip,
  persistDispatchFromScheduled,
} from "./helpers/ai-story-pr37-phase-c-e2e";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const id = (n: number) => `9e000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const SOURCE_HASH = `sha256:${"a".repeat(64)}`;
const PRODUCT_MATERIAL_CONTRACT = "ai-story-product-visual-material-selection.v1" as const;
const MODES: AiStorySceneGenerationAuthority[] = [
  { strategy: "TEXT_TO_VIDEO" as const, referenceSource: "REFERENCE_FREE_T2V" as const, referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" as const },
  { strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const, referenceSource: "SCENE_EXPLICIT" as const, referenceAssetIds: [PHASE_2A_IDS.assetId], firstFrameAssetId: PHASE_2A_IDS.assetId, productVisualIdentityRequirement: "REQUIRED" as const },
  { strategy: "PRODUCT_GROUNDED_VIDEO" as const, referenceSource: "SCENE_EXPLICIT" as const, referenceAssetIds: [PHASE_2A_IDS.assetId], firstFrameAssetId: PHASE_2A_IDS.assetId, productVisualIdentityRequirement: "REQUIRED" as const },
];

function sourceMaterialSelection(input: {
  orgId: string; workspaceId: string; campaignId: string; storyId: string;
  storyVersionId: string; sceneId: string; sceneVersionId: string;
  generationAuthority: { strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" | "PRODUCT_GROUNDED_VIDEO"; referenceSource: "SCENE_EXPLICIT" };
}) {
  const body = {
    contractVersion: PRODUCT_MATERIAL_CONTRACT,
    orgId: input.orgId, workspaceId: input.workspaceId,
    campaignId: input.campaignId, storyId: input.storyId,
    storyVersionId: input.storyVersionId, sceneId: input.sceneId,
    sceneVersionId: input.sceneVersionId,
    productAuthority: { productAuthorityId: PHASE_2A_IDS.assetId,
      sourceAssetId: PHASE_2A_IDS.assetId, sourceAssetContentHash: SOURCE_HASH },
    visualRequirement: { sceneRequirement: "REQUIRED" as const,
      effectiveGenerationRequirement: "REQUIRED" as const,
      strategy: input.generationAuthority.strategy,
      referenceSource: input.generationAuthority.referenceSource },
    suitability: { authorityFingerprint: SOURCE_HASH,
      outcome: "TRANSPARENT_BACKGROUND_CERTIFIED" as const },
    derivativeResolution: { contractVersion: "ai-story-exact-product-derivative-resolution.v1" as const,
      status: "NOT_FOUND" as const, reason: "NO_READY_EXTRACTION" as const },
    preparationCapability: { status: "NOT_CERTIFIED" as const },
    selection: "SOURCE_ASSET" as const,
    selectedMaterial: { kind: "SOURCE_ASSET" as const,
      assetId: PHASE_2A_IDS.assetId, contentHash: SOURCE_HASH },
    reason: "SOURCE_TRANSPARENCY_CERTIFIED" as const,
  };
  return { ...body, fingerprint: sha256CanonicalIntegrityHash({ kind: PRODUCT_MATERIAL_CONTRACT, authority: body }) };
}

describeIntegration("FROM BUD TO BLOOM isolated production authority dry run", () => {
  let sql: Sql;
  let restoreNetwork: () => void;
  let mediaRoot: string;
  let artifactRoot: string;

  beforeAll(async () => {
    restoreNetwork = installCertificationNetworkIsolation();
    sql = createIntegrationSql();
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, PHASE_2A_IDS, PR32_USER_A, "self-use-dry-run");
    await sql`update organizations set plan = 'agency' where id = ${PHASE_2A_IDS.orgId}::uuid`;
    await sql`update assets set content_hash = ${SOURCE_HASH} where id = ${PHASE_2A_IDS.assetId}::uuid`;
    if (!ffmpegAvailable()) throw new Error("FFMPEG_REQUIRED_FOR_THREE_SCENE_ASSEMBLY_CERTIFICATION");
    mediaRoot = await mkdtemp(join(tmpdir(), "ai-story-self-use-media-"));
    artifactRoot = await mkdtemp(join(tmpdir(), "ai-story-self-use-assembly-"));
  }, 60_000);

  afterAll(async () => {
    if (sql) {
      await sql.unsafe("alter table ai_story_post_generation_qc_evaluations disable trigger ai_story_post_qc_immutable_v1");
      try {
        await sql`delete from ai_story_post_generation_qc_evaluations where org_id = ${PHASE_2A_IDS.orgId}::uuid`;
      } finally {
        await sql.unsafe("alter table ai_story_post_generation_qc_evaluations enable trigger ai_story_post_qc_immutable_v1");
      }
      await sql`delete from ai_story_durable_scene_media_attestations where org_id = ${PHASE_2A_IDS.orgId}::uuid`;
      await sql`delete from ai_story_canonical_scene_versions where story_id = ${PHASE_2A_IDS.storyId}::uuid`;
      await sql`delete from ai_story_canonical_scenes where story_id = ${PHASE_2A_IDS.storyId}::uuid`;
      await sql`delete from ai_story_script_versions where story_id = ${PHASE_2A_IDS.storyId}::uuid`;
      await sql`delete from ai_story_outline_versions where story_id = ${PHASE_2A_IDS.storyId}::uuid`;
      await cleanupPr32Tenant(sql);
      await sql.end();
    }
    await closeDb();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
    if (artifactRoot) await rm(artifactRoot, { recursive: true, force: true });
    restoreNetwork?.();
  }, 60_000);

  it("connects frozen planning, exact mode/material, fake Provider, human review and Final Story Result", async () => {
    const ids = PHASE_2A_IDS;
    const scope = {
      orgId: ids.orgId,
      workspaceId: ids.workspaceId,
      campaignId: ids.campaignId,
      storyId: ids.storyId,
      storyVersionId: ids.storyVersionId,
      actorUserId: PR32_USER_A,
      requireCurrentFrozenStoryVersion: true as const,
    };
    const beats = [0, 1, 2].map((order) => ({
      id: id(20 + order), storyUnitId: id(10), order,
      classification: "MAJOR" as const,
      name: ["Bud", "Bloom", "Continuity"][order]!,
      purpose: "Advance the floral story", summary: "One exact floral subject advances.",
      required: true, ownershipPolicy: "EXCLUSIVE" as const, authorityReferences: [],
    }));
    const outline = buildAiStoryOutlineVersion({
      storyId: ids.storyId, storyVersionId: ids.storyVersionId,
      orgId: ids.orgId, workspaceId: ids.workspaceId, version: 1,
      profile: { profileId: "CORE", profileVersion: 1 },
      premise: "From Bud to Bloom", coreClaim: "One floral subject blooms across three Scenes.",
      storyUnits: [{ storyUnitId: id(10), order: 0, purpose: "Show the bloom", summary: "Bud, bloom, continuity.", requiredBeatIds: beats.map((beat) => beat.id) }],
      beats, hooks: [], setupPayoffs: [], requiredSceneOutcomes: [], authorityReferences: [],
      upstreamAuthorityId: ids.storyVersionId, supersedesOutlineVersionId: null,
      createdBy: PR32_USER_A, createdAt: "2026-09-18T00:00:00.000Z",
    });
    const outlines = new AiStoryOutlineAuthorityService();
    await outlines.propose(scope, outline);
    await outlines.validate(scope, outline.outlineVersionId);
    await outlines.approve(scope, outline.outlineVersionId);
    const frozenOutline = await outlines.freeze(scope, outline.outlineVersionId);
    const scriptScenes = beats.map((beat, order) => ({
      scriptSceneId: id(30 + order), order,
      outlineBeatClaims: [{ outlineBeatId: beat.id, claim: "Show one exact floral subject" }],
      sceneFunction: "DEMONSTRATE" as const, sceneFunctionRegistryVersion: 1 as const,
      sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [],
      entries: [{ entryId: id(40 + order), order: 0, type: "ACTION" as const,
        subjectId: ids.assetId, action: "The same floral subject progresses naturally.",
        storyEffect: "The bloom advances.", durationRange: { minSeconds: 4, maxSeconds: 4 } }],
      characterIds: [], locationIds: [], propIds: [],
      assetIds: order === 0 ? [] : [ids.assetId],
      productAuthorityRefs: order === 0 ? [] : [ids.assetId],
      targetDurationRange: { minSeconds: 4, maxSeconds: 4 },
      mustKeep: ["One floral subject"], mustAvoid: ["Unrelated Product substitution"],
      newInformation: [], newEvidence: [], newActionOutcomes: [], productEvidence: [],
    }));
    const script = buildAiStoryScriptVersion({
      storyId: ids.storyId, storyVersionId: ids.storyVersionId,
      outlineVersionId: outline.outlineVersionId,
      orgId: ids.orgId, workspaceId: ids.workspaceId, version: 1,
      profileId: "CORE", profileVersion: 1, outlineSourceHash: frozenOutline.sourceHash,
      semanticInputFingerprint: `sha256:${"b".repeat(64)}`,
      scenes: scriptScenes, authorityReferences: [
        { authorityType: "ASSET", authorityId: ids.assetId },
        { authorityType: "PRODUCT", authorityId: ids.assetId },
      ],
      supersedesScriptVersionId: null, createdBy: PR32_USER_A,
      createdAt: "2026-09-18T00:01:00.000Z",
    });
    const scripts = new AiStoryScriptAuthorityService();
    await scripts.propose(scope, script);
    await scripts.validate(scope, script.scriptVersionId);
    await scripts.approve(scope, script.scriptVersionId);
    await scripts.freeze(scope, script.scriptVersionId);
    expect(script.scenes[0]!.assetIds).toEqual([]);
    expect(script.scenes[0]!.productAuthorityRefs).toEqual([]);
    expect(script.scenes[1]!.assetIds).toEqual([ids.assetId]);
    expect(script.scenes[2]!.assetIds).toEqual([ids.assetId]);
    expect(script.scenes[1]!.productAuthorityRefs).toEqual([ids.assetId]);
    expect(script.scenes[2]!.productAuthorityRefs).toEqual([ids.assetId]);
    const scenes = scriptScenes.map((source, order) => {
      const sceneId = canonicalAiStorySceneIdV1(ids.storyId, ids.storyVersionId, order);
      return finalizeAiStoryCanonicalScene({
        sceneId, orgId: ids.orgId, workspaceId: ids.workspaceId,
        campaignId: ids.campaignId, storyId: ids.storyId,
        storyVersionId: ids.storyVersionId, scriptVersionId: script.scriptVersionId,
        version: 1, order,
        sourceScriptSceneIds: [source.scriptSceneId],
        sourceScriptEntryIds: [source.entries[0]!.entryId],
        sceneFunction: "DEMONSTRATE", sceneRole: "DEMONSTRATE", importance: "MAJOR",
        locationBinding: { scope: "EPHEMERAL_ENVIRONMENT", id: id(50 + order),
          storyId: ids.storyId, sceneId, displayName: "Studio garden",
          environmentDescription: "Quiet spring studio garden", visualIdentityRequirement: "NONE" },
        locationState: { temporaryFacts: [] }, castBindings: [],
        productBindings: order === 0 ? [] : [{ productAuthorityId: ids.assetId,
          sourceAssetId: ids.assetId, sourceAssetContentHash: SOURCE_HASH,
          visualIdentityRequirement: "REQUIRED" }],
        generationAuthority: MODES[order]!, entryState: [],
        events: source.entries, exitState: [], continuityFacts: [],
        timeRelation: "UNSPECIFIED", discontinuity: null,
        mustKeep: ["One floral subject"], mustAvoid: ["Unrelated Product substitution"],
        lineageOperation: "CREATE", parentSceneVersionIds: [],
        createdBy: PR32_USER_A, createdAt: `2026-09-18T00:0${order + 2}:00.000Z`,
      });
    });
    const sceneService = new AiStoryCanonicalSceneAuthorityService();
    await sceneService.proposeRevisionSet(scope, scenes);
    await sceneService.transitionSet(scope, "VALIDATED");
    await sceneService.transitionSet(scope, "APPROVED");
    await sceneService.transitionSet(scope, "FROZEN");
    const current = await resolveCurrentFrozenCanonicalSceneSet(getDb(), scope);
    expect(current).toHaveLength(3);
    expect(current!.map((scene) => scene.order)).toEqual([0, 1, 2]);
    expect(current!.map((scene) => scene.generationAuthority?.strategy)).toEqual(MODES.map((mode) => mode.strategy));
    const base = animationPackageFixture("ready_for_execution");
    const scenePlan = scenes.map((scene, order) => ({ ...base.scenePlan[0]!,
      id: `scene-${order + 1}`, order, durationSec: 4, generationAuthority: MODES[order]! }));
    const shotPlan = scenes.map((_, order) => ({ ...base.shotPlan[0]!,
      id: `shot-${order + 1}`, sceneId: `scene-${order + 1}`, order, durationSec: 4 }));
    const packagePayload = { ...base, scenePlan, shotPlan,
      canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
        storyId: ids.storyId, storyVersionId: ids.storyVersionId,
        scenePlan, canonicalScenes: current!,
      }) };
    await sql`update ai_story_animation_packages
      set payload = ${sql.json(JSON.parse(JSON.stringify(packagePayload)))}
      where id = ${ids.animationPackageId}::uuid`;
    const compiled = compileSceneExecutionIntents(packagePayload, {
      orgId: ids.orgId, workspaceId: ids.workspaceId, campaignId: ids.campaignId,
      storyId: ids.storyId, storyVersionId: ids.storyVersionId,
      storyVersionNumber: 1, storyVersionFrozenAt: "2026-09-18T00:00:00.000Z",
      animationPackageId: ids.animationPackageId,
      animationPackageStatus: "ready_for_execution", compiledAt: "2026-09-18T01:00:00.000Z",
    });
    const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation({
      plan: compiled.storyExecutionPlan, intents: compiled.intents,
      instructionsBySceneExecutionId: compiled.instructionsBySceneExecutionId,
      validationResults: compiled.intents.map((intent) => ({
        status: "passed" as const, intentId: intent.identity.sceneExecutionId,
        sceneId: intent.identity.sceneId, validatedAt: "2026-09-18T01:01:00.000Z",
        contractVersion: "1" as const, errors: [],
      })),
    });
    expect(persisted.plan.animationPackage.sceneSetFingerprint)
      .toBe(packagePayload.canonicalSceneAuthority.sceneSetFingerprint);
    expect(persisted.intents.map((intent) => intent.identity.sceneVersionId))
      .toEqual(current!.map((scene) => scene.sceneVersionId));
    expect(persisted.intents.map((intent) => intent.generationAuthority?.strategy))
      .toEqual(MODES.map((mode) => mode.strategy));
    expect(persisted.intents[0]!.referencedAssetIds).toEqual([]);
    expect(persisted.intents[1]!.referencedAssetIds).toEqual([ids.assetId]);
    expect(persisted.intents[2]!.referencedAssetIds).toEqual([ids.assetId]);

    const planId = persisted.plan.storyExecutionId;
    const sceneExecutionIds = persisted.intents.map((intent) => intent.identity.sceneExecutionId);
    const review = new ExecutionPlanReviewRepository();
    await review.openReview({ executionPlanId: planId, openedBy: PR32_USER_A });
    for (const sceneExecutionId of sceneExecutionIds) {
      await review.appendSceneIntentDecision({ executionPlanId: planId,
        sceneExecutionId, decision: "APPROVED", reviewedBy: PR32_USER_A });
    }
    const storyDecision = await review.appendStoryDecision({
      executionPlanId: planId, decision: "APPROVED", reviewedBy: PR32_USER_A,
    });
    const assembly = await new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
      executionPlanId: planId, createdBy: PR32_USER_A,
      orderedSceneExecutionIds: sceneExecutionIds,
    });
    const ownership = { orgId: ids.orgId, workspaceId: ids.workspaceId,
      campaignId: ids.campaignId, storyId: ids.storyId,
      storyVersionId: ids.storyVersionId,
      animationPackageId: ids.animationPackageId, executionPlanId: planId };
    const issued = new RuntimeAuthorizationService().authorize({
      ownership, reviewDecisionId: storyDecision.factId,
      reviewHash: storyDecision.deterministicFingerprint,
      reviewDecision: "APPROVED", assemblyDefinitionId: assembly.definition.assemblyDefinitionId,
      assemblyHash: assembly.definition.deterministicFingerprint,
      orderedSceneExecutionIds: sceneExecutionIds,
      qcResults: sceneExecutionIds.map((sceneExecutionId, index) => ({
        qcResultId: id(90 + index), sceneExecutionId, status: "passed" as const,
        resultHash: canonicalPersistenceHash({ sceneExecutionId, qc: index }),
      })),
      authorizedBy: PR32_USER_A, authorizedAt: "2026-09-18T01:02:00.000Z",
      derivedReadiness: "READY_FOR_EXECUTION",
    });
    const accepted = await new RuntimeAuthorizationPersistenceRepository()
      .acceptOrReturn(issued.fact);
    const release = new AiStorySceneReleaseRepository();
    await release.initialize({ executionPlanId: planId,
      runtimeAuthorizationId: accepted.fact.runtimeAuthorizationId,
      workspaceId: ids.workspaceId, orderedSceneExecutionIds: sceneExecutionIds,
      actorUserId: PR32_USER_A, releasedAt: new Date("2026-09-18T01:03:00.000Z") });
    const commercial = await acceptCommercialAuthorizationFixture({
      orgId: ids.orgId, workspaceId: ids.workspaceId, executionPlanId: planId,
    });
    const router = new FixedSeedanceRouter();
    const scheduler = new SceneSchedulingCoordinator({
      router,
      productMaterialSelectionResolver: async (request) => {
        if ((request.generationAuthority.strategy !== "FIRST_FRAME_IMAGE_TO_VIDEO" &&
          request.generationAuthority.strategy !== "PRODUCT_GROUNDED_VIDEO") ||
          request.generationAuthority.referenceSource !== "SCENE_EXPLICIT") {
          throw new Error("Unexpected reference-free Product material resolution");
        }
        return sourceMaterialSelection({
          ...request,
          generationAuthority: {
            strategy: request.generationAuthority.strategy,
            referenceSource: "SCENE_EXPLICIT",
          },
        });
      },
    });
    const compiledIds: string[] = [];
    const sceneResultIds: string[] = [];
    const mediaPaths = new Map<string, string>();
    for (const [index, sceneExecutionId] of sceneExecutionIds.entries()) {
      if (index > 0) {
        const next = await release.releaseNextEligible({
          executionPlanId: planId, workspaceId: ids.workspaceId,
          actorUserId: PR32_USER_A, releasedAt: new Date(`2026-09-18T01:1${index}:00.000Z`),
        });
        expect(next.selectedSceneExecutionId).toBe(sceneExecutionId);
        expect(next.newlyReleased).toBe(true);
      }
      const scheduled = await scheduler.scheduleAuthorizedScene({
        executionPlanId: planId, sceneExecutionId,
        runtimeAuthorizationId: accepted.fact.runtimeAuthorizationId,
        commercialAuthorizationId: commercial.commercialAuthorizationId,
        actorUserId: PR32_USER_A,
      });
      const [envelopeRow] = await sql<{
        execution_context: { trace: { sceneExecutionId: string; compiledRequestId: string; compiledRequestFingerprint: string } };
      }[]>`select execution_context from provider_execution_envelopes
        where envelope_id = ${scheduled.envelopeId}`;
      const trace = envelopeRow!.execution_context.trace;
      expect(trace.sceneExecutionId).toBe(sceneExecutionId);
      const compiledRequest = await new AiStoryProviderRuntimeRepository()
        .getCompiledRequest(trace.compiledRequestId!);
      expect(compiledRequest?.requestFingerprint).toBe(trace.compiledRequestFingerprint);
      expect(compiledRequest?.generationAuthority?.strategy).toBe(MODES[index]!.strategy);
      expect(compiledRequest?.generationMode).toBe(index === 0 ? "TEXT_TO_VIDEO" : "FIRST_FRAME_IMAGE_TO_VIDEO");
      if (index === 0) {
        expect(compiledRequest?.referenceMappings).toEqual([]);
        expect(compiledRequest?.productMaterialSelection).toBeUndefined();
      } else {
        expect(compiledRequest?.productMaterialSelection?.selectedMaterial)
          .toMatchObject({ assetId: ids.assetId, contentHash: SOURCE_HASH });
        expect(compiledRequest?.referenceMappings[0]?.assetId).toBe(ids.assetId);
      }
      compiledIds.push(trace.compiledRequestId!);
      const clip = await generateFixtureClip(mediaRoot, `scene-${index + 1}.mp4`, {
        seconds: 4, color: ["green", "pink", "yellow"][index]!,
      });
      const uri = clip.uri(ids.workspaceId);
      mediaPaths.set(uri, clip.path);
      const fake = createPhaseCAdapterRegistry("terminal_success", {
        uri, contentHash: clip.hash, durationMs: 4_000,
      });
      const { coordinator } = await createPhaseCCoordinator({
        adapters: fake.registry, artifactRoot, pathByUri: mediaPaths,
        expectedOwnership: { orgId: ids.orgId, workspaceId: ids.workspaceId },
      });
      const dispatch = await persistDispatchFromScheduled(sql, scheduled);
      const outcome = await coordinator.continueFromDispatch(dispatch.dispatchId);
      expect(outcome.workerResult?.workerState).toBe("TERMINAL_SUCCESS");
      const [attempt] = await sql<{ attempt_id: string; status: string }[]>`
        select attempt_id, status from provider_attempts
        where execution_id = ${scheduled.providerExecutionId}::uuid`;
      expect(attempt?.status).toBe("SUCCEEDED");
      const [result] = await sql<{ scene_result_id: string; provider_attempt_id: string }[]>`
        select scene_result_id, provider_attempt_id from ai_story_scene_results
        where scene_execution_id = ${sceneExecutionId}::uuid`;
      expect(result?.provider_attempt_id).toBe(attempt!.attempt_id);
      sceneResultIds.push(result!.scene_result_id);
      const objectKey = `${ids.workspaceId}/self-use/scene-${index + 1}.mp4`;
      await new DurableSceneMediaAttestationRepositoryImpl().acceptOrConverge({
        contractVersion: "1", mediaAttestationId: id(110 + index),
        ...ownership, sceneExecutionId, sceneResultId: result!.scene_result_id,
        sourceMediaReference: { scheme: "https", host: "synthetic.invalid",
          path: `/scene-${index + 1}.mp4` },
        durableObjectReference: objectKey, contentHash: clip.hash,
        byteSize: (await stat(clip.path)).size, mediaType: "video/mp4",
        ingestContractVersion: "1", storageProvider: "supabase-storage",
        storageNamespaceVersion: "1", acceptedAt: "2026-09-18T01:20:00.000Z",
        integrityHash: sha256CanonicalIntegrityHash({
          kind: "synthetic-scene-media", sceneExecutionId,
          sceneResultId: result!.scene_result_id, contentHash: clip.hash,
        }),
        executionAllowed: false, executionLockCode: "PHASE1_EXECUTION_LOCKED",
      });
      const intent = persisted.intents[index]!;
      const instructions = persisted.instructionsBySceneExecutionId[sceneExecutionId]!;
      const qcInput = buildAiStoryPostGenerationQcInputFromCompiledAuthority({
        intent, instructions,
        preGenerationAuthority: {
          qcEvaluationId: compiledRequest!.qcEvaluationId,
          qcFingerprint: compiledRequest!.qcFingerprint,
          productGrounded: index > 0,
          planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
          scriptVersionId: script.scriptVersionId,
          handoffId: id(100), handoffFingerprint: `sha256:${"c".repeat(64)}`,
          shotRecipeFingerprint: null,
        },
        sceneVersion: 1, compiledRequest: compiledRequest!,
        attempt: {
          providerAttemptId: attempt!.attempt_id,
          compiledRequestId: compiledRequest!.compiledRequestId,
          requestFingerprint: compiledRequest!.requestFingerprint,
          sceneExecutionId, orgId: ids.orgId, workspaceId: ids.workspaceId,
          campaignId: ids.campaignId, storyId: ids.storyId,
          storyVersionId: ids.storyVersionId,
          generationMode: compiledRequest!.generationMode,
          providerId: "seedance", modelId: "dreamina-seedance-2-0-260128",
          mediaAssetId: id(110 + index),
        },
        privateMedia: {
          mediaAssetId: id(110 + index), contentHash: clip.hash,
          durableObjectReference: objectKey,
          byteSize: (await stat(clip.path)).size, durationMs: 4_000, width: 640, height: 360,
          readable: true, decodable: true,
        },
      });
      const qc = await new AiStoryPostGenerationQcService({
        repository: new BoundAiStoryPostGenerationQcRepository(qcInput),
        evidenceProvider: new FakeAiStoryVisualEvidenceProvider([]),
      }).evaluate(qcInput);
      expect(qc.evaluation.aggregateStatus).toBe("POST_QC_REQUIRES_HUMAN_CONFIRMATION");
      expect(postQcAllowsHumanApproval(qc.evaluation)).toBe(true);
      expect(qc.evaluation.autoApproved).toBe(false);
      expect(qc.evaluation.autoRetryAuthorized).toBe(false);
      const pendingReview = (await new GeneratedSceneReviewRepository()
        .listByExecutionPlanId(planId)).find((row) =>
        row.sceneExecutionId === sceneExecutionId &&
        row.providerAttemptId === attempt!.attempt_id &&
        row.decision === "PENDING_REVIEW");
      expect(pendingReview?.sceneResultId).toBe(result!.scene_result_id);
      const qcByAttempt = await new AiStoryPostGenerationQcRepository()
        .getLatestByProviderAttemptIds({ workspaceId: ids.workspaceId,
          providerAttemptIds: [attempt!.attempt_id] });
      expect(qcByAttempt.get(attempt!.attempt_id)?.eligibleForHumanReview).toBe(true);
      const human = await new GeneratedSceneReviewService().approve({
        executionPlanId: planId, sceneExecutionId, attemptId: attempt!.attempt_id,
        actorUserId: PR32_USER_A, workspaceId: ids.workspaceId,
        executionAuthorization: {
          allowed: true, accessMode: "commercial", settlementMode: "credits",
          authorizedBy: "AGENCY_PLAN_CAPABILITY", policyVersion: "ai-story-exec-03.v1",
          reason: "Isolated synthetic dry-run review", providerCostAccounting: "ALLOWED",
        },
      });
      expect(human.review.decision).toBe("APPROVED");
      expect(human.review.sceneResultId).toBe(result!.scene_result_id);
    }
    expect(new Set(compiledIds).size).toBe(3);
    expect(new Set(sceneResultIds).size).toBe(3);
    const final = await new FinalStoryResultRepositoryImpl().getByExecutionPlanId(planId);
    expect(final).toBeNull();
    // Human approval, not Worker completion or QC, is the assembly boundary.
    // The final continuation must consume the three approved Scene results.
    const finalCoordinator = await createPhaseCCoordinator({
      adapters: createPhaseCAdapterRegistry("terminal_success", {
        uri: `fixture://${ids.workspaceId}/unused.mp4`, contentHash: SOURCE_HASH,
      }).registry,
      artifactRoot, pathByUri: mediaPaths,
      expectedOwnership: { orgId: ids.orgId, workspaceId: ids.workspaceId },
    });
    const finalOutcome = await finalCoordinator.coordinator.continueAssemblyAndFinalStoryResult({
      executionPlanId: planId,
      runtimeAuthorizationId: accepted.fact.runtimeAuthorizationId,
      ownership: accepted.fact.ownership,
    });
    expect(["FSR_PROJECTED", "FSR_REPLAYED", "ASSEMBLY_TRIGGERED", "ASSEMBLY_REPLAYED"])
      .toContain(finalOutcome.status);
    const finalResult = await new FinalStoryResultRepositoryImpl().getByExecutionPlanId(planId);
    expect(finalResult).not.toBeNull();
    expect(finalResult?.orderedSceneResultIds).toEqual(sceneResultIds);
    expect(finalResult?.totalDurationMs).toBeGreaterThanOrEqual(11_500);
    expect(finalResult?.totalDurationMs).toBeLessThanOrEqual(12_500);
    expect(finalResult?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(blockedExternalNetworkAttempts()).toEqual([]);
  }, 300_000);
});
