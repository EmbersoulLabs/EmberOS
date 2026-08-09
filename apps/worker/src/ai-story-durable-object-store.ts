/**
 * Sprint 4 Phase A — Supabase-backed DurableObjectStore with immutable put semantics.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DurableObjectStoreError,
  hashFileSha256Stream,
  type DurableObjectStore,
  type DurableObjectPutInput,
} from "@ceo-agent/agents";
import { assertWorkspaceScopedDurableObjectKey } from "@ceo-agent/shared/server";
import {
  downloadStorageFile,
  uploadStorageFileImmutable,
} from "./storage";

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

export function createSupabaseDurableObjectStore(): DurableObjectStore {
  return {
    async putImmutableObject(input: DurableObjectPutInput) {
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

      let outcome: "created" | "already_exists";
      try {
        outcome = await uploadStorageFileImmutable(
          input.objectKey,
          input.localPath,
          input.mediaType
        );
      } catch (error) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_UPLOAD_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      }

      if (outcome === "already_exists") {
        const workRoot = await mkdtemp(join(tmpdir(), "ember-durable-conflict-"));
        const existingPath = join(workRoot, "existing.bin");
        try {
          await downloadStorageFile(input.objectKey, existingPath);
          const existingHash = await hashFileSha256Stream(existingPath);
          if (existingHash !== input.contentHash) {
            throw new DurableObjectStoreError(
              "DURABLE_OBJECT_CONFLICT",
              "Immutable object already exists with conflicting bytes"
            );
          }
        } catch (error) {
          if (error instanceof DurableObjectStoreError) throw error;
          throw new DurableObjectStoreError(
            "DURABLE_OBJECT_UPLOAD_FAILED",
            error instanceof Error ? error.message : String(error)
          );
        } finally {
          await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
        }
      }

      return { objectKey: input.objectKey };
    },

    async assertReadableObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      const workRoot = await mkdtemp(join(tmpdir(), "ember-durable-assert-"));
      const localPath = join(workRoot, "object.bin");
      try {
        await downloadStorageFile(input.objectKey, localPath);
        const hash = await hashFileSha256Stream(localPath);
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
          error instanceof Error ? error.message : "Durable object is missing"
        );
      } finally {
        await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async downloadObject(input) {
      assertKey(input.workspaceId, input.objectKey);
      try {
        await downloadStorageFile(input.objectKey, input.destinationPath);
      } catch (error) {
        throw new DurableObjectStoreError(
          "DURABLE_OBJECT_MISSING",
          error instanceof Error ? error.message : "Durable object is missing"
        );
      }
    },
  };
}

export function isSupabaseStorageConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  );
}
