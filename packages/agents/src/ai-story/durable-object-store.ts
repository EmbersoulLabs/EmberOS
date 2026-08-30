/**
 * Sprint 4 Phase A — durable object store port (immutable put + verified read).
 *
 * Production: Supabase Storage. Tests: in-memory / local fixture.
 * Never persists signed URLs or credentials.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertWorkspaceScopedDurableObjectKey } from "@ceo-agent/shared/server";

export type DurableObjectPutInput = {
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly localPath: string;
  readonly contentHash: string;
  readonly mediaType: string;
  readonly byteSize: number;
};

export type DurableObjectStore = {
  readonly putImmutableObject: (
    input: DurableObjectPutInput
  ) => Promise<{ readonly objectKey: string }>;
  readonly assertReadableObject: (input: {
    readonly workspaceId: string;
    readonly objectKey: string;
    readonly expectedContentHash: string;
  }) => Promise<void>;
  readonly downloadObject: (input: {
    readonly workspaceId: string;
    readonly objectKey: string;
    readonly destinationPath: string;
  }) => Promise<void>;
  readonly createSignedReadUrl?: (input: {
    readonly workspaceId: string;
    readonly objectKey: string;
    readonly expiresInSec: number;
  }) => Promise<{ readonly signedUrl: string; readonly expiresAt: string }>;
};

export class DurableObjectStoreError extends Error {
  constructor(
    readonly code:
      | "DURABLE_OBJECT_INVALID_KEY"
      | "DURABLE_OBJECT_HASH_MISMATCH"
      | "DURABLE_OBJECT_MISSING"
      | "DURABLE_OBJECT_CONFLICT"
      | "DURABLE_OBJECT_UPLOAD_FAILED",
    message: string
  ) {
    super(message);
    this.name = "DurableObjectStoreError";
  }
}

export async function hashFileSha256Stream(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return `sha256:${hash.digest("hex")}`;
}

export async function hashBytesSha256(bytes: Buffer): Promise<string> {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertKey(workspaceId: string, objectKey: string): void {
  try {
    assertWorkspaceScopedDurableObjectKey(workspaceId, objectKey);
  } catch (error) {
    throw new DurableObjectStoreError(
      "DURABLE_OBJECT_INVALID_KEY",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Local durable object store for tests / offline workers.
 * Keys map under rootDir; still enforces workspace prefix + immutable hash.
 */
export function createLocalDurableObjectStore(rootDir: string): DurableObjectStore {
  return {
    async putImmutableObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      const actualHash = await hashFileSha256Stream(input.localPath);
      if (actualHash !== input.contentHash) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_HASH_MISMATCH",
          "Local file hash does not match declared contentHash"
        );
      }
      const fileSize = (await stat(input.localPath)).size;
      if (fileSize !== input.byteSize) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_HASH_MISMATCH",
          "Local file size does not match declared byteSize"
        );
      }
      const target = join(rootDir, input.objectKey);
      await mkdir(dirname(target), { recursive: true });
      try {
        await stat(target);
        const existingHash = await hashFileSha256Stream(target);
        if (existingHash !== input.contentHash) {
          throw new DurableObjectStoreError(
            "DURABLE_OBJECT_CONFLICT",
            "Immutable object already exists with conflicting bytes"
          );
        }
        return { objectKey: input.objectKey };
      } catch (error) {
        if (error instanceof DurableObjectStoreError) throw error;
        // missing — write
      }
      const bytes = await readFile(input.localPath);
      await writeFile(target, bytes, { flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
        const existingHash = await hashFileSha256Stream(target);
        if (existingHash !== input.contentHash) {
          throw new DurableObjectStoreError(
            "DURABLE_OBJECT_CONFLICT",
            "Immutable object already exists with conflicting bytes"
          );
        }
      });
      return { objectKey: input.objectKey };
    },

    async assertReadableObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      const target = join(rootDir, input.objectKey);
      try {
        const hash = await hashFileSha256Stream(target);
        if (hash !== input.expectedContentHash) {
          throw new DurableObjectStoreError(
            "DURABLE_OBJECT_HASH_MISMATCH",
            "Durable object hash mismatch"
          );
        }
      } catch (error) {
        if (error instanceof DurableObjectStoreError) throw error;
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_MISSING",
          "Durable object is missing"
        );
      }
    },

    async downloadObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      const target = join(rootDir, input.objectKey);
      const bytes = await readFile(target).catch(() => {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_MISSING",
          "Durable object is missing"
        );
      });
      await mkdir(dirname(input.destinationPath), { recursive: true });
      await writeFile(input.destinationPath, bytes);
    },
  };
}

/**
 * In-memory durable object store for unit tests (no filesystem).
 */
export function createMemoryDurableObjectStore(): DurableObjectStore & {
  readonly objects: Map<string, Buffer>;
  readonly putCount: { value: number };
  readonly downloadCount: { value: number };
} {
  const objects = new Map<string, Buffer>();
  const putCount = { value: 0 };
  const downloadCount = { value: 0 };
  return {
    objects,
    putCount,
    downloadCount,
    async putImmutableObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      const bytes = await readFile(input.localPath);
      const hash = await hashBytesSha256(bytes);
      if (hash !== input.contentHash || bytes.length !== input.byteSize) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_HASH_MISMATCH",
          "Declared contentHash/byteSize mismatch"
        );
      }
      const existing = objects.get(input.objectKey);
      if (existing) {
        if ((await hashBytesSha256(existing)) !== hash) {
          throw new DurableObjectStoreError(
            "DURABLE_OBJECT_CONFLICT",
            "Immutable object already exists with conflicting bytes"
          );
        }
        return { objectKey: input.objectKey };
      }
      putCount.value += 1;
      objects.set(input.objectKey, bytes);
      return { objectKey: input.objectKey };
    },
    async assertReadableObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      const bytes = objects.get(input.objectKey);
      if (!bytes) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_MISSING",
          "Durable object is missing"
        );
      }
      if ((await hashBytesSha256(bytes)) !== input.expectedContentHash) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_HASH_MISMATCH",
          "Durable object hash mismatch"
        );
      }
    },
    async downloadObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      downloadCount.value += 1;
      const bytes = objects.get(input.objectKey);
      if (!bytes) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_MISSING",
          "Durable object is missing"
        );
      }
      await mkdir(dirname(input.destinationPath), { recursive: true });
      await writeFile(input.destinationPath, bytes);
    },
  };
}
