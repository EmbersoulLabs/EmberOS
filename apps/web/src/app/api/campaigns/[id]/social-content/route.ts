import { eq } from "drizzle-orm";
import { z } from "zod";
import { CampaignSocialContentSchema, isUuid } from "@ceo-agent/shared";
import { CampaignSocialContentService, getDb, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/api";

const Command=z.discriminatedUnion("action",[
 z.object({action:z.literal("save"),reviewId:z.string().uuid(),expectedLatestRevision:z.number().int().nonnegative(),idempotencyKey:z.string().min(8).max(200),draft:CampaignSocialContentSchema}),
 z.object({action:z.literal("approve"),draftId:z.string().uuid(),expectedVersion:z.number().int().positive(),idempotencyKey:z.string().min(8).max(200)}),
]);
async function context(campaignId:string,userId:string){const db=getDb();const[campaign]=await db.select().from(schema.campaigns).where(eq(schema.campaigns.id,campaignId)).limit(1);return campaign?{db,scope:{orgId:campaign.orgId,workspaceId:campaign.workspaceId,campaignId,actorUserId:userId}}:null;}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{const user=await requireAuth();const{id}=await params;if(!isUuid(id))return apiError("Invalid Campaign","VALIDATION_ERROR",400);const iterationId=new URL(request.url).searchParams.get("iterationId");if(!iterationId||!isUuid(iterationId))return apiError("Invalid Content Iteration","VALIDATION_ERROR",400);const ctx=await context(id,user.id);if(!ctx)return apiError("Campaign not found","NOT_FOUND",404);return apiSuccess({drafts:await new CampaignSocialContentService(ctx.db).list(ctx.scope,iterationId)});}catch(error){return handleApiError(error);}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const user=await requireAuth();const{id}=await params;if(!isUuid(id))return apiError("Invalid Campaign","VALIDATION_ERROR",400);const parsed=Command.safeParse(await request.json());if(!parsed.success)return apiError(parsed.error.issues[0]?.message??"Invalid Social Content command","VALIDATION_ERROR",400);const ctx=await context(id,user.id);if(!ctx)return apiError("Campaign not found","NOT_FOUND",404);const service=new CampaignSocialContentService(ctx.db);const result=parsed.data.action==="save"?await service.createRevision(ctx.scope,{...parsed.data,generationMode:"MANUAL"}):await service.approve(ctx.scope,parsed.data);return apiSuccess(result,result.reused?200:201);}catch(error){return handleApiError(error);}}
