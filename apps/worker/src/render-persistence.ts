import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  RENDER_PROVIDER_CONTRACT_VERSION,
  renderFingerprint,
  validateRenderResult,
  type RenderCorrelation,
  type RenderReference,
  type RenderRequest,
  type RenderResult,
  type RenderWarning,
} from "./render-providers/contracts";

export const RENDER_PERSISTENCE_CONTRACT_VERSION = "1" as const;
export const RENDER_PERSISTENCE_KEY = "CANONICAL_RENDER_PERSISTENCE";
const EXECUTION_LEASE_MS = 5 * 60 * 1000;
const MAX_DIAGNOSTICS = 50;

export type PersistedRenderCheckpoint =
  | "VIDEO_RENDER_PENDING"
  | "VIDEO_RENDERING"
  | "VIDEO_RENDER_COMPLETE";

export type RenderCallbackStage =
  | "QUEUED"
  | "ACCEPTED"
  | "PREPARING"
  | "RENDERING"
  | "UPLOADING"
  | "COMPLETED"
  | "FAILED";

export type RenderResumeDecisionCode =
  | "NOT_FOUND"
  | "FOUND_PENDING"
  | "FOUND_RENDERING"
  | "FOUND_VALID_RESULT"
  | "FOUND_CORRUPTED_RESULT"
  | "FOUND_STALE_RESULT"
  | "FOUND_PROVIDER_MISMATCH"
  | "FOUND_FINGERPRINT_MISMATCH"
  | "DUPLICATE_PROGRESS"
  | "DUPLICATE_COMPLETION"
  | "CONFLICTING_COMPLETION"
  | "CALLBACK_REGRESSION"
  | "RENDER_REQUIRED";

export interface RenderResumeDecision {
  readonly code: RenderResumeDecisionCode;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly requestFingerprint: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly safeContext?: Readonly<Record<string, string | number | boolean>>;
}

export interface CanonicalRenderCallback {
  readonly callbackId: string;
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly providerJobId?: string;
  readonly correlationId: string;
  readonly requestFingerprint: string;
  readonly stage: RenderCallbackStage;
  readonly resultFingerprint?: string;
  readonly sequence?: number;
  readonly providerTimestamp?: string;
}

export interface RenderArtifact {
  readonly artifactId: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly role: RenderReference["role"];
  readonly uri: string;
  readonly mimeType: "video/mp4" | "image/jpeg";
  readonly resolution: {
    readonly width: number;
    readonly height: number;
  };
  readonly durationSec: number;
  readonly fileSizeBytes?: number;
  readonly fingerprint: string;
  readonly createdAt: string;
}

export interface StoredRenderCheckpoint {
  readonly checkpoint: PersistedRenderCheckpoint;
  readonly status: "WAITING_FOR_DEPENDENCY" | "RUNNING" | "COMPLETED";
  readonly providerId?: string;
  readonly correlationId: string;
  readonly progress?: Readonly<Record<string, unknown>>;
  readonly resultFingerprint?: string;
  readonly updatedAt: string;
}

export interface StoredRenderResult {
  readonly contractVersion: typeof RENDER_PERSISTENCE_CONTRACT_VERSION;
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly correlationId: string;
  readonly requestFingerprint: string;
  readonly resultFingerprint: string;
  readonly result: RenderResult;
  readonly artifactIds: readonly string[];
  readonly warnings: readonly RenderWarning[];
  readonly createdAt: string;
}

export interface RenderIdempotencyRecord {
  readonly idempotencyKey: string;
  readonly contractVersion: typeof RENDER_PERSISTENCE_CONTRACT_VERSION;
  readonly providerId: string;
  readonly correlationId: string;
  readonly requestFingerprint: string;
  readonly outputProfileIdentity: string;
  readonly acceptedStage: RenderCallbackStage;
  readonly acceptedCallbackIds: readonly string[];
  readonly providerJobIds: readonly string[];
  readonly resultFingerprint?: string;
  readonly artifactIds: readonly string[];
  readonly completionTimestamp?: string;
  readonly lease?: {
    readonly token: string;
    readonly expiresAt: string;
  };
  readonly diagnostics: readonly RenderResumeDecision[];
  readonly updatedAt: string;
}

export interface RenderPersistenceEnvelope {
  readonly contractVersion: typeof RENDER_PERSISTENCE_CONTRACT_VERSION;
  readonly checkpoints: Readonly<
    Partial<Record<PersistedRenderCheckpoint, StoredRenderCheckpoint>>
  >;
  readonly resultsByRequestFingerprint: Readonly<
    Record<string, StoredRenderResult>
  >;
  readonly fingerprintIndex: Readonly<Record<string, string>>;
  readonly artifactsById: Readonly<Record<string, RenderArtifact>>;
  readonly idempotencyRecords: Readonly<
    Record<string, RenderIdempotencyRecord>
  >;
}

export interface RenderPersistenceMutation<T> {
  readonly value: T;
  readonly envelope: RenderPersistenceEnvelope;
}

export interface RenderPersistenceStore {
  load(): Promise<unknown>;
  transact<T>(
    operation: (
      envelope: RenderPersistenceEnvelope
    ) => RenderPersistenceMutation<T>
  ): Promise<T>;
}

export interface RenderAttemptIdentity {
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly requestFingerprint: string;
  readonly correlationId: string;
  readonly outputProfileIdentity: string;
}

export interface RenderAttemptClaim {
  readonly decision: RenderResumeDecision;
  readonly leaseToken?: string;
  readonly completedResult?: StoredRenderResult;
}

export interface RenderCompletionAcceptance {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly decision: RenderResumeDecision;
  readonly storedResult: StoredRenderResult;
}

export interface RenderResumeRecord {
  readonly resumeFrom?: "VIDEO_RENDER_PENDING" | "VIDEO_RENDERING";
  readonly completedResult?: StoredRenderResult;
}

export class RenderPersistenceConflictError extends Error {
  constructor(
    readonly code:
      | "IDEMPOTENCY_CONFLICT"
      | "CONFLICTING_COMPLETION"
      | "CALLBACK_REGRESSION"
      | "ARTIFACT_CONFLICT"
      | "CONCURRENT_WRITE_CONFLICT",
    message: string,
    readonly decision?: RenderResumeDecision
  ) {
    super(message);
    this.name = "RenderPersistenceConflictError";
  }
}

function emptyEnvelope(): RenderPersistenceEnvelope {
  return {
    contractVersion: RENDER_PERSISTENCE_CONTRACT_VERSION,
    checkpoints: {},
    resultsByRequestFingerprint: {},
    fingerprintIndex: {},
    artifactsById: {},
    idempotencyRecords: {},
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      immutable(item);
    }
  }
  return value;
}

function validateCorrelation(correlation: RenderCorrelation): void {
  const fields = [
    correlation.taskId,
    correlation.creativeId,
    correlation.campaignId,
    correlation.workspaceId,
    correlation.orgId,
    correlation.correlationId,
  ];
  if (fields.some((field) => !field?.trim())) {
    throw new Error("Render persistence requires valid correlation");
  }
}

export function buildRenderIdempotencyKey(
  request: RenderRequest,
  providerId: string
): string {
  if (!providerId.trim()) {
    throw new Error("Render idempotency requires provider identity");
  }
  return renderFingerprint({
    contractVersion: RENDER_PERSISTENCE_CONTRACT_VERSION,
    taskId: request.correlation.taskId,
    campaignId: request.correlation.campaignId,
    creativeDrafts: request.creativeDraftReferences.map((draft) => ({
      creativeId: draft.creativeId,
      stableKey: draft.stableKey,
    })),
    requestFingerprint: request.retry.deterministicKey,
    providerId,
    outputProfile: request.outputProfile,
  });
}

export function buildRenderCallbackIdentity(input: {
  readonly idempotencyKey: string;
  readonly providerId: string;
  readonly providerJobId?: string;
  readonly correlationId: string;
  readonly requestFingerprint: string;
  readonly stage: RenderCallbackStage;
  readonly resultFingerprint?: string;
  readonly sequence?: number;
  readonly providerTimestamp?: string;
}): CanonicalRenderCallback {
  return immutable({
    ...input,
    callbackId: renderFingerprint({
      idempotencyKey: input.idempotencyKey,
      providerId: input.providerId,
      providerJobId: input.providerJobId,
      correlationId: input.correlationId,
      requestFingerprint: input.requestFingerprint,
      stage: input.stage,
      resultFingerprint: input.resultFingerprint,
      sequence: input.sequence,
      providerTimestamp: input.providerTimestamp,
    }),
  });
}

export function validatePersistableRenderResult(value: unknown): RenderResult {
  const result = validateRenderResult(value);
  if (result.contractVersion !== RENDER_PROVIDER_CONTRACT_VERSION) {
    throw new Error("Render persistence received an invalid contract version");
  }
  if (result.status !== "COMPLETED") {
    throw new Error("Render persistence accepts only completed RenderResult");
  }
  if (
    result.outputReferences.length === 0 ||
    result.outputReferences.some((reference) => !reference.uri.trim())
  ) {
    throw new Error("Render persistence requires output references");
  }
  if (!result.fingerprint.trim()) {
    throw new Error("Render persistence requires a result fingerprint");
  }
  if (!result.providerMetadata.providerId.trim()) {
    throw new Error("Render persistence requires provider identity");
  }
  validateCorrelation(result.correlation);
  if (
    result.provenance.length === 0 ||
    result.provenance.some(
      (entry) =>
        !entry.providerId.trim() ||
        !entry.correlationId.trim() ||
        entry.correlationId !== result.correlation.correlationId ||
        !entry.renderSpecificationKey.trim() ||
        !entry.timestamp.trim()
    )
  ) {
    throw new Error("Render persistence requires valid provenance");
  }
  return result;
}

function canonicalRenderResult(result: RenderResult): RenderResult {
  return {
    contractVersion: result.contractVersion,
    status: result.status,
    outputReferences: clone(result.outputReferences),
    previewReferences: clone(result.previewReferences),
    coverReferences: clone(result.coverReferences),
    durationSec: result.durationSec,
    resolution: { ...result.resolution },
    fileSizeBytes: result.fileSizeBytes,
    fingerprint: result.fingerprint,
    providerMetadata: {
      providerId: result.providerMetadata.providerId,
      providerVersion: result.providerMetadata.providerVersion,
      executionId: result.providerMetadata.executionId,
    },
    correlation: { ...result.correlation },
    warnings: clone(result.warnings),
    provenance: clone(result.provenance),
    usedCache: result.usedCache,
  };
}

function normalizeEnvelope(value: unknown): RenderPersistenceEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyEnvelope();
  }
  const candidate = value as Partial<RenderPersistenceEnvelope>;
  if (candidate.contractVersion !== RENDER_PERSISTENCE_CONTRACT_VERSION) {
    throw new Error(
      `Unsupported RenderPersistence version: ${String(candidate.contractVersion)}`
    );
  }
  return {
    contractVersion: RENDER_PERSISTENCE_CONTRACT_VERSION,
    checkpoints: clone(candidate.checkpoints ?? {}),
    resultsByRequestFingerprint: clone(
      candidate.resultsByRequestFingerprint ?? {}
    ),
    fingerprintIndex: clone(candidate.fingerprintIndex ?? {}),
    artifactsById: clone(candidate.artifactsById ?? {}),
    idempotencyRecords: clone(candidate.idempotencyRecords ?? {}),
  };
}

function decision(
  code: RenderResumeDecisionCode,
  reason: string,
  identity: RenderAttemptIdentity,
  safeContext?: RenderResumeDecision["safeContext"]
): RenderResumeDecision {
  return {
    code,
    reason,
    idempotencyKey: identity.idempotencyKey,
    providerId: identity.providerId,
    requestFingerprint: identity.requestFingerprint,
    correlationId: identity.correlationId,
    timestamp: new Date().toISOString(),
    safeContext,
  };
}

function appendDiagnostic(
  record: RenderIdempotencyRecord,
  item: RenderResumeDecision
): RenderIdempotencyRecord {
  return {
    ...record,
    diagnostics: [...record.diagnostics, item].slice(-MAX_DIAGNOSTICS),
    updatedAt: item.timestamp,
  };
}

function identityConflict(
  record: RenderIdempotencyRecord,
  identity: RenderAttemptIdentity
): RenderResumeDecision | undefined {
  if (record.providerId !== identity.providerId) {
    return decision(
      "FOUND_PROVIDER_MISMATCH",
      "Stored provider does not match the requested provider",
      identity
    );
  }
  if (record.requestFingerprint !== identity.requestFingerprint) {
    return decision(
      "FOUND_FINGERPRINT_MISMATCH",
      "Stored request fingerprint does not match",
      identity
    );
  }
  if (record.correlationId !== identity.correlationId) {
    return decision(
      "FOUND_FINGERPRINT_MISMATCH",
      "Stored correlation does not match",
      identity
    );
  }
  return undefined;
}

const STAGE_RANK: Readonly<Record<Exclude<RenderCallbackStage, "FAILED">, number>> =
  {
    QUEUED: 0,
    ACCEPTED: 1,
    PREPARING: 2,
    RENDERING: 3,
    UPLOADING: 4,
    COMPLETED: 5,
  };

function artifactFor(
  idempotencyKey: string,
  requestFingerprint: string,
  reference: RenderReference,
  result: RenderResult,
  createdAt: string,
  index: number
): RenderArtifact {
  const fingerprint = renderFingerprint({
    resultFingerprint: result.fingerprint,
    reference,
  });
  return {
    artifactId: renderFingerprint({
      idempotencyKey,
      role: reference.role,
      index,
    }),
    idempotencyKey,
    requestFingerprint,
    role: reference.role,
    uri: reference.uri,
    mimeType: reference.mediaType === "video" ? "video/mp4" : "image/jpeg",
    resolution: { ...result.resolution },
    durationSec: result.durationSec,
    fileSizeBytes: result.fileSizeBytes,
    fingerprint,
    createdAt,
  };
}

function artifactSetsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

export class RenderPersistence {
  constructor(
    private readonly store: RenderPersistenceStore,
    private readonly correlation: RenderCorrelation
  ) {
    validateCorrelation(correlation);
  }

  async claimAttempt(
    identity: RenderAttemptIdentity,
    options: { readonly forceStale?: boolean } = {}
  ): Promise<RenderAttemptClaim> {
    return this.store.transact<RenderAttemptClaim>((envelope) => {
      const existing = envelope.idempotencyRecords[identity.idempotencyKey];
      if (existing) {
        const conflict = identityConflict(existing, identity);
        if (conflict) {
          throw new RenderPersistenceConflictError(
            "IDEMPOTENCY_CONFLICT",
            conflict.reason,
            conflict
          );
        }
        const completed =
          envelope.resultsByRequestFingerprint[identity.requestFingerprint];
        if (existing.acceptedStage === "COMPLETED" && !completed) {
          const corrupted = decision(
            "FOUND_CORRUPTED_RESULT",
            "Completed idempotency record has no canonical RenderResult",
            identity
          );
          throw new RenderPersistenceConflictError(
            "IDEMPOTENCY_CONFLICT",
            corrupted.reason,
            corrupted
          );
        }
        if (
          existing.acceptedStage === "COMPLETED" &&
          completed &&
          !options.forceStale
        ) {
          const found = decision(
            "FOUND_VALID_RESULT",
            "A valid canonical RenderResult already exists",
            identity
          );
          return {
            value: { decision: found, completedResult: immutable(clone(completed)) },
            envelope: {
              ...envelope,
              idempotencyRecords: {
                ...envelope.idempotencyRecords,
                [identity.idempotencyKey]: appendDiagnostic(existing, found),
              },
            },
          };
        }
        const leaseActive =
          existing.lease &&
          Date.parse(existing.lease.expiresAt) > Date.now() &&
          !options.forceStale;
        if (leaseActive) {
          const found = decision(
            "FOUND_RENDERING",
            "Another worker owns the active Render execution lease",
            identity
          );
          return {
            value: { decision: found },
            envelope: {
              ...envelope,
              idempotencyRecords: {
                ...envelope.idempotencyRecords,
                [identity.idempotencyKey]: appendDiagnostic(existing, found),
              },
            },
          };
        }
      }

      const now = new Date();
      const leaseToken = randomUUID();
      const required = decision(
        "RENDER_REQUIRED",
        existing
          ? "The prior Render attempt is stale and must resume"
          : "No canonical Render attempt exists",
        identity,
        { resumed: Boolean(existing) }
      );
      const staleArtifactIds =
        options.forceStale && existing ? existing.artifactIds : [];
      const artifactsById = { ...envelope.artifactsById };
      for (const artifactId of staleArtifactIds) {
        delete artifactsById[artifactId];
      }
      const resultsByRequestFingerprint = {
        ...envelope.resultsByRequestFingerprint,
      };
      const fingerprintIndex = { ...envelope.fingerprintIndex };
      if (options.forceStale) {
        delete resultsByRequestFingerprint[identity.requestFingerprint];
        delete fingerprintIndex[identity.requestFingerprint];
      }
      const record: RenderIdempotencyRecord = {
        idempotencyKey: identity.idempotencyKey,
        contractVersion: RENDER_PERSISTENCE_CONTRACT_VERSION,
        providerId: identity.providerId,
        correlationId: identity.correlationId,
        requestFingerprint: identity.requestFingerprint,
        outputProfileIdentity: identity.outputProfileIdentity,
        acceptedStage: options.forceStale
          ? "QUEUED"
          : existing?.acceptedStage ?? "QUEUED",
        acceptedCallbackIds: options.forceStale
          ? []
          : existing?.acceptedCallbackIds ?? [],
        providerJobIds: existing?.providerJobIds ?? [],
        resultFingerprint: options.forceStale
          ? undefined
          : existing?.resultFingerprint,
        artifactIds: options.forceStale ? [] : existing?.artifactIds ?? [],
        completionTimestamp: options.forceStale
          ? undefined
          : existing?.completionTimestamp,
        lease: {
          token: leaseToken,
          expiresAt: new Date(now.getTime() + EXECUTION_LEASE_MS).toISOString(),
        },
        diagnostics: [...(existing?.diagnostics ?? []), required].slice(
          -MAX_DIAGNOSTICS
        ),
        updatedAt: now.toISOString(),
      };
      return {
        value: { decision: required, leaseToken },
        envelope: {
          ...envelope,
          resultsByRequestFingerprint,
          fingerprintIndex,
          artifactsById,
          checkpoints: {
            ...envelope.checkpoints,
            VIDEO_RENDER_PENDING: {
              checkpoint: "VIDEO_RENDER_PENDING",
              status: "WAITING_FOR_DEPENDENCY",
              providerId: identity.providerId,
              correlationId: identity.correlationId,
              updatedAt: now.toISOString(),
            },
          },
          idempotencyRecords: {
            ...envelope.idempotencyRecords,
            [identity.idempotencyKey]: record,
          },
        },
      };
    });
  }

  async acceptCallback(
    callback: CanonicalRenderCallback,
    leaseToken?: string
  ): Promise<RenderResumeDecision> {
    return this.store.transact<RenderResumeDecision>((envelope) => {
      const record = envelope.idempotencyRecords[callback.idempotencyKey];
      const identity: RenderAttemptIdentity = {
        idempotencyKey: callback.idempotencyKey,
        providerId: callback.providerId,
        requestFingerprint: callback.requestFingerprint,
        correlationId: callback.correlationId,
        outputProfileIdentity: record?.outputProfileIdentity ?? "",
      };
      if (!record) {
        throw new RenderPersistenceConflictError(
          "CONCURRENT_WRITE_CONFLICT",
          "Render callback arrived without a persisted attempt"
        );
      }
      const conflict = identityConflict(record, identity);
      if (conflict) {
        throw new RenderPersistenceConflictError(
          "IDEMPOTENCY_CONFLICT",
          conflict.reason,
          conflict
        );
      }
      if (
        leaseToken &&
        record.lease?.token &&
        record.lease.token !== leaseToken
      ) {
        throw new RenderPersistenceConflictError(
          "CONCURRENT_WRITE_CONFLICT",
          "Render callback lease does not own this attempt"
        );
      }
      if (record.acceptedCallbackIds.includes(callback.callbackId)) {
        const duplicate = decision(
          "DUPLICATE_PROGRESS",
          "Equivalent callback was already accepted",
          identity,
          { stage: callback.stage }
        );
        return {
          value: duplicate,
          envelope: {
            ...envelope,
            idempotencyRecords: {
              ...envelope.idempotencyRecords,
              [callback.idempotencyKey]: appendDiagnostic(record, duplicate),
            },
          },
        };
      }
      if (record.acceptedStage === "COMPLETED") {
        const code =
          callback.stage === "FAILED"
            ? "CONFLICTING_COMPLETION"
            : "CALLBACK_REGRESSION";
        const rejected = decision(
          code,
          "Render completion is terminal and cannot regress",
          identity,
          { stage: callback.stage }
        );
        if (callback.stage === "FAILED") {
          throw new RenderPersistenceConflictError(
            "CONFLICTING_COMPLETION",
            rejected.reason,
            rejected
          );
        }
        return {
          value: rejected,
          envelope: {
            ...envelope,
            idempotencyRecords: {
              ...envelope.idempotencyRecords,
              [callback.idempotencyKey]: appendDiagnostic(record, rejected),
            },
          },
        };
      }

      const currentRank =
        record.acceptedStage === "FAILED"
          ? -1
          : STAGE_RANK[record.acceptedStage];
      const nextRank =
        callback.stage === "FAILED" ? currentRank : STAGE_RANK[callback.stage];
      if (callback.stage !== "FAILED" && nextRank < currentRank) {
        const regression = decision(
          "CALLBACK_REGRESSION",
          "Late callback cannot regress the accepted Render stage",
          identity,
          { acceptedStage: record.acceptedStage, callbackStage: callback.stage }
        );
        return {
          value: regression,
          envelope: {
            ...envelope,
            idempotencyRecords: {
              ...envelope.idempotencyRecords,
              [callback.idempotencyKey]: appendDiagnostic(record, regression),
            },
          },
        };
      }
      if (callback.stage === record.acceptedStage) {
        const duplicate = decision(
          "DUPLICATE_PROGRESS",
          "Equivalent Render stage was already accepted",
          identity,
          { stage: callback.stage }
        );
        return {
          value: duplicate,
          envelope: {
            ...envelope,
            idempotencyRecords: {
              ...envelope.idempotencyRecords,
              [callback.idempotencyKey]: appendDiagnostic(record, duplicate),
            },
          },
        };
      }

      const now = new Date();
      const advanced = decision(
        callback.stage === "FAILED" ? "FOUND_RENDERING" : "FOUND_RENDERING",
        `Render callback advanced to ${callback.stage}`,
        identity,
        { stage: callback.stage }
      );
      const providerJobIds = callback.providerJobId
        ? [...new Set([...record.providerJobIds, callback.providerJobId])]
        : record.providerJobIds;
      const updated: RenderIdempotencyRecord = {
        ...record,
        acceptedStage: callback.stage,
        acceptedCallbackIds: [
          ...record.acceptedCallbackIds,
          callback.callbackId,
        ],
        providerJobIds,
        lease:
          callback.stage === "FAILED"
            ? undefined
            : record.lease
              ? {
                  ...record.lease,
                  expiresAt: new Date(
                    now.getTime() + EXECUTION_LEASE_MS
                  ).toISOString(),
                }
              : undefined,
        diagnostics: [...record.diagnostics, advanced].slice(-MAX_DIAGNOSTICS),
        updatedAt: now.toISOString(),
      };
      return {
        value: advanced,
        envelope: {
          ...envelope,
          checkpoints: {
            ...envelope.checkpoints,
            VIDEO_RENDERING: {
              checkpoint: "VIDEO_RENDERING",
              status: "RUNNING",
              providerId: callback.providerId,
              correlationId: callback.correlationId,
              progress: {
                stage: callback.stage,
                callbackId: callback.callbackId,
              },
              updatedAt: now.toISOString(),
            },
          },
          idempotencyRecords: {
            ...envelope.idempotencyRecords,
            [callback.idempotencyKey]: updated,
          },
        },
      };
    });
  }

  async acceptCompletion(
    identity: RenderAttemptIdentity,
    value: unknown,
    leaseToken?: string
  ): Promise<RenderCompletionAcceptance> {
    const result = canonicalRenderResult(validatePersistableRenderResult(value));
    if (result.correlation.correlationId !== identity.correlationId) {
      throw new RenderPersistenceConflictError(
        "CONFLICTING_COMPLETION",
        "Render completion correlation mismatch"
      );
    }
    if (result.providerMetadata.providerId !== identity.providerId) {
      throw new RenderPersistenceConflictError(
        "CONFLICTING_COMPLETION",
        "Render completion provider mismatch"
      );
    }

    return this.store.transact<RenderCompletionAcceptance>((envelope) => {
      const record = envelope.idempotencyRecords[identity.idempotencyKey];
      if (!record) {
        throw new RenderPersistenceConflictError(
          "CONCURRENT_WRITE_CONFLICT",
          "Render completion arrived without a persisted attempt"
        );
      }
      const conflict = identityConflict(record, identity);
      if (conflict) {
        throw new RenderPersistenceConflictError(
          "IDEMPOTENCY_CONFLICT",
          conflict.reason,
          conflict
        );
      }
      if (
        leaseToken &&
        record.lease?.token &&
        record.lease.token !== leaseToken
      ) {
        throw new RenderPersistenceConflictError(
          "CONCURRENT_WRITE_CONFLICT",
          "Render completion lease does not own this attempt"
        );
      }

      const existing =
        envelope.resultsByRequestFingerprint[identity.requestFingerprint];
      if (existing) {
        const sameResult =
          existing.resultFingerprint === result.fingerprint &&
          existing.providerId === identity.providerId &&
          existing.correlationId === identity.correlationId &&
          JSON.stringify(existing.result.outputReferences) ===
            JSON.stringify(result.outputReferences) &&
          JSON.stringify(existing.result.previewReferences) ===
            JSON.stringify(result.previewReferences) &&
          JSON.stringify(existing.result.coverReferences) ===
            JSON.stringify(result.coverReferences);
        const duplicate = decision(
          sameResult ? "DUPLICATE_COMPLETION" : "CONFLICTING_COMPLETION",
          sameResult
            ? "Equivalent Render completion already exists"
            : "Conflicting Render completion cannot replace accepted result",
          identity
        );
        if (!sameResult) {
          throw new RenderPersistenceConflictError(
            "CONFLICTING_COMPLETION",
            duplicate.reason,
            duplicate
          );
        }
        return {
          value: {
            accepted: false,
            duplicate: true,
            decision: duplicate,
            storedResult: immutable(clone(existing)),
          },
          envelope: {
            ...envelope,
            idempotencyRecords: {
              ...envelope.idempotencyRecords,
              [identity.idempotencyKey]: appendDiagnostic(record, duplicate),
            },
          },
        };
      }

      const createdAt = new Date().toISOString();
      const references = [
        ...result.outputReferences,
        ...result.previewReferences,
        ...result.coverReferences,
      ];
      const artifacts = references.map((reference, index) =>
        artifactFor(
          identity.idempotencyKey,
          identity.requestFingerprint,
          reference,
          result,
          createdAt,
          index
        )
      );
      const artifactsById = { ...envelope.artifactsById };
      for (const artifact of artifacts) {
        const stored = artifactsById[artifact.artifactId];
        if (
          stored &&
          (stored.uri !== artifact.uri ||
            stored.fingerprint !== artifact.fingerprint)
        ) {
          throw new RenderPersistenceConflictError(
            "ARTIFACT_CONFLICT",
            "Canonical artifact identity conflicts with persisted metadata"
          );
        }
        artifactsById[artifact.artifactId] = stored ?? artifact;
      }
      const artifactIds = artifacts.map((artifact) => artifact.artifactId);
      if (
        record.artifactIds.length > 0 &&
        !artifactSetsEqual(record.artifactIds, artifactIds)
      ) {
        throw new RenderPersistenceConflictError(
          "ARTIFACT_CONFLICT",
          "Render completion contains a conflicting artifact set"
        );
      }
      const storedResult: StoredRenderResult = {
        contractVersion: RENDER_PERSISTENCE_CONTRACT_VERSION,
        idempotencyKey: identity.idempotencyKey,
        providerId: identity.providerId,
        correlationId: identity.correlationId,
        requestFingerprint: identity.requestFingerprint,
        resultFingerprint: result.fingerprint,
        result: clone(result),
        artifactIds,
        warnings: clone(result.warnings),
        createdAt,
      };
      const accepted = decision(
        "FOUND_VALID_RESULT",
        "Canonical Render completion accepted",
        identity
      );
      const completionCallback = buildRenderCallbackIdentity({
        idempotencyKey: identity.idempotencyKey,
        providerId: identity.providerId,
        providerJobId: result.providerMetadata.executionId,
        correlationId: identity.correlationId,
        requestFingerprint: identity.requestFingerprint,
        stage: "COMPLETED",
        resultFingerprint: result.fingerprint,
      });
      const completedRecord: RenderIdempotencyRecord = {
        ...record,
        acceptedStage: "COMPLETED",
        acceptedCallbackIds: [
          ...new Set([
            ...record.acceptedCallbackIds,
            completionCallback.callbackId,
          ]),
        ],
        providerJobIds: result.providerMetadata.executionId
          ? [
              ...new Set([
                ...record.providerJobIds,
                result.providerMetadata.executionId,
              ]),
            ]
          : record.providerJobIds,
        resultFingerprint: result.fingerprint,
        artifactIds,
        completionTimestamp: record.completionTimestamp ?? createdAt,
        lease: undefined,
        diagnostics: [...record.diagnostics, accepted].slice(-MAX_DIAGNOSTICS),
        updatedAt: createdAt,
      };
      return {
        value: {
          accepted: true,
          duplicate: false,
          decision: accepted,
          storedResult: immutable(clone(storedResult)),
        },
        envelope: {
          ...envelope,
          checkpoints: {
            ...envelope.checkpoints,
            VIDEO_RENDER_COMPLETE: {
              checkpoint: "VIDEO_RENDER_COMPLETE",
              status: "COMPLETED",
              providerId: identity.providerId,
              correlationId: identity.correlationId,
              resultFingerprint: result.fingerprint,
              updatedAt: completedRecord.completionTimestamp!,
            },
          },
          resultsByRequestFingerprint: {
            ...envelope.resultsByRequestFingerprint,
            [identity.requestFingerprint]: storedResult,
          },
          fingerprintIndex: {
            ...envelope.fingerprintIndex,
            [identity.requestFingerprint]: result.fingerprint,
          },
          artifactsById,
          idempotencyRecords: {
            ...envelope.idempotencyRecords,
            [identity.idempotencyKey]: completedRecord,
          },
        },
      };
    });
  }

  async recordDecision(
    identity: RenderAttemptIdentity,
    code: RenderResumeDecisionCode,
    reason: string
  ): Promise<RenderResumeDecision> {
    return this.store.transact((envelope) => {
      const item = decision(code, reason, identity);
      const record = envelope.idempotencyRecords[identity.idempotencyKey];
      return {
        value: item,
        envelope: record
          ? {
              ...envelope,
              idempotencyRecords: {
                ...envelope.idempotencyRecords,
                [identity.idempotencyKey]: appendDiagnostic(record, item),
              },
            }
          : envelope,
      };
    });
  }

  async resolveResumeDecision(
    identity: RenderAttemptIdentity
  ): Promise<RenderResumeDecision> {
    let envelope: RenderPersistenceEnvelope;
    try {
      envelope = normalizeEnvelope(await this.store.load());
    } catch {
      return decision(
        "FOUND_CORRUPTED_RESULT",
        "Render persistence envelope is invalid",
        identity
      );
    }
    const record = envelope.idempotencyRecords[identity.idempotencyKey];
    if (!record) {
      return decision(
        "NOT_FOUND",
        "No canonical Render attempt exists",
        identity
      );
    }
    const conflict = identityConflict(record, identity);
    if (conflict) return conflict;
    if (record.acceptedStage === "COMPLETED") {
      const stored =
        envelope.resultsByRequestFingerprint[identity.requestFingerprint];
      if (!stored) {
        return decision(
          "FOUND_CORRUPTED_RESULT",
          "Completed Render attempt has no stored result",
          identity
        );
      }
      try {
        if (
          envelope.fingerprintIndex[identity.requestFingerprint] !==
            stored.resultFingerprint ||
          stored.resultFingerprint !== record.resultFingerprint
        ) {
          throw new Error("fingerprint mismatch");
        }
        validatePersistableRenderResult(stored.result);
      } catch {
        return decision(
          "FOUND_CORRUPTED_RESULT",
          "Stored RenderResult failed canonical validation",
          identity
        );
      }
      return decision(
        "FOUND_VALID_RESULT",
        "A valid canonical RenderResult exists",
        identity
      );
    }
    if (
      record.acceptedStage === "QUEUED" ||
      !envelope.checkpoints.VIDEO_RENDERING
    ) {
      return decision(
        "FOUND_PENDING",
        "Render attempt is pending provider execution",
        identity
      );
    }
    return decision(
      "FOUND_RENDERING",
      "Render attempt is in progress",
      identity
    );
  }

  async saveCheckpoint(
    checkpoint: PersistedRenderCheckpoint,
    status: StoredRenderCheckpoint["status"],
    details: {
      readonly providerId?: string;
      readonly progress?: Readonly<Record<string, unknown>>;
      readonly resultFingerprint?: string;
    } = {}
  ): Promise<void> {
    await this.store.transact((envelope) => {
      const checkpointRank: Readonly<Record<PersistedRenderCheckpoint, number>> =
        {
          VIDEO_RENDER_PENDING: 0,
          VIDEO_RENDERING: 1,
          VIDEO_RENDER_COMPLETE: 2,
        };
      const highest = Object.values(envelope.checkpoints).reduce<
        StoredRenderCheckpoint | undefined
      >(
        (current, candidate) =>
          !current ||
          checkpointRank[candidate.checkpoint] >
            checkpointRank[current.checkpoint]
            ? candidate
            : current,
        undefined
      );
      if (
        highest &&
        checkpointRank[checkpoint] <= checkpointRank[highest.checkpoint]
      ) {
        return { value: undefined, envelope };
      }
      const record: StoredRenderCheckpoint = {
        checkpoint,
        status,
        providerId: details.providerId,
        correlationId: this.correlation.correlationId,
        progress: details.progress ? clone(details.progress) : undefined,
        resultFingerprint: details.resultFingerprint,
        updatedAt: new Date().toISOString(),
      };
      return {
        value: undefined,
        envelope: {
          ...envelope,
          checkpoints: { ...envelope.checkpoints, [checkpoint]: record },
        },
      };
    });
  }

  async saveRenderResult(
    requestFingerprint: string,
    value: unknown
  ): Promise<StoredRenderResult> {
    const result = validatePersistableRenderResult(value);
    const identity: RenderAttemptIdentity = {
      idempotencyKey: renderFingerprint({
        requestFingerprint,
        providerId: result.providerMetadata.providerId,
        correlationId: result.correlation.correlationId,
      }),
      providerId: result.providerMetadata.providerId,
      requestFingerprint,
      correlationId: result.correlation.correlationId,
      outputProfileIdentity: "legacy",
    };
    const claim = await this.claimAttempt(identity, { forceStale: true });
    const accepted = await this.acceptCompletion(
      identity,
      result,
      claim.leaseToken
    );
    return accepted.storedResult;
  }

  async loadRenderResult(
    requestFingerprint: string
  ): Promise<StoredRenderResult | undefined> {
    const envelope = normalizeEnvelope(await this.store.load());
    const record = envelope.resultsByRequestFingerprint[requestFingerprint];
    if (!record) return undefined;
    if (
      envelope.fingerprintIndex[requestFingerprint] !==
        record.resultFingerprint ||
      record.requestFingerprint !== requestFingerprint ||
      record.correlationId !== this.correlation.correlationId
    ) {
      throw new Error("Render persistence fingerprint or correlation mismatch");
    }
    validatePersistableRenderResult(record.result);
    return immutable(clone(record));
  }

  async resolveArtifact(
    artifactId: string
  ): Promise<RenderArtifact | undefined> {
    const envelope = normalizeEnvelope(await this.store.load());
    const artifact = envelope.artifactsById[artifactId];
    return artifact ? immutable(clone(artifact)) : undefined;
  }

  async loadResume(
    requestFingerprint: string
  ): Promise<RenderResumeRecord> {
    const completedResult = await this.loadRenderResult(requestFingerprint);
    if (completedResult) return { completedResult };
    const envelope = normalizeEnvelope(await this.store.load());
    const rendering = envelope.checkpoints.VIDEO_RENDERING;
    if (
      rendering?.status === "RUNNING" &&
      rendering.correlationId === this.correlation.correlationId
    ) {
      return { resumeFrom: "VIDEO_RENDERING" };
    }
    const pending = envelope.checkpoints.VIDEO_RENDER_PENDING;
    if (
      pending &&
      pending.correlationId === this.correlation.correlationId
    ) {
      return { resumeFrom: "VIDEO_RENDER_PENDING" };
    }
    return {};
  }
}

export function createTaskRenderPersistence(
  taskId: string,
  correlation: RenderCorrelation
): RenderPersistence {
  const store: RenderPersistenceStore = {
    async load() {
      const db = getDb();
      const [task] = await db
        .select({ stepProgress: schema.tasks.stepProgress })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, taskId))
        .limit(1);
      return (
        (task?.stepProgress as Record<string, unknown> | null)?.[
          RENDER_PERSISTENCE_KEY
        ] ?? null
      );
    },
    async transact(operation) {
      const db = getDb();
      return db.transaction(async (tx) => {
        const [task] = await tx
          .select({ stepProgress: schema.tasks.stepProgress })
          .from(schema.tasks)
          .where(eq(schema.tasks.id, taskId))
          .for("update")
          .limit(1);
        if (!task) {
          throw new RenderPersistenceConflictError(
            "CONCURRENT_WRITE_CONFLICT",
            "Render task does not exist"
          );
        }
        const progress =
          (task.stepProgress as Record<string, unknown> | null) ?? {};
        const current = normalizeEnvelope(
          progress[RENDER_PERSISTENCE_KEY] ?? null
        );
        const mutation = operation(current);
        await tx
          .update(schema.tasks)
          .set({
            stepProgress: {
              ...progress,
              [RENDER_PERSISTENCE_KEY]: mutation.envelope,
            },
          })
          .where(eq(schema.tasks.id, taskId));
        return mutation.value;
      });
    },
  };
  return new RenderPersistence(store, correlation);
}
