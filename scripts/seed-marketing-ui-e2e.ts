import { writeFileSync } from "node:fs";
import { getDb, schema } from "@ceo-agent/db";
import { isMarketingPackLocaleReady, type MarketingContentPackage } from "@ceo-agent/shared";

const seedFile = process.env.MARKETING_UI_SEED_FILE;
if (!seedFile) throw new Error("MARKETING_UI_SEED_FILE is required");
if (!process.env.DATABASE_URL?.includes("127.0.0.1")) {
  throw new Error("Refusing to seed without an isolated 127.0.0.1 DATABASE_URL");
}

const editorId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const outsiderId = crypto.randomUUID();
const orgId = crypto.randomUUID();
const workspaceId = crypto.randomUUID();
const campaignId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const exhaustedCampaignId = crypto.randomUUID();
const exhaustedTaskId = crypto.randomUUID();
const otherOrgId = crypto.randomUUID();
const otherWorkspaceId = crypto.randomUUID();
const otherCampaignId = crypto.randomUUID();
const otherTaskId = crypto.randomUUID();

function asset(caption: string, hook: string, cta: string) {
  return { caption, hook, cta, hashtags: ["cafe"] };
}

const contentPackage: MarketingContentPackage = {
  voiceScripts: { "15s": "十五秒脚本", "30s": "三十秒脚本", "60s": "六十秒脚本" },
  voiceScriptsZh: { "15s": "中文口播十五秒", "30s": "中文口播三十秒", "60s": "中文口播六十秒" },
  voiceScriptsEn: { "15s": "English voice fifteen", "30s": "English voice thirty", "60s": "English voice sixty" },
  subtitleTimeline: [{ startSec: 0, endSec: 3, text: "开场", role: "hook" }],
  captions: {
    tiktok: "抖音中文",
    instagram: "IG中文",
    facebook: "",
    linkedin: "",
    xiaohongshu: "小红书原文",
    youtubeShorts: "",
    googleBusiness: "",
  },
  captionsEn: {
    tiktok: "TikTok English",
    instagram: "IG English",
    facebook: "",
    linkedin: "",
    xiaohongshu: "",
    youtubeShorts: "",
    googleBusiness: "",
  },
  captionsMs: {
    tiktok: "TikTok Melayu",
    instagram: "IG Melayu",
    facebook: "",
    linkedin: "",
    xiaohongshu: "",
    youtubeShorts: "",
    googleBusiness: "",
  },
  hooks: [{ text: "十秒钩子", textEn: "Ten second hook", textMs: "Cangkuk sepuluh saat", type: "curiosity" }],
  cta: [{ text: "立即了解", textEn: "Learn more", textMs: "Ketahui lagi" }],
  musicMood: "Upbeat acoustic",
  broll: ["Product close-up"],
  effects: ["Soft zoom"],
  postingRecommendation: {
    bestPostingTime: "Weekdays 7pm",
    bestPlatform: "TikTok",
    idealAudience: "office workers",
    estimatedEngagement: "",
  },
  platformAssets: {
    tiktok: asset("抖音中文", "十秒钩子", "立即了解"),
    instagram: asset("IG中文", "十秒钩子", "立即了解"),
    xiaohongshu: asset("小红书原文", "十秒钩子", "立即了解"),
  },
  analysis: {
    marketingScore: 70,
    hookScore: 70,
    seoScore: 70,
    emotionalScore: 70,
    conversionScore: 70,
    estimatedCtr: "",
    estimatedEngagement: "",
    estimatedConversion: "",
  },
  contentOrigin: "template_fallback",
} as MarketingContentPackage;

if (!isMarketingPackLocaleReady(contentPackage, "en") || !isMarketingPackLocaleReady(contentPackage, "ms")) {
  throw new Error("Seeded marketing package is not locale-ready; refusing to start a server that could call a model");
}

const incompletePackage: MarketingContentPackage = {
  ...contentPackage,
  captionsEn: undefined,
  captionsMs: undefined,
  voiceScriptsEn: undefined,
  hooks: [{ text: "十秒钩子", type: "curiosity" }],
  cta: [{ text: "立即了解" }],
};

const strategyPlan = {
  industry: "restaurant",
  businessType: "cafe",
  product: "coffee",
  marketingGoal: "awareness",
  marketingAngle: "morning coffee",
  brandPersonality: ["warm"],
  tone: "warm",
  videoStyle: "lifestyle",
  audience: { interests: ["coffee"], painPoints: [] },
  customerJourney: "discover",
  keywords: ["coffee"],
  hashtags: { trending: [], seo: [], local: [], industry: [] },
  platformPriority: ["tiktok"],
  ctaStrategy: "visit",
  confidence: 0.8,
};

const stepProgress = {
  strategy_plan: { status: "completed", output: strategyPlan },
  vision_analyze: {
    status: "completed",
    output: {
      transcriptSummary: "A cup of coffee",
      subjects: ["coffee"],
      products: [{ name: "coffee" }],
      scenes: [],
      hooks: [],
      durationSec: 15,
    },
  },
  content_generate: {
    status: "completed",
    output: contentPackage,
    contentRevision: 0,
  },
};

async function main() {
const db = getDb();
await db.insert(schema.organizations).values([
  { id: orgId, name: "UI Cert Org", slug: `ui-${orgId.slice(0, 8)}` },
  { id: otherOrgId, name: "Other Org", slug: `other-${otherOrgId.slice(0, 8)}` },
]);
await db.insert(schema.workspaces).values([
  {
    id: workspaceId,
    orgId,
    name: "UI Cert Workspace",
    slug: "marketing-ui-e2e",
    brandProfile: { tone: "warm", industry: "F&B", targetAudience: "office workers", bannedWords: [], cta: "Visit" },
  },
  {
    id: otherWorkspaceId,
    orgId: otherOrgId,
    name: "Other Workspace",
    slug: "marketing-ui-other",
    brandProfile: {},
  },
]);
await db.insert(schema.workspaceMembers).values([
  { orgId, workspaceId, userId: editorId, role: "operator" },
  { orgId, workspaceId, userId: viewerId, role: "client_viewer" },
  { orgId: otherOrgId, workspaceId: otherWorkspaceId, userId: outsiderId, role: "editor" },
]);
await db.insert(schema.businessProfiles).values({
  orgId,
  workspaceId,
  companyName: "Ember Cafe",
  city: "Kuala Lumpur",
  services: ["Coffee"],
  businessDescription: "Roastery",
});
await db.insert(schema.campaigns).values([
  {
    id: campaignId,
    orgId,
    workspaceId,
    name: "Cafe Launch",
    platforms: ["tiktok", "instagram"],
    status: "ready",
    generateStatus: "completed",
  },
  {
    id: exhaustedCampaignId,
    orgId,
    workspaceId,
    name: "Exhausted Budget",
    platforms: ["tiktok"],
    status: "ready",
    generateStatus: "completed",
  },
  {
    id: otherCampaignId,
    orgId: otherOrgId,
    workspaceId: otherWorkspaceId,
    name: "Other Workspace Campaign",
    platforms: ["tiktok"],
    status: "ready",
    generateStatus: "completed",
  },
]);
await db.insert(schema.tasks).values([
  {
    id: taskId,
    orgId,
    workspaceId,
    campaignId,
    status: "completed",
    strategyJson: strategyPlan,
    stepProgress,
    costUsd: "0",
    costBudgetUsd: "0.50",
  },
  {
    id: exhaustedTaskId,
    orgId,
    workspaceId,
    campaignId: exhaustedCampaignId,
    status: "completed",
    stepProgress: {
      content_generate: { status: "completed", output: incompletePackage, contentRevision: 0 },
    },
    costUsd: "0.50",
    costBudgetUsd: "0.50",
  },
  {
    id: otherTaskId,
    orgId: otherOrgId,
    workspaceId: otherWorkspaceId,
    campaignId: otherCampaignId,
    status: "completed",
    stepProgress: {
      content_generate: { status: "completed", output: contentPackage, contentRevision: 0 },
    },
    costUsd: "0",
    costBudgetUsd: "0.50",
  },
]);

writeFileSync(
  seedFile,
  JSON.stringify(
    {
      editorId,
      viewerId,
      outsiderId,
      workspaceSlug: "marketing-ui-e2e",
      campaignId,
      taskId,
      exhaustedTaskId,
      otherCampaignId,
      databaseUrl: process.env.DATABASE_URL,
    },
    null,
    2
  )
);
console.log(`seeded marketing ui e2e campaign ${campaignId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
