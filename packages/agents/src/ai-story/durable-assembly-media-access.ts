/**
 * Sprint 4 Phase A — DurableObjectStore + attestation lookup → AssemblyMediaAccessPort.
 *
 * Resolves durable workspace objects to local work paths. Returns the SHA-256 of
 * downloaded bytes (never a Provider HTTPS URI placeholder).
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DurableSceneMediaAttestation } from "@ceo-agent/shared/server";
import {
  AssemblyMediaAccessError,
  hashFileSha256,
  type AssemblyMediaAccessPort,
} from "./assembly-runtime-media-access";
import type { DurableObjectStore } from "./durable-object-store";

export type DurableSceneMediaAttestationLookup = {
  readonly getBySceneResultId: (
    sceneResultId: string
  ) => Promise<DurableSceneMediaAttestation | null>;
};

export function createDurableAssemblyMediaAccessPort(input: {
  readonly store: DurableObjectStore;
  readonly attestations: DurableSceneMediaAttestationLookup;
}): AssemblyMediaAccessPort {
  return {
    async resolveToLocalPath({ ownership, scene, workDir }) {
      const attestation = await input.attestations.getBySceneResultId(
        scene.sceneResultId
      );
      if (!attestation) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Durable Scene Media Attestation missing for Scene Result"
        );
      }
      if (
        attestation.workspaceId !== ownership.workspaceId ||
        attestation.orgId !== ownership.orgId ||
        attestation.executionPlanId !== ownership.executionPlanId
      ) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Durable Scene Media Attestation ownership mismatch"
        );
      }

      const objectKey =
        scene.mediaReference.uri.startsWith(`${ownership.workspaceId}/`)
          ? scene.mediaReference.uri
          : attestation.durableObjectReference;

      if (objectKey !== attestation.durableObjectReference) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_UNAVAILABLE",
          "Scene media reference does not match Durable Scene Media Attestation"
        );
      }

      await mkdir(workDir, { recursive: true });
      const target = join(
        workDir,
        `scene-${scene.sceneOrder}-${scene.sceneResultId}.mp4`
      );
      await input.store.downloadObject({
        workspaceId: ownership.workspaceId,
        objectKey,
        destinationPath: target,
      });
      const contentHash = await hashFileSha256(target);
      const expected =
        scene.contentHash ||
        scene.mediaReference.contentHash ||
        attestation.contentHash;
      if (contentHash !== expected || contentHash !== attestation.contentHash) {
        throw new AssemblyMediaAccessError(
          "ASSEMBLY_MEDIA_HASH_MISMATCH",
          "Durable scene media content hash mismatch"
        );
      }
      return { localPath: target, contentHash };
    },
  };
}
