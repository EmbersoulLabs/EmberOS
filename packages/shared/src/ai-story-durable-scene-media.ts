/**
 * Sprint 4 Phase A — Durable Scene Media Attestation contracts.
 *
 * Subordinate immutable evidence under Canonical Scene Result.
 * Does NOT mutate Scene Result rows. Provider URI alone is never durable.
 */
import { z } from "zod";
import { PHASE1_EXECUTION_LOCKED } from "./ai-story-phase1-execution-lock";

export const DURABLE_SCENE_MEDIA_CONTRACT_VERSION = "1" as const;
export const DURABLE_SCENE_MEDIA_STORAGE_NAMESPACE_VERSION = "1" as const;
export const DURABLE_SCENE_MEDIA_STORAGE_PROVIDER = "supabase-storage" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");
const IsoDatetimeSchema = z.string().datetime();

/** Redacted source descriptor — never persists signed query tokens. */
export const DurableMediaSourceReferenceSchema = z
  .object({
    scheme: z.literal("https"),
    host: NonEmptyTextSchema,
    /** Path only — query/fragment stripped. */
    path: NonEmptyTextSchema,
    mediaTypeHint: z.string().min(1).optional(),
  })
  .strict();

export type DurableMediaSourceReference = z.infer<
  typeof DurableMediaSourceReferenceSchema
>;

export const DurableSceneMediaAttestationSchema = z
  .object({
    contractVersion: z.literal(DURABLE_SCENE_MEDIA_CONTRACT_VERSION),
    mediaAttestationId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema,
    campaignId: UuidSchema,
    storyId: UuidSchema,
    storyVersionId: UuidSchema,
    animationPackageId: UuidSchema,
    executionPlanId: UuidSchema,
    sceneExecutionId: UuidSchema,
    sceneResultId: UuidSchema,
    sourceMediaReference: DurableMediaSourceReferenceSchema,
    /** Workspace-scoped object key — never signed URL / file path / tmp. */
    durableObjectReference: NonEmptyTextSchema,
    /** SHA-256 of actual persisted bytes. */
    contentHash: IntegrityHashSchema,
    byteSize: z.number().int().positive(),
    mediaType: z.literal("video/mp4"),
    ingestContractVersion: z.literal(DURABLE_SCENE_MEDIA_CONTRACT_VERSION),
    storageProvider: z.literal(DURABLE_SCENE_MEDIA_STORAGE_PROVIDER),
    storageNamespaceVersion: z.literal(
      DURABLE_SCENE_MEDIA_STORAGE_NAMESPACE_VERSION
    ),
    acceptedAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
    executionAllowed: z.literal(false),
    executionLockCode: z.literal(PHASE1_EXECUTION_LOCKED),
  })
  .strict();

export type DurableSceneMediaAttestation = z.infer<
  typeof DurableSceneMediaAttestationSchema
>;

export function parseDurableSceneMediaAttestation(
  value: unknown
): DurableSceneMediaAttestation {
  return DurableSceneMediaAttestationSchema.parse(value);
}

export function redactHttpsMediaUri(uri: string): DurableMediaSourceReference {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error("Source media URI is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Source media URI must use https");
  }
  return {
    scheme: "https",
    host: parsed.host,
    path: parsed.pathname || "/",
  };
}

export function assertWorkspaceScopedDurableObjectKey(
  workspaceId: string,
  objectKey: string
): void {
  const key = objectKey.trim();
  if (!key) throw new Error("Durable object key is empty");
  if (key.includes("..") || /%2e%2e/i.test(key)) {
    throw new Error("Durable object key path traversal is denied");
  }
  if (/^https?:/i.test(key) || /^file:/i.test(key)) {
    throw new Error("Durable object key must not be a URL");
  }
  if (/^[A-Za-z]:\\/.test(key) || key.startsWith("/") || key.startsWith("\\\\")) {
    throw new Error("Durable object key must not be an absolute filesystem path");
  }
  if (!key.startsWith(`${workspaceId}/`)) {
    throw new Error("Durable object key must be workspace-prefixed");
  }
}
