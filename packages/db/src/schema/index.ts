import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  doublePrecision,
  bigint,
  boolean,
  unique,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("free"),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.userId)]
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    brandProfile: jsonb("brand_profile").$type<Record<string, unknown>>().default({}),
    platformAccounts: jsonb("platform_accounts").$type<unknown[]>().default([]),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.orgId, t.slug)]
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id"),
    role: text("role").notNull().default("operator"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.userId)]
);

/** SPEC-001 Business Profile — 1:1 with workspace. */
export const businessProfiles = pgTable(
  "business_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyName: text("company_name"),
    industryId: text("industry_id"),
    industryDisplayName: text("industry_display_name"),
    industryCustomValue: text("industry_custom_value"),
    services: text("services").array().notNull().default([]),
    businessDescription: text("business_description"),
    targetAudience: text("target_audience"),
    businessHours: jsonb("business_hours").$type<import("@ceo-agent/shared").BusinessHours>().default([]),
    businessEmail: text("business_email"),
    businessPhone: text("business_phone"),
    whatsappBusiness: text("whatsapp_business"),
    website: text("website"),
    facebook: text("facebook"),
    instagram: text("instagram"),
    tiktok: text("tiktok"),
    youtube: text("youtube"),
    redNote: text("red_note"),
    linkedIn: text("linkedin"),
    country: text("country"),
    stateProvince: text("state_province"),
    city: text("city"),
    address: text("address"),
    postalCode: text("postal_code"),
    timezone: text("timezone"),
    brandPersonality: text("brand_personality").array().notNull().default([]),
    brandStyle: text("brand_style").array().notNull().default([]),
    brandValues: text("brand_values").array().notNull().default([]),
    brandKeywords: text("brand_keywords").array().notNull().default([]),
    logo: text("logo"),
    brandColors: text("brand_colors").array().notNull().default([]),
    brandFonts: text("brand_fonts").array().notNull().default([]),
    brandImages: text("brand_images").array().notNull().default([]),
    supportedLanguages: text("supported_languages").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique().on(t.workspaceId),
    index("business_profiles_workspace_idx").on(t.workspaceId),
  ]
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    goal: text("goal"),
    platforms: text("platforms").array().notNull().default([]),
    industry: text("industry"),
    strategyJson: jsonb("strategy_json").$type<Record<string, unknown>>(),
    objectives: text("objectives").array().default([]),
    status: text("status").notNull().default("draft"),
    campaignBrief: text("campaign_brief"),
    voicePreset: text("voice_preset").default("auto"),
    contentStyle: text("content_style"),
    campaignGoal: text("campaign_goal"),
    bgmPreference: text("bgm_preference").default("auto"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_workspace_idx").on(t.workspaceId)]
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type"),
    durationSec: numeric("duration_sec"),
    width: integer("width"),
    height: integer("height"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    contentHash: text("content_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_campaign_idx").on(t.campaignId)]
);

/** Campaign → Asset references (Photo Scene / Asset Library). File ownership stays on assets. */
export const campaignAssetRefs = pgTable(
  "campaign_asset_refs",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.campaignId, t.assetId),
    index("campaign_asset_refs_campaign_idx").on(t.campaignId, t.sortOrder),
  ]
);

/** Photo Scene generation/extraction execution identity. Not Video Studio tasks. */
export const photoSceneGenerations = pgTable(
  "photo_scene_generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    operation: text("operation").notNull().default("product_extraction"),
    status: text("status").notNull().default("queued"),
    sourceAssetId: uuid("source_asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    sourceContentHash: text("source_content_hash").notNull(),
    inputCapsule: jsonb("input_capsule").$type<Record<string, unknown>>().notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    outputAssetId: uuid("output_asset_id").references(() => assets.id, { onDelete: "set null" }),
    providerKey: text("provider_key"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    boundedError: text("bounded_error"),
    costUsd: numeric("cost_usd"),
    createdBy: uuid("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("photo_scene_generations_workspace_idx").on(t.workspaceId, t.createdAt),
    index("photo_scene_generations_campaign_idx").on(t.campaignId, t.createdAt),
    index("photo_scene_generations_reuse_idx").on(
      t.workspaceId,
      t.operation,
      t.inputFingerprint,
      t.status
    ),
    uniqueIndex("photo_scene_generations_inflight_fingerprint_idx")
      .on(t.workspaceId, t.operation, t.inputFingerprint)
      .where(sql`${t.status} in ('queued', 'processing')`),
  ]
);

/** Global Official Scene Library. Not tenant-owned. Versions are immutable once published. */
export const photoSceneOfficialScenes = pgTable("photo_scene_official_scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const photoSceneOfficialSceneVersions = pgTable(
  "photo_scene_official_scene_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => photoSceneOfficialScenes.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    supportedPresets: text("supported_presets").array().notNull(),
    backgroundStorageIdentity: text("background_storage_identity").notNull(),
    backgroundContentHash: text("background_content_hash").notNull(),
    previewStorageIdentity: text("preview_storage_identity").notNull(),
    safeArea: jsonb("safe_area").$type<Record<string, unknown>>().notNull(),
    productAnchor: text("product_anchor").notNull(),
    scaleMin: numeric("scale_min").notNull(),
    scaleMax: numeric("scale_max").notNull(),
    defaultScale: numeric("default_scale").notNull(),
    defaultOffsetX: numeric("default_offset_x").notNull().default("0"),
    defaultOffsetY: numeric("default_offset_y").notNull().default("0"),
    defaultShadowPreset: text("default_shadow_preset").notNull().default("soft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.sceneId, t.version),
    uniqueIndex("photo_scene_official_scene_one_published_idx")
      .on(t.sceneId)
      .where(sql`${t.status} = 'published'`),
    index("photo_scene_official_scene_versions_status_idx").on(t.status, t.sceneId),
  ]
);

/** Tenant-owned frozen official-scene + placement selection. Not a marketing image. */
export const photoSceneSceneSelections = pgTable(
  "photo_scene_scene_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    extractedAssetId: uuid("extracted_asset_id").references(() => assets.id, { onDelete: "restrict" }),
    frozenSelection: jsonb("frozen_selection").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.workspaceId, t.campaignId),
    index("photo_scene_scene_selections_campaign_idx").on(t.campaignId),
  ]
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    ceoPlan: jsonb("ceo_plan").$type<Record<string, unknown>>(),
    strategyJson: jsonb("strategy_json").$type<Record<string, unknown>>(),
    hooksJson: jsonb("hooks_json").$type<Record<string, unknown>>(),
    marketingScoreJson: jsonb("marketing_score_json").$type<Record<string, unknown>>(),
    currentStep: text("current_step"),
    stepProgress: jsonb("step_progress").$type<Record<string, unknown>>().default({}),
    retryCount: integer("retry_count").notNull().default(0),
    costUsd: numeric("cost_usd").default("0"),
    costBudgetUsd: numeric("cost_budget_usd").default("0.50"),
    errorMessage: text("error_message"),
    generationInputCapsule: jsonb("generation_input_capsule").$type<Record<string, unknown>>(),
    generationInputFingerprint: text("generation_input_fingerprint"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_campaign_idx").on(t.campaignId)]
);

export const creatives = pgTable(
  "creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"),
    copyVariants: jsonb("copy_variants").$type<unknown[]>().default([]),
    selectedCopyId: text("selected_copy_id"),
    videoUrl: text("video_url"),
    videoExportUrl: text("video_export_url"),
    coverUrl: text("cover_url"),
    editPlan: jsonb("edit_plan").$type<Record<string, unknown>>(),
    complianceResult: jsonb("compliance_result").$type<Record<string, unknown>>(),
    marketingScoreJson: jsonb("marketing_score_json").$type<Record<string, unknown>>(),
    selectedHookId: text("selected_hook_id"),
    publishStatus: text("publish_status").default("none"),
    renderStatus: text("render_status").default("none"),
    renderProgress: jsonb("render_progress").$type<Record<string, unknown>>(),
    renderCachePath: text("render_cache_path"),
    renderCacheFingerprint: text("render_cache_fingerprint"),
    platformAdaptations: jsonb("platform_adaptations").$type<Record<string, unknown>>().default({}),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("creatives_campaign_idx").on(t.campaignId)]
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => creatives.id, { onDelete: "cascade" }),
    reviewerType: text("reviewer_type").notNull(),
    reviewerId: uuid("reviewer_id"),
    reviewerEmail: text("reviewer_email"),
    decision: text("decision").notNull().default("pending"),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_creative_idx").on(t.creativeId)]
);

export const clientInvites = pgTable(
  "client_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    creativeId: uuid("creative_id").references(() => creatives.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    email: text("email"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("client_invites_token_idx").on(t.token)]
);

export const publishJobs = pgTable("publish_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  creativeId: uuid("creative_id")
    .notNull()
    .references(() => creatives.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  status: text("status").notNull().default("export_pending"),
  exportPackUrl: text("export_pack_url"),
  externalPostId: text("external_post_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usageRecords = pgTable("usage_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id"),
  metric: text("metric").notNull(),
  amount: numeric("amount").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentLogs = pgTable("agent_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  taskId: uuid("task_id").references(() => tasks.id),
  agent: text("agent").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: numeric("cost_usd"),
  inputSummary: jsonb("input_summary").$type<Record<string, unknown>>(),
  outputJson: jsonb("output_json").$type<Record<string, unknown>>(),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketingScores = pgTable(
  "marketing_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    creativeId: uuid("creative_id").references(() => creatives.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    overallScore: numeric("overall_score"),
    hookScore: numeric("hook_score"),
    visualScore: numeric("visual_score"),
    copyScore: numeric("copy_score"),
    ctaScore: numeric("cta_score"),
    platformFitScore: numeric("platform_fit_score"),
    improvements: jsonb("improvements").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("marketing_scores_creative_idx").on(t.creativeId)]
);

export const knowledgeEntries = pgTable(
  "knowledge_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id"),
    workspaceId: uuid("workspace_id"),
    industry: text("industry").notNull(),
    category: text("category").notNull(),
    hookType: text("hook_type"),
    locale: text("locale").default("zh-CN"),
    title: text("title"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    performanceScore: numeric("performance_score"),
    usageCount: integer("usage_count").default(0),
    isActive: integer("is_active").default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_entries_industry_idx").on(t.industry, t.category)]
);

export const contentAnalytics = pgTable(
  "content_analytics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    creativeId: uuid("creative_id")
      .notNull()
      .references(() => creatives.id, { onDelete: "cascade" }),
    publishJobId: uuid("publish_job_id").references(() => publishJobs.id),
    platform: text("platform").notNull(),
    metricDate: timestamp("metric_date", { withTimezone: true }).notNull(),
    views: bigint("views", { mode: "number" }).default(0),
    reach: bigint("reach", { mode: "number" }).default(0),
    engagement: bigint("engagement", { mode: "number" }).default(0),
    clicks: bigint("clicks", { mode: "number" }).default(0),
    leads: bigint("leads", { mode: "number" }).default(0),
    conversions: bigint("conversions", { mode: "number" }).default(0),
    raw: jsonb("raw").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_analytics_creative_idx").on(t.creativeId, t.platform)]
);

export const workspaceInsights = pgTable(
  "workspace_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    insightType: text("insight_type").notNull(),
    platform: text("platform"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sampleSize: integer("sample_size").default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workspace_insights_ws_idx").on(t.workspaceId, t.insightType)]
);

// --- AI Story overlay (EXEC-02) + structural compile deps ---
export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("stories_workspace_idx").on(t.workspaceId),
    index("stories_workspace_deleted_idx").on(t.workspaceId, t.deletedAt),
  ]
);

/** Many-to-many Story ↔ Asset with persisted business ordering (PD-036/037). */

export const storyAssets = pgTable(
  "story_assets",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.storyId, t.assetId),
    index("story_assets_story_idx").on(t.storyId, t.sortOrder),
    index("story_assets_asset_idx").on(t.assetId),
  ]
);

/** Campaign → Asset references (no file ownership). */

export const campaignStoryRefs = pgTable(
  "campaign_story_refs",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.campaignId, t.storyId),
    index("campaign_story_refs_campaign_idx").on(t.campaignId),
  ]
);

/** Campaign-owned AI Story (V1) — not workspace Asset Story. */

export const aiStories = pgTable(
  "ai_stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    originalIdea: text("original_idea").notNull(),
    status: text("status").notNull().default("draft"),
    currentVersionId: uuid("current_version_id"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_stories_campaign_idx").on(t.campaignId),
    index("ai_stories_workspace_idx").on(t.workspaceId, t.status),
  ]
);

export const aiStoryVersions = pgTable(
  "ai_story_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    structuredContent: jsonb("structured_content")
      .$type<import("@ceo-agent/shared").AiStoryStructuredDraft>()
      .notNull(),
    sourceContextSnapshot: jsonb("source_context_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    aiMetadata: jsonb("ai_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    userEdited: boolean("user_edited").notNull().default(false),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    frozenBy: uuid("frozen_by"),
  },
  (t) => [
    unique().on(t.storyId, t.versionNumber),
    index("ai_story_versions_story_idx").on(t.storyId, t.versionNumber),
  ]
);

export const aiStoryAssetLinks = pgTable(
  "ai_story_asset_links",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    usageType: text("usage_type").notNull().default("reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.storyId, t.assetId),
    index("ai_story_asset_links_asset_idx").on(t.assetId),
  ]
);

export const aiStoryCreativeContexts = pgTable(
  "ai_story_creative_contexts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "cascade" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<import("@ceo-agent/shared").CreativeContext>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_story_creative_contexts_story_idx").on(t.storyId, t.createdAt),
    index("ai_story_creative_contexts_workspace_idx").on(t.workspaceId, t.createdAt),
  ]
);

export const aiStoryAnimationPackages = pgTable(
  "ai_story_animation_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "cascade" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("generating"),
    payload: jsonb("payload")
      .$type<
        | import("@ceo-agent/shared").AnimationPackagePayload
        | import("@ceo-agent/shared").StoryPlanningDraft
      >()
      .notNull(),
    consistencyReport: jsonb("consistency_report")
      .$type<import("@ceo-agent/shared").NarrativeIntegrationReport>()
      .notNull()
      .default({ consistent: false, issues: [], links: [] }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
  },
  (t) => [
    index("ai_story_animation_packages_story_idx").on(t.storyId, t.createdAt),
    index("ai_story_animation_packages_workspace_idx").on(t.workspaceId, t.createdAt),
    index("ai_story_animation_packages_status_idx").on(t.status),
    index("ai_story_animation_packages_workspace_status_idx").on(t.workspaceId, t.status),
  ]
);

/**
 * Sprint 3 Phase 2A — immutable, content-addressed Scene instructions.
 * Content hash is the primary identity; org/workspace record first-writer scope.
 * Canonical compiled instruction authority. See docs/architecture/scene-intent-storage.md
 * for why Scene rows also retain Intent envelope JSON.
 */

export const aiStorySceneInstructionSnapshots = pgTable(
  "ai_story_scene_instruction_snapshots",
  {
    contentHash: text("content_hash").primaryKey(),
    snapshotId: uuid("snapshot_id").notNull().unique(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    contractVersion: text("contract_version").notNull(),
    instructions: jsonb("instructions")
      .$type<import("@ceo-agent/shared").AiStorySceneCompiledInstructions>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_story_instruction_snapshots_id_idx").on(t.snapshotId),
    index("ai_story_instruction_snapshots_workspace_idx").on(t.workspaceId, t.createdAt),
  ]
);

/**
 * Sprint 3 Phase 2A — one canonical plan per deterministic compilation identity.
 * Uniqueness is `deterministic_fingerprint` (workspace + version + package +
 * compilation hash + ordered scene identities), not Story Version alone.
 */

export const aiStoryExecutionPlans = pgTable(
  "ai_story_execution_plans",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id").notNull().references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id").notNull().references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("PLANNED"),
    contractVersion: text("contract_version").notNull(),
    compilationHash: text("compilation_hash").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    plan: jsonb("plan").$type<import("@ceo-agent/shared").AiStoryExecutionPlan>().notNull(),
    compiledAt: timestamp("compiled_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_execution_plans_fingerprint_unique").on(t.deterministicFingerprint),
    index("ai_story_execution_plans_workspace_idx").on(t.workspaceId, t.createdAt),
    index("ai_story_execution_plans_story_idx").on(t.storyId, t.createdAt),
    index("ai_story_execution_plans_story_version_idx").on(t.workspaceId, t.storyVersionId, t.createdAt),
  ]
);

/**
 * Sprint 3 Phase 2A — Scene row for one plan (status PLANNED only).
 * `intent` retains non-reconstructable Intent envelope fields only; instruction
 * bodies are authoritative on Instruction Snapshots.
 */

export const aiStorySceneExecutions = pgTable(
  "ai_story_scene_executions",
  {
    id: uuid("id").primaryKey(),
    executionPlanId: uuid("execution_plan_id").notNull().references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id").notNull().references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id").notNull().references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    sceneId: text("scene_id").notNull(),
    sceneOrder: integer("scene_order").notNull(),
    status: text("status").notNull().default("PLANNED"),
    idempotencyKey: text("idempotency_key").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    compilationHash: text("compilation_hash").notNull(),
    instructionHash: text("instruction_hash").notNull().references(() => aiStorySceneInstructionSnapshots.contentHash, { onDelete: "restrict" }),
    intent: jsonb("intent").$type<import("@ceo-agent/shared").AiStorySceneExecutionIntent>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_executions_plan_scene_unique").on(t.executionPlanId, t.sceneId),
    unique("ai_story_scene_executions_plan_order_unique").on(t.executionPlanId, t.sceneOrder),
    unique("ai_story_scene_executions_idempotency_unique").on(t.idempotencyKey),
    index("ai_story_scene_executions_plan_idx").on(t.executionPlanId, t.sceneOrder),
  ]
);

/** Sprint 3 Phase 2A — append-only deterministic AI QC facts (not human review). */

export const aiStorySceneIntentValidationResults = pgTable(
  "ai_story_scene_intent_validation_results",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id").notNull().references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id").notNull().references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    intentHash: text("intent_hash").notNull(),
    resultHash: text("result_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    status: text("status").notNull(),
    result: jsonb("result").$type<import("@ceo-agent/shared").AiStoryAiQcResult>().notNull(),
    validatedAt: timestamp("validated_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_validation_result_unique").on(t.sceneExecutionId, t.resultHash),
    index("ai_story_scene_validation_scene_idx").on(t.sceneExecutionId, t.acceptedAt),
    index("ai_story_scene_validation_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_scene_validation_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/**
 * Sprint 3 Phase 2B PR 2B.1 — append-only ReviewOpenedFact rows.
 * One open fact per Execution Plan. Review is a logical aggregate only.
 */

export const aiStoryReviewOpenedFacts = pgTable(
  "ai_story_review_opened_facts",
  {
    factId: uuid("fact_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id").notNull().references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    openedBy: uuid("opened_by").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    contractVersion: text("contract_version").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    fact: jsonb("fact").$type<import("@ceo-agent/shared").ReviewOpenedFact>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_review_opened_plan_unique").on(t.executionPlanId),
    unique("ai_story_review_opened_fingerprint_unique").on(t.deterministicFingerprint),
    index("ai_story_review_opened_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/**
 * Sprint 3 Phase 2B PR 2B.1 — append-only Scene Intent review decision facts.
 */

export const aiStorySceneIntentReviewFacts = pgTable(
  "ai_story_scene_intent_review_facts",
  {
    factId: uuid("fact_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id").notNull().references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    sceneId: text("scene_id").notNull(),
    sceneOrder: integer("scene_order").notNull(),
    decision: text("decision").notNull(),
    reviewedBy: uuid("reviewed_by").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    instructionHash: text("instruction_hash")
      .notNull()
      .references(() => aiStorySceneInstructionSnapshots.contentHash, { onDelete: "restrict" }),
    qcResultHash: text("qc_result_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    fact: jsonb("fact").$type<import("@ceo-agent/shared").SceneIntentReviewDecision>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_intent_review_fingerprint_unique").on(t.deterministicFingerprint),
    index("ai_story_scene_intent_review_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_scene_intent_review_scene_idx").on(t.sceneExecutionId, t.acceptedAt),
    index("ai_story_scene_intent_review_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/**
 * Sprint 3 Phase 2B PR 2B.1 — append-only Story review decision facts.
 */

export const aiStoryStoryReviewFacts = pgTable(
  "ai_story_story_review_facts",
  {
    factId: uuid("fact_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id").notNull().references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    reviewedBy: uuid("reviewed_by").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    contractVersion: text("contract_version").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    fact: jsonb("fact").$type<import("@ceo-agent/shared").StoryReviewDecision>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_story_review_fingerprint_unique").on(t.deterministicFingerprint),
    index("ai_story_story_review_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_story_review_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/**
 * Sprint 3 Phase 2B PR 2B.2 — immutable Story Assembly Definition.
 * Subordinate to Execution Plan (sole Aggregate Root). Ordering only — not media / Story Video.
 */

export const aiStoryAssemblyDefinitions = pgTable(
  "ai_story_assembly_definitions",
  {
    assemblyDefinitionId: uuid("assembly_definition_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id").notNull().references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneCount: integer("scene_count").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    contractVersion: text("contract_version").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    definition: jsonb("definition").$type<import("@ceo-agent/shared").StoryAssemblyDefinition>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_assembly_definition_plan_unique").on(t.executionPlanId),
    unique("ai_story_assembly_definition_fingerprint_unique").on(t.deterministicFingerprint),
    index("ai_story_assembly_definition_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/**
 * Sprint 3 Phase 2B PR 2B.2 — ordered Scene membership under an Assembly Definition.
 */

export const aiStoryAssemblySceneMemberships = pgTable(
  "ai_story_assembly_scene_memberships",
  {
    membershipId: uuid("membership_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id").notNull().references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    assemblyDefinitionId: uuid("assembly_definition_id")
      .notNull()
      .references(() => aiStoryAssemblyDefinitions.assemblyDefinitionId, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    sceneId: text("scene_id").notNull(),
    sceneOrder: integer("scene_order").notNull(),
    contractVersion: text("contract_version").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    membership: jsonb("membership").$type<import("@ceo-agent/shared").AssemblySceneMembership>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_assembly_membership_fingerprint_unique").on(t.deterministicFingerprint),
    unique("ai_story_assembly_membership_def_scene_unique").on(t.assemblyDefinitionId, t.sceneExecutionId),
    unique("ai_story_assembly_membership_def_order_unique").on(t.assemblyDefinitionId, t.sceneOrder),
    index("ai_story_assembly_membership_plan_idx").on(t.executionPlanId, t.sceneOrder),
    index("ai_story_assembly_membership_def_idx").on(t.assemblyDefinitionId, t.sceneOrder),
    index("ai_story_assembly_membership_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

export const aiStoryExecutionJobs = pgTable(
  "ai_story_execution_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "cascade" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    status: text("status").notNull().default("queued"),
    capabilityId: text("capability_id").notNull().default("animation-video-generation"),
    targetOutputCount: integer("target_output_count").notNull().default(5),
    selectedOutputCount: integer("selected_output_count"),
    progress: jsonb("progress")
      .$type<import("@ceo-agent/shared").AiStoryExecutionProgress>()
      .notNull()
      .default({
        phase: "queued",
        percent: 0,
        message: "",
        completedOutputs: 0,
        targetOutputs: 5,
        providerAttempts: 0,
      }),
    generateReview: jsonb("generate_review")
      .$type<import("@ceo-agent/shared").GenerateReviewEstimate | null>()
      .default(null),
    executionManifest: jsonb("execution_manifest")
      .$type<import("@ceo-agent/shared").ExecutionManifest | null>()
      .default(null),
    providerExecutionIds: jsonb("provider_execution_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_story_execution_jobs_story_idx").on(t.storyId, t.createdAt),
    index("ai_story_execution_jobs_workspace_idx").on(t.workspaceId, t.status),
    index("ai_story_execution_jobs_status_idx").on(t.status, t.createdAt),
  ]
);

export const aiStoryExecutionOutputs = pgTable(
  "ai_story_execution_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "cascade" }),
    executionJobId: uuid("execution_job_id")
      .notNull()
      .references(() => aiStoryExecutionJobs.id, { onDelete: "cascade" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "cascade" }),
    creativeId: uuid("creative_id").references(() => creatives.id, {
      onDelete: "set null",
    }),
    outputType: text("output_type").notNull().default("animation_video"),
    status: text("status").notNull().default("draft"),
    title: text("title").notNull(),
    outputIndex: integer("output_index").notNull().default(0),
    storagePath: text("storage_path"),
    generatedVideoAssetId: uuid("generated_video_asset_id"),
    referencedAssetIds: jsonb("referenced_asset_ids").$type<string[]>().notNull().default([]),
    executionManifest: jsonb("execution_manifest")
      .$type<import("@ceo-agent/shared").ExecutionManifest | null>()
      .default(null),
    caption: text("caption").notNull().default(""),
    hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
    providerId: text("provider_id"),
    providerExecutionId: text("provider_execution_id"),
    qualityScore: numeric("quality_score"),
    failureMessage: text("failure_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_story_execution_outputs_job_idx").on(t.executionJobId, t.outputIndex),
    index("ai_story_execution_outputs_workspace_idx").on(t.workspaceId, t.status),
    unique("ai_story_execution_outputs_job_index_unique").on(
      t.executionJobId,
      t.outputIndex
    ),
  ]
);

export const providerExecutions = pgTable(
  "provider_executions",
  {
    executionId: text("execution_id").primaryKey(),
    contractVersion: text("contract_version").notNull(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    campaignId: uuid("campaign_id"),
    pipelineRunId: text("pipeline_run_id").notNull(),
    capabilityId: text("capability_id").notNull(),
    capabilityVersion: text("capability_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    requestHash: text("request_hash").notNull(),
    outputSchemaId: text("output_schema_id").notNull(),
    outputSchemaVersion: text("output_schema_version").notNull(),
    status: text("status").notNull(),
    executionMetadata: jsonb("execution_metadata")
      .$type<import("@ceo-agent/shared").ExecutionMetadata>()
      .notNull(),
    acceptedAttemptId: text("accepted_attempt_id"),
    acceptedResult: jsonb("accepted_result")
      .$type<import("@ceo-agent/shared").CanonicalProviderResult>(),
    acceptedResponseHash: text("accepted_response_hash"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    unique("provider_executions_idempotency_key_unique").on(t.idempotencyKey),
    index("provider_executions_workspace_idx").on(t.workspaceId, t.createdAt),
    index("provider_executions_fingerprint_idx").on(t.deterministicFingerprint),
  ]
);

export const providerAttempts = pgTable(
  "provider_attempts",
  {
    attemptId: text("attempt_id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => providerExecutions.executionId, { onDelete: "restrict" }),
    contractVersion: text("contract_version").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    providerId: text("provider_id").notNull(),
    providerVersion: text("provider_version").notNull(),
    modelVersion: text("model_version").notNull(),
    providerRequestId: text("provider_request_id"),
    requestHash: text("request_hash").notNull(),
    responseHash: text("response_hash"),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failure: jsonb("failure").$type<import("@ceo-agent/shared").ProviderError>(),
    warnings: jsonb("warnings")
      .$type<Array<{ code: string; message: string; retryable: boolean }>>()
      .notNull()
      .default([]),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("provider_attempts_execution_number_unique").on(t.executionId, t.attemptNumber),
    index("provider_attempts_execution_idx").on(t.executionId, t.attemptNumber),
  ]
);

export const providerAttemptUsage = pgTable(
  "provider_attempt_usage",
  {
    attemptId: text("attempt_id")
      .primaryKey()
      .references(() => providerAttempts.attemptId, { onDelete: "restrict" }),
    usage: jsonb("usage").$type<import("@ceo-agent/shared").ProviderUsage>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const providerAttemptCosts = pgTable(
  "provider_attempt_costs",
  {
    attemptId: text("attempt_id")
      .primaryKey()
      .references(() => providerAttempts.attemptId, { onDelete: "restrict" }),
    cost: jsonb("cost").$type<import("@ceo-agent/shared").ProviderCost>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const providerOutboxJobs = pgTable(
  "provider_outbox_jobs",
  {
    jobId: text("job_id").primaryKey(),
    contractVersion: text("contract_version").notNull(),
    executionId: text("execution_id")
      .notNull()
      .references(() => providerExecutions.executionId, { onDelete: "restrict" }),
    payloadReference: text("payload_reference").notNull(),
    correlationId: text("correlation_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    priority: integer("priority").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextVisibleAt: timestamp("next_visible_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    retryDelayMs: integer("retry_delay_ms"),
    retryClassification: text("retry_classification"),
    lastErrorCategory: text("last_error_category"),
    deadLetterReason: text("dead_letter_reason"),
    deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
    operatorNotes: text("operator_notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completionWorkerId: text("completion_worker_id"),
    completionMetadata: jsonb("completion_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("provider_outbox_jobs_execution_unique").on(t.executionId),
    index("provider_outbox_jobs_claim_idx").on(t.status, t.nextVisibleAt, t.priority),
    index("provider_outbox_jobs_lease_idx").on(t.status, t.leaseExpiresAt),
  ]
);

export const providerExecutionEnvelopes = pgTable(
  "provider_execution_envelopes",
  {
    envelopeId: text("envelope_id").primaryKey(),
    version: text("version").notNull(),
    payloadReference: text("payload_reference").notNull(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    executionContext: jsonb("execution_context")
      .$type<import("@ceo-agent/shared").ExecutionEnvelopeContext>()
      .notNull(),
    capabilityId: text("capability_id").notNull(),
    capabilityVersion: text("capability_version").notNull(),
    providerPolicySnapshot: jsonb("provider_policy_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    canonicalRequest: jsonb("canonical_request")
      .$type<import("@ceo-agent/shared").CanonicalProviderRequest>()
      .notNull(),
    requestHash: text("request_hash").notNull(),
    envelopeHash: text("envelope_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("provider_execution_envelopes_payload_reference_unique").on(
      t.payloadReference
    ),
    index("provider_execution_envelopes_workspace_idx").on(
      t.workspaceId,
      t.createdAt
    ),
    index("provider_execution_envelopes_request_hash_idx").on(t.requestHash),
  ]
);

export const providerExecutionDispatches = pgTable(
  "provider_execution_dispatches",
  {
    dispatchId: text("dispatch_id").primaryKey(),
    version: text("version").notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => providerOutboxJobs.jobId, { onDelete: "restrict" }),
    executionId: text("execution_id")
      .notNull()
      .references(() => providerExecutions.executionId, {
        onDelete: "restrict",
      }),
    envelopeId: text("envelope_id")
      .notNull()
      .references(() => providerExecutionEnvelopes.envelopeId, {
        onDelete: "restrict",
      }),
    payloadReference: text("payload_reference").notNull(),
    correlationId: text("correlation_id").notNull(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    capabilityId: text("capability_id").notNull(),
    capabilityVersion: text("capability_version").notNull(),
    requestHash: text("request_hash").notNull(),
    envelopeHash: text("envelope_hash").notNull(),
    workerHandoff: jsonb("worker_handoff")
      .$type<import("@ceo-agent/shared").ExecutionDispatch["workerHandoff"]>()
      .notNull(),
    dispatchHash: text("dispatch_hash").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("provider_execution_dispatches_job_unique").on(t.jobId),
    index("provider_execution_dispatches_execution_idx").on(t.executionId),
    index("provider_execution_dispatches_workspace_idx").on(
      t.workspaceId,
      t.createdAt
    ),
  ]
);

/**
 * Sprint 3 PR 3.2 — append-only RuntimeAuthorizedFact persistence.
 * One accepted authorization fact per Execution Plan.
 */

export const aiStoryRuntimeAuthorizedFacts = pgTable(
  "ai_story_runtime_authorized_facts",
  {
    runtimeAuthorizationId: uuid("runtime_authorization_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    runtimeAuthorizationVersion: integer("runtime_authorization_version").notNull(),
    reviewDecisionId: uuid("review_decision_id").notNull(),
    reviewHash: text("review_hash").notNull(),
    assemblyDefinitionId: uuid("assembly_definition_id").notNull(),
    assemblyHash: text("assembly_hash").notNull(),
    orderedSceneExecutionIds: jsonb("ordered_scene_execution_ids")
      .$type<string[]>()
      .notNull(),
    qcResultIds: jsonb("qc_result_ids").$type<string[]>().notNull(),
    authorizedBy: uuid("authorized_by").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
    authorizationContractVersion: text("authorization_contract_version").notNull(),
    deterministicIntegrityHash: text("deterministic_integrity_hash").notNull(),
    fact: jsonb("fact")
      .$type<import("@ceo-agent/shared").RuntimeAuthorizedFact>()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_runtime_auth_plan_unique").on(t.executionPlanId),
    unique("ai_story_runtime_auth_hash_unique").on(t.deterministicIntegrityHash),
    index("ai_story_runtime_auth_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/** EXEC-07 — durable separation between plan authorization and provider release. */
export const aiStorySceneReleaseStates = pgTable(
  "ai_story_scene_release_states",
  {
    sceneExecutionId: uuid("scene_execution_id")
      .primaryKey()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    runtimeAuthorizationId: uuid("runtime_authorization_id")
      .notNull()
      .references(() => aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sceneOrder: integer("scene_order").notNull(),
    releaseState: text("release_state").notNull(),
    releaseStage: integer("release_stage"),
    releasedBy: uuid("released_by"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    gateSceneExecutionId: uuid("gate_scene_execution_id")
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    gateProviderAttemptId: text("gate_provider_attempt_id"),
    gateSceneResultId: uuid("gate_scene_result_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_release_plan_order_unique").on(t.executionPlanId, t.sceneOrder),
    index("ai_story_scene_release_plan_idx").on(t.executionPlanId, t.sceneOrder),
    index("ai_story_scene_release_workspace_idx").on(t.workspaceId, t.createdAt),
  ]
);

/** PROD-VERIFY-01 — explicit, server-authorized no-provider Execute evidence. */
export const aiStoryExecuteVerifications = pgTable(
  "ai_story_execute_verifications",
  {
    executionPlanId: uuid("execution_plan_id")
      .primaryKey()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    runtimeAuthorizationId: uuid("runtime_authorization_id")
      .notNull()
      .references(() => aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId, {
        onDelete: "restrict",
      }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    outboxJobId: text("outbox_job_id")
      .notNull()
      .references(() => providerOutboxJobs.jobId, { onDelete: "restrict" }),
    verificationMode: boolean("verification_mode").notNull().default(true),
    verificationPolicyVersion: text("verification_policy_version").notNull(),
    authorizedBy: text("authorized_by").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_execute_verification_outbox_unique").on(t.outboxJobId),
    unique("ai_story_execute_verification_runtime_auth_unique").on(
      t.runtimeAuthorizationId
    ),
    index("ai_story_execute_verification_workspace_idx").on(
      t.workspaceId,
      t.createdAt
    ),
  ]
);

/**
 * Sprint 3 PR 3.2 — immutable Scene routing decisions (fallback disabled).
 */

export const aiStorySceneRoutingDecisions = pgTable(
  "ai_story_scene_routing_decisions",
  {
    routingDecisionId: uuid("routing_decision_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    runtimeAuthorizationId: uuid("runtime_authorization_id")
      .notNull()
      .references(() => aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId, {
        onDelete: "restrict",
      }),
    capabilityId: text("capability_id").notNull(),
    capabilityVersion: text("capability_version").notNull(),
    selectedProviderId: text("selected_provider_id").notNull(),
    selectedAdapterVersion: text("selected_adapter_version").notNull(),
    routerVersion: integer("router_version").notNull().default(1),
    registrySnapshotHash: text("registry_snapshot_hash").notNull(),
    capabilitySnapshot: jsonb("capability_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    policySnapshot: jsonb("policy_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    candidateSummary: jsonb("candidate_summary")
      .$type<
        Array<{
          providerId: string;
          adapterVersion: string;
          selected: boolean;
          scoreTotal?: number;
          exclusionCodes: string[];
        }>
      >()
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    deterministicIntegrityHash: text("deterministic_integrity_hash").notNull(),
    automaticFallbackEnabled: boolean("automatic_fallback_enabled").notNull().default(false),
    contractVersion: text("contract_version").notNull(),
    decision: jsonb("decision")
      .$type<import("@ceo-agent/shared").PersistedSceneRoutingDecision>()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_routing_scene_unique").on(t.sceneExecutionId),
    unique("ai_story_scene_routing_hash_unique").on(t.deterministicIntegrityHash),
    index("ai_story_scene_routing_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_scene_routing_workspace_idx").on(t.workspaceId, t.acceptedAt),
    index("ai_story_scene_routing_auth_idx").on(t.runtimeAuthorizationId),
  ]
);

/**
 * Sprint 3 PR 3.2 — Scene ↔ Provider Execution scheduling correlation.
 */

export const aiStorySceneSchedulingCorrelations = pgTable(
  "ai_story_scene_scheduling_correlations",
  {
    correlationId: uuid("correlation_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    runtimeAuthorizationId: uuid("runtime_authorization_id")
      .notNull()
      .references(() => aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId, {
        onDelete: "restrict",
      }),
    routingDecisionId: uuid("routing_decision_id")
      .notNull()
      .references(() => aiStorySceneRoutingDecisions.routingDecisionId, {
        onDelete: "restrict",
      }),
    providerExecutionId: text("provider_execution_id")
      .notNull()
      .references(() => providerExecutions.executionId, { onDelete: "restrict" }),
    envelopeId: text("envelope_id")
      .notNull()
      .references(() => providerExecutionEnvelopes.envelopeId, {
        onDelete: "restrict",
      }),
    outboxJobId: text("outbox_job_id")
      .notNull()
      .references(() => providerOutboxJobs.jobId, { onDelete: "restrict" }),
    requestHash: text("request_hash").notNull(),
    envelopeHash: text("envelope_hash").notNull(),
    routingDecisionHash: text("routing_decision_hash").notNull(),
    authorizationHash: text("authorization_hash").notNull(),
    schedulingIdentityHash: text("scheduling_identity_hash").notNull(),
    retryInputRevisionId: uuid("retry_input_revision_id"),
    contractVersion: text("contract_version").notNull(),
    scheduledBy: uuid("scheduled_by").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    correlation: jsonb("correlation")
      .$type<import("@ceo-agent/shared").SceneProviderSchedulingCorrelation>()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_scheduling_provider_unique").on(t.providerExecutionId),
    unique("ai_story_scene_scheduling_outbox_unique").on(t.outboxJobId),
    unique("ai_story_scene_scheduling_identity_unique").on(t.schedulingIdentityHash),
    index("ai_story_scene_scheduling_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_scene_scheduling_workspace_idx").on(t.workspaceId, t.acceptedAt),
    index("ai_story_scene_scheduling_auth_idx").on(t.runtimeAuthorizationId),
    index("ai_story_scene_scheduling_scene_idx").on(t.sceneExecutionId, t.acceptedAt),
  ]
);

/**
 * Sprint 3 PR 3.3 — immutable Worker Execution Results (no Finalizer / Scene Result).
 * Terminal normalized Worker evidence only (MODEL A in PR 3.7 Phase C remediation).
 */

export const aiStoryWorkerExecutionResults = pgTable(
  "ai_story_worker_execution_results",
  {
    workerExecutionResultId: uuid("worker_execution_result_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    providerExecutionId: text("provider_execution_id")
      .notNull()
      .references(() => providerExecutions.executionId, { onDelete: "restrict" }),
    providerAttemptId: text("provider_attempt_id").notNull(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => providerExecutionDispatches.dispatchId, {
        onDelete: "restrict",
      }),
    outboxJobId: text("outbox_job_id")
      .notNull()
      .references(() => providerOutboxJobs.jobId, { onDelete: "restrict" }),
    routingDecisionId: uuid("routing_decision_id")
      .notNull()
      .references(() => aiStorySceneRoutingDecisions.routingDecisionId, {
        onDelete: "restrict",
      }),
    providerId: text("provider_id").notNull(),
    adapterVersion: text("adapter_version").notNull(),
    routerVersion: integer("router_version").notNull(),
    providerRequestId: text("provider_request_id"),
    workerState: text("worker_state").notNull(),
    acceptanceClassification: text("acceptance_classification").notNull(),
    canonicalProviderState: text("canonical_provider_state").notNull(),
    reconciliationRequired: boolean("reconciliation_required").notNull().default(false),
    deterministicIntegrityHash: text("deterministic_integrity_hash").notNull(),
    workerContractVersion: text("worker_contract_version").notNull(),
    result: jsonb("result")
      .$type<import("@ceo-agent/shared").WorkerExecutionResult>()
      .notNull(),
    producedAt: timestamp("produced_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_worker_result_dispatch_unique").on(t.dispatchId),
    unique("ai_story_worker_result_hash_unique").on(t.deterministicIntegrityHash),
    unique("ai_story_worker_result_attempt_unique").on(t.providerAttemptId),
    index("ai_story_worker_result_workspace_idx").on(t.workspaceId, t.acceptedAt),
    index("ai_story_worker_result_execution_idx").on(t.providerExecutionId),
  ]
);

/**
 * Sprint 3 PR 3.7 Phase C remediation — append-only Worker Attempt Observations.
 * Operational resume/reconciliation evidence for non-terminal Adapter outcomes.
 * Does not replace immutable terminal WorkerExecutionResult authority.
 */

export const aiStoryWorkerAttemptObservations = pgTable(
  "ai_story_worker_attempt_observations",
  {
    observationId: uuid("observation_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    providerExecutionId: text("provider_execution_id")
      .notNull()
      .references(() => providerExecutions.executionId, { onDelete: "restrict" }),
    providerAttemptId: text("provider_attempt_id").notNull(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => providerExecutionDispatches.dispatchId, {
        onDelete: "restrict",
      }),
    outboxJobId: text("outbox_job_id")
      .notNull()
      .references(() => providerOutboxJobs.jobId, { onDelete: "restrict" }),
    providerRequestId: text("provider_request_id"),
    observationKind: text("observation_kind").notNull(),
    reconciliationRequired: boolean("reconciliation_required").notNull().default(false),
    deterministicIntegrityHash: text("deterministic_integrity_hash").notNull(),
    observation: jsonb("observation")
      .$type<import("@ceo-agent/shared").WorkerExecutionResult>()
      .notNull(),
    producedAt: timestamp("produced_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_worker_observation_hash_unique").on(t.deterministicIntegrityHash),
    index("ai_story_worker_observation_dispatch_idx").on(t.dispatchId, t.producedAt),
    index("ai_story_worker_observation_attempt_idx").on(t.providerAttemptId, t.producedAt),
    index("ai_story_worker_observation_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/**
 * Sprint 3 PR 3.6 Phase 3 — immutable deterministic Assembly Job.
 * Subordinate to Execution Plan. No Final Story Result. No media assembly.
 */

export const aiStoryAssemblyJobs = pgTable(
  "ai_story_assembly_jobs",
  {
    assemblyJobId: uuid("assembly_job_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    assemblyDefinitionId: uuid("assembly_definition_id")
      .notNull()
      .references(() => aiStoryAssemblyDefinitions.assemblyDefinitionId, {
        onDelete: "restrict",
      }),
    runtimeAuthorizationId: uuid("runtime_authorization_id").notNull(),
    orderedSceneResultIds: jsonb("ordered_scene_result_ids").$type<string[]>().notNull(),
    orderedSceneContentHashes: jsonb("ordered_scene_content_hashes")
      .$type<string[]>()
      .notNull(),
    assemblyContractVersion: text("assembly_contract_version").notNull(),
    assemblyEngineSnapshotId: uuid("assembly_engine_snapshot_id").notNull(),
    assemblyEngineSnapshotHash: text("assembly_engine_snapshot_hash").notNull(),
    deterministicFingerprint: text("deterministic_fingerprint").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    job: jsonb("job").$type<import("@ceo-agent/shared/server").AssemblyJob>().notNull(),
  },
  (t) => [
    unique("ai_story_assembly_jobs_fingerprint_unique").on(t.deterministicFingerprint),
    index("ai_story_assembly_jobs_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_assembly_jobs_workspace_idx").on(t.workspaceId, t.acceptedAt),
    index("ai_story_assembly_jobs_definition_idx").on(t.assemblyDefinitionId),
  ]
);

/**
 * Sprint 3 PR 3.6 Phase 3 — append-only Assembly Job facts.
 * Immutable. One ACCEPTED. At most one terminal SUCCEEDED|FAILED.
 * PROCESSING_STARTED is operational telemetry only.
 */

export const aiStoryAssemblyJobFacts = pgTable(
  "ai_story_assembly_job_facts",
  {
    factId: uuid("fact_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    assemblyJobId: uuid("assembly_job_id")
      .notNull()
      .references(() => aiStoryAssemblyJobs.assemblyJobId, { onDelete: "restrict" }),
    factKind: text("fact_kind").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    fact: jsonb("fact").$type<import("@ceo-agent/shared/server").AssemblyJobFact>().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_assembly_job_facts_hash_unique").on(t.integrityHash),
    index("ai_story_assembly_job_facts_job_idx").on(t.assemblyJobId, t.recordedAt),
    index("ai_story_assembly_job_facts_workspace_idx").on(t.workspaceId, t.recordedAt),
    index("ai_story_assembly_job_facts_plan_idx").on(t.executionPlanId, t.recordedAt),
  ]
);

/**
 * Sprint 3 PR 3.6 — immutable Assembly Runtime artifact metadata (no binary).
 * One artifact per Assembly Job / execution identity. No Final Story Result.
 */

export const aiStoryAssemblyArtifacts = pgTable(
  "ai_story_assembly_artifacts",
  {
    artifactId: uuid("artifact_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    assemblyJobId: uuid("assembly_job_id")
      .notNull()
      .references(() => aiStoryAssemblyJobs.assemblyJobId, { onDelete: "restrict" }),
    executionIdentity: text("execution_identity").notNull(),
    artifactReference: text("artifact_reference").notNull(),
    contentHash: text("content_hash").notNull(),
    mediaType: text("media_type").notNull(),
    durationMs: integer("duration_ms").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    frameRate: doublePrecision("frame_rate").notNull(),
    byteSize: integer("byte_size").notNull(),
    assemblyEngineVersion: text("assembly_engine_version").notNull(),
    normalizationPolicyVersion: text("normalization_policy_version").notNull(),
    assemblyRuntimeContractVersion: text("assembly_runtime_contract_version").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    artifact: jsonb("artifact").$type<import("@ceo-agent/shared/server").AssemblyArtifact>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("ai_story_assembly_artifacts_identity_unique").on(t.executionIdentity),
    unique("ai_story_assembly_artifacts_hash_unique").on(t.integrityHash),
    unique("ai_story_assembly_artifacts_job_unique").on(t.assemblyJobId),
    index("ai_story_assembly_artifacts_workspace_idx").on(t.workspaceId, t.createdAt),
    index("ai_story_assembly_artifacts_plan_idx").on(t.executionPlanId, t.createdAt),
    index("ai_story_assembly_artifacts_content_hash_idx").on(t.contentHash),
  ]
);

/**
 * Sprint 3 PR 3.7 Phase A — success-only immutable Final Story Result.
 * Subordinate to Execution Plan. No Export / Publish. No FAILED rows.
 */

export const aiStoryFinalStoryResults = pgTable(
  "ai_story_final_story_results",
  {
    finalStoryResultId: uuid("final_story_result_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    assemblyDefinitionId: uuid("assembly_definition_id")
      .notNull()
      .references(() => aiStoryAssemblyDefinitions.assemblyDefinitionId, {
        onDelete: "restrict",
      }),
    assemblyJobId: uuid("assembly_job_id")
      .notNull()
      .references(() => aiStoryAssemblyJobs.assemblyJobId, { onDelete: "restrict" }),
    assemblyArtifactId: uuid("assembly_artifact_id")
      .notNull()
      .references(() => aiStoryAssemblyArtifacts.artifactId, { onDelete: "restrict" }),
    assemblyJobIdentity: text("assembly_job_identity").notNull(),
    orderedSceneResultIds: jsonb("ordered_scene_result_ids").$type<string[]>().notNull(),
    outputMediaReference: text("output_media_reference").notNull(),
    contentHash: text("content_hash").notNull(),
    mediaType: text("media_type").notNull(),
    totalDurationMs: integer("total_duration_ms").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    frameRate: doublePrecision("frame_rate").notNull(),
    assemblyRuntimeContractVersion: text("assembly_runtime_contract_version").notNull(),
    assemblyEngineVersion: text("assembly_engine_version").notNull(),
    normalizationPolicyVersion: text("normalization_policy_version").notNull(),
    finalStoryResultContractVersion: text("final_story_result_contract_version").notNull(),
    assemblyEngineSnapshotHash: text("assembly_engine_snapshot_hash").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
    projectionVersion: text("projection_version").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    result: jsonb("result")
      .$type<import("@ceo-agent/shared/server").FinalStoryResultPersistenceRecord>()
      .notNull(),
  },
  (t) => [
    unique("ai_story_final_story_results_job_unique").on(t.assemblyJobId),
    unique("ai_story_final_story_results_artifact_unique").on(t.assemblyArtifactId),
    unique("ai_story_final_story_results_integrity_unique").on(t.integrityHash),
    unique("ai_story_final_story_results_job_identity_unique").on(t.assemblyJobIdentity),
    index("ai_story_final_story_results_workspace_idx").on(t.workspaceId, t.acceptedAt),
    index("ai_story_final_story_results_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_final_story_results_content_hash_idx").on(t.contentHash),
  ]
);

/**
 * Sprint 4 Phase A — Durable Scene Media Attestation (immutable).
 * Subordinate to Canonical Scene Result. No UPDATE/DELETE product paths.
 */

export const aiStoryDurableSceneMediaAttestations = pgTable(
  "ai_story_durable_scene_media_attestations",
  {
    mediaAttestationId: uuid("media_attestation_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => aiStoryVersions.id, { onDelete: "restrict" }),
    animationPackageId: uuid("animation_package_id")
      .notNull()
      .references(() => aiStoryAnimationPackages.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    sceneResultId: uuid("scene_result_id")
      .notNull()
      .references(() => aiStorySceneResults.sceneResultId, { onDelete: "restrict" }),
    sourceMediaReference: jsonb("source_media_reference")
      .$type<import("@ceo-agent/shared/server").DurableMediaSourceReference>()
      .notNull(),
    durableObjectReference: text("durable_object_reference").notNull(),
    contentHash: text("content_hash").notNull(),
    byteSize: integer("byte_size").notNull(),
    mediaType: text("media_type").notNull(),
    ingestContractVersion: text("ingest_contract_version").notNull(),
    storageProvider: text("storage_provider").notNull(),
    storageNamespaceVersion: text("storage_namespace_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    attestation: jsonb("attestation")
      .$type<import("@ceo-agent/shared/server").DurableSceneMediaAttestation>()
      .notNull(),
  },
  (t) => [
    unique("ai_story_durable_scene_media_scene_unique").on(t.sceneResultId),
    unique("ai_story_durable_scene_media_integrity_unique").on(t.integrityHash),
    unique("ai_story_durable_scene_media_object_unique").on(t.durableObjectReference),
    index("ai_story_durable_scene_media_workspace_idx").on(t.workspaceId, t.acceptedAt),
    index("ai_story_durable_scene_media_plan_idx").on(t.executionPlanId, t.acceptedAt),
    index("ai_story_durable_scene_media_hash_idx").on(t.contentHash),
  ]
);

/**
 * Sprint 4 Phase B2 — Platform Admin grant (assignment) facts.
 * Platform-scoped. Status may materialize to REVOKED on accepted revocation.
 */

export const platformAdminGrants = pgTable(
  "platform_admin_grants",
  {
    platformAdminAssignmentId: uuid("platform_admin_assignment_id").primaryKey(),
    userId: uuid("user_id").notNull(),
    platformRole: text("platform_role").notNull(),
    status: text("status").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    grantedByUserId: uuid("granted_by_user_id"),
    reason: text("reason").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    assignment: jsonb("assignment")
      .$type<import("@ceo-agent/shared").PlatformAdminAssignment>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("platform_admin_grants_integrity_unique").on(t.integrityHash),
    index("platform_admin_grants_user_idx").on(t.userId, t.grantedAt),
    index("platform_admin_grants_status_idx").on(t.status, t.grantedAt),
  ]
);

/**
 * Sprint 4 Phase B2 — Platform Admin revocation facts (append-only).
 */

export const platformAdminRevocations = pgTable(
  "platform_admin_revocations",
  {
    platformAdminRevocationId: uuid("platform_admin_revocation_id").primaryKey(),
    platformAdminAssignmentId: uuid("platform_admin_assignment_id")
      .notNull()
      .references(() => platformAdminGrants.platformAdminAssignmentId, {
        onDelete: "restrict",
      }),
    userId: uuid("user_id").notNull(),
    platformRole: text("platform_role").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
    revokedByUserId: uuid("revoked_by_user_id").notNull(),
    reason: text("reason").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    revocation: jsonb("revocation")
      .$type<import("@ceo-agent/shared").PlatformAdminRevocation>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("platform_admin_revocations_integrity_unique").on(t.integrityHash),
    unique("platform_admin_revocations_assignment_unique").on(
      t.platformAdminAssignmentId
    ),
    index("platform_admin_revocations_user_idx").on(t.userId, t.revokedAt),
  ]
);

/**
 * Sprint 4 Phase B2 — Append-only Admin Audit Events.
 */

export const adminAuditEvents = pgTable(
  "admin_audit_events",
  {
    adminAuditEventId: uuid("admin_audit_event_id").primaryKey(),
    commandId: uuid("command_id").notNull(),
    eventType: text("event_type").notNull(),
    commandStatus: text("command_status").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    platformAdminAssignmentId: uuid("platform_admin_assignment_id")
      .notNull()
      .references(() => platformAdminGrants.platformAdminAssignmentId, {
        onDelete: "restrict",
      }),
    platformRole: text("platform_role").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    orgId: uuid("org_id"),
    workspaceId: uuid("workspace_id"),
    reason: text("reason").notNull(),
    beforeReference: jsonb("before_reference").$type<
      import("@ceo-agent/shared").AdminAuditSafeReference | null
    >(),
    afterReference: jsonb("after_reference").$type<
      import("@ceo-agent/shared").AdminAuditSafeReference | null
    >(),
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    event: jsonb("event")
      .$type<import("@ceo-agent/shared").AdminAuditEvent>()
      .notNull(),
  },
  (t) => [
    unique("admin_audit_events_integrity_unique").on(t.integrityHash),
    index("admin_audit_events_actor_idx").on(t.actorUserId, t.createdAt),
    index("admin_audit_events_assignment_idx").on(
      t.platformAdminAssignmentId,
      t.createdAt
    ),
    index("admin_audit_events_org_idx").on(t.orgId, t.createdAt),
  ]
);

/**
 * Sprint 4 Phase B3 — Billing Account (org-scoped commercial root).
 */

export const billingAccounts = pgTable(
  "billing_accounts",
  {
    billingAccountId: uuid("billing_account_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    externalCustomerReference: text("external_customer_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    account: jsonb("account")
      .$type<import("@ceo-agent/shared").BillingAccount>()
      .notNull(),
  },
  (t) => [
    unique("billing_accounts_org_unique").on(t.orgId),
    unique("billing_accounts_integrity_unique").on(t.integrityHash),
    index("billing_accounts_org_idx").on(t.orgId),
  ]
);

/**
 * Sprint 4 Phase B3 — Append-only provider-neutral Subscription Events.
 */

export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    subscriptionEventId: uuid("subscription_event_id").primaryKey(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.billingAccountId, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sourceProvider: text("source_provider").notNull(),
    sourceExternalSubscriptionId: text("source_external_subscription_id").notNull(),
    sourceExternalCustomerId: text("source_external_customer_id"),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    payloadDigest: text("payload_digest").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    event: jsonb("event")
      .$type<import("@ceo-agent/shared").SubscriptionEvent>()
      .notNull(),
  },
  (t) => [
    unique("subscription_events_integrity_unique").on(t.integrityHash),
    unique("subscription_events_source_unique").on(
      t.sourceProvider,
      t.sourceExternalSubscriptionId,
      t.eventType,
      t.payloadDigest
    ),
    index("subscription_events_org_idx").on(t.orgId, t.acceptedAt),
    index("subscription_events_account_idx").on(t.billingAccountId, t.acceptedAt),
  ]
);

/**
 * Sprint 4 Phase B3 — Rebuildable Subscription Projection (server-owned).
 */

export const subscriptionProjections = pgTable(
  "subscription_projections",
  {
    subscriptionProjectionId: uuid("subscription_projection_id").primaryKey(),
    billingAccountId: uuid("billing_account_id")
      .notNull()
      .references(() => billingAccounts.billingAccountId, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    planKey: text("plan_key"),
    sourceProvider: text("source_provider"),
    sourceExternalSubscriptionId: text("source_external_subscription_id"),
    sourceExternalCustomerId: text("source_external_customer_id"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
    sourceEventId: uuid("source_event_id").references(
      () => subscriptionEvents.subscriptionEventId,
      { onDelete: "restrict" }
    ),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    projection: jsonb("projection")
      .$type<import("@ceo-agent/shared").SubscriptionProjection>()
      .notNull(),
  },
  (t) => [
    unique("subscription_projections_account_unique").on(t.billingAccountId),
    unique("subscription_projections_org_unique").on(t.orgId),
    unique("subscription_projections_integrity_unique").on(t.integrityHash),
    index("subscription_projections_status_idx").on(t.status, t.projectedAt),
  ]
);

/**
 * Sprint 4 Phase B3 — Append-only Entitlement Grants.
 */

export const entitlementGrants = pgTable(
  "entitlement_grants",
  {
    entitlementGrantId: uuid("entitlement_grant_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "restrict",
    }),
    capabilityKey: text("capability_key").notNull(),
    source: text("source").notNull(),
    sourceReference: text("source_reference"),
    reason: text("reason").notNull(),
    grantedByUserId: uuid("granted_by_user_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    grantBody: jsonb("grant_body")
      .$type<import("@ceo-agent/shared").EntitlementGrant>()
      .notNull(),
  },
  (t) => [
    unique("entitlement_grants_integrity_unique").on(t.integrityHash),
    index("entitlement_grants_org_idx").on(t.orgId, t.grantedAt),
    index("entitlement_grants_capability_idx").on(
      t.orgId,
      t.capabilityKey,
      t.grantedAt
    ),
  ]
);

/**
 * Sprint 4 Phase B3 — Append-only Entitlement Revocations.
 */

export const entitlementRevocations = pgTable(
  "entitlement_revocations",
  {
    entitlementRevocationId: uuid("entitlement_revocation_id").primaryKey(),
    entitlementGrantId: uuid("entitlement_grant_id")
      .notNull()
      .references(() => entitlementGrants.entitlementGrantId, {
        onDelete: "restrict",
      }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    capabilityKey: text("capability_key").notNull(),
    source: text("source").notNull(),
    reason: text("reason").notNull(),
    revokedByUserId: uuid("revoked_by_user_id").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    revocation: jsonb("revocation")
      .$type<import("@ceo-agent/shared").EntitlementRevocation>()
      .notNull(),
  },
  (t) => [
    unique("entitlement_revocations_integrity_unique").on(t.integrityHash),
    unique("entitlement_revocations_grant_unique").on(t.entitlementGrantId),
    index("entitlement_revocations_org_idx").on(t.orgId, t.revokedAt),
  ]
);

/**
 * Sprint 4 Phase B3 — Effective Entitlement Projection (authoritative read model).
 */

export const effectiveEntitlementProjections = pgTable(
  "effective_entitlement_projections",
  {
    effectiveEntitlementProjectionId: uuid(
      "effective_entitlement_projection_id"
    ).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "restrict",
    }),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    projection: jsonb("projection")
      .$type<import("@ceo-agent/shared").EffectiveEntitlementProjection>()
      .notNull(),
  },
  (t) => [
    unique("effective_entitlement_projections_integrity_unique").on(
      t.integrityHash
    ),
    index("effective_entitlement_projections_org_idx").on(t.orgId, t.projectedAt),
  ]
);

/**
 * Sprint 4 Phase C — Verified Stripe event receipts (Admin read model).
 * Evidence only — never commercial authority. No raw webhook body.
 */

export const stripeEventReceipts = pgTable(
  "stripe_event_receipts",
  {
    stripeEventReceiptId: uuid("stripe_event_receipt_id").primaryKey(),
    stripeEventId: text("stripe_event_id").notNull(),
    stripeEventType: text("stripe_event_type").notNull(),
    livemode: boolean("livemode").notNull(),
    status: text("status").notNull(),
    billingAccountId: uuid("billing_account_id").references(
      () => billingAccounts.billingAccountId,
      { onDelete: "restrict" }
    ),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    subscriptionEventId: uuid("subscription_event_id").references(
      () => subscriptionEvents.subscriptionEventId,
      { onDelete: "restrict" }
    ),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    rawBodyDigest: text("raw_body_digest").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    receipt: jsonb("receipt")
      .$type<Record<string, unknown>>()
      .notNull(),
  },
  (t) => [
    unique("stripe_event_receipts_event_id_unique").on(t.stripeEventId),
    unique("stripe_event_receipts_integrity_unique").on(t.integrityHash),
    index("stripe_event_receipts_org_idx").on(t.orgId, t.receivedAt),
    index("stripe_event_receipts_status_idx").on(t.status, t.receivedAt),
    index("stripe_event_receipts_type_idx").on(t.stripeEventType, t.receivedAt),
  ]
);

/**
 * Sprint 4 Phase D — Credit Wallet (projection; one per org).
 */

export const creditWallets = pgTable(
  "credit_wallets",
  {
    creditWalletId: uuid("credit_wallet_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    availableBalance: integer("available_balance").notNull(),
    reservedBalance: integer("reserved_balance").notNull(),
    currencyUnit: text("currency_unit").notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    wallet: jsonb("wallet")
      .$type<import("@ceo-agent/shared").CreditWallet>()
      .notNull(),
  },
  (t) => [
    unique("credit_wallets_org_unique").on(t.orgId),
    unique("credit_wallets_integrity_unique").on(t.integrityHash),
    index("credit_wallets_org_idx").on(t.orgId),
  ]
);

/**
 * Sprint 4 Phase D — Append-only Credit Ledger Entries (accounting authority).
 */

export const creditLedgerEntries = pgTable(
  "credit_ledger_entries",
  {
    creditLedgerEntryId: uuid("credit_ledger_entry_id").primaryKey(),
    creditWalletId: uuid("credit_wallet_id")
      .notNull()
      .references(() => creditWallets.creditWalletId, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    entryType: text("entry_type").notNull(),
    amount: integer("amount").notNull(),
    currencyUnit: text("currency_unit").notNull(),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    pricingRuleKey: text("pricing_rule_key"),
    pricingRuleVersion: text("pricing_rule_version"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    entry: jsonb("entry")
      .$type<import("@ceo-agent/shared").CreditLedgerEntry>()
      .notNull(),
  },
  (t) => [
    unique("credit_ledger_entries_integrity_unique").on(t.integrityHash),
    unique("credit_ledger_entries_idempotency_unique").on(
      t.creditWalletId,
      t.idempotencyKey
    ),
    index("credit_ledger_entries_org_idx").on(t.orgId, t.createdAt),
    index("credit_ledger_entries_wallet_idx").on(t.creditWalletId, t.createdAt),
  ]
);

/**
 * Sprint 4 Phase D — Credit Reservations (immutable identity; status advances).
 */

export const creditReservations = pgTable(
  "credit_reservations",
  {
    creditReservationId: uuid("credit_reservation_id").primaryKey(),
    creditWalletId: uuid("credit_wallet_id")
      .notNull()
      .references(() => creditWallets.creditWalletId, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "restrict",
    }),
    amount: integer("amount").notNull(),
    currencyUnit: text("currency_unit").notNull(),
    status: text("status").notNull(),
    pricingRuleKey: text("pricing_rule_key"),
    pricingRuleVersion: text("pricing_rule_version"),
    executionIdentity: text("execution_identity"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    reservation: jsonb("reservation")
      .$type<import("@ceo-agent/shared").CreditReservation>()
      .notNull(),
  },
  (t) => [
    unique("credit_reservations_integrity_unique").on(t.integrityHash),
    index("credit_reservations_org_idx").on(t.orgId, t.createdAt),
    index("credit_reservations_status_idx").on(t.creditWalletId, t.status),
  ]
);

/**
 * Sprint 4 Phase D — Append-only Credit Settlements.
 */

export const creditSettlements = pgTable(
  "credit_settlements",
  {
    creditSettlementId: uuid("credit_settlement_id").primaryKey(),
    creditWalletId: uuid("credit_wallet_id")
      .notNull()
      .references(() => creditWallets.creditWalletId, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    creditReservationId: uuid("credit_reservation_id")
      .notNull()
      .references(() => creditReservations.creditReservationId, {
        onDelete: "restrict",
      }),
    creditLedgerEntryId: uuid("credit_ledger_entry_id")
      .notNull()
      .references(() => creditLedgerEntries.creditLedgerEntryId, {
        onDelete: "restrict",
      }),
    amount: integer("amount").notNull(),
    currencyUnit: text("currency_unit").notNull(),
    billableEffectReference: text("billable_effect_reference").notNull(),
    pricingRuleKey: text("pricing_rule_key"),
    pricingRuleVersion: text("pricing_rule_version"),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    settlement: jsonb("settlement")
      .$type<import("@ceo-agent/shared").CreditSettlement>()
      .notNull(),
  },
  (t) => [
    unique("credit_settlements_integrity_unique").on(t.integrityHash),
    unique("credit_settlements_reservation_unique").on(t.creditReservationId),
    unique("credit_settlements_effect_unique").on(
      t.creditWalletId,
      t.billableEffectReference
    ),
    index("credit_settlements_org_idx").on(t.orgId, t.settledAt),
  ]
);

/**
 * Sprint 4 Phase D — Append-only Credit Releases.
 */

export const creditReleases = pgTable(
  "credit_releases",
  {
    creditReleaseId: uuid("credit_release_id").primaryKey(),
    creditWalletId: uuid("credit_wallet_id")
      .notNull()
      .references(() => creditWallets.creditWalletId, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    creditReservationId: uuid("credit_reservation_id")
      .notNull()
      .references(() => creditReservations.creditReservationId, {
        onDelete: "restrict",
      }),
    reason: text("reason").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
    actorUserId: uuid("actor_user_id"),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    releaseBody: jsonb("release_body")
      .$type<import("@ceo-agent/shared").CreditRelease>()
      .notNull(),
  },
  (t) => [
    unique("credit_releases_integrity_unique").on(t.integrityHash),
    unique("credit_releases_reservation_unique").on(t.creditReservationId),
    index("credit_releases_org_idx").on(t.orgId, t.releasedAt),
  ]
);

/**
 * Sprint 4 Phase D — Product Usage Events (independent of Provider Usage).
 */

export const productUsageEvents = pgTable(
  "product_usage_events",
  {
    productUsageEventId: uuid("product_usage_event_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "restrict",
    }),
    capabilityKey: text("capability_key").notNull(),
    executionIdentity: text("execution_identity").notNull(),
    pricingRuleKey: text("pricing_rule_key"),
    pricingRuleVersion: text("pricing_rule_version"),
    commercialAuthorizationId: uuid("commercial_authorization_id"),
    quantity: doublePrecision("quantity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    event: jsonb("event")
      .$type<import("@ceo-agent/shared").ProductUsageEvent>()
      .notNull(),
  },
  (t) => [
    unique("product_usage_events_integrity_unique").on(t.integrityHash),
    unique("product_usage_events_execution_unique").on(
      t.orgId,
      t.executionIdentity,
      t.capabilityKey
    ),
    index("product_usage_events_org_idx").on(t.orgId, t.occurredAt),
  ]
);

/**
 * Sprint 4 Phase E — Append-only Commercial Execution Authorization.
 * Sole authority for billable Execute scheduling.
 */

export const commercialExecutionAuthorizations = pgTable(
  "commercial_execution_authorizations",
  {
    commercialAuthorizationId: uuid("commercial_authorization_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    capabilityKey: text("capability_key").notNull(),
    executionIdentity: text("execution_identity").notNull(),
    entitlementEvidenceId: text("entitlement_evidence_id").notNull(),
    pricingRuleKey: text("pricing_rule_key").notNull(),
    pricingRuleVersion: text("pricing_rule_version").notNull(),
    pricingRuleIntegrityHash: text("pricing_rule_integrity_hash").notNull(),
    creditReservationId: uuid("credit_reservation_id").references(
      () => creditReservations.creditReservationId,
      { onDelete: "restrict" }
    ),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    authorizationBody: jsonb("authorization_body")
      .$type<import("@ceo-agent/shared").CommercialExecutionAuthorization>()
      .notNull(),
  },
  (t) => [
    unique("commercial_execution_authorizations_integrity_unique").on(
      t.integrityHash
    ),
    unique("commercial_execution_authorizations_execution_unique").on(
      t.orgId,
      t.workspaceId,
      t.capabilityKey,
      t.executionIdentity
    ),
    index("commercial_execution_authorizations_org_idx").on(
      t.orgId,
      t.authorizedAt
    ),
    index("commercial_execution_authorizations_workspace_idx").on(
      t.workspaceId,
      t.authorizedAt
    ),
    index("commercial_execution_authorizations_execution_idx").on(
      t.executionIdentity
    ),
  ]
);

/**
 * Sprint 4 Phase F — Append-only Admin Runtime Recovery command receipts.
 */

export const adminRuntimeRecoveryReceipts = pgTable(
  "admin_runtime_recovery_receipts",
  {
    recoveryReceiptId: uuid("recovery_receipt_id").primaryKey(),
    commandType: text("command_type").notNull(),
    commandId: uuid("command_id").notNull(),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "restrict",
    }),
    executionPlanId: uuid("execution_plan_id"),
    targetId: text("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    resultBody: jsonb("result_body")
      .$type<import("@ceo-agent/shared").RuntimeRecoveryCommandResult>()
      .notNull(),
  },
  (t) => [
    unique("admin_runtime_recovery_receipts_integrity_unique").on(
      t.integrityHash
    ),
    unique("admin_runtime_recovery_receipts_idempotency_unique").on(
      t.commandType,
      t.idempotencyKey,
      t.targetId
    ),
    index("admin_runtime_recovery_receipts_org_idx").on(t.orgId, t.acceptedAt),
    index("admin_runtime_recovery_receipts_plan_idx").on(
      t.executionPlanId,
      t.acceptedAt
    ),
  ]
);

/**
 * MS-016 — Creative Studio jobs (product state). Not a commercial authority table.
 */

export const aiStorySceneProjectionCorrelations = pgTable(
  "ai_story_scene_projection_correlations",
  {
    projectionCorrelationId: uuid("projection_correlation_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    workerExecutionResultId: uuid("worker_execution_result_id")
      .notNull()
      .references(() => aiStoryWorkerExecutionResults.workerExecutionResultId, {
        onDelete: "restrict",
      }),
    providerExecutionId: text("provider_execution_id")
      .notNull()
      .references(() => providerExecutions.executionId, { onDelete: "restrict" }),
    providerAttemptId: text("provider_attempt_id").notNull(),
    outboxJobId: text("outbox_job_id")
      .notNull()
      .references(() => providerOutboxJobs.jobId, { onDelete: "restrict" }),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => providerExecutionDispatches.dispatchId, {
        onDelete: "restrict",
      }),
    providerFinalizationReference: text("provider_finalization_reference").notNull(),
    sceneResultId: uuid("scene_result_id").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    correlation: jsonb("correlation")
      .$type<import("@ceo-agent/shared").SceneProjectionCorrelation>()
      .notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("ai_story_scene_projection_scene_attempt_unique").on(
      t.sceneExecutionId,
      t.providerAttemptId
    ),
    unique("ai_story_scene_projection_hash_unique").on(t.integrityHash),
    unique("ai_story_scene_projection_finalization_unique").on(
      t.providerFinalizationReference
    ),
    index("ai_story_scene_projection_workspace_idx").on(t.workspaceId, t.projectedAt),
  ]
);

/**
 * Sprint 3 PR 3.5 — Projected Canonical Scene Result (references Provider artifacts).
 */

export const aiStorySceneResults = pgTable(
  "ai_story_scene_results",
  {
    sceneResultId: uuid("scene_result_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneRuntimeId: uuid("scene_runtime_id").notNull(),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    workerExecutionResultId: uuid("worker_execution_result_id")
      .notNull()
      .references(() => aiStoryWorkerExecutionResults.workerExecutionResultId, {
        onDelete: "restrict",
      }),
    projectionCorrelationId: uuid("projection_correlation_id")
      .notNull()
      .references(() => aiStorySceneProjectionCorrelations.projectionCorrelationId, {
        onDelete: "restrict",
      }),
    providerExecutionId: text("provider_execution_id").notNull(),
    providerAttemptId: text("provider_attempt_id").notNull(),
    providerFinalizationReference: text("provider_finalization_reference").notNull(),
    sceneId: text("scene_id").notNull(),
    sceneOrder: integer("scene_order").notNull(),
    status: text("status").notNull(),
    integrityHash: text("integrity_hash").notNull(),
    contractVersion: text("contract_version").notNull(),
    result: jsonb("result")
      .$type<import("@ceo-agent/shared").ProjectedSceneResult>()
      .notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    projectedAt: timestamp("projected_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("ai_story_scene_results_scene_attempt_unique").on(
      t.sceneExecutionId,
      t.providerAttemptId
    ),
    unique("ai_story_scene_results_hash_unique").on(t.integrityHash),
    unique("ai_story_scene_results_worker_unique").on(t.workerExecutionResultId),
    index("ai_story_scene_results_workspace_idx").on(t.workspaceId, t.projectedAt),
    index("ai_story_scene_results_plan_idx").on(t.executionPlanId, t.sceneOrder),
  ]
);

/**
 * EXEC-04 — persisted generated-media Scene review (not Scene Intent review).
 */

export const aiStoryGeneratedSceneReviews = pgTable(
  "ai_story_generated_scene_reviews",
  {
    generatedSceneReviewId: uuid("generated_scene_review_id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => aiStories.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id")
      .notNull()
      .references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id")
      .notNull()
      .references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    sceneId: text("scene_id").notNull(),
    providerAttemptId: text("provider_attempt_id").notNull(),
    sceneResultId: uuid("scene_result_id").references(
      () => aiStorySceneResults.sceneResultId,
      { onDelete: "restrict" }
    ),
    decision: text("decision").notNull(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    rationale: text("rationale"),
    contractVersion: text("contract_version").notNull(),
    fact: jsonb("fact")
      .$type<import("@ceo-agent/shared").GeneratedSceneReviewFact>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_generated_scene_reviews_scene_attempt_unique").on(
      t.sceneExecutionId,
      t.providerAttemptId
    ),
    uniqueIndex("ai_story_generated_scene_reviews_approved_scene_unique")
      .on(t.sceneExecutionId)
      .where(sql`${t.decision} = 'APPROVED'`),
    index("ai_story_generated_scene_reviews_plan_idx").on(
      t.executionPlanId,
      t.createdAt
    ),
    index("ai_story_generated_scene_reviews_workspace_idx").on(
      t.workspaceId,
      t.createdAt
    ),
  ]
);

/** Human creative rejection policy, independent from Provider technical truth. */
export const aiStorySceneRetryEligibilityFacts = pgTable(
  "ai_story_scene_retry_eligibility_facts",
  {
    retryEligibilityId: uuid("retry_eligibility_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id").notNull().references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id").notNull().references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    sourceReviewId: uuid("source_review_id").notNull().references(() => aiStoryGeneratedSceneReviews.generatedSceneReviewId, { onDelete: "restrict" }),
    sourceAttemptId: text("source_attempt_id").notNull(),
    eligibility: text("eligibility").notNull(),
    nextAttemptNumber: integer("next_attempt_number"),
    reason: text("reason").notNull(),
    canonicalFingerprint: text("canonical_fingerprint").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull(),
    contractVersion: text("contract_version").notNull(),
    fact: jsonb("fact").$type<import("@ceo-agent/shared").SceneRetryEligibilityFact>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_retry_eligibility_review_unique").on(t.sourceReviewId),
    unique("ai_story_scene_retry_eligibility_hash_unique").on(t.canonicalFingerprint),
    index("ai_story_scene_retry_eligibility_scene_idx").on(t.sceneExecutionId, t.createdAt),
    index("ai_story_scene_retry_eligibility_workspace_idx").on(t.workspaceId, t.createdAt),
  ]
);

/** Immutable Director/shot input revision for one human-authorized retry. */
export const aiStorySceneAttemptInputRevisions = pgTable(
  "ai_story_scene_attempt_input_revisions",
  {
    retryInputRevisionId: uuid("retry_input_revision_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id").notNull().references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id").notNull().references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    revisionNumber: integer("revision_number").notNull(),
    parentRevisionId: uuid("parent_revision_id"),
    sourceAttemptId: text("source_attempt_id").notNull(),
    sourceReviewId: uuid("source_review_id").notNull().references(() => aiStoryGeneratedSceneReviews.generatedSceneReviewId, { onDelete: "restrict" }),
    retryReason: text("retry_reason").notNull(),
    creativeDirection: jsonb("creative_direction").$type<import("@ceo-agent/shared").SceneRetryCreativeDirection>().notNull(),
    productAssetId: uuid("product_asset_id").notNull().references(() => assets.id, { onDelete: "restrict" }),
    productAuthorityHash: text("product_authority_hash").notNull(),
    visualAuthorityCertificationHash: text("visual_authority_certification_hash").notNull(),
    providerModeRequirement: text("provider_mode_requirement").notNull(),
    canonicalFingerprint: text("canonical_fingerprint").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    contractVersion: text("contract_version").notNull(),
    fact: jsonb("fact").$type<import("@ceo-agent/shared").SceneAttemptInputRevisionFact>().notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_attempt_input_revision_number_unique").on(t.sceneExecutionId, t.revisionNumber),
    unique("ai_story_scene_attempt_input_revision_hash_unique").on(t.canonicalFingerprint),
    index("ai_story_scene_attempt_input_revision_workspace_idx").on(t.workspaceId, t.acceptedAt),
  ]
);

/** Human authorization to spend exactly one bounded next attempt. */
export const aiStorySceneRetryAuthorizations = pgTable(
  "ai_story_scene_retry_authorizations",
  {
    retryAuthorizationId: uuid("retry_authorization_id").primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "restrict" }),
    storyId: uuid("story_id").notNull().references(() => aiStories.id, { onDelete: "restrict" }),
    executionPlanId: uuid("execution_plan_id").notNull().references(() => aiStoryExecutionPlans.id, { onDelete: "restrict" }),
    sceneExecutionId: uuid("scene_execution_id").notNull().references(() => aiStorySceneExecutions.id, { onDelete: "restrict" }),
    sourceReviewId: uuid("source_review_id").notNull().references(() => aiStoryGeneratedSceneReviews.generatedSceneReviewId, { onDelete: "restrict" }),
    sourceAttemptId: text("source_attempt_id").notNull(),
    authorizedAttemptNumber: integer("authorized_attempt_number").notNull(),
    authorizedBy: uuid("authorized_by").notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    retryInputRevisionId: uuid("retry_input_revision_id").notNull().references(() => aiStorySceneAttemptInputRevisions.retryInputRevisionId, { onDelete: "restrict" }),
    retryInputFingerprint: text("retry_input_fingerprint").notNull(),
    status: text("status").notNull(),
    canonicalFingerprint: text("canonical_fingerprint").notNull(),
    contractVersion: text("contract_version").notNull(),
    fact: jsonb("fact").$type<import("@ceo-agent/shared").SceneRetryAuthorizationFact>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ai_story_scene_retry_authorization_attempt_unique").on(t.sceneExecutionId, t.authorizedAttemptNumber),
    unique("ai_story_scene_retry_authorization_revision_unique").on(t.retryInputRevisionId),
    unique("ai_story_scene_retry_authorization_hash_unique").on(t.canonicalFingerprint),
    index("ai_story_scene_retry_authorization_workspace_idx").on(t.workspaceId, t.createdAt),
  ]
);

export const storiesRelations = relations(stories, ({ many }) => ({
  assetLinks: many(storyAssets),
  campaignRefs: many(campaignStoryRefs),
}));

export const storyAssetsRelations = relations(storyAssets, ({ one }) => ({
  story: one(stories, { fields: [storyAssets.storyId], references: [stories.id] }),
  asset: one(assets, { fields: [storyAssets.assetId], references: [assets.id] }),
}));

export const campaignStoryRefsRelations = relations(campaignStoryRefs, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignStoryRefs.campaignId], references: [campaigns.id] }),
  story: one(stories, { fields: [campaignStoryRefs.storyId], references: [stories.id] }),
}));

export const aiStoriesRelations = relations(aiStories, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [aiStories.campaignId], references: [campaigns.id] }),
  workspace: one(workspaces, { fields: [aiStories.workspaceId], references: [workspaces.id] }),
  currentVersion: one(aiStoryVersions, {
    fields: [aiStories.currentVersionId],
    references: [aiStoryVersions.id],
  }),
  versions: many(aiStoryVersions),
  assetLinks: many(aiStoryAssetLinks),
  creativeContexts: many(aiStoryCreativeContexts),
  animationPackages: many(aiStoryAnimationPackages),
}));

export const aiStoryVersionsRelations = relations(aiStoryVersions, ({ one, many }) => ({
  story: one(aiStories, { fields: [aiStoryVersions.storyId], references: [aiStories.id] }),
  creativeContexts: many(aiStoryCreativeContexts),
  animationPackages: many(aiStoryAnimationPackages),
}));

export const aiStoryAssetLinksRelations = relations(aiStoryAssetLinks, ({ one }) => ({
  story: one(aiStories, { fields: [aiStoryAssetLinks.storyId], references: [aiStories.id] }),
  asset: one(assets, { fields: [aiStoryAssetLinks.assetId], references: [assets.id] }),
}));

export const aiStoryCreativeContextsRelations = relations(
  aiStoryCreativeContexts,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [aiStoryCreativeContexts.campaignId],
      references: [campaigns.id],
    }),
    story: one(aiStories, {
      fields: [aiStoryCreativeContexts.storyId],
      references: [aiStories.id],
    }),
    storyVersion: one(aiStoryVersions, {
      fields: [aiStoryCreativeContexts.storyVersionId],
      references: [aiStoryVersions.id],
    }),
  })
);

export const aiStoryAnimationPackagesRelations = relations(
  aiStoryAnimationPackages,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [aiStoryAnimationPackages.campaignId],
      references: [campaigns.id],
    }),
    story: one(aiStories, {
      fields: [aiStoryAnimationPackages.storyId],
      references: [aiStories.id],
    }),
    storyVersion: one(aiStoryVersions, {
      fields: [aiStoryAnimationPackages.storyVersionId],
      references: [aiStoryVersions.id],
    }),
  })
);

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  workspaces: many(workspaces),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  organization: one(organizations, { fields: [workspaces.orgId], references: [organizations.id] }),
  members: many(workspaceMembers),
  campaigns: many(campaigns),
  businessProfile: one(businessProfiles, {
    fields: [workspaces.id],
    references: [businessProfiles.workspaceId],
  }),
}));

export const businessProfilesRelations = relations(businessProfiles, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [businessProfiles.workspaceId],
    references: [workspaces.id],
  }),
  organization: one(organizations, {
    fields: [businessProfiles.orgId],
    references: [organizations.id],
  }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [campaigns.workspaceId], references: [workspaces.id] }),
  assets: many(assets),
  assetRefs: many(campaignAssetRefs),
  tasks: many(tasks),
  creatives: many(creatives),
  photoSceneGenerations: many(photoSceneGenerations),
  photoSceneSceneSelections: many(photoSceneSceneSelections),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [assets.campaignId], references: [campaigns.id] }),
  campaignRefs: many(campaignAssetRefs),
}));

export const campaignAssetRefsRelations = relations(campaignAssetRefs, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignAssetRefs.campaignId], references: [campaigns.id] }),
  asset: one(assets, { fields: [campaignAssetRefs.assetId], references: [assets.id] }),
}));

export const photoSceneGenerationsRelations = relations(photoSceneGenerations, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [photoSceneGenerations.campaignId],
    references: [campaigns.id],
  }),
  sourceAsset: one(assets, {
    fields: [photoSceneGenerations.sourceAssetId],
    references: [assets.id],
    relationName: "photoSceneGenerationSource",
  }),
  outputAsset: one(assets, {
    fields: [photoSceneGenerations.outputAssetId],
    references: [assets.id],
    relationName: "photoSceneGenerationOutput",
  }),
}));

export const photoSceneOfficialScenesRelations = relations(photoSceneOfficialScenes, ({ many }) => ({
  versions: many(photoSceneOfficialSceneVersions),
}));

export const photoSceneOfficialSceneVersionsRelations = relations(
  photoSceneOfficialSceneVersions,
  ({ one }) => ({
    scene: one(photoSceneOfficialScenes, {
      fields: [photoSceneOfficialSceneVersions.sceneId],
      references: [photoSceneOfficialScenes.id],
    }),
  })
);

export const photoSceneSceneSelectionsRelations = relations(photoSceneSceneSelections, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [photoSceneSceneSelections.campaignId],
    references: [campaigns.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  campaign: one(campaigns, { fields: [tasks.campaignId], references: [campaigns.id] }),
  creative: one(creatives, { fields: [tasks.id], references: [creatives.taskId] }),
}));

export const creativesRelations = relations(creatives, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [creatives.campaignId], references: [campaigns.id] }),
  task: one(tasks, { fields: [creatives.taskId], references: [tasks.id] }),
  reviews: many(reviews),
}));
