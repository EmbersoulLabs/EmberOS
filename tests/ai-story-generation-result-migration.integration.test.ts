import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertIsolatedTestDatabase, getIntegrationDbUrl, RUN_DB_INTEGRATION } from "./helpers/db-integration";
import { installCertificationNetworkIsolation } from "./helpers/certification-network-isolation";
import { drizzle } from "drizzle-orm/postgres-js";
import { schema, AiStoryLocalGenerationRepository, AiStoryGenerationResultRepository, AiStoryPostGenerationQcRepository,
  DurableSceneMediaAttestationRepositoryImpl, AiStoryLocalMediaJobRepository } from "@ceo-agent/db";
import { AiStoryLocalGenerationPackageSchema } from "@ceo-agent/shared";
import { AiStoryGenerationResultService, materializeLocalGenerationResult, localGenerationPackageFingerprint } from "../packages/agents/src/ai-story";
import { FakeAiStoryVisualEvidenceProvider } from "../packages/agents/src/ai-story/post-generation-qc-service";

if(process.env.CI==="true"&&(!RUN_DB_INTEGRATION||!getIntegrationDbUrl())) throw new Error("GENERATION_RESULT_POSTGRES_REQUIRED_IN_CI");
const suite=RUN_DB_INTEGRATION&&getIntegrationDbUrl()?describe:describe.skip;
const read=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const migrations=[
  "packages/db/sql/ai-story-manual-local-generation-handoff-v1.sql",
  "packages/db/sql/ai-story-provider-neutral-generation-result-v1.sql",
  "packages/db/sql/ai-story-local-generation-package-contract-v2.sql",
  "packages/db/sql/ai-story-sequential-manual-local-package-v3.sql",
  "packages/db/sql/ai-story-local-gpu-execution-mode-v1.sql",
];
suite("Provider-neutral upgrade preserves actual predecessor authority",()=>{
  let admin:Sql, db:Sql, ormClient:Sql, name:string, restore:()=>void;
  let before:unknown;
  async function evidence(){return db`select jsonb_agg(to_jsonb(t) order by t.attempt_id) as rows from provider_attempts t`;}
  beforeAll(async()=>{
    restore=installCertificationNetworkIsolation();const urlValue=getIntegrationDbUrl();if(!urlValue)throw new Error("POSTGRES_REQUIRED");assertIsolatedTestDatabase(urlValue);
    const url=new URL(urlValue);if(!["localhost","127.0.0.1","::1"].includes(url.hostname))throw new Error("LOCAL_POSTGRES_REQUIRED");
    name=`emberos_generation_result_${randomUUID().replaceAll("-","")}_test`;
    admin=postgres(urlValue,{max:1,prepare:false});await admin.unsafe(`CREATE DATABASE "${name}"`);url.pathname=`/${name}`;db=postgres(url.toString(),{max:1,prepare:false});
    // Drizzle installs identity JSON serializers on its client. Keep the raw
    // predecessor fixture/snapshot connection separate from ORM persistence.
    ormClient=postgres(url.toString(),{max:1,prepare:false});
    await db.unsafe(read("tests/fixtures/ai-story-production-predecessor-schema.sql"));
    await db.unsafe("DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
    await db.unsafe(read("tests/fixtures/ai-story-production-predecessor-preservation-seed.sql"));before=await evidence();
    const manifest=JSON.parse(read("docs/releases/ai-story-v1-production-migration-manifest.json")) as {entries:Array<{file:string}>};
    for(const entry of manifest.entries){const source=read(entry.file);await db.unsafe(/^\s*(?:--[^\n]*\n\s*)*BEGIN\s*;/i.test(source)?source:`BEGIN;\n${source}\nCOMMIT;`);}
    const applied=new Set(manifest.entries.map((entry)=>entry.file));
    for(const file of migrations){if(!applied.has(file))await db.unsafe(read(file));}
  },120_000);
  afterAll(async()=>{await ormClient?.end();await db?.end();if(admin&&/^emberos_generation_result_[a-f0-9]+_test$/.test(name))await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);await admin?.end();restore?.();},120_000);
  it("loads both additive migrations against the certified predecessor closure",async()=>{const rows=await db`select tablename from pg_tables where schemaname='public' and tablename in ('ai_story_generation_results','ai_story_generation_result_decisions','ai_story_generation_result_continuity_frames','ai_story_local_generation_packages','ai_story_local_generation_outputs','ai_story_local_media_jobs')`;expect(rows).toHaveLength(6);});
  it("accepts V1, V2, and V3 local package contracts without rewriting rows",async()=>{
    const [before]=await db`select count(*)::int as count from ai_story_local_generation_packages`;
    const [check]=await db`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='ai_story_local_generation_packages'::regclass and contype='c' and pg_get_constraintdef(oid) like '%local-generation-package.v3%'`;
    expect(check?.definition).toContain("local-generation-package.v1");
    expect(check?.definition).toContain("local-generation-package.v2");
    expect(check?.definition).toContain("local-generation-package.v3");
    expect(before?.count).toBe(0);
  });
  it("preserves all historical Provider Attempt rows",async()=>{expect(await evidence()).toEqual(before);});
  it("preserves four Production-only Provider historical relations",async()=>{for(const table of ["provider_execution_finalizations","provider_finalization_costs","provider_finalization_usage","provider_terminal_ledger_records"]){const rows=await db.unsafe(`select count(*)::int as count from ${table}`);expect(rows[0]?.count).toBe(1);}});
  it("allows null Provider provenance only with canonical result authority",async()=>{const columns=await db`select column_name,is_nullable from information_schema.columns where table_name='ai_story_post_generation_qc_evaluations' and column_name in ('provider_attempt_id','media_asset_id','generation_result_id')`;expect(columns).toHaveLength(3);expect(columns.every(row=>row.is_nullable==="YES")).toBe(true);});
  it("enforces exactly-one source in PostgreSQL",async()=>{const constraints=await db`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='ai_story_generation_results'::regclass and conname='ai_story_generation_result_exact_source'`;expect(constraints[0]?.definition).toContain("MANUAL_LOCAL");expect(constraints[0]?.definition).toContain("REMOTE_PROVIDER");expect(constraints[0]?.definition).toContain("LOCAL_GPU_WORKER");});
  it("enables RLS and denies authenticated direct result/package writes",async()=>{for(const table of ["ai_story_generation_results","ai_story_generation_result_decisions","ai_story_generation_result_continuity_frames","ai_story_local_generation_packages","ai_story_local_generation_outputs","ai_story_local_media_jobs"]){const rows=await db`select relrowsecurity,has_table_privilege('authenticated',${table},'INSERT') as can_insert from pg_class where oid=${table}::regclass`;expect(rows[0]?.relrowsecurity).toBe(true);expect(rows[0]?.can_insert).toBe(false);}});
  it("has immutable triggers on results, decisions, frames and outputs",async()=>{const triggers=await db`select tgname from pg_trigger where not tgisinternal and tgname in ('generation_result_immutable','generation_result_decision_immutable','generation_result_frame_immutable','ai_story_local_generation_output_immutable')`;expect(triggers).toHaveLength(4);});
  it("creates no result, review, frame or commercial authority automatically",async()=>{for(const table of ["ai_story_generation_results","ai_story_generation_result_decisions","ai_story_generation_result_continuity_frames","ai_story_local_generation_packages"]){const rows=await db.unsafe(`select count(*)::int as count from ${table}`);expect(rows[0]?.count).toBe(0);}});
  it("rejects missing source and prevents mutation of accepted remote evidence",async()=>{
    const values={generation_result_id:randomUUID(),org_id:"10000000-0000-4000-8000-000000000001",workspace_id:"10000000-0000-4000-8000-000000000002",campaign_id:"10000000-0000-4000-8000-000000000003",story_id:"10000000-0000-4000-8000-000000000004",execution_plan_id:"10000000-0000-4000-8000-000000000008",scene_execution_id:"10000000-0000-4000-8000-000000000009",generation_unit_id:randomUUID(),source_kind:"MANUAL_LOCAL",asset_id:randomUUID(),content_hash:`sha256:${"a".repeat(64)}`,fingerprint:`sha256:${"b".repeat(64)}`,result:{synthetic:true},created_at:new Date()};
    await expect(db`insert into ai_story_generation_results ${db(values)}`).rejects.toThrow();
    const [attempt]=await db`select attempt_id from provider_attempts limit 1`;
    await db`insert into ai_story_generation_results ${db({...values,source_kind:"REMOTE_PROVIDER",provider_attempt_id:attempt!.attempt_id})}`;
    await expect(db`update ai_story_generation_results set content_hash=${`sha256:${"c".repeat(64)}`} where generation_result_id=${values.generation_result_id}`).rejects.toThrow("GENERATION_RESULT_IMMUTABLE_CONFLICT");
    await expect(db`delete from ai_story_generation_results where generation_result_id=${values.generation_result_id}`).rejects.toThrow("GENERATION_RESULT_IMMUTABLE_CONFLICT");
  });
  it("persists local output, neutral QC, Human approval, Scene Result and adjacent continuity without an Attempt",async()=>{
    const orm=drizzle(ormClient,{schema});
    const packages=new AiStoryLocalGenerationRepository(orm),results=new AiStoryGenerationResultRepository(orm);
    const hash=`sha256:${"a".repeat(64)}`,now=new Date().toISOString();
    const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
    const runtimeId=randomUUID(),actor=randomUUID(),packageId=randomUUID(),assetId=randomUUID(),outputId=randomUUID();
    // Synthetic already-authorized predecessor evidence; no live review/identity is used.
    await db`insert into ai_story_runtime_authorized_facts ${db({
      runtime_authorization_id:runtimeId,org_id:id(1),workspace_id:id(2),campaign_id:id(3),story_id:id(4),story_version_id:id(5),
      animation_package_id:id(6),execution_plan_id:id(8),runtime_authorization_version:1,review_decision_id:randomUUID(),
      review_hash:hash,assembly_definition_id:randomUUID(),assembly_hash:hash,ordered_scene_execution_ids:db.json([id(9)]),
      qc_result_ids:db.json([]),authorized_by:actor,authorized_at:new Date(),authorization_contract_version:"1",
      deterministic_integrity_hash:hash,fact:{synthetic:true},
    })}`;
    const facts=AiStoryLocalGenerationPackageSchema.parse({
      version:"local-generation-package.v1",packageId,packageFingerprint:hash,executionMode:"MANUAL_LOCAL",
      organizationId:id(1),workspaceId:id(2),campaignId:id(3),storyId:id(4),storyVersionId:id(5),executionPlanId:id(8),runtimeAuthorizationId:runtimeId,
      unitId:id(9),sceneExecutionId:id(9),sceneId:"synthetic-scene",order:1,durationSec:4,aspectRatio:"9:16",resolutionIntent:"720p",
      recommendedWorkflow:"WAN_T2V",generationMode:"TEXT_TO_VIDEO",prompt:"Synthetic immutable execution.",negativePrompt:"",dialogue:[],
      generateAudio:false,audioBlocked:true,characterAuthority:null,productAuthority:null,worldDescription:"Synthetic room",
      mustKeep:[],mustAvoid:[],qcRequirements:[],continuityRequirements:[],previousUnitEndState:[],currentUnitStartState:[],expectedEndState:[],references:[],
      sourceAuthority:{schedulingAuthorityId:randomUUID(),schedulingAuthorityFingerprint:hash,plannerSnapshotId:randomUUID(),
        compiledRequestId:randomUUID(),compiledRequestFingerprint:hash,sceneFingerprint:hash,semanticPlanFingerprint:hash,
        preGenerationQcEvaluationId:randomUUID(),preGenerationQcFingerprint:hash,directorFingerprint:hash,motionFingerprint:hash,
        castSnapshotFingerprint:hash,locationSnapshotFingerprint:hash,productSnapshotFingerprint:hash},
      planningAuthority:{planningLineageSource:"LEGACY_COMPILED_V1",sceneVersion:1,scriptVersionId:null,handoffId:null,handoffFingerprint:null},
      instructions:"Synthetic local render",state:"AWAITING_LOCAL_OUTPUT",retryOfPackageId:null,retryNumber:0,createdAt:now,
    });
    const pkg={...facts,packageFingerprint:localGenerationPackageFingerprint(facts)};
    await packages.insertOrConverge({packages:[pkg],createdBy:actor});
    const storagePath=`${id(2)}/ai-story/local-generation/${packageId}/${assetId}.mp4`;
    await orm.insert(schema.assets).values({id:assetId,orgId:id(1),workspaceId:id(2),campaignId:id(3),
      type:"video",mimeType:"video/mp4",storagePath,status:"ready",contentHash:hash,fileSizeBytes:2000,uploadedBy:actor});
    const output=(await packages.insertOutput({outputId,packageId,unitId:id(9),sceneExecutionId:id(9),assetId,contentHash:hash,
      mediaType:"video/mp4",durationSec:4,width:720,height:1280,qcState:"PENDING",continuityFrameAssetId:null,uploadedBy:actor,uploadedAt:now})).output;
    const result=materializeLocalGenerationResult({package:pkg,output,animationPackageId:id(6),sceneId:"synthetic-scene",sceneOrder:0,storagePath,byteSize:2000,decodable:true});
    expect((await results.accept(result)).replayed).toBe(false);
    expect((await results.accept(result)).replayed).toBe(true);
    expect(await results.decision(result.generationResultId)).toBeNull();
    const service=new AiStoryGenerationResultService(results,packages,new AiStoryPostGenerationQcRepository(orm),new DurableSceneMediaAttestationRepositoryImpl(orm));
    const qc=await service.evaluateLocal(result,pkg,new FakeAiStoryVisualEvidenceProvider([]),actor);
    expect(qc.evaluation.providerAttemptId).toBeNull();expect(qc.evaluation.generationResultId).toBe(result.generationResultId);
    expect(qc.evaluation.aggregateStatus).toBe("POST_QC_PASS");
    await service.approve(result,actor,"Human inspected synthetic test evidence");
    const scenes=await db`select * from ai_story_scene_results where generation_result_id=${result.generationResultId}`;
    expect(scenes).toHaveLength(1);expect(scenes[0]?.provider_attempt_id).toBeNull();
    const frameAssetId=randomUUID();
    await orm.insert(schema.assets).values({id:frameAssetId,orgId:id(1),workspaceId:id(2),campaignId:id(3),type:"image",
      mimeType:"image/png",storagePath:`${id(2)}/ai-story/continuity/test.png`,contentHash:hash,status:"ready",uploadedBy:actor});
    await results.acceptContinuityFrame(result,{frameAssetId,contentHash:hash,sourceContentHash:hash,
      extractionContractVersion:"ai-story-continuity-frame-extraction.v1",extractedAt:new Date()});
    const continuity=await results.previousUnitContinuity({...pkg,order:2});
    expect(continuity?.frameAssetId).toBe(frameAssetId);expect(continuity?.automaticModeSelection).toBe(false);
    const jobs=new AiStoryLocalMediaJobRepository(orm);
    const job=await jobs.enqueue({workspaceId:id(2),executionPlanId:id(8),packageId,actorUserId:actor,kind:"EXTRACT_FRAME",generationResultId:result.generationResultId});
    expect((await jobs.enqueue({workspaceId:id(2),executionPlanId:id(8),packageId,actorUserId:actor,kind:"EXTRACT_FRAME",generationResultId:result.generationResultId})).jobId).toBe(job.jobId);
    const claimed=await jobs.claim();expect(claimed?.jobId).toBe(job.jobId);
    expect(await jobs.claim()).toBeNull();
    if(!claimed)throw new Error("LOCAL_MEDIA_CLAIM_REQUIRED");
    await expect(jobs.finish({...claimed,claimToken:randomUUID()},null)).rejects.toThrow("CLAIM_LOST");
    await jobs.finish(claimed,null);
    await expect(db`update ai_story_local_media_jobs set package_id=${randomUUID()} where job_id=${job.jobId}`).rejects.toThrow("IDENTITY_IMMUTABLE");
    expect(await evidence()).toEqual(before);
  });
  it("accepts LOCAL_GPU execution mode without rewriting packages or historical modes",async()=>{
    const packagesBefore=await db`select package_id, package::text as package from ai_story_local_generation_packages order by package_id`;
    const releasesBefore=await db`select scene_execution_id, execution_mode from ai_story_scene_release_states order by scene_execution_id`;
    const tables=await db`select relname, count(*)::int as copies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and relname in ('ai_story_local_generation_packages','ai_story_local_generation_outputs','ai_story_generation_results','ai_story_generation_result_decisions','ai_story_generation_result_continuity_frames','ai_story_local_media_jobs') group by relname order by relname`;
    expect(tables).toHaveLength(6);
    expect(tables.every((row)=>row.copies===1)).toBe(true);
    const columns=await db`select column_name from information_schema.columns where table_schema='public' and table_name='ai_story_scene_release_states' and column_name in ('org_id','execution_mode','gate_kind','release_revision','release_authority_id','release_authority_fingerprint','predecessor_authority_fingerprint','gate_generation_result_id','gate_generation_result_decision_id','current_local_generation_package_id')`;
    expect(columns).toHaveLength(10);
    const postQc=await db`select 1 from information_schema.columns where table_schema='public' and table_name='ai_story_post_generation_qc_evaluations' and column_name='generation_result_id'`;
    expect(postQc).toHaveLength(1);
    const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
    const hash=`sha256:${"d".repeat(64)}`;
    const [runtime]=await db`select runtime_authorization_id from ai_story_runtime_authorized_facts where execution_plan_id=${id(8)} limit 1`;
    await db.begin(async (tx)=>{
      const runtimeId=runtime?.runtime_authorization_id ?? randomUUID();
      if(!runtime){
        await tx`insert into ai_story_runtime_authorized_facts ${tx({
          runtime_authorization_id:runtimeId,org_id:id(1),workspace_id:id(2),campaign_id:id(3),story_id:id(4),story_version_id:id(5),
          animation_package_id:id(6),execution_plan_id:id(8),runtime_authorization_version:1,review_decision_id:randomUUID(),
          review_hash:hash,assembly_definition_id:randomUUID(),assembly_hash:hash,ordered_scene_execution_ids:tx.json([id(9)]),
          qc_result_ids:tx.json([]),authorized_by:randomUUID(),authorized_at:new Date(),authorization_contract_version:"1",
          deterministic_integrity_hash:hash,fact:{synthetic:true},
        })}`;
      }
      await tx`insert into ai_story_scene_release_states ${tx({
        scene_execution_id:id(9),execution_plan_id:id(8),runtime_authorization_id:runtimeId,workspace_id:id(2),org_id:id(1),
        scene_order:1,release_state:"AUTHORIZED_NOT_RELEASED",execution_mode:"LOCAL_GPU",gate_kind:"INITIAL_UNIT",
      })}`;
      await tx`update ai_story_scene_release_states set execution_mode='REMOTE_PROVIDER' where scene_execution_id=${id(9)}`;
      await tx`update ai_story_scene_release_states set execution_mode='MANUAL_LOCAL' where scene_execution_id=${id(9)}`;
      await tx`update ai_story_scene_release_states set execution_mode='LOCAL_GPU' where scene_execution_id=${id(9)}`;
      await tx`savepoint unknown_mode`;
      await expect(tx`update ai_story_scene_release_states set execution_mode='NOT_A_MODE' where scene_execution_id=${id(9)}`).rejects.toThrow();
      await tx`rollback to savepoint unknown_mode`;
      const [row]=await tx`select execution_mode from ai_story_scene_release_states where scene_execution_id=${id(9)}`;
      expect(row?.execution_mode).toBe("LOCAL_GPU");
      throw new Error("ROLLBACK_LOCAL_GPU_MODE_FIXTURE");
    }).catch((error:unknown)=>{
      if(!(error instanceof Error) || error.message!=="ROLLBACK_LOCAL_GPU_MODE_FIXTURE") throw error;
    });
    expect(await db`select package_id, package::text as package from ai_story_local_generation_packages order by package_id`).toEqual(packagesBefore);
    expect(await db`select scene_execution_id, execution_mode from ai_story_scene_release_states order by scene_execution_id`).toEqual(releasesBefore);
  });
  it("replay fails atomically without changing historical or result rows",async()=>{const beforeResults=await db`select * from ai_story_generation_results order by generation_result_id`;for(const file of migrations){await expect(db.unsafe(read(file))).rejects.toThrow();await db.unsafe("ROLLBACK");}expect(await evidence()).toEqual(before);expect(await db`select * from ai_story_generation_results order by generation_result_id`).toEqual(beforeResults);});
});
