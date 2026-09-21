import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  computeAiStoryAudioMixFingerprint,
  deterministicUuidFromFingerprint,
  type AiStoryAudioMixExecutionPlan,
} from "@ceo-agent/shared/server";
import { runAiStoryAssemblyV2, runAiStoryAudioMix } from "@ceo-agent/agents";
import { buildAssemblyV2Fixture } from "./helpers/ai-story-assembly-v2-fixture";

const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
const id = (n: number) =>
  `a8000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const workDir = mkdtempSync(join(tmpdir(), "ember-audio-cert-"));

function run(binary: string, args: string[]): string {
  return execFileSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function hashFile(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function generateVideo(path: string, color: string): void {
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=30:d=2`,
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", path,
  ]);
}

function generateTone(path: string, frequency: number, durationSeconds: number): void {
  run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${durationSeconds}`,
    "-ac", "2", "-c:a", "pcm_s16le", path,
  ]);
}

function meanBandDb(
  path: string,
  frequency: number,
  startSeconds: number,
  durationSeconds: number
): number {
  const measured = spawnSync(
    ffmpeg,
    [
      "-hide_banner", "-nostats",
      "-ss", startSeconds.toFixed(3),
      "-t", durationSeconds.toFixed(3),
      "-i", path,
      "-map", "0:a:0",
      "-af", `bandpass=f=${frequency}:w=50,volumedetect`,
      "-f", "null", "-",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const stderr = measured.stderr ?? "";
  const match = [...stderr.matchAll(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s+dB/g)].at(-1);
  if (!match) throw new Error(`mean_volume unavailable: ${stderr}`);
  return Number(match[1]);
}

function createMixPlan(input: {
  assemblyPlan: ReturnType<ReturnType<typeof buildAssemblyV2Fixture>["compile"]>;
  assets: Record<string, { id: string; path: string; hash: string; durationMs: number }>;
  videoContentHash: string;
}): AiStoryAudioMixExecutionPlan {
  const { assemblyPlan, assets } = input;
  const withoutIdentity = {
    contractVersion: "ai-story-audio-mix.v1" as const,
    audioPlanId: id(1),
    audioPlanFingerprint: `sha256:${"1".repeat(64)}`,
    assemblyV2PlanId: assemblyPlan.assemblyV2PlanId,
    assemblyV2Fingerprint: assemblyPlan.assemblyFingerprint,
    assemblyV2VideoContentHash: input.videoContentHash,
    mode: "AUDIO_MIX_V1" as const,
    videoDurationMs: 6000,
    resolvedTracks: [
      {
        trackId: id(10), trackKind: "SPEECH" as const,
        sourceAssetId: assets.jSpeech!.id, contentHash: assets.jSpeech!.hash,
        startMs: 1500, endMs: 2700, sourceDurationMs: 1200, gainDb: -3,
        sourceSampleRate: 48000, sourceChannelCount: 2,
        loop: false, fadeInMs: 0, fadeOutMs: 0,
        speechSegmentId: id(110), exactScriptText: "You remembered.",
        jCutExecuted: true, lCutExecuted: false,
      },
      {
        trackId: id(11), trackKind: "SPEECH" as const,
        sourceAssetId: assets.lSpeech!.id, contentHash: assets.lSpeech!.hash,
        startMs: 3200, endMs: 4400, sourceDurationMs: 1200, gainDb: -3,
        sourceSampleRate: 48000, sourceChannelCount: 2,
        loop: false, fadeInMs: 0, fadeOutMs: 0,
        speechSegmentId: id(111), exactScriptText: "Care continues.",
        jCutExecuted: false, lCutExecuted: true,
      },
      {
        trackId: id(12), trackKind: "MUSIC" as const,
        sourceAssetId: assets.music!.id, contentHash: assets.music!.hash,
        startMs: 0, endMs: 6000, sourceDurationMs: 6000, gainDb: -10,
        sourceSampleRate: 48000, sourceChannelCount: 2,
        loop: false, fadeInMs: 100, fadeOutMs: 200,
        speechSegmentId: null, exactScriptText: null,
        jCutExecuted: false, lCutExecuted: false,
      },
      {
        trackId: id(13), trackKind: "AMBIENCE" as const,
        sourceAssetId: assets.ambience!.id, contentHash: assets.ambience!.hash,
        startMs: 0, endMs: 6000, sourceDurationMs: 6000, gainDb: -30,
        sourceSampleRate: 48000, sourceChannelCount: 2,
        loop: false, fadeInMs: 0, fadeOutMs: 0,
        speechSegmentId: null, exactScriptText: null,
        jCutExecuted: false, lCutExecuted: false,
      },
      {
        trackId: id(14), trackKind: "SFX" as const,
        sourceAssetId: assets.sfx!.id, contentHash: assets.sfx!.hash,
        startMs: 800, endMs: 1000, sourceDurationMs: 200, gainDb: -8,
        sourceSampleRate: 48000, sourceChannelCount: 2,
        loop: false, fadeInMs: 0, fadeOutMs: 0,
        speechSegmentId: null, exactScriptText: null,
        jCutExecuted: false, lCutExecuted: false,
      },
    ],
    duckingRules: [{
      duckingRuleId: id(20),
      speechSegmentIds: [id(110), id(111)],
      targetMusicTrackIds: [id(12)],
      duckingAmountDb: 12,
      attackMs: 20,
      releaseMs: 300,
    }],
    mixPolicy: {
      speechTargetDb: -3,
      musicTargetDb: -18,
      ambienceTargetDb: -28,
      sfxTargetDb: -12,
      duckingRequiredWhenSpeechAndMusic: true,
      peakCeilingDbfs: -1,
      loudnessTargetLufs: -14,
      truePeakTargetDbtp: -1.5,
      channelLayout: "stereo" as const,
      sampleRate: 48000 as const,
    },
    subtitleSpeechTiming: [
      { speechSegmentId: id(110), startMs: 1500, endMs: 2700, exactScriptText: "You remembered." },
      { speechSegmentId: id(111), startMs: 3200, endMs: 4400, exactScriptText: "Care continues." },
    ],
  };
  const fingerprint = computeAiStoryAudioMixFingerprint(withoutIdentity);
  return {
    ...withoutIdentity,
    audioMixPlanId: deterministicUuidFromFingerprint("audio-mix-media-test", fingerprint),
    fingerprint,
  };
}

describe("AI Story real audiovisual certification", () => {
  beforeAll(() => {
    run(ffmpeg, ["-version"]);
    run(ffprobe, ["-version"]);
  });

  it("COMMERCIAL_FLOWER_AUDIO executes J/L cuts, ducking, loudness, mux, and final probe", async () => {
    const clips = ["red", "green", "blue"].map((color) => {
      const path = join(workDir, `${color}.mp4`);
      generateVideo(path, color);
      return {
        path,
        hash: hashFile(path),
        durationMs: 2000,
        width: 320,
        height: 180,
        frameRate: 30,
      };
    });
    const assemblyFixture = buildAssemblyV2Fixture({
      base: 8_000,
      sources: clips,
      entries: [
        { sourceIndex: 0, role: "DISCOVERY", durationSeconds: 2, sceneIndex: 0 },
        { sourceIndex: 1, role: "REACTION", durationSeconds: 2, sceneIndex: 0 },
        { sourceIndex: 2, role: "CTA", durationSeconds: 2, sceneIndex: 0 },
      ],
    });
    const assemblyPlan = assemblyFixture.compile();
    const videoOnly = await runAiStoryAssemblyV2({
      plan: assemblyPlan,
      sourcePathByResultId: assemblyFixture.sourcePathByResultId,
      workDir: join(workDir, "assembly"),
    });
    const videoOnlyProbe = JSON.parse(
      run(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", videoOnly.outputPath])
    ) as { streams: Array<{ codec_type: string }> };
    expect(videoOnlyProbe.streams.some((stream) => stream.codec_type === "audio")).toBe(false);
    expect(videoOnly.durationMs).toBeGreaterThanOrEqual(5900);
    expect(videoOnly.durationMs).toBeLessThanOrEqual(6100);

    const specs = {
      jSpeech: { id: id(30), path: join(workDir, "speech-j.wav"), frequency: 1000, duration: 1.2 },
      lSpeech: { id: id(31), path: join(workDir, "speech-l.wav"), frequency: 1400, duration: 1.2 },
      music: { id: id(32), path: join(workDir, "music.wav"), frequency: 220, duration: 6 },
      ambience: { id: id(33), path: join(workDir, "ambience.wav"), frequency: 90, duration: 6 },
      sfx: { id: id(34), path: join(workDir, "card-pickup.wav"), frequency: 1800, duration: 0.2 },
    };
    for (const spec of Object.values(specs)) {
      generateTone(spec.path, spec.frequency, spec.duration);
    }
    const assets = Object.fromEntries(
      Object.entries(specs).map(([key, spec]) => [
        key,
        { id: spec.id, path: spec.path, hash: hashFile(spec.path), durationMs: Math.round(spec.duration * 1000) },
      ])
    );
    const plan = createMixPlan({
      assemblyPlan,
      assets,
      videoContentHash: videoOnly.contentHash,
    });
    const sourcePathByAssetId = new Map(
      Object.values(assets).map((asset) => [asset.id, asset.path])
    );
    const result = await runAiStoryAudioMix({
      plan,
      assemblyV2VideoPath: videoOnly.outputPath,
      sourcePathByAssetId,
      workDir: join(workDir, "mix"),
    });

    expect(result.evidence.jCutCount).toBe(1);
    expect(result.evidence.lCutCount).toBe(1);
    expect(result.evidence.musicTrackCount).toBe(1);
    expect(result.evidence.ambienceTrackCount).toBe(1);
    expect(result.evidence.sfxTrackCount).toBe(1);
    expect(result.sampleRate).toBe(48000);
    expect(result.channelCount).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(5900);
    expect(result.durationMs).toBeLessThanOrEqual(6100);
    expect(Math.abs(result.evidence.measuredIntegratedLufs + 14)).toBeLessThanOrEqual(1.5);
    expect(result.evidence.measuredTruePeakDbfs).toBeLessThanOrEqual(-1);

    const jBeforeCut = meanBandDb(result.outputPath, 1000, 1.65, 0.2);
    const jBeforeStart = meanBandDb(result.outputPath, 1000, 1.1, 0.2);
    expect(jBeforeCut - jBeforeStart).toBeGreaterThan(15);

    const lAfterCut = meanBandDb(result.outputPath, 1400, 4.1, 0.2);
    const lAfterEnd = meanBandDb(result.outputPath, 1400, 4.7, 0.2);
    expect(lAfterCut - lAfterEnd).toBeGreaterThan(15);

    const bgmWithoutSpeech = meanBandDb(result.outputPath, 220, 1.05, 0.2);
    const bgmDuringSpeech = meanBandDb(result.outputPath, 220, 1.9, 0.2);
    expect(bgmWithoutSpeech - bgmDuringSpeech).toBeGreaterThan(8);

    const probe = JSON.parse(
      run(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", result.outputPath])
    ) as { streams: Array<{ codec_type: string }> };
    expect(probe.streams.some((stream) => stream.codec_type === "video")).toBe(true);
    expect(probe.streams.some((stream) => stream.codec_type === "audio")).toBe(true);
  }, 180_000);
});
