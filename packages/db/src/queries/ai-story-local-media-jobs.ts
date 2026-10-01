import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AiStoryLocalMediaJobIdentitySchema, AiStoryLocalMediaJobSchema, type AiStoryLocalMediaJob, type AiStoryLocalMediaJobInput } from "@ceo-agent/shared";
import { getDb } from "../client";
import { deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";
import { AiStoryLocalGenerationRepository } from "./ai-story-local-generation";
import { AiStoryGenerationResultRepository } from "./ai-story-generation-result";

export type LocalMediaJob = AiStoryLocalMediaJob;
const projection=sql`job_id AS "jobId",workspace_id AS "workspaceId",execution_plan_id AS "executionPlanId",
 package_id AS "packageId",actor_user_id AS "actorUserId",kind,asset_id AS "assetId",
 generation_result_id AS "generationResultId",state,claim_token AS "claimToken",error_code AS "errorCode"`;

/** Durable, fenced CPU processing claims. This queue carries no Provider authority. */
export class AiStoryLocalMediaJobRepository {
  constructor(private readonly db= getDb()) {}
  async enqueue(input:AiStoryLocalMediaJobInput) {
    AiStoryLocalMediaJobIdentitySchema.parse(input);
    const pkg=await new AiStoryLocalGenerationRepository(this.db).getPackage(input);
    if(!pkg)throw new Error("LOCAL_MEDIA_PACKAGE_NOT_FOUND");
    const assetId=input.kind==="VALIDATE_OUTPUT"?input.assetId:null;
    const generationResultId=input.kind==="EXTRACT_FRAME"?input.generationResultId:null;
    AiStoryLocalMediaJobSchema.parse({...input,jobId:randomUUID(),assetId,generationResultId,state:"PENDING",claimToken:null,errorCode:null});
    if(generationResultId) {
      const repository=new AiStoryGenerationResultRepository(this.db);
      const result=await repository.get(input.workspaceId,generationResultId);
      if(!result||result.ownership.executionPlanId!==input.executionPlanId||
        result.inputAuthority.localPackageId!==input.packageId||(await repository.decision(generationResultId))?.decision!=="APPROVED")throw new Error("GENERATION_RESULT_APPROVAL_REQUIRED");
    }
    const jobId=deterministicPersistenceUuid("ai-story-local-media-job",{kind:input.kind,packageId:input.packageId,assetId,generationResultId});
    await this.db.execute(sql`INSERT INTO ai_story_local_media_jobs(job_id,workspace_id,execution_plan_id,package_id,asset_id,generation_result_id,actor_user_id,kind)
      VALUES(${jobId},${input.workspaceId},${input.executionPlanId},${input.packageId},${assetId},${generationResultId},${input.actorUserId},${input.kind})
      ON CONFLICT(job_id) DO NOTHING`);
    // Explicit operator retry of CPU work, not a generation/paid retry.
    await this.db.execute(sql`UPDATE ai_story_local_media_jobs SET state='PENDING',error_code=NULL,claim_token=NULL,lease_until=NULL
      WHERE job_id=${jobId} AND state='FAILED'`);
    const rows=await this.db.execute(sql`SELECT ${projection} FROM ai_story_local_media_jobs WHERE job_id=${jobId}`);
    return AiStoryLocalMediaJobSchema.parse(rows[0]);
  }
  async list(workspaceId:string,executionPlanId:string) {
    const rows=await this.db.execute(sql`SELECT ${projection} FROM ai_story_local_media_jobs WHERE workspace_id=${workspaceId} AND execution_plan_id=${executionPlanId} ORDER BY created_at`);
    return rows.map(row=>AiStoryLocalMediaJobSchema.parse(row));
  }
  async claim() {
    const token=randomUUID();
    const rows=await this.db.execute(sql`UPDATE ai_story_local_media_jobs SET state='RUNNING',claim_token=${token},lease_until=now()+interval '5 minutes',error_code=NULL
      WHERE job_id=(SELECT job_id FROM ai_story_local_media_jobs WHERE state='PENDING' OR (state='RUNNING' AND lease_until<now())
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING ${projection}`);
    return rows[0]?AiStoryLocalMediaJobSchema.parse(rows[0]):null;
  }
  async finish(job:LocalMediaJob,errorCode:string|null) {
    const rows=await this.db.execute(sql`UPDATE ai_story_local_media_jobs SET state=${errorCode?"FAILED":"SUCCEEDED"},error_code=${errorCode},lease_until=NULL
      WHERE job_id=${job.jobId} AND claim_token=${job.claimToken} AND state='RUNNING' RETURNING job_id`);
    if(rows.length!==1)throw new Error("LOCAL_MEDIA_JOB_CLAIM_LOST");
  }
}
