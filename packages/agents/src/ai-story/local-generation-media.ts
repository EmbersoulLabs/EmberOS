import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { probeAssemblyMedia } from "./assembly-runtime-media-probe";

/** Pure local CPU derivation; the caller must verify canonical Human approval first. */
export async function extractLocalGenerationEndFrame(bytes:Uint8Array, expectedContentHash:string) {
  if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== expectedContentHash) throw new Error("GENERATION_RESULT_CONTENT_MISMATCH");
  const directory=await mkdtemp(join(tmpdir(),"emberos-continuity-frame-"));
  try {
    const video=join(directory,"output.mp4"), frame=join(directory,"frame.png");
    await writeFile(video,bytes);
    await promisify(execFile)(process.env.FFMPEG_PATH??"ffmpeg",["-hide_banner","-loglevel","error","-sseof","-0.1","-i",video,"-frames:v","1",frame],{windowsHide:true,timeout:60_000,maxBuffer:1024*1024});
    const image=await readFile(frame);
    if (!image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("GENERATION_RESULT_FRAME_INVALID");
    return { bytes:image,contentHash:`sha256:${createHash("sha256").update(image).digest("hex")}` };
  } finally { await rm(directory,{recursive:true,force:true}); }
}

/** Header inspection alone is never proof of a decodable video. Reuse the canonical media probe. */
export async function validateLocalGenerationMedia(bytes: Uint8Array, expectedContentHash: string, nativeAudioRequired: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "emberos-local-media-"));
  const file = join(directory, "output.mp4");
  try {
    await writeFile(file, bytes);
    const probe = await probeAssemblyMedia({
      sceneResultId: "00000000-0000-4000-8000-000000000001", localPath: file, expectedContentHash,
    });
    await promisify(execFile)(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-v", "error", "-i", file, "-map", "0:v:0", "-f", "null", "-",
    ], { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 });
    if (nativeAudioRequired && !probe.hasAudio) throw new Error("LOCAL_GENERATION_NATIVE_AUDIO_REQUIRED");
    return probe;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function inspectLocalGenerationMp4(bytes: Uint8Array): {
  readonly contentHash: string;
  readonly durationSec: number;
} {
  const buffer = Buffer.from(bytes);
  if (buffer.length < 16 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    throw new Error("LOCAL_GENERATION_MEDIA_TYPE_INVALID");
  }
  const marker = buffer.indexOf(Buffer.from("mvhd", "ascii"));
  if (marker < 4 || marker + 24 > buffer.length) {
    throw new Error("LOCAL_GENERATION_MEDIA_DURATION_UNAVAILABLE");
  }
  const version = buffer.readUInt8(marker + 4);
  const timescaleOffset = version === 1 ? marker + 24 : marker + 16;
  const durationOffset = timescaleOffset + 4;
  if (durationOffset + (version === 1 ? 8 : 4) > buffer.length) {
    throw new Error("LOCAL_GENERATION_MEDIA_DURATION_UNAVAILABLE");
  }
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset);
  if (!timescale || !duration) throw new Error("LOCAL_GENERATION_MEDIA_DURATION_INVALID");
  return {
    contentHash: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
    durationSec: duration / timescale,
  };
}

/**
 * A successor Scene must not reuse another Scene Execution's accepted video bytes.
 * Distinct encodes that merely look similar keep distinct hashes and remain allowed.
 */
export function assertDistinctSceneMediaContent(input: {
  readonly sceneExecutionId: string;
  readonly contentHash: string;
  readonly peers: readonly {
    readonly sceneExecutionId: string;
    readonly contentHash: string;
  }[];
}): void {
  const duplicate = input.peers.find(
    (peer) =>
      peer.sceneExecutionId !== input.sceneExecutionId &&
      peer.contentHash === input.contentHash
  );
  if (duplicate) {
    throw new Error("LOCAL_GENERATION_DUPLICATE_SCENE_CONTENT");
  }
}

export function assertLocalGenerationDuration(input: {
  readonly actualSec: number;
  readonly targetSec: number;
  readonly toleranceRatio?: number;
}): void {
  const tolerance = Math.max(1, input.targetSec * (input.toleranceRatio ?? 0.2));
  if (Math.abs(input.actualSec - input.targetSec) > tolerance) {
    throw new Error("LOCAL_GENERATION_MEDIA_DURATION_OUT_OF_RANGE");
  }
}
