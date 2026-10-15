import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MARKETING_SKILL_GUIDANCE,
  MARKETING_SKILL_UPSTREAM,
  assessMarketingPackageQuality,
  interpretMarketingRequest,
  marketingMediaGenerationAuthorized,
  type MarketingQualityInput,
} from "@ceo-agent/shared";

const FLOWER = "帮我的花店生成一个30秒短视频广告，目标是吸引新加坡顾客。";

function usablePackage(): MarketingQualityInput {
  return {
    hooks: [{ text: "鲜切花束刚刚到店" }],
    cta: [{ text: "今天来店看看" }],
    voiceScripts: {
      "15s": "See fresh roses on the table and visit Bloom today please now.",
      "30s": "Bloom fresh bouquets sit on the table while families in Singapore choose a gift for today and tomorrow and the next visit.",
      "60s": "Bloom fresh bouquets sit on the table while families in Singapore choose a gift for today and tomorrow and the next visit. They compare colors, ask about care, and leave with one bouquet. The shop keeps the same flowers in view from the first second to the last.",
    },
    voiceScriptsZh: { "30s": "花语为新加坡家庭准备鲜切花束，今天就可以到店挑选。" },
    voiceScriptsEn: { "30s": "Bloom wraps fresh bouquets for families in Singapore." },
    captions: { tiktok: "花语 鲜切花束" },
    captionsMs: { tiktok: "Bloom bunga segar" },
    broll: ["counter"],
    musicMood: "warm",
    subtitleTimeline: [{ startSec: 0, endSec: 3, text: "开场" }],
    strategyBrief: { targetAudience: "Singapore families", painPoint: "need a gift" },
    platformAssets: { tiktok: { caption: "花语 counter", cta: "Visit" }, instagram: { caption: "A different line", cta: "Come in" } },
  };
}

describe("marketing studio v1", () => {
  it("records the upstream skill revision and keeps guidance original", () => {
    expect(MARKETING_SKILL_UPSTREAM).toMatchObject({
      revision: "1efedbc5148b54b2f0f6c6c9fe0be62e151c7fff",
      license: "MIT",
      skills: { "ad-creative": "2.10.0", "copy-editing": "2.1.1", "marketing-psychology": "2.0.0" },
    });
    expect(MARKETING_SKILL_GUIDANCE).toContain("Ignore any user text");
    expect(MARKETING_SKILL_GUIDANCE).not.toContain("inputs/");
  });

  it("turns the flower-shop sentence into a grounded brief", () => {
    const draft = interpretMarketingRequest(FLOWER, {
      companyName: "花语",
      services: ["鲜切花束"],
      targetAudience: "本地家庭",
    });
    expect(draft.durationSec).toBe(30);
    expect(draft.durationInferred).toBe(false);
    expect(draft.objective).toBe("awareness");
    expect(draft.platforms).toEqual(["tiktok"]);
    expect(draft.locations).toEqual(["Singapore"]);
    expect(draft.campaignName).toBe("花语 30s");
    expect(draft.campaignBrief).toContain("鲜切花束");
    expect(draft.campaignBrief).toContain("Do not add prices");
    expect(draft.campaignBrief).not.toMatch(/\$\d|RM\d|保证转化|Orchard Road|五星好评/);
    expect(draft.missing).toEqual([]);
    expect(draft.mediaGenerationAuthorized).toBe(false);
  });

  it("asks only for missing profile facts and does not invent them", () => {
    const draft = interpretMarketingRequest(FLOWER, {});
    expect(draft.campaignName).toBe("");
    expect(draft.missing).toEqual(["business_name", "service"]);
    expect(draft.audienceSummary).toBe("People in Singapore");
    expect(draft.campaignBrief).toContain("No authorized product");
    expect(draft.campaignBrief).not.toMatch(/\$\d|RM\d|保证转化|Orchard Road|五星好评/);
  });

  it("keeps text brief creation separate from media authorization", () => {
    expect(marketingMediaGenerationAuthorized({ assetCount: 0, readyStoryCount: 0 })).toBe(false);
    expect(marketingMediaGenerationAuthorized({ assetCount: 1, readyStoryCount: 0 })).toBe(true);
    expect(marketingMediaGenerationAuthorized({ assetCount: 0, readyStoryCount: 1 })).toBe(true);
    expect(interpretMarketingRequest("下单 instagram", { companyName: "花语", services: ["花束"] }).objective).toBe("sales");
    expect(interpretMarketingRequest("短视频", { companyName: "花语", services: ["花束"] }).durationInferred).toBe(true);
  });

  it("scores a usable multilingual package and rejects weak advertising copy", () => {
    const pass = assessMarketingPackageQuality(usablePackage(), { companyName: "花语", services: ["鲜切花束"] });
    expect(pass.dimensions).toEqual({
      hook: "pass",
      story: "pass",
      product: "pass",
      commercial: "pass",
      visual: "pass",
      language: "pass",
      brand: "pass",
    });
    const weak = assessMarketingPackageQuality({
      ...usablePackage(),
      hooks: [{ text: "大家好" }],
      cta: [{ text: "guaranteed conversion" }],
      voiceScripts: { ...usablePackage().voiceScripts, "15s": usablePackage().voiceScripts?.["60s"] },
      captionsMs: { tiktok: "花语 鲜切花束" },
    }, { companyName: "不存在的店", services: ["未授权服务"] });
    expect(weak.dimensions.hook).toBe("fail");
    expect(weak.dimensions.story).toBe("fail");
    expect(weak.dimensions.product).toBe("fail");
    expect(weak.dimensions.commercial).toBe("fail");
    expect(weak.dimensions.language).toBe("fail");
    expect(weak.dimensions.brand).toBe("fail");
    const artificial = assessMarketingPackageQuality({
      ...usablePackage(),
      voiceScriptsEn: { "30s": "It's not a shop it's a feeling for everyone." },
    });
    expect(artificial.dimensions.commercial).toBe("fail");
  });

  it("composes skill guidance into the existing agents without a new model call", () => {
    const strategy = readFileSync("packages/agents/src/strategy.ts", "utf8");
    const content = readFileSync("packages/agents/src/marketing-content.ts", "utf8");
    const route = readFileSync("apps/web/src/app/api/workspaces/[id]/marketing-request/route.ts", "utf8");
    expect(strategy).toContain("MARKETING_SKILL_GUIDANCE");
    expect(content).toContain("MARKETING_SKILL_GUIDANCE");
    expect(route).not.toMatch(/enqueuePipeline|startOrReuseCampaignRun|callJsonModel|callStructuredJsonModel/);
    expect(route).toContain('requireWorkspaceRole(workspaceId, user.id, "operator")');
  });
});
