import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { CampaignMarketingReviewFindingsSchema,CampaignMarketingReviewStatusSchema } from "@ceo-agent/shared";

describe("Campaign actual-artifact Marketing Review",()=>{
 it("distinguishes human decisions and never implies unperformed media analysis",()=>{
  expect(CampaignMarketingReviewStatusSchema.options).toEqual(["PENDING_REVIEW","APPROVED","CHANGES_REQUESTED"]);
  expect(CampaignMarketingReviewFindingsSchema.parse({provenance:{status:"PASS",detail:"bound"},planAlignment:{status:"PASS",detail:"bound"},businessGrounding:{status:"NOT_EVALUATED",detail:"not analyzed"},visualQuality:{status:"NOT_EVALUATED",detail:"not analyzed"},audioQuality:{status:"NOT_EVALUATED",detail:"not analyzed"}}).visualQuality.status).toBe("NOT_EVALUATED");
 });
 it("uses canonical final artifact authorities for all three independent modules",()=>{
  const source=readFileSync("packages/db/src/queries/campaign-marketing-reviews.ts","utf8");
  expect(source).toContain("from creatives"); expect(source).toContain("photo_scene_generations");
  expect(source).toContain("ai_story_final_story_results"); expect(source).toContain("ai_story_assembly_artifacts");
  expect(source).not.toContain("from ai_stories where");
 });
 it("keeps approval as a social-content readiness boundary, not generation",()=>{
  const source=readFileSync("packages/db/src/queries/campaign-marketing-reviews.ts","utf8");
  expect(source).toContain("READY_FOR_SOCIAL_CONTENT"); expect(source).not.toContain("generateSocial");
 });
});
