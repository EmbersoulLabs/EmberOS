import { describe,expect,it,vi } from "vitest";
import { generateCampaignSocialContent } from "../packages/agents/src/social-content-generation";
import { actualSocialAiCostUsd,maximumSocialAiCostUsd,SOCIAL_AI_MAX_OUTPUT_TOKENS } from "../packages/db/src/queries/campaign-social-ai-budget";

describe("Campaign Social AI generation",()=>{
 it("uses a bounded no-retry structured request and accepts YouTube copy",async()=>{
  const complete=vi.fn(async(input:any)=>({result:{platform:"YOUTUBE",content:{title:"Fresh flowers for thoughtful moments",description:"A fresh flower bouquet for Singapore gift buyers.",hashtags:["#FreshFlowers"]},disclosure:{containsAiGeneratedContent:true,label:"AI-assisted copy based on an approved creative."}},providerRequestId:"req_fixture",modelVersion:"gpt-4o-mini-2024-07-18",usage:{input:800,output:120,costUsd:0.000192},timings:{providerMs:1,decodeMs:1}}));
  const result=await generateCampaignSocialContent({platform:"YOUTUBE",businessFacts:{product:"Fresh flower bouquet"},approvedPlan:{objective:"awareness"},reviewFindings:{},artifactIdentity:"artifact:v1"},{complete});
  expect(result.draft.platform).toBe("YOUTUBE");expect(complete).toHaveBeenCalledOnce();expect(complete.mock.calls[0]![0].maxOutputTokens).toBe(SOCIAL_AI_MAX_OUTPUT_TOKENS);
 });
 it("rejects provider output for a different platform",async()=>{
  const complete=async()=>({result:{platform:"TIKTOK",content:{caption:"x",hashtags:[]},disclosure:{containsAiGeneratedContent:true,label:"AI"}},providerRequestId:"req",modelVersion:"gpt-4o-mini",usage:{input:1,output:1,costUsd:0},timings:{providerMs:1,decodeMs:1}});
  await expect(generateCampaignSocialContent({platform:"YOUTUBE",businessFacts:{},approvedPlan:{},reviewFindings:{},artifactIdentity:"a"},{complete})).rejects.toThrow();
 });
 it("enforces the certified token and cost envelope",()=>{
  expect(maximumSocialAiCostUsd()).toBe(0.01);expect(actualSocialAiCostUsd(12_000,1_200)).toBeLessThanOrEqual(maximumSocialAiCostUsd());expect(()=>actualSocialAiCostUsd(12_001,1)).toThrow("token envelope");
 });
 it("rejects oversized evidence before invoking a provider",async()=>{const complete=vi.fn();await expect(generateCampaignSocialContent({platform:"TIKTOK",businessFacts:{large:"x".repeat(10_001)},approvedPlan:{},reviewFindings:{},artifactIdentity:"a"},{complete})).rejects.toThrow("INPUT_LIMIT");expect(complete).not.toHaveBeenCalled();});
});
