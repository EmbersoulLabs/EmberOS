/**
 * Request-scoped private delivery for an existing canonical AI Story Scene
 * Result. This is a read-only projection helper: it never schedules, retries,
 * approves, or persists signed URLs.
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  ProjectedSceneResultSchema,
  assertWorkspaceScopedDurableObjectKey,
  parseDurableSceneMediaAttestation,
  redactHttpsMediaUri,
  type DurableSceneMediaAttestation,
  type ProjectedSceneResult,
} from "@ceo-agent/shared/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const AI_STORY_SCENE_PLAYBACK_TTL_SECONDS = 10 * 60;

export function assertSceneMediaResultAuthority(input: {
  readonly workspaceId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly providerAttemptId: string;
  readonly sceneResultId: string;
  readonly result: ProjectedSceneResult;
  readonly attestation: DurableSceneMediaAttestation;
}): string {
  const result = input.result;
  const attestation = input.attestation;
  if (
    result.status !== "SUCCEEDED" ||
    !result.mediaReference ||
    result.executionPlanId !== input.executionPlanId ||
    result.sceneResultId !== input.sceneResultId ||
    result.sceneExecutionId !== input.sceneExecutionId ||
    result.providerAttemptId !== input.providerAttemptId ||
    result.ownership.workspaceId !== input.workspaceId
  ) {
    throw new Error("Scene media identity does not match the persisted result");
  }
  if (
    attestation.workspaceId !== input.workspaceId ||
    attestation.executionPlanId !== input.executionPlanId ||
    attestation.sceneExecutionId !== input.sceneExecutionId ||
    attestation.sceneResultId !== input.sceneResultId ||
    attestation.orgId !== result.ownership.orgId ||
    attestation.campaignId !== result.ownership.campaignId ||
    attestation.storyId !== result.ownership.storyId ||
    attestation.storyVersionId !== result.ownership.storyVersionId ||
    attestation.animationPackageId !== result.ownership.animationPackageId
  ) {
    throw new Error("Durable media attestation does not match the persisted result");
  }

  const source = redactHttpsMediaUri(result.mediaReference.uri);
  if (
    source.scheme !== attestation.sourceMediaReference.scheme ||
    source.host !== attestation.sourceMediaReference.host ||
    source.path !== attestation.sourceMediaReference.path
  ) {
    throw new Error("Durable media attestation source does not match the persisted result");
  }

  const objectKey = attestation.durableObjectReference;
  assertWorkspaceScopedDurableObjectKey(input.workspaceId, objectKey);
  const expectedPrefix = `${input.workspaceId}/ai-story/scenes/${input.executionPlanId}/${input.sceneExecutionId}/`;
  const expectedFilename = `${attestation.contentHash.replace(/^sha256:/, "")}.mp4`;
  if (
    !objectKey.startsWith(expectedPrefix) ||
    !objectKey.endsWith(`/${expectedFilename}`)
  ) {
    throw new Error("Durable media object key does not match the attested Scene identity");
  }
  return objectKey;
}

export async function mintSceneResultPlayback(input: {
  readonly workspaceId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly providerAttemptId: string;
  readonly sceneResultId: string;
}): Promise<{ readonly deliveryUrl: string; readonly expiresAt: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.aiStorySceneResults)
    .where(
      and(
        eq(schema.aiStorySceneResults.sceneResultId, input.sceneResultId),
        eq(schema.aiStorySceneResults.workspaceId, input.workspaceId),
        eq(schema.aiStorySceneResults.executionPlanId, input.executionPlanId),
        eq(schema.aiStorySceneResults.sceneExecutionId, input.sceneExecutionId),
        eq(schema.aiStorySceneResults.providerAttemptId, input.providerAttemptId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Scene media is not available");

  const [attestationRow] = await db
    .select()
    .from(schema.aiStoryDurableSceneMediaAttestations)
    .where(
      and(
        eq(
          schema.aiStoryDurableSceneMediaAttestations.sceneResultId,
          input.sceneResultId
        ),
        eq(schema.aiStoryDurableSceneMediaAttestations.workspaceId, input.workspaceId),
        eq(
          schema.aiStoryDurableSceneMediaAttestations.executionPlanId,
          input.executionPlanId
        ),
        eq(
          schema.aiStoryDurableSceneMediaAttestations.sceneExecutionId,
          input.sceneExecutionId
        )
      )
    )
    .limit(1);
  if (!attestationRow) {
    throw new Error("Scene media preview is temporarily unavailable");
  }

  const result = ProjectedSceneResultSchema.parse(row.result);
  const attestation = parseDurableSceneMediaAttestation(attestationRow.attestation);
  const objectKey = assertSceneMediaResultAuthority({
    ...input,
    result,
    attestation,
  });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  const { data, error } = await createAdminClient().storage
    .from(bucket)
    .createSignedUrl(objectKey, AI_STORY_SCENE_PLAYBACK_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error("Scene media preview is temporarily unavailable");
  }

  return {
    deliveryUrl: data.signedUrl,
    expiresAt: new Date(
      Date.now() + AI_STORY_SCENE_PLAYBACK_TTL_SECONDS * 1000
    ).toISOString(),
  };
}
