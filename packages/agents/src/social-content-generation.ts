import { z } from "zod";
import { CampaignSocialContentSchema, type CampaignSocialContent } from "@ceo-agent/shared";
import { callStructuredJsonModel, type StructuredJsonModelCompletion } from "./llm";

export type SocialContentGenerationInput={
  platform:"YOUTUBE"|"TIKTOK";
  businessFacts:Record<string,unknown>;
  approvedPlan:unknown;
  reviewFindings:unknown;
  artifactIdentity:string;
};
export const SOCIAL_AI_MAX_EVIDENCE_BYTES=10_000;
export type SocialContentCompletion=(input:{system:string;user:string;schema:z.ZodTypeAny;schemaName:string;model:"gpt-4o-mini";maxOutputTokens:number})=>Promise<StructuredJsonModelCompletion>;

const schemas={
  YOUTUBE:z.object({platform:z.literal("YOUTUBE"),content:z.object({title:z.string().min(1).max(100),description:z.string().min(1).max(5000),hashtags:z.array(z.string()).max(15)}),disclosure:z.object({containsAiGeneratedContent:z.boolean(),label:z.string().min(1).max(300)})}),
  TIKTOK:z.object({platform:z.literal("TIKTOK"),content:z.object({caption:z.string().min(1).max(2200),hashtags:z.array(z.string()).max(20)}),disclosure:z.object({containsAiGeneratedContent:z.boolean(),label:z.string().min(1).max(300)})}),
} as const;

export async function generateCampaignSocialContent(input:SocialContentGenerationInput,deps:{complete?:SocialContentCompletion}={}){
  const complete:SocialContentCompletion=deps.complete??((request)=>callStructuredJsonModel(request));
  const schema=schemas[input.platform];
  const evidence=JSON.stringify({platform:input.platform,businessFacts:input.businessFacts,approvedPlan:input.approvedPlan,reviewFindings:input.reviewFindings,artifactIdentity:input.artifactIdentity});
  if(Buffer.byteLength(evidence,"utf8")>SOCIAL_AI_MAX_EVIDENCE_BYTES)throw new Error("SOCIAL_AI_INPUT_LIMIT_EXCEEDED");
  const completion=await complete({
    model:"gpt-4o-mini",
    maxOutputTokens:1200,
    schema,
    schemaName:`campaign_social_${input.platform.toLowerCase()}_v1`,
    system:"Create platform-native social copy from authorized evidence only. Do not invent contact channels, prices, discounts, delivery, locations, rankings, testimonials, guarantees, or product attributes. The approved Business Profile facts are authoritative; planning suggestions are not facts. Return only the requested platform schema and include accurate AI-content disclosure metadata.",
    user:evidence,
  });
  if(completion.decodeIssue)throw new Error(`SOCIAL_AI_${completion.decodeIssue}`);
  const draft=CampaignSocialContentSchema.parse(completion.result) as CampaignSocialContent;
  if(draft.platform!==input.platform)throw new Error("SOCIAL_AI_PLATFORM_MISMATCH");
  return{draft,completion};
}
