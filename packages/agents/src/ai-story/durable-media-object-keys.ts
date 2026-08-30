/**
 * Sprint 4 Phase A — deterministic durable object key policy.
 */
import { assertWorkspaceScopedDurableObjectKey } from "@ceo-agent/shared/server";

const HASH_HEX = /^sha256:([a-f0-9]{64})$/;

function contentHashToken(contentHash: string): string {
  const match = HASH_HEX.exec(contentHash.trim());
  if (!match) {
    throw new Error("contentHash must be sha256:<64 hex>");
  }
  return match[1]!;
}

export function buildDurableSceneMediaObjectKey(input: {
  readonly workspaceId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly contentHash: string;
}): string {
  const key = `${input.workspaceId}/ai-story/scenes/${input.executionPlanId}/${input.sceneExecutionId}/${contentHashToken(input.contentHash)}.mp4`;
  assertWorkspaceScopedDurableObjectKey(input.workspaceId, key);
  return key;
}

export function buildDurableAssemblyArtifactObjectKey(input: {
  readonly workspaceId: string;
  readonly executionPlanId: string;
  readonly assemblyJobId: string;
  readonly contentHash: string;
}): string {
  const key = `${input.workspaceId}/ai-story/assembly/${input.executionPlanId}/${input.assemblyJobId}/${contentHashToken(input.contentHash)}.mp4`;
  assertWorkspaceScopedDurableObjectKey(input.workspaceId, key);
  return key;
}
