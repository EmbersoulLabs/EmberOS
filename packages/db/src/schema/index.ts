import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  bigint,
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
