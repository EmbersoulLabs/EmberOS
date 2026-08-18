/**
 * Sprint 3 PR 3.7 Phase E — mint short-lived signed playback URL for FSR media.
 * Never persists the signed URL. Never exposes storage credentials.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export const FINAL_STORY_PLAYBACK_TTL_SECONDS = 60 * 15;

function assertDurableReference(workspaceId: string, reference: string): string {
  const ref = reference.trim();
  if (!ref.startsWith(`${workspaceId}/`)) {
    throw new Error("Final Story media reference is not workspace-scoped");
  }
  if (ref.includes("..") || /^https?:/i.test(ref) || /^(?:[a-zA-Z]:[\\/]|\/)/.test(ref)) {
    throw new Error("Final Story media reference is not a durable object key");
  }
  return ref;
}

export async function mintFinalStoryPlaybackUrl(input: {
  readonly workspaceId: string;
  readonly outputMediaReference: string;
  readonly expiresInSeconds?: number;
}): Promise<{ readonly playbackUrl: string; readonly expiresInSeconds: number }> {
  const ref = assertDurableReference(input.workspaceId, input.outputMediaReference);

  const expiresInSeconds =
    input.expiresInSeconds ?? FINAL_STORY_PLAYBACK_TTL_SECONDS;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(ref, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to create playback URL");
  }

  return {
    playbackUrl: data.signedUrl,
    expiresInSeconds,
  };
}

export async function mintFinalStoryDownloadUrl(input: {
  readonly workspaceId: string;
  readonly outputMediaReference: string;
  readonly filename: string;
  readonly expiresInSeconds?: number;
}): Promise<{ readonly downloadUrl: string; readonly expiresInSeconds: number }> {
  const ref = assertDurableReference(input.workspaceId, input.outputMediaReference);
  const expiresInSeconds = input.expiresInSeconds ?? FINAL_STORY_PLAYBACK_TTL_SECONDS;
  const supabase = createAdminClient();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(
    ref,
    expiresInSeconds,
    { download: input.filename }
  );
  if (error || !data?.signedUrl) {
    throw new Error("Failed to create download URL");
  }
  return { downloadUrl: data.signedUrl, expiresInSeconds };
}
