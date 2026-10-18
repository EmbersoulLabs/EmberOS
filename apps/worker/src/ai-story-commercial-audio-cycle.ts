import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AiStoryCommercialAudioRepository, deterministicPersistenceUuid, getDb, schema } from "@ceo-agent/db";
import { commerciallyLicensedTrack } from "@ceo-agent/shared";
import { resolveBgmFile } from "./bgm/resolve";
import { mixBackgroundMusic } from "./ffmpeg/audio-mix";
import { getFfmpegPath } from "./ffmpeg/ffmpeg-path";
import { mediaHasAudio } from "./ffmpeg/probe-audio";
import { downloadStorageBytes, uploadStorageBytesImmutable } from "./storage";

const execFileAsync = promisify(execFile);

async function durationSec(filePath: string): Promise<number> {
  const ffmpeg = getFfmpegPath();
  const ffprobe = ffmpeg.toLowerCase().includes("ffmpeg") ? ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") : "ffprobe";
  const { stdout } = await execFileAsync(ffprobe, ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", filePath], { windowsHide: true });
  const value = Number(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error("COMMERCIAL_AUDIO_SYNC_MISMATCH");
  return value;
}

/** Mix a licensed Video Studio bed onto a copy of the generation video. The source asset stays in place. */
export async function runAiStoryCommercialAudioCycle(repository = new AiStoryCommercialAudioRepository()): Promise<{ status: "IDLE" | "ASSEMBLED" | "FAILED"; assemblyId?: string; errorCode?: string }> {
  const job = await repository.claim();
  if (!job) return { status: "IDLE" };
  const workDir = await mkdtemp(join(tmpdir(), "ember-commercial-audio-"));
  try {
    const track = job.bgmTrackId ? commerciallyLicensedTrack(job.bgmTrackId) : null;
    if (!track || !job.sourceStoragePath || job.finalPolicy === "EXPLICIT_SILENCE") throw new Error("COMMERCIAL_AUDIO_TRACK_UNLICENSED");
    const source = await downloadStorageBytes(job.sourceStoragePath);
    const sourceHash = `sha256:${createHash("sha256").update(source).digest("hex")}`;
    if (sourceHash !== job.sourceContentHash) throw new Error("COMMERCIAL_AUDIO_SOURCE_HASH_MISMATCH");
    const sourcePath = join(workDir, "source.mp4");
    const outputPath = join(workDir, "assembled.mp4");
    await writeFile(sourcePath, source);
    const sourceDuration = await durationSec(sourcePath);
    const bgmPath = await resolveBgmFile(track.id);
    await mixBackgroundMusic(sourcePath, bgmPath, outputPath, sourceDuration, job.finalPolicy === "NATIVE_PLUS_BGM", 0);
    if (!(await mediaHasAudio(outputPath))) throw new Error("COMMERCIAL_AUDIO_STREAM_MISSING");
    const outputDuration = await durationSec(outputPath);
    if (Math.abs(outputDuration - sourceDuration) > 0.5) throw new Error("COMMERCIAL_AUDIO_SYNC_MISMATCH");
    const bytes = await readFile(outputPath);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const assetId = deterministicPersistenceUuid("commercial-audio-asset", { assemblyId: job.assemblyId });
    const storagePath = `${job.workspaceId}/ai-story/commercial-audio/${job.assemblyId}.mp4`;
    const uploaded = await uploadStorageBytesImmutable(storagePath, bytes, "video/mp4");
    if (uploaded === "already_exists") {
      const stored = await downloadStorageBytes(storagePath);
      if (`sha256:${createHash("sha256").update(stored).digest("hex")}` !== contentHash) throw new Error("COMMERCIAL_AUDIO_OUTPUT_CONFLICT");
    }
    await getDb().insert(schema.assets).values({
      id: assetId,
      orgId: job.orgId,
      workspaceId: job.workspaceId,
      campaignId: job.campaignId,
      type: "video",
      mimeType: "video/mp4",
      contentHash,
      storagePath,
      status: "ready",
      source: "ai_story_commercial_audio",
      uploadedBy: job.actorUserId,
      fileSizeBytes: bytes.length,
      durationSec: String(outputDuration),
      displayName: "Commercial audio assembly",
      metadata: {
        sourceKind: "COMMERCIAL_AUDIO_ASSEMBLY",
        generationResultId: job.generationResultId,
        sourceAssetId: job.sourceAssetId,
        sourceContentHash: job.sourceContentHash,
        bgmTrackId: track.id,
        bgmLicense: track.license,
        finalPolicy: job.finalPolicy,
      },
    }).onConflictDoNothing();
    await repository.finish(job.assemblyId, { assetId, contentHash, hasAudio: true });
    return { status: "ASSEMBLED", assemblyId: job.assemblyId };
  } catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "COMMERCIAL_AUDIO_ASSEMBLY_FAILED";
    await repository.finish(job.assemblyId, { failed: code });
    return { status: "FAILED", assemblyId: job.assemblyId, errorCode: code };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
