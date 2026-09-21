import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AiStoryAssemblyV2PlanSchema,
  type AiStoryAssemblyV2Plan,
} from "@ceo-agent/shared";
import {
  computeAiStoryAssemblyV2Fingerprint,
} from "@ceo-agent/shared/server";
import {
  AiStoryAssemblyV2ExecutionError,
  hashFileSha256,
  probeAssemblyMedia,
  runAiStoryAssemblyV2,
  type AiStoryAssemblyV2ExecutionResult,
} from "../packages/agents/src/ai-story";
import {
  buildAssemblyV2Fixture,
  type AssemblyV2FixtureSource,
} from "./helpers/ai-story-assembly-v2-fixture";

function ffmpegAvailable(): boolean {
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

const MEDIA_AVAILABLE = ffmpegAvailable();

async function generateClip(
  root: string,
  name: string,
  color: string,
  options: { withAudio?: boolean; width?: number; height?: number; frameRate?: number } = {}
): Promise<AssemblyV2FixtureSource> {
  const withAudio = options.withAudio ?? false;
  const width = options.width ?? 320;
  const height = options.height ?? 180;
  const frameRate = options.frameRate ?? 30;
  const path = join(root, name);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=${width}x${height}:d=6:r=${frameRate}`,
  ];
  if (withAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=6",
      "-shortest"
    );
  }
  args.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    ...(withAudio ? ["-c:a", "aac"] : ["-an"]),
    path
  );
  execFileSync(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    args,
    { windowsHide: true }
  );
  const contentHash = await hashFileSha256(path);
  const probe = await probeAssemblyMedia({
    sceneResultId: "b2000000-0000-4000-8000-000000009999",
    localPath: path,
  });
  return {
    path,
    hash: contentHash,
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    frameRate: probe.frameRate,
  };
}

function dominantPixel(path: string, atSeconds: number): "RED" | "GREEN" | "BLUE" | "OTHER" {
  const bytes = execFileSync(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(atSeconds),
      "-i",
      path,
      "-frames:v",
      "1",
      "-vf",
      "scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { windowsHide: true, encoding: "buffer" }
  );
  const [red = 0, green = 0, blue = 0] = bytes;
  if (red > green * 1.5 && red > blue * 1.5) return "RED";
  if (green > red * 1.5 && green > blue * 1.5) return "GREEN";
  if (blue > red * 1.5 && blue > green * 1.5) return "BLUE";
  return "OTHER";
}

function clonePlan(plan: AiStoryAssemblyV2Plan): AiStoryAssemblyV2Plan {
  return AiStoryAssemblyV2PlanSchema.parse(JSON.parse(JSON.stringify(plan)));
}

function refreshFingerprint(plan: AiStoryAssemblyV2Plan): void {
  plan.assemblyFingerprint = computeAiStoryAssemblyV2Fingerprint(plan);
}

describe("AI Story Final Assembly V2 — real media execution", () => {
  let root: string;
  let red: AssemblyV2FixtureSource;
  let green: AssemblyV2FixtureSource;
  let blue: AssemblyV2FixtureSource;
  let yellow: AssemblyV2FixtureSource;
  let purpleHd24: AssemblyV2FixtureSource;
  let criticalFixture: ReturnType<typeof buildAssemblyV2Fixture>;
  let criticalPlan: AiStoryAssemblyV2Plan;
  let criticalResult: AiStoryAssemblyV2ExecutionResult;

  beforeAll(async () => {
    if (!MEDIA_AVAILABLE) {
      throw new Error("Final Assembly V2 certification requires ffmpeg and ffprobe");
    }
    root = await mkdtemp(join(tmpdir(), "ember-assembly-v2-"));
    [red, green, blue, yellow, purpleHd24] = await Promise.all([
      generateClip(root, "red.mp4", "red"),
      generateClip(root, "green.mp4", "green"),
      generateClip(root, "blue.mp4", "blue"),
      generateClip(root, "yellow-with-audio.mp4", "yellow", { withAudio: true }),
      generateClip(root, "purple-640x360-24fps.mp4", "purple", {
        width: 640,
        height: 360,
        frameRate: 24,
      }),
    ]);
    criticalFixture = buildAssemblyV2Fixture({
      sources: [red, green, blue],
      entries: [
        { sourceIndex: 0, role: "ACTION", durationSeconds: 2 },
        { sourceIndex: 2, role: "PAYOFF", durationSeconds: 2.5 },
      ],
      omittedSourceIndexes: [1],
      base: 10_000,
    });
    criticalPlan = criticalFixture.compile();
    criticalResult = await runAiStoryAssemblyV2({
      plan: criticalPlan,
      sourcePathByResultId: criticalFixture.sourcePathByResultId,
      workDir: join(root, "critical"),
      now: (() => {
        const times = [
          new Date("2026-09-21T02:00:00.000Z"),
          new Date("2026-09-21T02:00:01.000Z"),
        ];
        return () => times.shift() ?? times[0]!;
      })(),
    });
  }, 180_000);

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("CRITICAL DURATION: 18 seconds of source becomes approximately 4.5 seconds, not full concat", () => {
    expect(red.durationMs + green.durationMs + blue.durationMs).toBe(18_000);
    expect(criticalPlan.expectedOutputDurationMs).toBe(4500);
    expect(criticalResult.durationMs).toBeGreaterThanOrEqual(4350);
    expect(criticalResult.durationMs).toBeLessThanOrEqual(4650);
    expect(criticalResult.durationMs).not.toBe(18_000);
  });

  it("OMIT_DISPOSITION and HARD_CUT are executed in the binary media", () => {
    expect(criticalResult.evidence.omittedUnitCount).toBe(1);
    expect(criticalResult.evidence.transitionCount).toBe(0);
    expect(dominantPixel(criticalResult.outputPath, 1)).toBe("RED");
    expect(dominantPixel(criticalResult.outputPath, 3)).toBe("BLUE");
    expect(dominantPixel(criticalResult.outputPath, 3)).not.toBe("GREEN");
  });

  it("OUTPUT_PROBE validates a non-empty decodable video-only result", async () => {
    const probe = await probeAssemblyMedia({
      sceneResultId: criticalPlan.assemblyV2PlanId,
      localPath: criticalResult.outputPath,
      expectedContentHash: criticalResult.contentHash,
    });
    expect(probe.durationMs).toBe(criticalResult.durationMs);
    expect(probe.width).toBe(320);
    expect(probe.height).toBe(180);
    expect(probe.frameRate).toBeCloseTo(30, 1);
    expect(probe.hasAudio).toBe(false);
    expect(probe.byteSize).toBeGreaterThan(0);
  });

  it("EDITORIAL_ORDER follows B → A → C instead of source creation order", async () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [red, green, blue],
      entries: [
        { sourceIndex: 1, role: "ACTION", durationSeconds: 1 },
        { sourceIndex: 0, role: "REACTION", durationSeconds: 1 },
        { sourceIndex: 2, role: "PAYOFF", durationSeconds: 1 },
      ],
      profileId: "COMMERCIAL_STORY",
      base: 11_000,
    });
    const result = await runAiStoryAssemblyV2({
      plan: fixture.compile(),
      sourcePathByResultId: fixture.sourcePathByResultId,
      workDir: join(root, "order"),
    });
    expect(dominantPixel(result.outputPath, 0.4)).toBe("GREEN");
    expect(dominantPixel(result.outputPath, 1.4)).toBe("RED");
    expect(dominantPixel(result.outputPath, 2.4)).toBe("BLUE");
  }, 120_000);

  it("AUTHORIZED_DISSOLVE executes bounded overlap and is duration-accounted", async () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [red, blue],
      entries: [
        { sourceIndex: 0, role: "ACTION", durationSeconds: 2 },
        {
          sourceIndex: 1,
          role: "PAYOFF",
          durationSeconds: 2,
          transition: "DISSOLVE",
        },
      ],
      base: 12_000,
    });
    const plan = fixture.compile();
    expect(plan.expectedOutputDurationMs).toBe(3750);
    const result = await runAiStoryAssemblyV2({
      plan,
      sourcePathByResultId: fixture.sourcePathByResultId,
      workDir: join(root, "dissolve"),
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(3600);
    expect(result.durationMs).toBeLessThanOrEqual(3900);
    expect(result.evidence.transitionCount).toBe(1);
  }, 120_000);

  it("normalizes differing resolution and frame rate without creative crop or distortion", async () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [red, purpleHd24],
      entries: [
        { sourceIndex: 0, role: "ACTION", durationSeconds: 1 },
        { sourceIndex: 1, role: "PAYOFF", durationSeconds: 1 },
      ],
      base: 12_500,
    });
    const result = await runAiStoryAssemblyV2({
      plan: fixture.compile(),
      sourcePathByResultId: fixture.sourcePathByResultId,
      workDir: join(root, "normalization"),
    });
    expect(result.width).toBe(320);
    expect(result.height).toBe(180);
    expect(result.frameRate).toBeCloseTo(30, 1);
  }, 120_000);

  it("COMMERCIAL STORY preserves action → reaction → payoff in one multi-shot Scene", async () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [red, green, blue, yellow],
      entries: [
        { sourceIndex: 0, role: "ACTION", durationSeconds: 0.8 },
        { sourceIndex: 1, role: "REACTION", durationSeconds: 0.9 },
        { sourceIndex: 2, role: "PAYOFF", durationSeconds: 1.1 },
      ],
      omittedSourceIndexes: [3],
      profileId: "COMMERCIAL_STORY",
      base: 13_000,
    });
    const plan = fixture.compile();
    const result = await runAiStoryAssemblyV2({
      plan,
      sourcePathByResultId: fixture.sourcePathByResultId,
      workDir: join(root, "commercial"),
    });
    expect(plan.resolvedTimeline.map((entry) => entry.editorialRole)).toEqual([
      "ACTION",
      "REACTION",
      "PAYOFF",
    ]);
    expect(new Set(plan.resolvedTimeline.map((entry) => entry.sceneId)).size).toBe(1);
    expect(plan.omittedGenerationUnitIds).toHaveLength(1);
    expect(result.durationMs).toBeCloseTo(2800, -2);
    expect(dominantPixel(result.outputPath, 2.2)).toBe("BLUE");
  }, 120_000);

  it("SERVICE STORY assembles without Product-specific runtime assumptions", async () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [red, green, blue, yellow],
      entries: [
        { sourceIndex: 0, role: "ESTABLISH", durationSeconds: 0.6 },
        { sourceIndex: 1, role: "ACTION", durationSeconds: 0.6 },
        { sourceIndex: 2, role: "CONSEQUENCE", durationSeconds: 0.6 },
        { sourceIndex: 3, role: "REACTION", durationSeconds: 0.6 },
      ],
      profileId: "CORE",
      base: 14_000,
    });
    const result = await runAiStoryAssemblyV2({
      plan: fixture.compile(),
      sourcePathByResultId: fixture.sourcePathByResultId,
      workDir: join(root, "service"),
    });
    expect(result.durationMs).toBeCloseTo(2400, -2);
    expect(result.evidence.usedUnitCount).toBe(4);
    const probe = await probeAssemblyMedia({
      sceneResultId: fixture.compile().assemblyV2PlanId,
      localPath: result.outputPath,
    });
    expect(probe.hasAudio).toBe(false);
  }, 120_000);

  it("MINIMAL HERO preserves deliberate detail → hero → CTA duration", async () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [red, green, blue],
      entries: [
        { sourceIndex: 0, role: "DETAIL", durationSeconds: 1 },
        { sourceIndex: 1, role: "HERO", durationSeconds: 1.5 },
        { sourceIndex: 2, role: "CTA", durationSeconds: 1.5 },
      ],
      profileId: "PRODUCT_STORY",
      base: 15_000,
    });
    const plan = fixture.compile();
    const result = await runAiStoryAssemblyV2({
      plan,
      sourcePathByResultId: fixture.sourcePathByResultId,
      workDir: join(root, "minimal"),
    });
    expect(plan.resolvedTimeline.map((entry) => entry.editorialRole)).toEqual([
      "DETAIL",
      "HERO",
      "CTA",
    ]);
    expect(result.durationMs).toBeCloseTo(4000, -2);
  }, 120_000);

  it("FROM BUD TO BLOOM executes cross-Scene bridges and final CTA progression", async () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [red, green, blue, yellow],
      entries: [
        { sourceIndex: 0, role: "DETAIL", durationSeconds: 0.7, sceneIndex: 0 },
        { sourceIndex: 1, role: "ACTION", durationSeconds: 0.8, sceneIndex: 0 },
        { sourceIndex: 2, role: "DISCOVERY", durationSeconds: 0.9, sceneIndex: 1 },
        { sourceIndex: 3, role: "CTA", durationSeconds: 1.1, sceneIndex: 2 },
      ],
      profileId: "PRODUCT_STORY",
      base: 16_000,
    });
    const plan = fixture.compile();
    const result = await runAiStoryAssemblyV2({
      plan,
      sourcePathByResultId: fixture.sourcePathByResultId,
      workDir: join(root, "bloom"),
    });
    expect(
      plan.resolvedTimeline.filter((entry) => entry.sceneBridgeExecution).length
    ).toBe(2);
    expect(plan.resolvedTimeline.at(-1)?.editorialRole).toBe("CTA");
    expect(result.durationMs).toBeCloseTo(3500, -2);
  }, 120_000);

  it("INVALID_SOURCE and STALE_HASH fail closed", async () => {
    await expect(
      runAiStoryAssemblyV2({
        plan: criticalPlan,
        sourcePathByResultId: new Map(),
        workDir: join(root, "missing"),
      })
    ).rejects.toMatchObject({ code: "SOURCE_MEDIA_MISSING" });

    const stalePaths = new Map(criticalFixture.sourcePathByResultId);
    stalePaths.set(criticalPlan.resolvedTimeline[0]!.sourceResultId, green.path);
    await expect(
      runAiStoryAssemblyV2({
        plan: criticalPlan,
        sourcePathByResultId: stalePaths,
        workDir: join(root, "stale"),
      })
    ).rejects.toMatchObject({ code: "SOURCE_HASH_MISMATCH" });
  });

  it("INVALID_TRIM and post-plan mutation fail closed", async () => {
    const invalidTrim = clonePlan(criticalPlan);
    invalidTrim.resolvedTimeline[0]!.trimWindow.sourceEndMs = 6500;
    invalidTrim.resolvedTimeline[0]!.trimWindow.durationMs = 6500;
    invalidTrim.resolvedTimeline[0]!.trimWindow.maximumDurationMs = 6500;
    invalidTrim.expectedOutputDurationMs = 9000;
    refreshFingerprint(invalidTrim);
    await expect(
      runAiStoryAssemblyV2({
        plan: invalidTrim,
        sourcePathByResultId: criticalFixture.sourcePathByResultId,
        workDir: join(root, "invalid-trim"),
      })
    ).rejects.toMatchObject({ code: "TRIM_WINDOW_INVALID" });

    const stalePlan = clonePlan(criticalPlan);
    stalePlan.resolvedTimeline[0]!.order = 99;
    await expect(
      runAiStoryAssemblyV2({
        plan: stalePlan,
        sourcePathByResultId: criticalFixture.sourcePathByResultId,
        workDir: join(root, "stale-plan"),
      })
    ).rejects.toMatchObject({
      code: "EDITORIAL_PLAN_FINGERPRINT_MISMATCH",
    });
  });

  it("exposes typed execution failure without provider or media contents", () => {
    const error = new AiStoryAssemblyV2ExecutionError(
      "FINAL_MEDIA_INVALID",
      "Final media invalid"
    );
    expect(error).toMatchObject({
      name: "AiStoryAssemblyV2ExecutionError",
      code: "FINAL_MEDIA_INVALID",
    });
  });
});
