import { z } from "zod";

export const PlatformSchema = z.enum(["tiktok", "xiaohongshu", "instagram", "douyin"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const WorkspaceRoleSchema = z.enum([
  "admin",
  "operator",
  "editor",
  "reviewer",
  "publisher",
  "client_viewer",
]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const OrgRoleSchema = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const CampaignStatusSchema = z.enum([
  "draft",
  "processing",
  "pending_internal_review",
  "pending_client_review",
  "approved",
  "export_ready",
  "failed",
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const CreativeStatusSchema = z.enum([
  "draft",
  "processing",
  "compliance_failed",
  "pending_internal_review",
  "pending_client_review",
  "approved",
  "exported",
  "failed",
]);
export type CreativeStatus = z.infer<typeof CreativeStatusSchema>;

export const TaskStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const AssetTypeSchema = z.enum(["video", "image"]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const ReviewerTypeSchema = z.enum(["internal", "client"]);
export type ReviewerType = z.infer<typeof ReviewerTypeSchema>;

export const ReviewDecisionSchema = z.enum(["pending", "approved", "rejected"]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const BrandProfileSchema = z.object({
  tone: z.string().optional(),
  industry: z.string().optional(),
  targetAudience: z.string().optional(),
  bannedWords: z.array(z.string()).default([]),
  cta: z.string().optional(),
  locale: z.string().default("en-SG"),
});
export type BrandProfile = z.infer<typeof BrandProfileSchema>;

export const CopyVariantSchema = z.object({
  id: z.string(),
  template: z.enum(["pain_point", "comparison", "story", "listicle", "review"]),
  hook: z.string(),
  body: z.string(),
  cta: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  platform: PlatformSchema,
  estimatedReadSec: z.number().optional(),
});
export type CopyVariant = z.infer<typeof CopyVariantSchema>;

export const VisionAnalysisSchema = z.object({
  assetId: z.string(),
  mediaType: AssetTypeSchema,
  durationSec: z.number().optional(),
  subjects: z.array(z.string()),
  scenes: z.array(
    z.object({
      startSec: z.number(),
      endSec: z.number(),
      description: z.string(),
      emotion: z.string().optional(),
    })
  ),
  products: z.array(
    z.object({
      name: z.string(),
      attributes: z.array(z.string()).optional(),
    })
  ),
  hooks: z.array(z.string()),
  transcriptSummary: z.string().optional(),
  suggestedMoments: z.array(
    z.object({
      startSec: z.number(),
      endSec: z.number(),
      reason: z.string(),
    })
  ),
  confidence: z.number().optional(),
});
export type VisionAnalysis = z.infer<typeof VisionAnalysisSchema>;

export const EditPlanSchema = z.object({
  aspectRatio: z.literal("9:16"),
  targetDurationSec: z.number(),
  outputResolution: z.object({
    preview: z.string(),
    export: z.string(),
  }),
  clips: z.array(
    z.object({
      assetId: z.string(),
      startSec: z.number(),
      endSec: z.number(),
      speed: z.number().default(1),
    })
  ),
  subtitles: z.array(
    z.object({
      startSec: z.number(),
      endSec: z.number(),
      text: z.string(),
      style: z.string().default("bold_center"),
    })
  ),
  cover: z.object({
    atSec: z.number(),
    overlayText: z.string().optional(),
  }),
  audio: z.object({
    keepOriginal: z.boolean().default(true),
    bgm: z.string().nullable().optional(),
    normalize: z.boolean().default(true),
  }),
  effects: z
    .array(
      z.object({
        type: z.string(),
        startSec: z.number(),
        durationSec: z.number(),
      })
    )
    .optional(),
});
export type EditPlan = z.infer<typeof EditPlanSchema>;

export const ComplianceResultSchema = z.object({
  passed: z.boolean(),
  score: z.number(),
  flags: z.array(
    z.object({
      source: z.enum(["copy", "subtitle"]),
      variantId: z.string().optional(),
      word: z.string(),
      reason: z.string(),
      suggestion: z.string().optional(),
    })
  ),
  checkedAt: z.string(),
});
export type ComplianceResult = z.infer<typeof ComplianceResultSchema>;

export const TaskGraphStepSchema = z.object({
  id: z.string(),
  agent: z.string(),
  dependsOn: z.array(z.string()).default([]),
  parallel: z.boolean().optional(),
});

export const TaskGraphSchema = z.object({
  version: z.literal("1.0"),
  steps: z.array(TaskGraphStepSchema),
  retryPolicy: z.object({
    maxRetries: z.number(),
    onCopyReject: z.array(z.string()),
    onEditReject: z.array(z.string()),
  }),
  costBudgetUsd: z.number(),
});
export type TaskGraph = z.infer<typeof TaskGraphSchema>;

export const StepProgressSchema = z.record(
  z.string(),
  z.object({
    status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })
);
export type StepProgress = z.infer<typeof StepProgressSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
