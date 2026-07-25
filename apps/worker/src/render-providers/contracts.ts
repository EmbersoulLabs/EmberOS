import { createHash } from "node:crypto";
import type {
  EditPlan,
  RenderMode,
  RenderPhase,
  RenderProfileKey,
} from "@ceo-agent/shared";
import type { RenderSpecification } from "@ceo-agent/agents";

export const RENDER_PROVIDER_CONTRACT_VERSION = "1" as const;

export type RenderProviderCapability =
  | "VIDEO"
  | "IMAGE"
  | "SUBTITLES"
  | "VOICEOVER"
  | "BGM"
  | "BRAND_OVERLAY"
  | "CACHE"
  | "COVER";

export interface RenderSourceAsset {
  readonly assetId: string;
  readonly uri: string;
  readonly mediaType: "video" | "image";
}

export interface RenderOutputProfile {
  readonly mode: RenderMode;
  readonly resolution?: "720p" | "1080p" | "2k";
  readonly profileKey?: RenderProfileKey;
}

export interface RenderQualityProfile {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly videoBitrateKbps: number;
  readonly audioBitrateKbps: number;
}

export interface RenderRetryContext {
  readonly attempt: number;
  readonly deterministicKey: string;
  readonly cachedOutputUri?: string;
}

export interface RenderCorrelation {
  readonly taskId: string;
  readonly creativeId: string;
  readonly campaignId: string;
  readonly workspaceId: string;
  readonly orgId: string;
  readonly correlationId: string;
}

export interface RenderRequest {
  readonly contractVersion: typeof RENDER_PROVIDER_CONTRACT_VERSION;
  readonly renderSpecification: RenderSpecification;
  readonly creativeDraftReferences: readonly {
    readonly creativeId: string;
    readonly stableKey: string;
  }[];
  readonly sourceAssets: readonly RenderSourceAsset[];
  readonly outputProfile: RenderOutputProfile;
  readonly qualityProfile: RenderQualityProfile;
  readonly retry: RenderRetryContext;
  readonly correlation: RenderCorrelation;
  readonly destinations: {
    readonly outputUri: string;
    readonly cacheOutputUri?: string;
    readonly coverOutputUri?: string;
  };
  readonly cachedBaseUri?: string;
  readonly sourceDurationSec?: number;
  readonly cover?: {
    readonly sourceAssetId?: string;
    readonly atSec: number;
  };
  readonly branding?: {
    readonly logoUri?: string;
  };
  /**
   * Temporary compatibility input for the unchanged legacy renderer.
   * Canonical providers should execute from renderSpecification.
   */
  readonly legacyEditPlan?: EditPlan;
  readonly unknownFields?: Readonly<Record<string, unknown>>;
}

export interface RenderReference {
  readonly uri: string;
  readonly mediaType: "video" | "image";
  readonly role: "output" | "preview" | "cover" | "cache";
}

export interface RenderProviderMetadata {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly executionId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface RenderWarning {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface RenderProvenance {
  readonly providerId: string;
  readonly sourceAssetIds: readonly string[];
  readonly renderSpecificationKey: string;
  readonly correlationId: string;
  readonly timestamp: string;
}

export interface RenderResult {
  readonly contractVersion: typeof RENDER_PROVIDER_CONTRACT_VERSION;
  readonly status: "COMPLETED" | "FAILED_RETRYABLE" | "FAILED_TERMINAL";
  readonly outputReferences: readonly RenderReference[];
  readonly previewReferences: readonly RenderReference[];
  readonly coverReferences: readonly RenderReference[];
  readonly durationSec: number;
  readonly resolution: { readonly width: number; readonly height: number };
  readonly fileSizeBytes?: number;
  readonly fingerprint: string;
  readonly providerMetadata: RenderProviderMetadata;
  readonly correlation: RenderCorrelation;
  readonly warnings: readonly RenderWarning[];
  readonly provenance: readonly RenderProvenance[];
  readonly usedCache: boolean;
  readonly unknownFields?: Readonly<Record<string, unknown>>;
}

export type RenderProgressReporter = (
  percent: number,
  phase: RenderPhase
) => void | Promise<void>;

export interface RenderProvider {
  readonly id: string;
  readonly version: string;
  capabilities(): ReadonlySet<RenderProviderCapability>;
  execute(
    request: RenderRequest,
    onProgress?: RenderProgressReporter
  ): Promise<RenderResult>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function renderFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value;
}

export function validateRenderRequest(value: unknown): RenderRequest {
  assertRecord(value, "RenderRequest");
  if (value.contractVersion !== RENDER_PROVIDER_CONTRACT_VERSION) {
    throw new Error(`Unsupported RenderRequest version: ${String(value.contractVersion)}`);
  }
  assertRecord(value.renderSpecification, "RenderRequest.renderSpecification");
  if (
    !Array.isArray(value.sourceAssets) ||
    (value.sourceAssets.length === 0 && typeof value.cachedBaseUri !== "string")
  ) {
    throw new Error(
      "RenderRequest requires source assets or a cached base reference"
    );
  }
  assertRecord(value.outputProfile, "RenderRequest.outputProfile");
  assertRecord(value.qualityProfile, "RenderRequest.qualityProfile");
  assertRecord(value.retry, "RenderRequest.retry");
  assertRecord(value.correlation, "RenderRequest.correlation");
  assertRecord(value.destinations, "RenderRequest.destinations");
  return deepFreeze(value as unknown as RenderRequest);
}

export function validateRenderResult(value: unknown): RenderResult {
  assertRecord(value, "RenderResult");
  if (value.contractVersion !== RENDER_PROVIDER_CONTRACT_VERSION) {
    throw new Error(`Unsupported RenderResult version: ${String(value.contractVersion)}`);
  }
  if (!["COMPLETED", "FAILED_RETRYABLE", "FAILED_TERMINAL"].includes(String(value.status))) {
    throw new Error(`Invalid RenderResult status: ${String(value.status)}`);
  }
  if (!Array.isArray(value.outputReferences)) {
    throw new Error("RenderResult.outputReferences must be an array");
  }
  return deepFreeze(value as unknown as RenderResult);
}

export function serializeRenderRequest(request: RenderRequest): string {
  return JSON.stringify(validateRenderRequest(request));
}

export function deserializeRenderRequest(payload: string): RenderRequest {
  return validateRenderRequest(JSON.parse(payload));
}

export function serializeRenderResult(result: RenderResult): string {
  return JSON.stringify(validateRenderResult(result));
}

export function deserializeRenderResult(payload: string): RenderResult {
  return validateRenderResult(JSON.parse(payload));
}

export class RenderProviderRegistry {
  private readonly providers = new Map<string, RenderProvider>();
  private defaultProviderId?: string;

  register(provider: RenderProvider, options?: { makeDefault?: boolean }): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Render provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    if (options?.makeDefault || !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  get(providerId: string): RenderProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Render provider not registered: ${providerId}`);
    return provider;
  }

  select(required: readonly RenderProviderCapability[], providerId?: string): RenderProvider {
    const provider = providerId
      ? this.get(providerId)
      : this.defaultProviderId
        ? this.get(this.defaultProviderId)
        : undefined;
    if (!provider) throw new Error("No default render provider registered");
    const capabilities = provider.capabilities();
    const missing = required.filter((capability) => !capabilities.has(capability));
    if (missing.length > 0) {
      throw new Error(
        `Render provider ${provider.id} lacks capabilities: ${missing.join(", ")}`
      );
    }
    return provider;
  }
}
