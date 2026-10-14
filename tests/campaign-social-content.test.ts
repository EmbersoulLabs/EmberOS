import { describe,expect,it } from "vitest";
import { CampaignSocialContentSchema } from "@ceo-agent/shared";

describe("Campaign Phase 5 Social Content contract",()=>{
 it("accepts platform-native YouTube and TikTok drafts",()=>{
  expect(CampaignSocialContentSchema.parse({platform:"YOUTUBE",content:{title:"A useful title",description:"A useful description",hashtags:["#Singapore"]},disclosure:{containsAiGeneratedContent:false,label:"Human edited."}}).platform).toBe("YOUTUBE");
  expect(CampaignSocialContentSchema.parse({platform:"TIKTOK",content:{caption:"A concise native caption",hashtags:["#SingaporeTikTok"]},disclosure:{containsAiGeneratedContent:true,label:"AI-assisted copy, reviewed by a human."}}).platform).toBe("TIKTOK");
 });
 it("rejects cross-platform field substitution and malformed discovery metadata",()=>{
  expect(()=>CampaignSocialContentSchema.parse({platform:"YOUTUBE",content:{caption:"wrong",hashtags:["Singapore"]},disclosure:{containsAiGeneratedContent:false,label:"Human."}})).toThrow();
 });
});
