import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { config } from "dotenv";
import { getOpenAI } from "../packages/agents/src/llm";
import {
  buildProposedSgMyVoiceListeningExecutionPreview,
} from "../packages/shared/src/ai-story-voice-human-listening-review.server";

const EXPECTED_AUTHORIZATION =
  "EMBEROS-TTS-LISTENING-2026-09-21-SIX-CALLS-GPT4O-MINI-TTS-MARIN-MAX-USD-0.02";
const MAXIMUM_AUTHORIZED_CALLS = 6;
const MAXIMUM_AUTHORIZED_COST_USD = 0.02;

function parseOutputDirectory(): string {
  const argumentIndex = process.argv.indexOf("--output");
  const value = argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined;
  if (!value?.trim()) throw new Error("LISTENING_OUTPUT_DIRECTORY_REQUIRED");
  return resolve(value);
}

function loadProviderEnvironment(): void {
  const configuredPath =
    process.env.EMBEROS_LISTENING_PROVIDER_ENV?.trim() ||
    resolve(process.cwd(), "..", "..", "apps", "worker", ".env");
  config({ path: configuredPath });
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY_MISSING");
  }
}

function probeWave(path: string): {
  durationMs: number;
  sampleRate: number;
  channelCount: number;
} {
  const ffprobe = process.env.FFPROBE_PATH ?? "ffprobe";
  const stdout = execFileSync(
    ffprobe,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { encoding: "utf8", windowsHide: true }
  );
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      sample_rate?: string;
      channels?: number;
    }>;
  };
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const durationMs = Math.round(Number(parsed.format?.duration ?? 0) * 1000);
  const sampleRate = Number(audio?.sample_rate ?? 0);
  const channelCount = Number(audio?.channels ?? 0);
  if (!audio || durationMs <= 0 || sampleRate <= 0 || channelCount <= 0) {
    throw new Error("TTS_OUTPUT_INVALID");
  }
  return { durationMs, sampleRate, channelCount };
}

function contentHash(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function main(): Promise<void> {
  if (
    process.env.EMBEROS_TTS_LISTENING_AUTHORIZATION !==
    EXPECTED_AUTHORIZATION
  ) {
    throw new Error("EXPLICIT_PAID_TTS_AUTHORIZATION_REQUIRED");
  }

  const preview = buildProposedSgMyVoiceListeningExecutionPreview();
  if (
    preview.provider !== "openai" ||
    preview.model !== "gpt-4o-mini-tts" ||
    preview.voice !== "marin" ||
    preview.outputFormat !== "wav" ||
    preview.paidSampleCount !== MAXIMUM_AUTHORIZED_CALLS ||
    preview.estimatedMaximumCostUsd > MAXIMUM_AUTHORIZED_COST_USD ||
    preview.samples.some(
      (sample) => sample.status !== "PLANNED_AWAITING_AUTHORIZATION"
    )
  ) {
    throw new Error("AUTHORIZED_LISTENING_MATRIX_MISMATCH");
  }

  const outputDirectory = parseOutputDirectory();
  mkdirSync(outputDirectory, { recursive: true });
  if (readdirSync(outputDirectory).length > 0) {
    throw new Error("LISTENING_OUTPUT_DIRECTORY_MUST_BE_EMPTY");
  }
  loadProviderEnvironment();
  const client = getOpenAI();
  const startedAt = new Date().toISOString();
  const completed: Array<Record<string, unknown>> = [];

  try {
    for (const [index, sample] of preview.samples.entries()) {
      // Exactly one Provider call per authorized sample. No retry wrapper.
      const response = await client.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "marin",
        input: sample.exactScriptText,
        instructions: String(sample.capability.generationSettings.instructions),
        response_format: "wav",
        speed: 1,
      } as never);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error("TTS_OUTPUT_EMPTY");
      const localeSlug = sample.capability.locale
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      const outputPath = join(
        outputDirectory,
        `${String(index + 1).padStart(2, "0")}-${localeSlug}.wav`
      );
      writeFileSync(outputPath, bytes, { flag: "wx" });
      const probe = probeWave(outputPath);
      completed.push({
        sampleId: sample.sampleId,
        locale: sample.capability.locale,
        exactScriptText: sample.exactScriptText,
        provider: preview.provider,
        model: preview.model,
        voice: preview.voice,
        outputFormat: preview.outputFormat,
        generationInstructions:
          sample.capability.generationSettings.instructions,
        requestFingerprint: sample.requestFingerprint,
        contentHash: contentHash(bytes),
        durationMs: probe.durationMs,
        sampleRate: probe.sampleRate,
        channelCount: probe.channelCount,
        outputFile: basename(outputPath),
        providerCallOrdinal: index + 1,
        actualCostUsd: null,
      });
    }
  } catch (error) {
    writeFileSync(
      join(outputDirectory, "FAILED-NO-RETRY.json"),
      JSON.stringify(
        {
          status: "PROVIDER_CALL_FAILED_NO_RETRY",
          providerCallsCompleted: completed.length,
          failedCallOrdinal: completed.length + 1,
          error: error instanceof Error ? error.message : "UNKNOWN_FAILURE",
          completed,
          retryAuthorized: false,
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      { flag: "wx" }
    );
    throw error;
  }

  writeFileSync(
    join(outputDirectory, "listening-manifest.json"),
    JSON.stringify(
      {
        status: "SAMPLES_GENERATED_HUMAN_LISTENING_REQUIRED",
        authorizationId: EXPECTED_AUTHORIZATION,
        provider: preview.provider,
        model: preview.model,
        voice: preview.voice,
        outputFormat: preview.outputFormat,
        providerCallCount: completed.length,
        maximumAuthorizedCalls: MAXIMUM_AUTHORIZED_CALLS,
        estimatedMaximumCostUsd: MAXIMUM_AUTHORIZED_COST_USD,
        actualCostUsd: null,
        automaticRetryAuthorized: false,
        productionMutation: 0,
        commercialMutation: 0,
        videoProviderCalls: 0,
        startedAt,
        completedAt: new Date().toISOString(),
        samples: completed,
      },
      null,
      2
    ),
    { flag: "wx" }
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "LISTENING_EXECUTION_FAILED"
  );
  process.exit(1);
});
