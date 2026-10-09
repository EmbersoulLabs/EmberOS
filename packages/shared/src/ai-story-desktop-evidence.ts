import { LOCAL_GPU_WORKER_WORKFLOW } from "./ai-story-local-gpu";

export const DESKTOP_AUDIO_EVIDENCE_SHA256 =
  "c4208b37e8a63311ea7dd0a26ab494f184d7324b6abc2fed52a0a8f7595630aa";
export const DESKTOP_DEPLOYMENT_ATTESTATION_SHA256 =
  "052d62793e9ecc976d7508d8c9c50117008d2a0ddb7035ccb2de45b11a73708a";
export const DESKTOP_TESTED_WORKER_COMMIT =
  "297bf5e2240a21e463b35623fde689a493c61883";

const HEX64 = /^[0-9a-f]{64}$/;

type Artifact = { path?: string; sha256?: string; bytes?: number; mtime?: string; match?: boolean };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function artifacts(value: unknown): Artifact[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as Artifact[] : [];
}

function hexEqual(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" && HEX64.test(left) && left === right;
}

/**
 * Validates the original Desktop files. A matching file hash is not a
 * substitute for the internal checks. In-memory measurement is recorded
 * and is not treated as a pass.
 */
export function verifyImportedDesktopEvidence(input: {
  audioFileSha256: string;
  attestationFileSha256: string;
  audio: unknown;
  attestation: unknown;
  liveHealth: { httpStatus: number; body: Record<string, unknown> };
  liveWorkflows: readonly string[];
  liveSigningAccepted: boolean;
}): {
  audioFileHashValid: boolean;
  attestationFileHashValid: boolean;
  nativePreservesAudio: boolean;
  artifactHashesMatch: boolean;
  inMemoryMeasurement: "NOT_PERFORMED";
  attestedPid: number | null;
  attestedCommit: string | null;
  liveHealthConsistent: boolean;
  liveCapabilitiesConsistent: boolean;
  compatible: boolean;
  rejected: string[];
} {
  const rejected: string[] = [];
  const audioFileHashValid = input.audioFileSha256 === DESKTOP_AUDIO_EVIDENCE_SHA256;
  const attestationFileHashValid = input.attestationFileSha256 === DESKTOP_DEPLOYMENT_ATTESTATION_SHA256;
  if (!audioFileHashValid) rejected.push("audioFileSha256");
  if (!attestationFileHashValid) rejected.push("attestationFileSha256");

  const audio = record(input.audio);
  const attestation = record(input.attestation);
  if (!audio || !attestation) rejected.push("json");
  const native = record(audio?.nativePolicy);
  const request = record(audio?.historicalRequest);
  const media = record(audio?.audio);
  const inputStream = record(media?.inputAudioStream);
  const outputStream = record(media?.outputAudioStream);
  const upload = record(audio?.secureUpload);
  const audioWorker = record(audio?.workerIdentity);
  const running = record(attestation?.runningWorker);
  const endpoints = record(attestation?.endpoints);
  const capabilities = record(attestation?.signedCapabilities);
  const audioLink = record(attestation?.audioEvidence);
  const verification = record(attestation?.verification);
  const safety = record(attestation?.safety);
  const portMapping = record(attestation?.portMapping);

  const nativePreservesAudio = native?.audioPolicy === "NATIVE"
    && native.dialogueRequired === false
    && native.voiceInstructionsPresent === false
    && request?.workflow === LOCAL_GPU_WORKER_WORKFLOW
    && request.audioPolicy === "NATIVE"
    && request.voiceInstructionsPresent === false
    && audio?.offlineAudioTest === "PASS"
    && Array.isArray(audio?.failedChecks) && audio.failedChecks.length === 0
    && audio?.h3RunsUsed === 0
    && hexEqual(media?.inputDecodedAudioSha256, media?.outputDecodedAudioSha256)
    && hexEqual(media?.inputFileSha256, media?.outputFileSha256)
    && media?.decodedAudioHashMatch === true
    && media?.fileHashMatch === true
    && inputStream?.codec === "aac"
    && outputStream?.codec === "aac"
    && inputStream?.present === true
    && outputStream?.present === true
    && inputStream?.durationMs === 5167
    && outputStream?.durationMs === 5167
    && upload?.uploadedFileSha256 === media?.inputFileSha256
    && upload?.uploadedDecodedAudioSha256 === media?.inputDecodedAudioSha256
    && upload?.uploadedAudioStreamPresent === true
    && safety?.h3RunsDuringTask === 0;
  if (!nativePreservesAudio) rejected.push("nativeAudioPreservation");

  const audioArtifacts = artifacts(audioWorker?.artifactSha256);
  const attestedArtifacts = artifacts(attestation?.artifacts);
  const artifactHashesMatch = attestedArtifacts.length === 4
    && attestedArtifacts.every((item) => {
      const prior = audioArtifacts.find((candidate) => candidate.path === item.path);
      return item.match === true
        && typeof item.sha256 === "string"
        && HEX64.test(item.sha256)
        && prior?.sha256 === item.sha256
        && prior.bytes === item.bytes;
    })
    && audioLink?.sha256 === DESKTOP_AUDIO_EVIDENCE_SHA256
    && audioLink.preservedUnchanged === true
    && audioLink.offlineAudioTest === "PASS"
    && attestedArtifacts.some((item) => item.path === "apps/local-worker/dist/worker/media.js" && item.sha256 === audioLink?.testedMediaArtifactSha256);
  if (!artifactHashesMatch) rejected.push("artifactHashes");

  const attestedCommit = typeof attestation?.repositoryCommit === "string" ? attestation.repositoryCommit : null;
  const startedAt = typeof running?.startedAt === "string" ? Date.parse(running.startedAt) : Number.NaN;
  const artifactTimes = attestedArtifacts
    .map((item) => typeof item.mtime === "string" ? Date.parse(item.mtime) : Number.NaN);
  const processAfterBuild = artifactTimes.length === 4
    && artifactTimes.every((time) => Number.isFinite(time) && startedAt > time);
  const attestedPid = typeof running?.pid === "number" ? running.pid : null;
  const mapping = typeof portMapping?.publicEndpointProcessMapping === "string"
    ? portMapping.publicEndpointProcessMapping
    : "";
  const identityConsistent = attestedCommit === DESKTOP_TESTED_WORKER_COMMIT
    && attestation?.testedBuildCommit === DESKTOP_TESTED_WORKER_COMMIT
    && audioWorker?.repositoryCommitSha === DESKTOP_TESTED_WORKER_COMMIT
    && attestedPid === 27236
    && processAfterBuild
    && endpoints?.public === "https://local-gpu.embersoullabs.com"
    && mapping === "local-gpu.embersoullabs.com -> http://127.0.0.1:8787 -> PID 27236"
    && audioWorker?.deployedWorkerIdentityMatch === "NOT_VERIFIED"
    && audioWorker.activePid !== attestedPid
    && verification?.filesystemBuildMatch === "YES"
    && verification.processStartupBuildLinkage === "YES"
    && verification.deployedWorkerIdentityMatch === "YES"
    && verification.cryptographicInMemoryBuildVerification === "NO"
    && safety?.distFilesChanged === "NO"
    && capabilities?.httpStatus === 200
    && Array.isArray(capabilities.workflowIds)
    && capabilities.workflowIds.includes(LOCAL_GPU_WORKER_WORKFLOW);
  if (!identityConsistent) rejected.push("workerIdentity");

  const attestedHealth = record(record(attestation?.publicHealth)?.body);
  const live = input.liveHealth.body;
  const liveHealthConsistent = input.liveHealth.httpStatus === 200
    && live.status === attestedHealth?.status
    && live.version === attestedHealth?.version
    && live.worker === attestedHealth?.worker
    && live.comfyui === attestedHealth?.comfyui
    && live.allowStaging === true;
  if (!liveHealthConsistent) rejected.push("liveHealth");
  const liveCapabilitiesConsistent = input.liveSigningAccepted
    && input.liveWorkflows.includes(LOCAL_GPU_WORKER_WORKFLOW);
  if (!liveCapabilitiesConsistent) rejected.push("liveCapabilities");

  return {
    audioFileHashValid,
    attestationFileHashValid,
    nativePreservesAudio,
    artifactHashesMatch,
    inMemoryMeasurement: "NOT_PERFORMED",
    attestedPid,
    attestedCommit,
    liveHealthConsistent,
    liveCapabilitiesConsistent,
    compatible: rejected.length === 0,
    rejected,
  };
}
