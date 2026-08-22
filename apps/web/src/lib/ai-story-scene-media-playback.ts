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
}): string {
  const result = input.result;
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
  assertWorkspaceScopedDurableObjectKey(input.workspaceId, result.mediaReference.uri);
  return result.mediaReference.uri;
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

  const result = ProjectedSceneResultSchema.parse(row.result);
  const objectKey = assertSceneMediaResultAuthority({ ...input, result });
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
