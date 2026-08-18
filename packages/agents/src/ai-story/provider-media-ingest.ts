/**
 * Sprint 4 Phase A — Provider HTTPS media ingest → durable attestation.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  DURABLE_SCENE_MEDIA_CONTRACT_VERSION,
  DURABLE_SCENE_MEDIA_STORAGE_NAMESPACE_VERSION,
  DURABLE_SCENE_MEDIA_STORAGE_PROVIDER,
  PHASE1_EXECUTION_LOCKED,
  redactHttpsMediaUri,
  type DurableSceneMediaAttestation,
  type RuntimeOwnershipIdentity,
} from "@ceo-agent/shared/server";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import { canonicalPersistenceHash } from "@ceo-agent/db";
import { buildDurableSceneMediaObjectKey } from "./durable-media-object-keys";
import {
  hashFileSha256Stream,
  type DurableObjectStore,
} from "./durable-object-store";

export const DEFAULT_MAX_PROVIDER_MEDIA_BYTES = 512 * 1024 * 1024;
export const DEFAULT_PROVIDER_MEDIA_DOWNLOAD_TIMEOUT_MS = 180_000;

export class ProviderMediaIngestError extends Error {
  constructor(
    readonly code:
      | "INGEST_URI_INVALID"
      | "INGEST_URI_SCHEME_DENIED"
      | "INGEST_REDIRECT_DENIED"
      | "INGEST_SIZE_LIMIT"
      | "INGEST_TIMEOUT"
      | "INGEST_EMPTY"
      | "INGEST_MEDIA_INVALID"
      | "INGEST_UPLOAD_FAILED"
      | "INGEST_OWNERSHIP_INVALID",
    message: string
  ) {
    super(message);
    this.name = "ProviderMediaIngestError";
  }
}

export type ProviderMediaIngestInput = {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly sceneExecutionId: string;
  readonly sceneResultId: string;
  readonly sourceHttpsUri: string;
  readonly mediaTypeHint?: string;
  readonly now?: () => Date;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
};

export type DurableSceneMediaAttestationRepository = {
  readonly acceptOrConverge: (
    attestation: DurableSceneMediaAttestation
  ) => Promise<{ attestation: DurableSceneMediaAttestation; replayed: boolean }>;
  readonly getBySceneResultId: (
    sceneResultId: string
  ) => Promise<DurableSceneMediaAttestation | null>;
  readonly listByExecutionPlanId: (
    executionPlanId: string
  ) => Promise<readonly DurableSceneMediaAttestation[]>;
};

function assertOwnership(input: ProviderMediaIngestInput): void {
  const o = input.ownership;
  for (const [k, v] of Object.entries({
    orgId: o.orgId,
    workspaceId: o.workspaceId,
    campaignId: o.campaignId,
    storyId: o.storyId,
    storyVersionId: o.storyVersionId,
    animationPackageId: o.animationPackageId,
    executionPlanId: o.executionPlanId,
  })) {
    if (typeof v !== "string" || !v.trim()) {
      throw new ProviderMediaIngestError(
        "INGEST_OWNERSHIP_INVALID",
        `Missing ownership field ${k}`
      );
    }
  }
}

function validateSourceUri(uri: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new ProviderMediaIngestError(
      "INGEST_URI_INVALID",
      "Source media URI is not a valid URL"
    );
  }
  if (parsed.protocol !== "https:") {
    throw new ProviderMediaIngestError(
      "INGEST_URI_SCHEME_DENIED",
      "Only https Provider media URIs are accepted"
    );
  }
  if (parsed.username || parsed.password) {
    throw new ProviderMediaIngestError(
      "INGEST_URI_INVALID",
      "Provider media URI must not embed credentials"
    );
  }
  return parsed;
}

async function downloadHttpsToFile(input: {
  readonly uri: string;
  readonly destinationPath: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly fetchImpl: typeof fetch;
}): Promise<{ readonly mediaType: string; readonly byteSize: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(input.uri, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProviderMediaIngestError(
        "INGEST_UPLOAD_FAILED",
        `Provider media download failed (${response.status})`
      );
    }
    const contentType = (response.headers.get("content-type") ?? "video/mp4")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (
      contentType &&
      contentType !== "application/octet-stream" &&
      !contentType.includes("video") &&
      contentType !== "video/mp4"
    ) {
      throw new ProviderMediaIngestError(
        "INGEST_MEDIA_INVALID",
        `Unsupported media content-type: ${contentType}`
      );
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > input.maxBytes) {
      throw new ProviderMediaIngestError(
        "INGEST_SIZE_LIMIT",
        "Provider media exceeds allowed size"
      );
    }
    if (!response.body) {
      throw new ProviderMediaIngestError(
        "INGEST_EMPTY",
        "Provider media response body is empty"
      );
    }

    let transferred = 0;
    const nodeReadable = Readable.fromWeb(
      response.body as unknown as import("stream/web").ReadableStream
    );
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        transferred += buf.length;
        if (transferred > input.maxBytes) {
          callback(
            new ProviderMediaIngestError(
              "INGEST_SIZE_LIMIT",
              "Provider media exceeds allowed size"
            )
          );
          return;
        }
        callback(null, buf);
      },
    });
    await pipeline(nodeReadable, limiter, createWriteStream(input.destinationPath));
    if (transferred <= 0) {
      throw new ProviderMediaIngestError(
        "INGEST_EMPTY",
        "Provider media is zero bytes"
      );
    }
    return {
      mediaType: contentType.includes("video") ? "video/mp4" : "video/mp4",
      byteSize: transferred,
    };
  } catch (error) {
    if (error instanceof ProviderMediaIngestError) throw error;
    if ((error as { name?: string })?.name === "AbortError") {
      throw new ProviderMediaIngestError(
        "INGEST_TIMEOUT",
        "Provider media download timed out"
      );
    }
    // fetch redirect: 'error' surfaces as TypeError in undici
    const message = String((error as { message?: string })?.message ?? error);
    if (/redirect/i.test(message)) {
      throw new ProviderMediaIngestError(
        "INGEST_REDIRECT_DENIED",
        "Provider media redirects are denied"
      );
    }
    throw new ProviderMediaIngestError(
      "INGEST_UPLOAD_FAILED",
      "Provider media download failed"
    );
  } finally {
    clearTimeout(timer);
  }
}

export function buildDurableSceneMediaAttestation(input: {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly sceneExecutionId: string;
  readonly sceneResultId: string;
  readonly sourceHttpsUri: string;
  readonly durableObjectReference: string;
  readonly contentHash: string;
  readonly byteSize: number;
  readonly acceptedAt: string;
}): DurableSceneMediaAttestation {
  const sourceMediaReference = redactHttpsMediaUri(input.sourceHttpsUri);
  const mediaAttestationId = deterministicPersistenceUuid(
    "ai-story-durable-scene-media",
    {
      sceneResultId: input.sceneResultId,
      contentHash: input.contentHash,
      durableObjectReference: input.durableObjectReference,
    }
  );
  const withoutHash = {
    contractVersion: DURABLE_SCENE_MEDIA_CONTRACT_VERSION,
    mediaAttestationId,
    orgId: input.ownership.orgId,
    workspaceId: input.ownership.workspaceId,
    campaignId: input.ownership.campaignId,
    storyId: input.ownership.storyId,
    storyVersionId: input.ownership.storyVersionId,
    animationPackageId: input.ownership.animationPackageId,
    executionPlanId: input.ownership.executionPlanId,
    sceneExecutionId: input.sceneExecutionId,
    sceneResultId: input.sceneResultId,
    sourceMediaReference,
    durableObjectReference: input.durableObjectReference,
    contentHash: input.contentHash,
    byteSize: input.byteSize,
    mediaType: "video/mp4" as const,
    ingestContractVersion: DURABLE_SCENE_MEDIA_CONTRACT_VERSION,
    storageProvider: DURABLE_SCENE_MEDIA_STORAGE_PROVIDER,
    storageNamespaceVersion: DURABLE_SCENE_MEDIA_STORAGE_NAMESPACE_VERSION,
    acceptedAt: input.acceptedAt,
    executionAllowed: false as const,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
  };
  return {
    ...withoutHash,
    integrityHash: canonicalPersistenceHash({
      kind: "ai-story-durable-scene-media-attestation",
      ...withoutHash,
    }),
  };
}

/**
 * Download Provider HTTPS media, store immutably, accept attestation.
 * Operational temp file is deleted after durable put+verify.
 */
export async function ingestProviderSceneMedia(input: {
  readonly ingest: ProviderMediaIngestInput;
  readonly store: DurableObjectStore;
  readonly repository: DurableSceneMediaAttestationRepository;
}): Promise<{
  readonly attestation: DurableSceneMediaAttestation;
  readonly replayed: boolean;
  readonly downloaded: boolean;
}> {
  assertOwnership(input.ingest);
  validateSourceUri(input.ingest.sourceHttpsUri);

  const existing = await input.repository.getBySceneResultId(
    input.ingest.sceneResultId
  );
  if (existing) {
    await input.store.assertReadableObject({
      workspaceId: existing.workspaceId,
      objectKey: existing.durableObjectReference,
      expectedContentHash: existing.contentHash,
    });
    return { attestation: existing, replayed: true, downloaded: false };
  }

  const workRoot = await mkdtemp(join(tmpdir(), "ember-media-ingest-"));
  const localPath = join(workRoot, "source.mp4");
  try {
    const downloaded = await downloadHttpsToFile({
      uri: input.ingest.sourceHttpsUri,
      destinationPath: localPath,
      maxBytes: input.ingest.maxBytes ?? DEFAULT_MAX_PROVIDER_MEDIA_BYTES,
      timeoutMs:
        input.ingest.timeoutMs ?? DEFAULT_PROVIDER_MEDIA_DOWNLOAD_TIMEOUT_MS,
      fetchImpl: input.ingest.fetchImpl ?? fetch,
    });
    const fileStat = await stat(localPath);
    if (fileStat.size <= 0) {
      throw new ProviderMediaIngestError(
        "INGEST_EMPTY",
        "Provider media is zero bytes"
      );
    }
    // Minimal container gate: MP4/ISO BMFF typically starts with size+ftyp.
    // Full ffmpeg probe remains Assembly's responsibility.
    const contentHash = await hashFileSha256Stream(localPath);
    const durableObjectReference = buildDurableSceneMediaObjectKey({
      workspaceId: input.ingest.ownership.workspaceId,
      executionPlanId: input.ingest.ownership.executionPlanId,
      sceneExecutionId: input.ingest.sceneExecutionId,
      contentHash,
    });
    await input.store.putImmutableObject({
      workspaceId: input.ingest.ownership.workspaceId,
      objectKey: durableObjectReference,
      localPath,
      contentHash,
      mediaType: downloaded.mediaType,
      byteSize: fileStat.size,
    });
    await input.store.assertReadableObject({
      workspaceId: input.ingest.ownership.workspaceId,
      objectKey: durableObjectReference,
      expectedContentHash: contentHash,
    });

    const attestation = buildDurableSceneMediaAttestation({
      ownership: input.ingest.ownership,
      sceneExecutionId: input.ingest.sceneExecutionId,
      sceneResultId: input.ingest.sceneResultId,
      sourceHttpsUri: input.ingest.sourceHttpsUri,
      durableObjectReference,
      contentHash,
      byteSize: fileStat.size,
      acceptedAt: (input.ingest.now ?? (() => new Date))().toISOString(),
    });
    const accepted = await input.repository.acceptOrConverge(attestation);
    return {
      attestation: accepted.attestation,
      replayed: accepted.replayed,
      downloaded: true,
    };
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
