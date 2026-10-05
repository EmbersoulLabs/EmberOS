import { createHash, randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AiStoryGenerationResultRepository,
  AiStoryLocalGenerationRepository,
  AiStoryPostGenerationQcRepository,
  AiStorySequentialLocalReleaseRepository,
  DurableSceneMediaAttestationRepositoryImpl,
  schema,
} from "@ceo-agent/db";
import type {
  AiStoryGenerationResult,
  AiStoryLocalGenerationPackage,
  AiStoryLocalGenerationPackageV3,
} from "@ceo-agent/shared";
import {
  AiStoryGenerationResultDecisionSchema,
  AiStoryPostGenerationQcEvaluationSchema,
} from "@ceo-agent/shared";
import {
  computeAiStoryLocalGenerationPackageV3Fingerprint,
  deterministicAiStoryLocalGenerationPackageV3Id,
} from "@ceo-agent/shared/server";
import {
  AiStoryGenerationResultService,
  buildGenerationResultPostQcInput,
  materializeLocalGenerationResult,
  materializeSequentialLocalPackageV3,
} from "@ceo-agent/agents";
import { FakeAiStoryVisualEvidenceProvider } from "../packages/agents/src/ai-story/post-generation-qc-service";
import {
  assertIsolatedTestDatabase,
  getIntegrationDbUrl,
  RUN_DB_INTEGRATION,
} from "./helpers/db-integration";

if (process.env.CI === "true" && (!RUN_DB_INTEGRATION || !getIntegrationDbUrl())) {
  throw new Error("SEQUENTIAL_LOCAL_V3_POSTGRES_REQUIRED_IN_CI");
}

const suite = RUN_DB_INTEGRATION && getIntegrationDbUrl()
  ? describe.sequential
  : describe.skip;
const hash = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const now = "2026-10-05T00:00:00.000Z";
type V2 = Extract<AiStoryLocalGenerationPackage, { version: "local-generation-package.v2" }>;

suite("Sequential Local V3 canonical PostgreSQL repositories", () => {
  const ids = {
    org: randomUUID(), workspace: randomUUID(), campaign: randomUUID(),
    story: randomUUID(), storyVersion: randomUUID(), animation: randomUUID(),
    plan: randomUUID(), runtime: randomUUID(), actor: randomUUID(),
    scenes: [randomUUID(), randomUUID(), randomUUID()],
  };
  let sql: Sql;
  let ormClient: Sql;
  let packages: AiStoryLocalGenerationRepository;
  let releases: AiStorySequentialLocalReleaseRepository;
  let results: AiStoryGenerationResultRepository;
  let initial: AiStoryLocalGenerationPackageV3;
  let activeOne: AiStoryLocalGenerationPackageV3;
  let successor: AiStoryLocalGenerationPackageV3;
  let unitTwoResult: AiStoryGenerationResult;
  const approved = new Map<string, Awaited<ReturnType<typeof approvePackage>>>();

  function base(order: number): V2 {
    const sceneExecutionId = ids.scenes[order - 1]!;
    return {
      version: "local-generation-package.v2",
      packageId: randomUUID(),
      packageFingerprint: hash(`v2-${order}`),
      executionMode: "MANUAL_LOCAL",
      organizationId: ids.org,
      workspaceId: ids.workspace,
      campaignId: ids.campaign,
      storyId: ids.story,
      storyVersionId: ids.storyVersion,
      executionPlanId: ids.plan,
      runtimeAuthorizationId: ids.runtime,
      unitId: sceneExecutionId,
      sceneExecutionId,
      sceneId: `scene-${order}`,
      order,
      durationSec: 5,
      aspectRatio: "9:16",
      resolutionIntent: "720p",
      recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      generationMode: "TEXT_TO_VIDEO",
      prompt: `Unit ${order}`,
      negativePrompt: "",
      dialogue: [],
      generateAudio: false,
      audioBlocked: true,
      characterAuthority: {
        characterId: randomUUID(),
        characterVersionId: randomUUID(),
        dnaFingerprint: hash(`character-${order}`),
        sourcePhotoSentToVideoProvider: false,
      },
      productAuthority: null,
      worldDescription: "Canonical test world",
      mustKeep: ["identity"],
      mustAvoid: ["substitution"],
      qcRequirements: [],
      continuityRequirements: ["adjacent continuity"],
      previousUnitEndState: [],
      currentUnitStartState: [],
      expectedEndState: [],
      references: [],
      sourceAuthority: {
        version: "ai-story-local-generation-source-authority.v2",
        localSourceAuthorityId: randomUUID(),
        localSourceAuthorityFingerprint: hash(`source-${order}`),
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        storyVersionId: ids.storyVersion,
        executionPlanId: ids.plan,
        runtimeAuthorizationId: ids.runtime,
        sceneExecutionId,
        sceneExecutionFingerprint: hash(`scene-execution-${order}`),
        instructionContentHash: hash("instructions"),
        sceneVersionId: randomUUID(),
        sceneFingerprint: hash(`scene-${order}`),
        generationAuthority: {
          strategy: "TEXT_TO_VIDEO",
          referenceSource: "REFERENCE_FREE_T2V",
          effectiveReferenceIds: [],
          firstFrameAssetId: null,
          productVisualIdentityRequirement: "NONE",
        },
        generationAuthorityFingerprint: hash(`generation-${order}`),
        preGenerationQcEvaluationId: randomUUID(),
        preGenerationQcFingerprint: hash(`pre-qc-${order}`),
        directorFingerprint: hash("director"),
        motionFingerprint: hash("motion"),
        scriptVersionId: randomUUID(),
        handoffId: randomUUID(),
        handoffFingerprint: hash("handoff"),
        characterAuthorityFingerprint: hash(`character-${order}`),
        worldAuthorityFingerprint: hash("world"),
        productMaterialFingerprint: hash("no-product"),
        productMaterialSelection: null,
      },
      planningAuthority: {
        planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
        sceneVersion: 1,
        scriptVersionId: randomUUID(),
        handoffId: randomUUID(),
        handoffFingerprint: hash("planning-handoff"),
      },
      instructions: `Generate Unit ${order}`,
      state: "AWAITING_LOCAL_OUTPUT",
      retryOfPackageId: null,
      retryNumber: 0,
      createdAt: now,
    };
  }

  function retryOf(pkg: AiStoryLocalGenerationPackageV3, marker: string) {
    const draft = {
      ...pkg,
      retryOfPackageId: pkg.packageId,
      retryNumber: pkg.retryNumber + 1,
      instructions: `${pkg.instructions}\n${marker}`,
      createdAt: now,
    };
    const packageFingerprint =
      computeAiStoryLocalGenerationPackageV3Fingerprint(draft);
    return {
      ...draft,
      packageFingerprint,
      packageId: deterministicAiStoryLocalGenerationPackageV3Id(packageFingerprint),
    };
  }

  async function approvePackage(pkg: AiStoryLocalGenerationPackageV3, sceneOrder: number) {
    const assetId = randomUUID();
    const outputHash = hash(`output-${pkg.packageId}`);
    const outputId = randomUUID();
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,mime_type,storage_path,status,content_hash,file_size_bytes,uploaded_by)
      values(${assetId},${ids.org},${ids.workspace},${ids.campaign},'video','video/mp4',
      ${`${ids.workspace}/ai-story/local-generation/${pkg.packageId}/${assetId}.mp4`},'ready',${outputHash},2000,${ids.actor})`;
    const output = (await packages.insertOutput({
      outputId, packageId: pkg.packageId, unitId: pkg.unitId,
      sceneExecutionId: pkg.sceneExecutionId, assetId, contentHash: outputHash,
      mediaType: "video/mp4", durationSec: 5, width: 720, height: 1280,
      qcState: "PENDING", continuityFrameAssetId: null,
      uploadedBy: ids.actor, uploadedAt: now,
    })).output;
    const result = materializeLocalGenerationResult({
      package: pkg, output, animationPackageId: ids.animation,
      sceneId: pkg.sceneId, sceneOrder,
      storagePath: `${ids.workspace}/ai-story/local-generation/${pkg.packageId}/${assetId}.mp4`,
      byteSize: 2000, decodable: true,
    });
    await results.accept(result);
    const service = new AiStoryGenerationResultService(
      results,
      packages,
      new AiStoryPostGenerationQcRepository(
        drizzle(ormClient, { schema }),
      ),
      new DurableSceneMediaAttestationRepositoryImpl(
        drizzle(ormClient, { schema }),
      ),
    );
    const evaluated = (await service.evaluateLocal(
      result,
      pkg,
      new FakeAiStoryVisualEvidenceProvider([]),
      ids.actor,
    )).evaluation;
    const qc = AiStoryPostGenerationQcEvaluationSchema.parse({
      ...evaluated,
      postQcEvaluationId: randomUUID(),
      evaluationVersion: evaluated.evaluationVersion + 1,
      aggregateStatus: "POST_QC_PASS",
      evidenceUnavailable: false,
      evaluationFingerprint: hash(`certified-qc-${result.generationResultId}`),
      evaluatedAt: now,
    });
    const qcInput = buildGenerationResultPostQcInput(result, pkg);
    await drizzle(ormClient, { schema }).insert(
      schema.aiStoryPostGenerationQcEvaluations,
    ).values({
      postQcEvaluationId: qc.postQcEvaluationId,
      postQcInputId: qc.postQcInputId,
      evaluationVersion: qc.evaluationVersion,
      orgId: qc.orgId,
      workspaceId: qc.workspaceId,
      providerAttemptId: qc.providerAttemptId,
      generationResultId: qc.generationResultId,
      // MANUAL_LOCAL evidence has no durable provider-media attestation FK.
      mediaAssetId: null,
      sceneExecutionId: qc.sceneExecutionId,
      aggregateStatus: qc.aggregateStatus,
      evaluationFingerprint: qc.evaluationFingerprint,
      inputPackage: qcInput,
      evaluation: qc,
      evaluatedAt: new Date(qc.evaluatedAt),
    });
    const decision = AiStoryGenerationResultDecisionSchema.parse({
      decisionId: randomUUID(),
      generationResultId: result.generationResultId,
      postQcEvaluationId: qc.postQcEvaluationId,
      decision: "APPROVED",
      actorUserId: ids.actor,
      rationale: "Canonical PostgreSQL integration approval",
      decidedAt: now,
    });
    await drizzle(ormClient, { schema }).insert(
      schema.aiStoryGenerationResultDecisions,
    ).values({
      ...decision,
      fact: decision,
      decidedAt: new Date(decision.decidedAt),
    });
    return { result, qc, decision };
  }

  async function addFrame(
    result: AiStoryGenerationResult,
    contract: string | null,
    extractedAt = new Date(now),
  ) {
    const frameAssetId = randomUUID();
    const contentHash = hash(`frame-${result.generationResultId}`);
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,mime_type,storage_path,status,content_hash,uploaded_by)
      values(${frameAssetId},${ids.org},${ids.workspace},${ids.campaign},'image','image/png',
      ${`${ids.workspace}/ai-story/continuity/${frameAssetId}.png`},'ready',${contentHash},${ids.actor})`;
    return {
      frameAssetId,
      contentHash,
      sourceContentHash: result.media.contentHash,
      extractionContractVersion: contract,
      extractedAt,
    };
  }

  beforeAll(async () => {
    const url = getIntegrationDbUrl();
    if (!url) throw new Error("POSTGRES_REQUIRED");
    assertIsolatedTestDatabase(url);
    ormClient = postgres(url, { max: 10, prepare: false });
    sql = postgres(url, { max: 2, prepare: false });
    const orm = drizzle(ormClient, { schema });
    packages = new AiStoryLocalGenerationRepository(orm);
    releases = new AiStorySequentialLocalReleaseRepository(orm);
    results = new AiStoryGenerationResultRepository(orm);
    const instructionHash = hash("instructions");
    await sql`insert into organizations(id,name,slug) values(${ids.org},'Sequential V3 Test',${`seq-${ids.org}`})`;
    await sql`insert into workspaces(id,org_id,name,slug) values(${ids.workspace},${ids.org},'Sequential V3',${`seq-${ids.workspace}`})`;
    await sql`insert into campaigns(id,org_id,workspace_id,name) values(${ids.campaign},${ids.org},${ids.workspace},'Sequential V3')`;
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea) values(${ids.story},${ids.org},${ids.workspace},${ids.campaign},'Sequential','Sequential')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content,frozen_at) values(${ids.storyVersion},${ids.story},1,${sql.json({})},now())`;
    await sql`insert into ai_story_animation_packages(id,org_id,workspace_id,campaign_id,story_id,story_version_id,status,payload)
      values(${ids.animation},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},'ready_for_execution',${sql.json({scenePlan:[]})})`;
    await sql`insert into ai_story_scene_instruction_snapshots(content_hash,snapshot_id,org_id,workspace_id,contract_version,instructions)
      values(${instructionHash},${randomUUID()},${ids.org},${ids.workspace},'1',${sql.json({synthetic:true})})`;
    await sql`insert into ai_story_execution_plans(id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,status,contract_version,compilation_hash,deterministic_fingerprint,plan,compiled_at)
      values(${ids.plan},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},'PLANNED','1',${hash("plan")},${hash("plan-fingerprint")},${sql.json({synthetic:true})},now())`;
    for (const [index, scene] of ids.scenes.entries()) {
      await sql`insert into ai_story_scene_executions(id,execution_plan_id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,scene_id,scene_order,status,idempotency_key,deterministic_fingerprint,compilation_hash,instruction_hash,intent)
        values(${scene},${ids.plan},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},${`scene-${index + 1}`},${index},'PLANNED',${`seq-${scene}`},${hash(`scene-${index}`)},${hash("plan")},${instructionHash},${sql.json({synthetic:true})})`;
    }
    await sql`insert into ai_story_runtime_authorized_facts(runtime_authorization_id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,execution_plan_id,runtime_authorization_version,review_decision_id,review_hash,assembly_definition_id,assembly_hash,ordered_scene_execution_ids,qc_result_ids,authorized_by,authorized_at,authorization_contract_version,deterministic_integrity_hash,fact)
      values(${ids.runtime},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},${ids.plan},1,${randomUUID()},${hash("review")},${randomUUID()},${hash("assembly")},${sql.json(ids.scenes)},${sql.json([])},${ids.actor},now(),'1',${hash(`runtime-${ids.runtime}`)},${sql.json({synthetic:true})})`;
  }, 120_000);

  afterAll(async () => {
    if (sql) {
      await sql.unsafe("set session_replication_role = replica");
      await sql`delete from ai_story_scene_results where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_generation_result_continuity_frames where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_generation_result_decisions where generation_result_id in
        (select generation_result_id from ai_story_generation_results where workspace_id=${ids.workspace})`;
      await sql`delete from ai_story_post_generation_qc_evaluations where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_durable_scene_media_attestations where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_generation_results where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_local_generation_outputs where package_id in
        (select package_id from ai_story_local_generation_packages where workspace_id=${ids.workspace})`;
      await sql`delete from ai_story_scene_release_states where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_local_generation_packages where workspace_id=${ids.workspace}`;
      await sql`delete from assets where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_runtime_authorized_facts where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_scene_executions where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_execution_plans where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_scene_instruction_snapshots where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_animation_packages where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_versions where story_id=${ids.story}`;
      await sql`delete from ai_stories where workspace_id=${ids.workspace}`;
      await sql`delete from campaigns where workspace_id=${ids.workspace}`;
      await sql`delete from workspaces where id=${ids.workspace}`;
      await sql`delete from organizations where id=${ids.org}`;
      await sql.unsafe("set session_replication_role = origin");
    }
    await ormClient?.end();
    await sql?.end();
  }, 120_000);

  it("A-F — certifies canonical sequential repositories and concurrency", async () => {
    // A — complete positional Runtime Authorization ledger.
    initial = materializeSequentialLocalPackageV3({
      basePackage: base(1),
      release: { releaseRevision: 0, releasedBy: ids.actor, releasedAt: now },
      predecessor: null,
    });
    for (const invalid of [
      [ids.scenes[1]!, ids.scenes[0]!, ids.scenes[2]!],
      ids.scenes.slice(0, 2),
      [ids.scenes[0]!, ids.scenes[0]!, ids.scenes[2]!],
      [...ids.scenes, randomUUID()],
    ]) {
      await expect(packages.initializeSequential({
        package: initial, orderedSceneExecutionIds: invalid, createdBy: ids.actor,
      })).rejects.toMatchObject({ code: "LOCAL_GENERATION_AUTHORITY_INVALID" });
    }
    const crossScope = materializeSequentialLocalPackageV3({
      basePackage: { ...base(1), workspaceId: randomUUID() },
      release: { releaseRevision: 0, releasedBy: ids.actor, releasedAt: now },
      predecessor: null,
    });
    await expect(packages.initializeSequential({
      package: crossScope, orderedSceneExecutionIds: ids.scenes, createdBy: ids.actor,
    })).rejects.toMatchObject({ code: "LOCAL_GENERATION_AUTHORITY_INVALID" });
    await packages.initializeSequential({
      package: initial, orderedSceneExecutionIds: ids.scenes, createdBy: ids.actor,
    });
    const rows = await sql`select scene_order,release_state,current_local_generation_package_id from ai_story_scene_release_states where execution_plan_id=${ids.plan} order by scene_order`;
    expect(rows).toEqual([
      { scene_order: 1, release_state: "RELEASED", current_local_generation_package_id: initial.packageId },
      { scene_order: 2, release_state: "WAITING_FOR_PREDECESSOR", current_local_generation_package_id: null },
      { scene_order: 3, release_state: "WAITING_FOR_PREDECESSOR", current_local_generation_package_id: null },
    ]);

    // B — exactly-once immutable retry activation under true concurrency.
    const initialRetry = retryOf(initial, "AUTHORIZED RETRY");
    const retryActivationCalls = await Promise.all([
      packages.insertOrActivateSequentialRetry({ package: initialRetry, createdBy: ids.actor }),
      packages.insertOrActivateSequentialRetry({ package: initialRetry, createdBy: ids.actor }),
    ]);
    expect(retryActivationCalls.map((call) => call.replayed).sort()).toEqual([false, true]);
    activeOne = initialRetry;
    const historical = await packages.getPackage({
      workspaceId: ids.workspace, executionPlanId: ids.plan, packageId: initial.packageId,
    });
    expect(historical).toEqual(initial);
    const bad = retryOf(initial, "MISMATCHED RETRY");
    await expect(packages.insertOrActivateSequentialRetry({
      package: bad, createdBy: ids.actor,
    })).rejects.toThrow("exactly once");

    // C — concurrent successor release convergence and mismatch denial.
    const one = await approvePackage(activeOne, 0);
    approved.set(activeOne.packageId, one);
    const legacyFrame = await addFrame(
      one.result,
      null,
    );
    await sql`insert into ai_story_generation_result_continuity_frames(
      generation_result_id,org_id,workspace_id,frame_asset_id,content_hash,
      source_content_hash,extraction_contract_version,extracted_at
    ) values(
      ${one.result.generationResultId},${ids.org},${ids.workspace},
      ${legacyFrame.frameAssetId},${legacyFrame.contentHash},${legacyFrame.sourceContentHash},
      null,${legacyFrame.extractedAt}
    )`;
    const legacyReplay = await results.acceptContinuityFrame(one.result, {
      ...legacyFrame,
      extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
    });
    expect(legacyReplay.extractionContractVersion).toBeNull();
    const evidence = {
      predecessorPackage: activeOne,
      generationResult: one.result,
      postQc: one.qc,
      decision: one.decision,
      frame: {
        ...legacyFrame,
        extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
        extractedAt: legacyFrame.extractedAt.toISOString(),
      },
    };
    successor = materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: ids.actor, releasedAt: now },
      predecessor: evidence,
    });
    const releaseCalls = await Promise.all([
      releases.releaseSuccessor({ package: successor, actorUserId: ids.actor }),
      releases.releaseSuccessor({ package: successor, actorUserId: ids.actor }),
    ]);
    expect(releaseCalls.map((call) => call.replayed).sort()).toEqual([false, true]);
    const mismatched = materializeSequentialLocalPackageV3({
      basePackage: base(2),
      release: { releaseRevision: 1, releasedBy: ids.actor, releasedAt: now },
      predecessor: {
        ...evidence,
        frame: { ...evidence.frame, contentHash: hash("mismatched-frame") },
      },
    });
    await expect(releases.releaseSuccessor({
      package: mismatched, actorUserId: ids.actor,
    })).rejects.toThrow("RELEASE_STATE_CONFLICT");

    // D — legacy NULL compatibility, new NULL denial, immutable mismatch denial.
    const two = await approvePackage(successor, 1);
    approved.set(successor.packageId, two);
    unitTwoResult = two.result;
    const unitTwoFrame = await addFrame(two.result, null);
    await expect(results.acceptContinuityFrame(two.result, unitTwoFrame))
      .rejects.toThrow("EXTRACTION_CONTRACT_REQUIRED");
    const accepted = await results.acceptContinuityFrame(two.result, {
      ...unitTwoFrame,
      extractionContractVersion: "ai-story-continuity-frame-extraction.v1",
    });
    expect(accepted.extractionContractVersion).toBe(
      "ai-story-continuity-frame-extraction.v1",
    );
    await expect(results.acceptContinuityFrame(two.result, {
      ...unitTwoFrame,
      extractionContractVersion: "ai-story-continuity-frame-extraction.v2",
    })).rejects.toThrow("IMMUTABLE_CONFLICT");

    // E — stale-current-package execution fence after locked activation.
    const unitTwoRetry = retryOf(successor, "UNIT TWO SUPERSESSION");
    await packages.insertOrActivateSequentialRetry({ package: unitTwoRetry, createdBy: ids.actor });
    await expect(packages.getExecutablePackage({
      workspaceId: ids.workspace, executionPlanId: ids.plan, packageId: successor.packageId,
    })).resolves.toBeNull();
    await expect(packages.getExecutablePackage({
      workspaceId: ids.workspace, executionPlanId: ids.plan, packageId: unitTwoRetry.packageId,
    })).resolves.toEqual(unitTwoRetry);
    const staleAsset = randomUUID();
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,mime_type,storage_path,status,content_hash,uploaded_by)
      values(${staleAsset},${ids.org},${ids.workspace},${ids.campaign},'video','video/mp4',${`${ids.workspace}/stale.mp4`},'ready',${hash("stale")},${ids.actor})`;
    await expect(packages.insertOutput({
      outputId: randomUUID(), packageId: successor.packageId,
      unitId: successor.unitId, sceneExecutionId: successor.sceneExecutionId,
      assetId: staleAsset, contentHash: hash("stale"), mediaType: "video/mp4",
      durationSec: 5, width: 720, height: 1280, qcState: "PENDING",
      continuityFrameAssetId: null, uploadedBy: ids.actor, uploadedAt: now,
    })).rejects.toMatchObject({ code: "LOCAL_GENERATION_PACKAGE_NOT_CURRENT" });

    // F — separated authorities and historical snapshot immutability.
    expect(successor.generationMode).toBe("TEXT_TO_VIDEO");
    expect(successor.sourceAuthority.generationAuthority.strategy).toBe("TEXT_TO_VIDEO");
    expect(successor.visualStartAuthority.sourceType).toBe("PREDECESSOR_CONTINUITY");
    expect(successor.characterAuthority).not.toBeNull();
    expect(successor.productAuthority).toBeNull();
    expect(successor.predecessorAuthority?.semantic.predecessorGenerationResultId)
      .toBe(approved.get(activeOne.packageId)?.result.generationResultId);
    expect(unitTwoResult.inputAuthority.localPackageId).toBe(successor.packageId);
    expect(await packages.getPackage({
      workspaceId: ids.workspace, executionPlanId: ids.plan, packageId: initial.packageId,
    })).toEqual(initial);
  });
});
