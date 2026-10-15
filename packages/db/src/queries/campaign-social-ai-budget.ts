import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { CampaignContentIterationError } from "./campaign-content-iterations";

type Db = ReturnType<typeof getDb>;
export const SOCIAL_AI_MODEL = "gpt-6-luna" as const;
export const SOCIAL_AI_SUPPORTED_MODELS = ["gpt-4o-mini", "gpt-6-luna"] as const;
export type SocialAiModel = (typeof SOCIAL_AI_SUPPORTED_MODELS)[number];
export const isSocialAiModel=(value:string):value is SocialAiModel=>(SOCIAL_AI_SUPPORTED_MODELS as readonly string[]).includes(value);
export const SOCIAL_AI_MAX_INPUT_TOKENS = 12_000;
export const SOCIAL_AI_MAX_OUTPUT_TOKENS = 1_200;
export const SOCIAL_AI_MAX_REQUEST_USD = 0.05;
const usd = (value:number)=>value.toFixed(6);
/** Existing commercial ledger settles in cents, so reserve one cent for a <=$0.00252 envelope. */
export const maximumSocialAiCostUsd=()=>0.01;
export const actualSocialAiCostUsd=(input:number,output:number,model:SocialAiModel=SOCIAL_AI_MODEL)=>{
  if(!Number.isInteger(input)||!Number.isInteger(output)||input<0||output<0||input>SOCIAL_AI_MAX_INPUT_TOKENS||output>SOCIAL_AI_MAX_OUTPUT_TOKENS)throw new CampaignContentIterationError("CAMPAIGN_SOCIAL_AI_USAGE_INVALID","Provider usage exceeds the authorized token envelope");
  const rate=model==="gpt-6-luna"?{input:0.1,output:0.5}:{input:0.15,output:0.6};
  return Number(usd((input*rate.input+output*rate.output)/1_000_000));
};
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export type SocialAiScope={orgId:string;workspaceId:string;campaignId:string;actorUserId:string};

export class CampaignSocialAiBudgetService{
  constructor(private readonly db:Db=getDb()){}
  async reserve(scope:SocialAiScope,input:{reviewId:string;platform:"YOUTUBE"|"TIKTOK";idempotencyKey:string;requestedMaximumUsd:number}){
    const reserved=maximumSocialAiCostUsd();
    if(!Number.isFinite(input.requestedMaximumUsd)||input.requestedMaximumUsd<reserved||input.requestedMaximumUsd>SOCIAL_AI_MAX_REQUEST_USD)throw new CampaignContentIterationError("CAMPAIGN_SOCIAL_AI_BUDGET_INVALID",`Per-request ceiling must be between ${reserved.toFixed(6)} and ${SOCIAL_AI_MAX_REQUEST_USD.toFixed(2)} USD`);
    const fp=digest({reviewId:input.reviewId,platform:input.platform,requestedMaximumUsd:usd(input.requestedMaximumUsd),model:SOCIAL_AI_MODEL,maxInputTokens:SOCIAL_AI_MAX_INPUT_TOKENS,maxOutputTokens:SOCIAL_AI_MAX_OUTPUT_TOKENS});
    return this.db.transaction(async tx=>{
      const [review]=await tx.select().from(schema.campaignMarketingReviews).where(and(eq(schema.campaignMarketingReviews.id,input.reviewId),eq(schema.campaignMarketingReviews.orgId,scope.orgId),eq(schema.campaignMarketingReviews.workspaceId,scope.workspaceId),eq(schema.campaignMarketingReviews.campaignId,scope.campaignId))).limit(1);
      if(!review||review.status!=="APPROVED")throw new CampaignContentIterationError("CAMPAIGN_SOCIAL_REVIEW_REQUIRED","Approved Marketing Review required");
      const member=await tx.execute<{role:string}>(sql`select wm.role from workspace_members wm where wm.workspace_id=${scope.workspaceId}::uuid and wm.org_id=${scope.orgId}::uuid and wm.user_id=${scope.actorUserId}::uuid limit 1`);
      if(!member[0]||!["admin","operator","editor"].includes(member[0].role))throw new CampaignContentIterationError("CAMPAIGN_ITERATION_ROLE_DENIED","Workspace role cannot generate Social Content");
      const [existing]=await tx.select().from(schema.campaignSocialAiClaims).where(and(eq(schema.campaignSocialAiClaims.iterationId,review.iterationId),eq(schema.campaignSocialAiClaims.idempotencyKey,input.idempotencyKey))).limit(1).for("update");
      if(existing){if(existing.requestFingerprint!==fp)throw new CampaignContentIterationError("CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT","AI generation key was reused");return{claim:existing,reused:true};}
      const [claim]=await tx.insert(schema.campaignSocialAiClaims).values({orgId:scope.orgId,workspaceId:scope.workspaceId,campaignId:scope.campaignId,iterationId:review.iterationId,marketingReviewId:review.id,platform:input.platform,idempotencyKey:input.idempotencyKey,requestFingerprint:fp,model:SOCIAL_AI_MODEL,maxInputTokens:SOCIAL_AI_MAX_INPUT_TOKENS,maxOutputTokens:SOCIAL_AI_MAX_OUTPUT_TOKENS,reservedMaximumUsd:usd(reserved),requestedMaximumUsd:usd(input.requestedMaximumUsd),createdBy:scope.actorUserId}).onConflictDoNothing({target:[schema.campaignSocialAiClaims.iterationId,schema.campaignSocialAiClaims.idempotencyKey]}).returning();
      if(claim)return{claim,reused:false};
      const [winner]=await tx.select().from(schema.campaignSocialAiClaims).where(and(eq(schema.campaignSocialAiClaims.iterationId,review.iterationId),eq(schema.campaignSocialAiClaims.idempotencyKey,input.idempotencyKey))).limit(1);
      if(!winner||winner.requestFingerprint!==fp)throw new CampaignContentIterationError("CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT","AI generation key was reused");return{claim:winner,reused:true};
    });
  }
  async markSubmitted(id:string){const [row]=await this.db.update(schema.campaignSocialAiClaims).set({status:"SUBMITTED",submittedAt:new Date()}).where(and(eq(schema.campaignSocialAiClaims.id,id),eq(schema.campaignSocialAiClaims.status,"RESERVED"))).returning();if(!row)throw new CampaignContentIterationError("CAMPAIGN_SOCIAL_AI_ALREADY_ATTEMPTED","AI request was already submitted");return row;}
  async cancelBeforeSubmission(id:string,code:string){await this.db.execute(sql`update campaign_social_ai_claims set status='CANCELLED',error_code=${code},completed_at=now() where id=${id}::uuid and status in ('RESERVED','SUBMITTED')`);}
  async markUnknown(id:string,code:string){await this.db.update(schema.campaignSocialAiClaims).set({status:"UNKNOWN",errorCode:code,completedAt:new Date()}).where(and(eq(schema.campaignSocialAiClaims.id,id),eq(schema.campaignSocialAiClaims.status,"SUBMITTED")));}
  async recordResult(id:string,input:{providerRequestId:string;providerModel:string;inputTokens:number;outputTokens:number;resultJson:Record<string,unknown>}){const [claim]=await this.db.select().from(schema.campaignSocialAiClaims).where(and(eq(schema.campaignSocialAiClaims.id,id),eq(schema.campaignSocialAiClaims.status,"SUBMITTED"))).limit(1);if(!claim||!isSocialAiModel(claim.model))throw new CampaignContentIterationError("CAMPAIGN_SOCIAL_AI_SETTLEMENT_CONFLICT","AI result has no compatible submitted claim");const actual=actualSocialAiCostUsd(input.inputTokens,input.outputTokens,claim.model);const [row]=await this.db.update(schema.campaignSocialAiClaims).set({status:"RESULT_READY",providerRequestId:input.providerRequestId,providerModel:input.providerModel,inputTokens:input.inputTokens,outputTokens:input.outputTokens,actualCostUsd:usd(actual),resultJson:input.resultJson}).where(and(eq(schema.campaignSocialAiClaims.id,id),eq(schema.campaignSocialAiClaims.status,"SUBMITTED"))).returning();if(!row)throw new CampaignContentIterationError("CAMPAIGN_SOCIAL_AI_SETTLEMENT_CONFLICT","AI result cannot be recorded twice");return row;}
  async finalize(id:string,draftId:string){const [row]=await this.db.update(schema.campaignSocialAiClaims).set({status:"SETTLED",draftId,completedAt:new Date()}).where(and(eq(schema.campaignSocialAiClaims.id,id),eq(schema.campaignSocialAiClaims.status,"RESULT_READY"))).returning();if(!row)throw new CampaignContentIterationError("CAMPAIGN_SOCIAL_AI_SETTLEMENT_CONFLICT","AI request cannot be settled twice");return row;}
}
