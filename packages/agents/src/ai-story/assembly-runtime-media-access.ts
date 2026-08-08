/**
 * Sprint 3 PR 3.6 — Assembly media access (no credentials in argv/logs).
 *
 * Fail-closed workspace scoping. Absolute / file:// paths are denied unless
 * they are explicitly workspace-prefixed. HTTP requires an injected storage port.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  redactSensitiveAssemblyValue,
  type AssemblyRuntimeFailureClassification,
  type AssemblyRuntimeSceneInput,
  type RuntimeOwnershipIdentity,
} from "@ceo-agent/shared/server";

export class AssemblyMediaAccessError extends Error {
  constructor(
    readonly classification: AssemblyRuntimeFailureClassification,
    message: string
  ) {
    super(message);
    this.name = "AssemblyMediaAccessError";
  }
}

export type AssemblyMediaAccessPort = {
  readonly resolveToLocalPath: (input: {
    readonly ownership: RuntimeOwnershipIdentity;
    readonly scene: AssemblyRuntimeSceneInput;
    readonly workDir: string;
  }) => Promise<{ readonly localPath: string; readonly contentHash: string }>;
};

export type AssemblyStorageDownloader = {
  readonly downloadObject: (input: {
    readonly ownership: RuntimeOwnershipIdentity;
    readonly objectKey: string;
    readonly destinationPath: string;
  }) => Promise<void>;
};

function isHttpUrl(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

function hasPathTraversal(uri: string): boolean {
  return uri.includes("..") || /%2e%2e/i.test(uri);
}

/**
 * Resolve a media URI to a workspace-scoped object key, or throw.
 * Accepted forms:
 * - `{workspaceId}/...`
 * - `asset://{workspaceId}/...`
 * - `fixture://{workspaceId}/...`
 */
export function resolveWorkspaceScopedObjectKey(
  ownership: RuntimeOwnershipIdentity,
  uri: string
): string {
  if (!uri.trim() || hasPathTraversal(uri)) {
    throw new AssemblyMediaAccessError(
      "ASSEMBLY_MEDIA_UNAVAILABLE",
      "Media reference path traversal is denied"
    );
  }
  if (isHttpUrl(uri)) {
    throw new AssemblyMediaAccessError(
      "ASSEMBLY_MEDIA_UNAVAILABLE",
      "HTTP media download requires an injected storage access port"
    );
  }
  if (/^file:/i.test(uri)) {
    throw new AssemblyMediaAccessError(
      "ASSEMBLY_MEDIA_UNAVAILABLE",
      "file:// media references are denied"
    );
  }
  if (/^[A-Za-z]:\\/.test(uri) || uri.startsWith("/") || uri.startsWith("\\\\")) {
    throw new AssemblyMediaAccessError(
      "ASSEMBLY_MEDIA_UNAVAILABLE",
      "Absolute media paths are denied"
    );
  }

  const schemeMatch = uri.match(/^(asset|fixture):\/\/([^/]+)\/(.+)$/i);
  if (schemeMatch) {
    const workspaceFromUri = schemeMatch[2]!;
    const rest = schemeMatch[3]!;
    if (workspaceFromUri !== ownership.workspaceId) {
      throw new AssemblyMediaAccessError(
        "ASSEMBLY_MEDIA_UNAVAILABLE",
        "Cross-workspace media reference is denied"
      );
    }
    if (hasPathTraversal(rest)) {
      throw new AssemblyMediaAccessError(
        "ASSEMBLY_MEDIA_UNAVAILABLE",
        "Media reference path traversal is denied"
      );
    }
    return `${ownership.workspaceId}/${rest}`;
  }

  if (uri.startsWith(`${ownership.workspaceId}/`)) {
    return uri;
  }

  throw new AssemblyMediaAccessError(
    "ASSEMBLY_MEDIA_UNAVAILABLE",
    `Unsupported or unscoped media reference: ${redactSensitiveAssemblyValue(uri.slice(0, 48))}`
  );
}

export async function hashFileSha256(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function verifyContentHash(
  target: string,
  scene: AssemblyRuntimeSceneInput
): Promise<string> {
  const contentHash = await hashFileSha256(target);
  const expected = scene.contentHash || scene.mediaReference.contentHash;
  if (expected && contentHash !== expected) {
    throw new AssemblyMediaAccessError(
      "ASSEMBLY_MEDIA_HASH_MISMATCH",
      "Scene media content hash mismatch"
    );
  }
  return contentHash;
}

/**
 * Local/fixture media accessor for workspace-scoped object keys with an optional
 * local override path used only after scoping succeeds (tests).
 */
export function createLocalAssemblyMediaAccessPort(): AssemblyMediaAccessPort {
  return {
    async resolveToLocalPath({ ownership, scene, workDir }) {
      const uri = scene.mediaReference.uri;
      const objectKey = resolveWorkspaceScopedObjectKey(ownership, uri);

      await mkdir(workDir, { recursive: true });
      const target = join(workDir, `scene-${scene.sceneOrder}-${scene.sceneResultId}.bin`);

      if (scene.localMediaPath) {
        // localMediaPath is a controlled host path after URI scoping succeeded.
        if (hasPathTraversal(scene.localMediaPath)) {
          throw new AssemblyMediaAccessError(
            "ASSEMBLY_MEDIA_UNAVAILABLE",
            "Media reference path traversal is denied"
          );
        }
        await copyFile(scene.localMediaPath, target);
      } else {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          `Local assembly media port requires localMediaPath for object ${redactSensitiveAssemblyValue(objectKey.slice(0, 48))}`
        );
      }

      const contentHash = await verifyContentHash(target, scene);
      return { localPath: target, contentHash };
    },
  };
}

/**
 * Production-shaped storage download port. Object keys must be workspace-scoped.
 * Downloader must never place credentials or signed URLs into FFmpeg argv.
 */
export function createWorkspaceScopedStorageMediaAccessPort(
  downloader: AssemblyStorageDownloader
): AssemblyMediaAccessPort {
  return {
    async resolveToLocalPath({ ownership, scene, workDir }) {
      const uri = scene.mediaReference.uri;
      if (isHttpUrl(uri)) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Signed HTTP URLs are denied; use workspace-scoped object keys"
        );
      }
      const objectKey = resolveWorkspaceScopedObjectKey(ownership, uri);
      await mkdir(workDir, { recursive: true });
      const target = join(workDir, `scene-${scene.sceneOrder}-${scene.sceneResultId}.bin`);
      await downloader.downloadObject({
        ownership,
        objectKey,
        destinationPath: target,
      });
      const contentHash = await verifyContentHash(target, scene);
      return { localPath: target, contentHash };
    },
  };
}

/**
 * Test fixture accessor. Enforces ownership when expectedOwnership is provided.
 */
export function createFixtureAssemblyMediaAccessPort(
  pathBySceneResultId: ReadonlyMap<string, string>,
  expectedOwnership?: Pick<RuntimeOwnershipIdentity, "orgId" | "workspaceId">
): AssemblyMediaAccessPort {
  return {
    async resolveToLocalPath({ ownership, scene, workDir }) {
      if (
        expectedOwnership &&
        (ownership.orgId !== expectedOwnership.orgId ||
          ownership.workspaceId !== expectedOwnership.workspaceId)
      ) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Cross-workspace media access is denied"
        );
      }
      const source = pathBySceneResultId.get(scene.sceneResultId);
      if (!source) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Fixture media missing for Scene Result"
        );
      }
      if (hasPathTraversal(source)) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Media reference path traversal is denied"
        );
      }
      await mkdir(workDir, { recursive: true });
      const target = join(workDir, `scene-${scene.sceneOrder}.mp4`);
      await copyFile(source, target);
      const contentHash = await hashFileSha256(target);
      if (scene.contentHash && contentHash !== scene.contentHash) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_HASH_MISMATCH",
          "Fixture media content hash mismatch"
        );
      }
      return { localPath: target, contentHash };
    },
  };
}
