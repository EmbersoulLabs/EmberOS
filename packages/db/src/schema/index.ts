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
    status: text("status").notNull().default("draft"),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_campaign_idx").on(t.campaignId)]
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
    taskId: uuid("task_id").references(() => tasks.id),
    status: text("status").notNull().default("draft"),
    copyVariants: jsonb("copy_variants").$type<unknown[]>().default([]),
    selectedCopyId: text("selected_copy_id"),
    videoUrl: text("video_url"),
    videoExportUrl: text("video_export_url"),
    coverUrl: text("cover_url"),
    editPlan: jsonb("edit_plan").$type<Record<string, unknown>>(),
    complianceResult: jsonb("compliance_result").$type<Record<string, unknown>>(),
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
    creativeId: uuid("creative_id").references(() => creatives.id),
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

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  workspaces: many(workspaces),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  organization: one(organizations, { fields: [workspaces.orgId], references: [organizations.id] }),
  members: many(workspaceMembers),
  campaigns: many(campaigns),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [campaigns.workspaceId], references: [workspaces.id] }),
  assets: many(assets),
  tasks: many(tasks),
  creatives: many(creatives),
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
