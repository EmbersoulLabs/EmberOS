/**
 * Sprint 4 Phase A — DurableObjectStore → AssemblyArtifactBlobStore adapter.
 */
import { stat } from "node:fs/promises";
import type { AssemblyJob } from "@ceo-agent/shared/server";
import { buildDurableAssemblyArtifactObjectKey } from "./durable-media-object-keys";
import {
  hashFileSha256Stream,
  type DurableObjectStore,
} from "./durable-object-store";
import {
  AssemblyRuntimeError,
  type AssemblyArtifactBlobStore,
} from "./assembly-runtime-orchestrator";

export function createDurableAssemblyArtifactBlobStore(
  store: DurableObjectStore
): AssemblyArtifactBlobStore {
  return {
    async putImmutableArtifact({
      ownership,
      assemblyJobId,
      localPath,
      contentHash,
    }) {
      const actualHash = await hashFileSha256Stream(localPath);
      if (actualHash !== contentHash) {
        throw new AssemblyRuntimeError(
          "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
          "Assembly artifact local hash does not match declared contentHash",
          false
        );
      }
      const fileSize = (await stat(localPath)).size;
      const artifactReference = buildDurableAssemblyArtifactObjectKey({
        workspaceId: ownership.workspaceId,
        executionPlanId: ownership.executionPlanId,
        assemblyJobId,
        contentHash,
      });
      await store.putImmutableObject({
        workspaceId: ownership.workspaceId,
        objectKey: artifactReference,
        localPath,
        contentHash,
        mediaType: "video/mp4",
        byteSize: fileSize,
      });
      return { artifactReference };
    },

    async assertReadableArtifact({
      ownership,
      artifactReference,
      expectedContentHash,
    }: {
      readonly ownership: AssemblyJob["ownership"];
      readonly artifactReference: string;
      readonly expectedContentHash: string;
    }) {
      if (
        !artifactReference.startsWith(`${ownership.workspaceId}/`) ||
        artifactReference.includes("..")
      ) {
        throw new AssemblyRuntimeError(
          "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
          "Artifact reference fails workspace scope check",
          false
        );
      }
      try {
        await store.assertReadableObject({
          workspaceId: ownership.workspaceId,
          objectKey: artifactReference,
          expectedContentHash,
        });
      } catch (error) {
        throw new AssemblyRuntimeError(
          "ASSEMBLY_ARTIFACT_PERSISTENCE_FAILED",
          error instanceof Error
            ? error.message
            : "Assembly artifact bytes are missing for recovery",
          false
        );
      }
    },
  };
}
