import { describe, expect, it } from "vitest";
import {
  CampaignVideoGenerationIdentityV1Schema,
  normalizeCampaignVideoGenerationIdentityV1,
  type CampaignVideoGenerationIdentityV1,
} from "../packages/shared/src/campaign-video-generation-identity";
import { fingerprintCampaignVideoGenerationIdentityV1 } from "../packages/shared/src/campaign-video-generation-identity.server";
import { getCampaignAssets } from "../apps/web/src/lib/campaign-assets";
import { readFileSync } from "node:fs";

const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;

function identity(): CampaignVideoGenerationIdentityV1 {
  return {
    version: 1,
    executionContract: "campaign-video-generation-v1",
    authority: {
      organizationId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      campaignId: "33333333-3333-4333-8333-333333333333",
    },
    generation: {
      campaignName: " Launch ", effectiveGoal: " Grow sales ", campaignBrief: "  Brief  ", targetAudience: null,
      platforms: ["tiktok", "instagram"], contentLocale: "en",
      treatment: { contentStyle: "promotional", voicePreset: "auto", bgmPreference: "auto", bgmStartPreference: "auto",
        renderPreferences: { subtitleStyle: "minimal", subtitleLanguage: "en" } },
      businessContext: { industry: " Retail ", tone: " Bold ", bannedWords: ["cheap", " spam ", "cheap"], cta: " Buy now ", targetAudience: null, locale: "en-SG", logoObjectReference: null },
      sources: [
        { assetId: "44444444-4444-4444-8444-444444444444", contentHash: hashA, mediaKind: "video" },
        { assetId: "55555555-5555-4555-8555-555555555555", contentHash: hashB, mediaKind: "image" },
      ],
    },
  };
}

describe("VS-RC-01A.3B Campaign task generation identity", () => {
  it("normalizes set-like and optional values without reordering sources", () => {
    const first = normalizeCampaignVideoGenerationIdentityV1(identity());
    const second = normalizeCampaignVideoGenerationIdentityV1({ ...identity(), generation: { ...identity().generation, platforms: ["instagram", "tiktok", "instagram"], businessContext: { ...identity().generation.businessContext, bannedWords: ["spam", "cheap"] } } });
    expect(first.generation.sources.map((source) => source.assetId)).toEqual(identity().generation.sources.map((source) => source.assetId));
    expect(fingerprintCampaignVideoGenerationIdentityV1(first)).toBe(fingerprintCampaignVideoGenerationIdentityV1(second));
  });

  it.each([
    ["source bytes", (value: CampaignVideoGenerationIdentityV1) => { value.generation.sources[0]!.contentHash = hashB; }],
    ["source order", (value: CampaignVideoGenerationIdentityV1) => { value.generation.sources.reverse(); }],
    ["campaign name", (value: CampaignVideoGenerationIdentityV1) => { value.generation.campaignName = "Other"; }],
    ["goal", (value: CampaignVideoGenerationIdentityV1) => { value.generation.effectiveGoal = "Other"; }],
    ["business tone", (value: CampaignVideoGenerationIdentityV1) => { value.generation.businessContext.tone = "Calm"; }],
    ["subtitle preference", (value: CampaignVideoGenerationIdentityV1) => { value.generation.treatment.renderPreferences.subtitleStyle = "social"; }],
  ])("changes fingerprint when %s changes", (_label, mutate) => {
    const before = identity(); const after = identity(); mutate(after);
    expect(fingerprintCampaignVideoGenerationIdentityV1(after)).not.toBe(fingerprintCampaignVideoGenerationIdentityV1(before));
  });

  it("rejects unknown versions and malformed source hashes", () => {
    expect(CampaignVideoGenerationIdentityV1Schema.safeParse({ ...identity(), version: 2 }).success).toBe(false);
    const malformed = identity(); malformed.generation.sources[0]!.contentHash = "sha256:nope";
    expect(CampaignVideoGenerationIdentityV1Schema.safeParse(malformed).success).toBe(false);
  });

  it("keeps Node crypto out of the browser-safe contract and preserves architecture boundaries", () => {
    const shared = readFileSync("packages/shared/src/campaign-video-generation-identity.ts", "utf8");
    const run = readFileSync("apps/web/src/lib/campaign-run.ts", "utf8");
    expect(shared).not.toMatch(/node:crypto|@ceo-agent\/db|ai-story|creative-studio/i);
    expect(run).not.toMatch(/VideoStudioProject|VideoStudioStatus|generation_input_fingerprint.*unique/i);
  });

  it("keeps the effective source resolver as the canonical ordering boundary", () => {
    expect(typeof getCampaignAssets).toBe("function");
    const source = readFileSync("apps/web/src/lib/campaign-assets.ts", "utf8");
    expect(source).toContain("asc(schema.assets.createdAt), asc(schema.assets.id)");
    expect(source).toContain("campaignAssetRefs");
    expect(source).not.toMatch(/campaignStoryRefs|ai-story/i);
  });

  it("migration enforces paired nullable identity without uniqueness or backfill", () => {
    const sql = readFileSync("packages/db/sql/campaign-video-generation-identity-v1.sql", "utf8");
    expect(sql).toContain("tasks_generation_input_pair_check");
    expect(sql).toContain("tasks_generation_input_fingerprint_check");
    expect(sql).not.toMatch(/unique|update tasks/i);
  });
});
