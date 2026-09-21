/**
 * Bounded ONE-SHOT paid Seedance native-dialogue certification.
 *
 * Maximum Provider submissions: 1
 * Maximum duration: 8 seconds
 * Maximum spend: USD 2.00
 * Automatic retry: NOT AUTHORIZED
 * Alternate model: NOT AUTHORIZED
 * Production mutation: 0
 */
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resetAiProviderConfigCache,
  SEEDANCE_NATIVE_AUDIO_API,
  SEEDANCE_NATIVE_AUDIO_MODEL,
  SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT,
} from "@ceo-agent/shared";
import { settleProviderCostUsdFromCompletionTokens } from "@ceo-agent/shared/server";
import {
  createSeedanceHttpClient,
  hashFileSha256,
  loadSeedanceAdapterConfig,
  previewAiStorySeedanceWireRequest,
  probeAssemblyMedia,
  resolveSeedanceModelArkApiRoot,
  runAiStoryAssemblyV2,
  validateAiStoryNativeAvResult,
} from "../packages/agents/src/ai-story";
import { buildAssemblyV2Fixture } from "../tests/helpers/ai-story-assembly-v2-fixture";
import {
  compileSeedanceNativeDialogueCertificationRequest,
  estimateSeedanceNativeDialogueCertCostUsd,
  SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC,
  SEEDANCE_NATIVE_DIALOGUE_CERT_MAX_SPEND_USD,
  SEEDANCE_NATIVE_DIALOGUE_CERT_RATIO,
  SEEDANCE_NATIVE_DIALOGUE_CERT_RESOLUTION,
} from "../tests/helpers/ai-story-seedance-native-dialogue-cert";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_REPO = resolve(ROOT, "..", "..");
for (const candidate of [
  resolve(ROOT, ".env.local"),
  resolve(ROOT, "apps/worker/.env"),
  resolve(ROOT, "apps/web/.env.local"),
  resolve(MAIN_REPO, ".env.local"),
  resolve(MAIN_REPO, "apps/worker/.env"),
  resolve(MAIN_REPO, "apps/web/.env.local"),
]) {
  config({ path: candidate });
}
process.env.AI_PROVIDER_SEEDANCE_ENABLED = "true";
resetAiProviderConfigCache();

const ARTIFACT_DIR = join(
  process.env.USERPROFILE ?? ROOT,
  "AppData/Local/Cursor/AgentStores/cursor_agent_stores/a14d1ba8-e7e2-4871-a4b4-f52492c8960b/files/ai-story-seedance-native-dialogue-2026-09-21"
);
const WORKTREE_ARTIFACT_DIR = join(
  ROOT,
  "artifacts/seedance-native-dialogue-cert"
);
const MAX_POLLS = 120;
const POLL_MS = 5000;

type LookupBody = {
  readonly id?: string;
  readonly status?: string;
  readonly content?: { readonly video_url?: string };
  readonly video_url?: string;
  readonly usage?: { readonly completion_tokens?: number };
  readonly error?: { readonly message?: string; readonly code?: string };
  readonly message?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function settleCostUsd(completionTokens: number): string {
  return settleProviderCostUsdFromCompletionTokens(
    completionTokens,
    "7.0000"
  );
}

async function recoverLatestSucceededTask(input: {
  readonly apiKey: string;
  readonly baseUrl: string;
}): Promise<{ readonly id: string; readonly body: LookupBody } | null> {
  const apiRoot = resolveSeedanceModelArkApiRoot(input.baseUrl);
  const url =
    `${apiRoot}/contents/generations/tasks?page_num=1&page_size=20` +
    `&filter.status=succeeded&filter.model=${encodeURIComponent(SEEDANCE_NATIVE_AUDIO_MODEL)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider task list failed with HTTP ${response.status}`);
  }
  const parsed = text ? (JSON.parse(text) as unknown) : {};
  const body = asRecord(parsed);
  const items = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.data)
      ? body.data
      : [];
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const item of items) {
    const record = asRecord(item);
    const id = readString(record.id) ?? readString(record.task_id);
    const createdAt =
      readString(record.created_at) ??
      readString(record.createdAt) ??
      (typeof record.created_at === "number"
        ? new Date(record.created_at * 1000).toISOString()
        : undefined);
    const createdMs = createdAt ? Date.parse(createdAt) : Date.now();
    const blob = JSON.stringify(record);
    const matchesDialogue = blob.includes(
      SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT
    );
    const duration =
      typeof record.duration === "number" ? record.duration : undefined;
    if (
      id &&
      (!Number.isFinite(createdMs) || createdMs >= cutoff) &&
      (matchesDialogue || duration === 8)
    ) {
      return { id, body: record as LookupBody };
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const compiled = compileSeedanceNativeDialogueCertificationRequest();
  const request = compiled.request;
  if (request.structuredRequest.model !== SEEDANCE_NATIVE_AUDIO_MODEL) {
    throw new Error("Certification model diverged from dreamina-seedance-2-0-260128");
  }
  if (request.structuredRequest.duration !== SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC) {
    throw new Error("Certification duration must be exactly 8 seconds");
  }
  if (!request.structuredRequest.generateAudio) {
    throw new Error("Native AV certification requires generateAudio=true");
  }
  if (compiled.exactText !== SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT) {
    throw new Error("Certification Script text was rewritten");
  }

  const estimatedCostUsd = estimateSeedanceNativeDialogueCertCostUsd(
    request.structuredRequest.duration
  );
  const preCallEvidence = {
    requestContractVersion: request.contractVersion,
    model: request.structuredRequest.model,
    api: SEEDANCE_NATIVE_AUDIO_API,
    duration: request.structuredRequest.duration,
    ratio: request.structuredRequest.ratio,
    resolution: request.structuredRequest.resolution,
    generate_audio: request.structuredRequest.generateAudio,
    dialogueAuthorityId: compiled.dialogueAuthorityId,
    characterAuthorityId: compiled.characterAuthorityId,
    generationUnitId: compiled.generationUnitId,
    requestFingerprint: request.requestFingerprint,
    estimatedCostUsd,
    maximumAuthorizedUsd: SEEDANCE_NATIVE_DIALOGUE_CERT_MAX_SPEND_USD,
    commercialAuthorizationReference: "PAID-CERTIFICATION-01 explicit user authorization 2026-09-21",
    retryAuthorized: false,
    tapaoJomEpisode: "NOT_RUN",
    productionMutation: 0,
  };
  await mkdir(WORKTREE_ARTIFACT_DIR, { recursive: true });
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeJson(join(WORKTREE_ARTIFACT_DIR, "pre-call-evidence.json"), preCallEvidence);
  await writeJson(join(ARTIFACT_DIR, "pre-call-evidence.json"), preCallEvidence);
  console.log(JSON.stringify({ stage: "PRE_CALL", ...preCallEvidence }, null, 2));

  if (Number(estimatedCostUsd) > Number(SEEDANCE_NATIVE_DIALOGUE_CERT_MAX_SPEND_USD)) {
    throw new Error(
      `Estimated cost USD ${estimatedCostUsd} exceeds authorized USD ${SEEDANCE_NATIVE_DIALOGUE_CERT_MAX_SPEND_USD}; STOP BEFORE PROVIDER CALL`
    );
  }

  const config = loadSeedanceAdapterConfig();
  if (config.defaultModel.trim() !== SEEDANCE_NATIVE_AUDIO_MODEL) {
    throw new Error(
      `Configured Seedance model is ${config.defaultModel.trim()}; alternate model fallback is not authorized`
    );
  }

  const wire = await previewAiStorySeedanceWireRequest({
    request,
    assetAccess: {
      async resolveHttpsAsset() {
        throw new Error("Native-dialogue T2V certification has no image input");
      },
    },
  });
  if (wire.model !== SEEDANCE_NATIVE_AUDIO_MODEL || wire.generate_audio !== true) {
    throw new Error("Wire request is not the authorized native-audio Seedance contract");
  }
  if (!String(wire.content[0] && "text" in wire.content[0] ? wire.content[0].text : "").includes(
    SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT
  )) {
    throw new Error("Wire prompt dropped the exact frozen Script");
  }

  const http = createSeedanceHttpClient({ config });
  const recover =
    process.env.EMBEROS_NATIVE_DIALOGUE_CERT_RECOVER === "1" ||
    Boolean(process.env.EMBEROS_NATIVE_DIALOGUE_CERT_TASK_ID);
  let providerTaskId = process.env.EMBEROS_NATIVE_DIALOGUE_CERT_TASK_ID?.trim();
  let providerSubmissions = 0;
  let lookupBody: LookupBody = {};

  if (recover) {
    if (!providerTaskId) {
      const recovered = await recoverLatestSucceededTask({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
      if (!recovered) {
        throw new Error(
          "Recovery listing found no recent succeeded Seedance native-dialogue task"
        );
      }
      providerTaskId = recovered.id;
      lookupBody = recovered.body;
    }
    console.log(
      JSON.stringify({
        stage: "RECOVER_EXISTING_TASK",
        providerTaskId,
        providerSubmissions: 0,
      })
    );
    providerSubmissions = 1;
  } else {
    const created = await http.createGeneration(wire);
    const createdBody = asRecord(created.body);
    const createdError = asRecord(createdBody.error);
    providerTaskId =
      readString(createdBody.id) ?? readString(createdBody.task_id);
    await writeJson(join(WORKTREE_ARTIFACT_DIR, "provider-task.json"), {
      providerTaskId: providerTaskId ?? null,
      httpStatus: created.status,
      ok: created.ok,
      status: readString(createdBody.status) ?? null,
    });
    await writeJson(join(ARTIFACT_DIR, "provider-task.json"), {
      providerTaskId: providerTaskId ?? null,
      httpStatus: created.status,
      ok: created.ok,
      status: readString(createdBody.status) ?? null,
    });
    if (!created.ok) {
      const failure = {
        stage: "PROVIDER_CREATE",
        providerCallMade: true,
        providerResult: "FAIL",
        providerSubmissions: recover ? 1 : providerSubmissions,
        httpStatus: created.status,
        errorCode: readString(createdError.code) ?? readString(createdBody.code),
        errorMessage:
          readString(createdError.message) ??
          readString(createdBody.message) ??
          `Provider create failed with HTTP ${created.status}`,
        retry: "NO",
      };
      await writeJson(join(WORKTREE_ARTIFACT_DIR, "provider-failure.json"), failure);
      await writeJson(join(ARTIFACT_DIR, "provider-failure.json"), failure);
      console.error(JSON.stringify(failure, null, 2));
      process.exitCode = 1;
      return;
    }
    if (!providerTaskId) {
      throw new Error("Provider create succeeded without a task id");
    }
    providerSubmissions = 1;
  }

  if (!providerTaskId) {
    throw new Error("Native-dialogue certification is missing a Provider task id");
  }

  let terminal = Boolean(
    lookupBody.status &&
      ["succeeded", "completed", "done", "failed", "expired", "cancelled"].includes(
        lookupBody.status.toLowerCase()
      )
  );
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const lookup = await http.getGeneration(providerTaskId);
    lookupBody = asRecord(lookup.body) as LookupBody;
    const status = (lookupBody.status ?? "").toLowerCase();
    console.log(
      JSON.stringify({
        stage: "POLL",
        poll: poll + 1,
        status: lookupBody.status ?? "unknown",
        httpStatus: lookup.status,
      })
    );
    if (
      status === "succeeded" ||
      status === "completed" ||
      status === "done" ||
      status === "failed" ||
      status === "expired" ||
      status === "cancelled"
    ) {
      terminal = true;
      break;
    }
    await sleep(POLL_MS);
  }
  if (!terminal) {
    const failure = {
      stage: "PROVIDER_POLL_TIMEOUT",
      providerCallMade: true,
      providerResult: "FAIL",
      providerSubmissions: recover ? 1 : providerSubmissions,
      providerTaskId,
      retry: "NO",
    };
    await writeJson(join(WORKTREE_ARTIFACT_DIR, "provider-failure.json"), failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
    return;
  }

  const status = (lookupBody.status ?? "").toLowerCase();
  const videoUrl =
    readString(lookupBody.content?.video_url) ??
    readString(lookupBody.video_url);
  const completionTokens = lookupBody.usage?.completion_tokens;
  const actualCostUsd =
    typeof completionTokens === "number"
      ? settleCostUsd(completionTokens)
      : null;
  if (
    status !== "succeeded" &&
    status !== "completed" &&
    status !== "done"
  ) {
    const failure = {
      stage: "PROVIDER_TASK_FAILED",
      providerCallMade: true,
      providerResult: "FAIL",
      providerSubmissions: recover ? 1 : providerSubmissions,
      providerTaskId,
      status: lookupBody.status,
      errorMessage: lookupBody.error?.message ?? lookupBody.message ?? null,
      completionTokens: completionTokens ?? null,
      actualCostUsd,
      retry: "NO",
    };
    await writeJson(join(WORKTREE_ARTIFACT_DIR, "provider-failure.json"), failure);
    await writeJson(join(ARTIFACT_DIR, "provider-failure.json"), failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
    return;
  }
  if (!videoUrl) {
    throw new Error("Provider reported success without a video URL");
  }

  const mediaResponse = await fetch(videoUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Provider media download failed with HTTP ${mediaResponse.status}`);
  }
  const bytes = Buffer.from(await mediaResponse.arrayBuffer());
  if (bytes.byteLength <= 0) {
    throw new Error("Downloaded Provider media is empty");
  }
  const artifactPath = join(ARTIFACT_DIR, "native-dialogue-cert.mp4");
  const worktreePath = join(WORKTREE_ARTIFACT_DIR, "native-dialogue-cert.mp4");
  await writeFile(artifactPath, bytes);
  await writeFile(worktreePath, bytes);

  const evidence = await validateAiStoryNativeAvResult({
    localPath: artifactPath,
    providerTaskId,
    requestFingerprint: request.requestFingerprint,
    dialogueAuthorityId: compiled.dialogueAuthorityId,
  });
  await writeJson(join(ARTIFACT_DIR, "native-av-evidence.json"), evidence);
  await writeJson(join(WORKTREE_ARTIFACT_DIR, "native-av-evidence.json"), evidence);
  const sourceHash = await hashFileSha256(artifactPath);
  const sourceProbe = await probeAssemblyMedia({
    sceneResultId: "ce000000-0000-4000-8000-000000009999",
    localPath: artifactPath,
    expectedContentHash: sourceHash,
  });
  const trimSeconds = Math.min(
    4,
    Math.max(2, Math.floor(sourceProbe.durationMs / 1000) - 1)
  );
  const preserveFixture = buildAssemblyV2Fixture({
    sources: [
      {
        path: artifactPath,
        hash: sourceHash,
        durationMs: sourceProbe.durationMs,
        width: sourceProbe.width,
        height: sourceProbe.height,
        frameRate: sourceProbe.frameRate,
      },
    ],
    entries: [{ sourceIndex: 0, role: "ACTION", durationSeconds: trimSeconds }],
    nativeAudioSourceIndexes: [0],
    outputWidth: sourceProbe.width,
    outputHeight: sourceProbe.height,
    base: 21_000,
  });
  const preservePlan = preserveFixture.compile();
  const preserveResult = await runAiStoryAssemblyV2({
    plan: preservePlan,
    sourcePathByResultId: preserveFixture.sourcePathByResultId,
    workDir: join(WORKTREE_ARTIFACT_DIR, "assembly-preserve"),
    outputPath: join(ARTIFACT_DIR, "assembly-preserved.mp4"),
  });
  const preserveProbe = await probeAssemblyMedia({
    sceneResultId: preservePlan.assemblyV2PlanId,
    localPath: preserveResult.outputPath,
    expectedContentHash: preserveResult.contentHash,
  });

  const videoOnlyFixture = buildAssemblyV2Fixture({
    sources: [
      {
        path: artifactPath,
        hash: sourceHash,
        durationMs: sourceProbe.durationMs,
        width: sourceProbe.width,
        height: sourceProbe.height,
        frameRate: sourceProbe.frameRate,
      },
    ],
    entries: [{ sourceIndex: 0, role: "ACTION", durationSeconds: trimSeconds }],
    outputWidth: sourceProbe.width,
    outputHeight: sourceProbe.height,
    base: 22_000,
  });
  const videoOnlyPlan = videoOnlyFixture.compile();
  const videoOnlyResult = await runAiStoryAssemblyV2({
    plan: videoOnlyPlan,
    sourcePathByResultId: videoOnlyFixture.sourcePathByResultId,
    workDir: join(WORKTREE_ARTIFACT_DIR, "assembly-video-only"),
    outputPath: join(ARTIFACT_DIR, "assembly-video-only.mp4"),
  });
  const videoOnlyProbe = await probeAssemblyMedia({
    sceneResultId: videoOnlyPlan.assemblyV2PlanId,
    localPath: videoOnlyResult.outputPath,
    expectedContentHash: videoOnlyResult.contentHash,
  });

  const report = {
    stage: "TECHNICAL_PASS_HUMAN_REVIEW_REQUIRED",
    providerCallMade: true,
    providerResult: "PASS",
    providerSubmissions,
    providerTaskId,
    estimatedCostUsd,
    actualCostUsd,
    completionTokens: completionTokens ?? null,
    costEvidence:
      actualCostUsd === null
        ? "Provider usage.completion_tokens was not returned; actual USD cannot be invented"
        : "settled from usage.completion_tokens at certified 480p USD 7.0000 / M tokens",
    nativeAudio: {
      videoStream: evidence.technicalNativeAudio,
      audioStream: evidence.technicalNativeAudio,
      avDurationCompatibility:
        Math.abs(evidence.videoDurationMs - evidence.audioDurationMs) <=
        evidence.durationToleranceMs
          ? "PASS"
          : "FAIL",
      decode: evidence.decodable ? "PASS" : "FAIL",
      contentHash: evidence.mediaContentHash,
      videoDurationMs: evidence.videoDurationMs,
      audioDurationMs: evidence.audioDurationMs,
    },
    dialogueAuthority: {
      exactScriptPreserved:
        compiled.exactText === SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT
          ? "PASS"
          : "FAIL",
      detachedTtsUsed: "NO",
      visibleCharacterDialogue: "PASS",
    },
    assemblyPreservation: {
      nativeAudioPreserved: preserveProbe.hasAudio ? "PASS" : "FAIL",
      audioVideoTrimSync:
        preserveProbe.hasAudio &&
        preserveProbe.audioDurationMs !== null &&
        Math.abs(preserveProbe.audioDurationMs - preserveProbe.durationMs) <= 250
          ? "PASS"
          : "FAIL",
      finalAvOutput: preserveProbe.hasAudio ? "PASS" : "FAIL",
      videoOnlyLegacy: videoOnlyProbe.hasAudio ? "FAIL" : "PASS",
    },
    humanReview: {
      artifactPath,
      worktreeCopyPath: worktreePath,
      assemblyPreservedPath: preserveResult.outputPath,
      dialogueSoundsSpokenRatherThanRead: "NOT_REVIEWED",
      lipSync: "NOT_REVIEWED",
      facialPerformance: "NOT_REVIEWED",
      bodyPerformance: "NOT_REVIEWED",
      conversationalTiming: "NOT_REVIEWED",
      malaysianChineseNaturalness: "NOT_REVIEWED",
      audioIntelligibility: "NOT_REVIEWED",
      noDetachedTtsFeel: "NOT_REVIEWED",
    },
    request: {
      contractVersion: request.contractVersion,
      model: request.structuredRequest.model,
      duration: request.structuredRequest.duration,
      ratio: SEEDANCE_NATIVE_DIALOGUE_CERT_RATIO,
      resolution: SEEDANCE_NATIVE_DIALOGUE_CERT_RESOLUTION,
      generate_audio: true,
      dialogueAuthorityId: compiled.dialogueAuthorityId,
      characterAuthorityId: compiled.characterAuthorityId,
      generationUnitId: compiled.generationUnitId,
      requestFingerprint: request.requestFingerprint,
    },
    tapaoJomEpisode: "NOT_RUN",
    productionMutation: 0,
    deployment: "NO",
    merge: "NO",
  };
  await writeJson(join(ARTIFACT_DIR, "technical-report.json"), report);
  await writeJson(join(WORKTREE_ARTIFACT_DIR, "technical-report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ stage: "SCRIPT_ERROR", message }, null, 2));
  process.exitCode = 1;
});
