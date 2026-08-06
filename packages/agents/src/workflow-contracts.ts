import type { CampaignAIContext, PipelineState } from "@ceo-agent/shared";

export const PIPELINE_TYPES = [
  "VIDEO",
  "IMAGE_UNDERSTANDING",
  "PRODUCT_IMAGE",
  "MARKETING",
] as const;

export type PipelineType = (typeof PIPELINE_TYPES)[number];
export type MediaPipelineType = Exclude<PipelineType, "MARKETING">;

export interface RoutableAsset {
  id: string;
  type: string;
  mimeType?: string | null;
  status?: string | null;
  storagePath?: string | null;
  durationSec?: string | number | null;
}

export type PipelineDependencyState =
  | "WAITING"
  | "READY"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL"
  | "NOT_REQUIRED";

export interface PipelineDependency {
  id: string;
  kind:
    | "campaign"
    | "asset_upload"
    | "asset_registration"
    | "business_profile"
    | "pipeline_output"
    | "marketing_context";
  required: boolean;
  state: PipelineDependencyState;
  pipelineType?: PipelineType;
  assetId?: string;
  reason?: string;
}

export interface PipelineWarning {
  code: string;
  message: string;
  retryable: boolean;
  assetId?: string;
}

export interface PipelineProvenance {
  source: string;
  pipelineType: PipelineType;
  assetId?: string;
  creativeId?: string;
  provider?: string;
  model?: string;
  skillVersion?: string;
  promptVersion?: string;
}

export interface PipelineExecutionRequest {
  campaignId: string;
  workspaceId: string;
  campaignObjective: string;
  selectedAssets: RoutableAsset[];
  requestedOutputs: string[];
  enabledCapabilities: string[];
  dependencies: PipelineDependency[];
  completedResults: Partial<Record<PipelineType, PipelineExecutionResult>>;
  retryPipelineTypes: PipelineType[];
}

export interface PipelineExecutionResult<T = Record<string, unknown>> {
  pipelineType: PipelineType;
  state: PipelineState;
  assetIds: string[];
  creativeIds: string[];
  output: T;
  warnings: PipelineWarning[];
  confidence: Record<string, number>;
  provenance: PipelineProvenance[];
  checkpoint?: string;
  deterministicKey?: string;
}

export interface PipelineRoute {
  pipelineType: PipelineType;
  state: PipelineState;
  assetIds: string[];
  dependsOn: string[];
  reason: string;
}

export interface PipelineExecutionPlan {
  campaignId: string;
  workspaceId: string;
  routes: PipelineRoute[];
  concurrencyGroups: MediaPipelineType[][];
  reusedResults: Partial<Record<PipelineType, PipelineExecutionResult>>;
  deterministicKey: string;
}

export interface MergedCampaignContext {
  campaignContext: CampaignAIContext;
  pipelineResults: PipelineExecutionResult[];
  assetIds: string[];
  creativeIds: string[];
  provenance: PipelineProvenance[];
  warnings: PipelineWarning[];
  confidence: Record<string, number>;
  deterministicKey: string;
}

export interface MarketingExecutionMetadata {
  campaignName: string;
  creativeBrief?: unknown;
  videoAnalysis?: string | null;
  assetsUploaded: number;
}

/** Backward-compatible internal alias while call sites migrate. */
export type MergedMarketingContext = MergedCampaignContext;
