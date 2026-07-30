import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  bigint,
  boolean,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
    defaultPublishingPlatforms: text("default_publishing_platforms")
      .array()
      .notNull()
      .default([]),
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
    /** SPEC-002 / Sprint 0003 interim objective dictionary. */
    objective: text("objective"),
    objectiveCustom: text("objective_custom"),
    targetAudienceOverride: text("target_audience_override"),
    platforms: text("platforms").array().notNull().default([]),
    industry: text("industry"),
    strategyJson: jsonb("strategy_json").$type<Record<string, unknown>>(),
    objectives: text("objectives").array().default([]),
    status: text("status").notNull().default("draft"),
    campaignBrief: text("campaign_brief"),
    outputLanguage: text("output_language"),
    subtitleLanguage: text("subtitle_language"),
    ctaLanguage: text("cta_language"),
    hashtagLanguage: text("hashtag_language"),
    /** Non-AI Generate placeholder state (Sprint 0003). */
    generateStatus: text("generate_status").notNull().default("idle"),
    generateSummary: jsonb("generate_summary").$type<Record<string, unknown>>(),
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

/**
 * PD-036: Workspace-owned Asset is the single source of truth for uploaded files.
 * Campaigns reference Assets via campaign_asset_refs.
 * assets.campaign_id is a nullable legacy compatibility field scheduled for removal
 * after all historical rows and consumers have migrated to reference tables.
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    /** @deprecated Legacy compatibility only; scheduled for removal after migration. */
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    displayName: text("display_name"),
    originalFilename: text("original_filename"),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type"),
    durationSec: numeric("duration_sec"),
    width: integer("width"),
    height: integer("height"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    status: text("status").notNull().default("ready"),
    source: text("source").notNull().default("campaign_upload"),
    uploadedBy: uuid("uploaded_by"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("assets_campaign_idx").on(t.campaignId),
    index("assets_workspace_idx").on(t.workspaceId),
    index("assets_workspace_deleted_idx").on(t.workspaceId, t.deletedAt),
  ]
);

/** PD-037: Story — ordered Asset references; never stores files. */
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

/** Campaign → Story references. */
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

/** Sprint 3 — Execution Job for an approved Animation Package. */
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
  storyRefs: many(campaignStoryRefs),
  aiStories: many(aiStories),
  tasks: many(tasks),
  creatives: many(creatives),
}));

export const assetsRelations = relations(assets, ({ many }) => ({
  storyLinks: many(storyAssets),
  campaignRefs: many(campaignAssetRefs),
  aiStoryLinks: many(aiStoryAssetLinks),
}));

export const storiesRelations = relations(stories, ({ many }) => ({
  assetLinks: many(storyAssets),
  campaignRefs: many(campaignStoryRefs),
}));

export const storyAssetsRelations = relations(storyAssets, ({ one }) => ({
  story: one(stories, { fields: [storyAssets.storyId], references: [stories.id] }),
  asset: one(assets, { fields: [storyAssets.assetId], references: [assets.id] }),
}));

export const campaignAssetRefsRelations = relations(campaignAssetRefs, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignAssetRefs.campaignId], references: [campaigns.id] }),
  asset: one(assets, { fields: [campaignAssetRefs.assetId], references: [assets.id] }),
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

export const tasksRelations = relations(tasks, ({ one }) => ({
  campaign: one(campaigns, { fields: [tasks.campaignId], references: [campaigns.id] }),
  creative: one(creatives, { fields: [tasks.id], references: [creatives.taskId] }),
}));

export const creativesRelations = relations(creatives, ({ one, many }) => ({
  campaign: one(campaigns, { fields: [creatives.campaignId], references: [campaigns.id] }),
  task: one(tasks, { fields: [creatives.taskId], references: [tasks.id] }),
  reviews: many(reviews),
}));
