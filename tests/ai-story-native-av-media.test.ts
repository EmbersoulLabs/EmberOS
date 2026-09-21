import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hashFileSha256,
  validateAiStoryNativeAvResult,
} from "../packages/agents/src/ai-story";
import {
  AiStoryNativeAvResultEvidenceSchema,
  evaluateCharacterDialoguePerformanceGate,
} from "@ceo-agent/shared";

const hash = (character: string) =>
  `sha256:${character.repeat(64)}`;

function mediaAvailable(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

function generate(path: string, input: {
  audio: boolean;
  videoSeconds: number;
  audioSeconds?: number;
}): void {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=blue:s=270x480:d=${input.videoSeconds}:r=24`,
  ];
  if (input.audio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${input.audioSeconds ?? input.videoSeconds}`,
      "-c:a",
      "aac"
    );
  } else {
    args.push("-an");
  }
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", path);
  execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", args, {
    windowsHide: true,
  });
}

describe("Seedance native audiovisual result validation", () => {
  let root: string;

  beforeAll(async () => {
    if (!mediaAvailable()) {
      throw new Error("Native AV certification requires ffmpeg and ffprobe");
    }
    root = await mkdtemp(join(tmpdir(), "ember-native-av-"));
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("requires decodable video and audio streams with compatible durations", async () => {
    const path = join(root, "valid.mp4");
    generate(path, { audio: true, videoSeconds: 5 });
    const expectedContentHash = await hashFileSha256(path);
    const evidence = await validateAiStoryNativeAvResult({
      localPath: path,
      providerTaskId: "provider-task-native-av-1",
      requestFingerprint: hash("a"),
      dialogueAuthorityId:
        "da000000-0000-4000-8000-000000000001",
      expectedContentHash,
      inspectedAt: "2026-09-21T11:00:00.000Z",
    });
    expect(evidence.technicalNativeAudio).toBe("PASS");
    expect(evidence.mediaContentHash).toBe(expectedContentHash);
    expect(evidence.audioCodec).toBe("aac");
    expect(
      Math.abs(evidence.videoDurationMs - evidence.audioDurationMs)
    ).toBeLessThanOrEqual(250);
    expect(evidence.humanPerformanceReview.lipSync).toBe(
      "HUMAN_REVIEW_REQUIRED"
    );
    expect(evidence.humanPerformanceReview.facialPerformance).toBe(
      "HUMAN_REVIEW_REQUIRED"
    );
    expect(evaluateCharacterDialoguePerformanceGate(evidence)).toEqual({
      technicalNativeAudio: "PASS",
      lipSync: "HUMAN_REVIEW_REQUIRED",
      humanConversationalDelivery: "HUMAN_REVIEW_REQUIRED",
      emotionalCharacterPerformance: "HUMAN_REVIEW_REQUIRED",
    });
    const visibleSpeechFailed =
      AiStoryNativeAvResultEvidenceSchema.parse({
        ...evidence,
        humanPerformanceReview: {
          ...evidence.humanPerformanceReview,
          dialogueIsSpokenNotRead: "FAIL",
          lipSync: "FAIL",
          facialPerformance: "FAIL",
        },
      });
    expect(
      evaluateCharacterDialoguePerformanceGate(visibleSpeechFailed)
    ).toEqual({
      technicalNativeAudio: "PASS",
      lipSync: "FAIL",
      humanConversationalDelivery: "FAIL",
      emotionalCharacterPerformance: "FAIL",
    });
  });

  it("blocks a Provider result with no audio stream", async () => {
    const path = join(root, "silent.mp4");
    generate(path, { audio: false, videoSeconds: 5 });
    await expect(
      validateAiStoryNativeAvResult({
        localPath: path,
        providerTaskId: "provider-task-native-av-2",
        requestFingerprint: hash("b"),
        dialogueAuthorityId:
          "da000000-0000-4000-8000-000000000002",
      })
    ).rejects.toMatchObject({
      code: "NATIVE_AV_AUDIO_STREAM_MISSING",
    });
  });

  it("blocks incompatible stream durations and stale content", async () => {
    const path = join(root, "mismatch.mp4");
    generate(path, {
      audio: true,
      videoSeconds: 5,
      audioSeconds: 2,
    });
    await expect(
      validateAiStoryNativeAvResult({
        localPath: path,
        providerTaskId: "provider-task-native-av-3",
        requestFingerprint: hash("c"),
        dialogueAuthorityId:
          "da000000-0000-4000-8000-000000000003",
      })
    ).rejects.toMatchObject({ code: "NATIVE_AV_DURATION_MISMATCH" });
    await expect(
      validateAiStoryNativeAvResult({
        localPath: path,
        providerTaskId: "provider-task-native-av-4",
        requestFingerprint: hash("d"),
        dialogueAuthorityId:
          "da000000-0000-4000-8000-000000000004",
        expectedContentHash: hash("e"),
      })
    ).rejects.toMatchObject({
      code: "NATIVE_AV_CONTENT_HASH_MISMATCH",
    });
  });
});
