import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { LocalGpuContractError } from "@ceo-agent/shared/server";

export const LOCAL_GPU_SUBMISSION_EVIDENCE_CONTRACT = "local-gpu-submission-evidence.v1" as const;
/** Desktop and Cloud clocks are independent; evidence older or newer than this is not trusted. */
export const LOCAL_GPU_SUBMISSION_EVIDENCE_MAX_SKEW_MS = 5 * 60 * 1000;

export type LocalGpuSubmissionVerdict = "ACCEPTED" | "REJECTED_BEFORE_ENQUEUE" | "IN_FLIGHT" | "NO_SUBMIT_RECORD" | "INCONSISTENT";

export type LocalGpuSubmissionEvidence = {
  v: 1;
  contract: typeof LOCAL_GPU_SUBMISSION_EVIDENCE_CONTRACT;
  environment: "staging" | "production";
  jobId: string;
  workspaceId: string;
  sceneExecutionId: string;
  workflow: string;
  verdict: LocalGpuSubmissionVerdict;
  basis: "JOB_RECORD" | "DURABLE_REJECTION_RECORD" | "AUTHENTICATED_SUBMIT_WITHOUT_ENQUEUE" | null;
  jobStatus: string | null;
  rejection: { httpStatus: number; errorCode: string; at: string } | null;
  submitAuthorizationCount: number;
  lastSubmitAuthorizationAt: string | null;
  challenge: string;
  issuedAt: string;
  desktopVersion: string;
};

export type SignedLocalGpuSubmissionEvidence = { payload: string; signature: string };

const VERDICTS = new Set(["ACCEPTED", "REJECTED_BEFORE_ENQUEUE", "IN_FLIGHT", "NO_SUBMIT_RECORD", "INCONSISTENT"]);

export function newLocalGpuEvidenceChallenge(): string {
  return randomBytes(32).toString("hex");
}

export function localGpuSubmissionEvidenceDigest(signed: SignedLocalGpuSubmissionEvidence): string {
  return createHash("sha256").update(`${signed.payload}.${signed.signature}`, "utf8").digest("hex");
}

/**
 * Verifies Desktop submission evidence: HMAC under the environment signing secret with the evidence
 * domain prefix, then the exact job identity, the fresh Cloud challenge and the issue time.
 */
export function verifyLocalGpuSubmissionEvidence(input: {
  signed: unknown;
  secret: string;
  now: Date;
  expected: { environment: string; jobId: string; workspaceId: string; sceneExecutionId: string; workflow: string; challenge: string };
}): LocalGpuSubmissionEvidence {
  const invalid = () => new LocalGpuContractError("LOCAL_GPU_ATTESTATION_INVALID");
  const signed = input.signed as Partial<SignedLocalGpuSubmissionEvidence> | null;
  if (!input.secret || !signed || typeof signed.payload !== "string" || typeof signed.signature !== "string") throw invalid();
  const expected = createHmac("sha256", Buffer.from(input.secret, "utf8"))
    .update(`${LOCAL_GPU_SUBMISSION_EVIDENCE_CONTRACT}.${signed.payload}`, "utf8")
    .digest("base64url");
  const actual = Buffer.from(signed.signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw invalid();
  let evidence: LocalGpuSubmissionEvidence;
  try {
    evidence = JSON.parse(Buffer.from(signed.payload, "base64url").toString("utf8")) as LocalGpuSubmissionEvidence;
  } catch {
    throw invalid();
  }
  const scope = input.expected;
  if (
    evidence?.v !== 1
    || evidence.contract !== LOCAL_GPU_SUBMISSION_EVIDENCE_CONTRACT
    || !VERDICTS.has(evidence.verdict)
    || evidence.environment !== scope.environment
    || evidence.jobId !== scope.jobId
    || evidence.workspaceId !== scope.workspaceId
    || evidence.sceneExecutionId !== scope.sceneExecutionId
    || evidence.workflow !== scope.workflow
    || evidence.challenge !== scope.challenge
  ) {
    throw invalid();
  }
  const issuedAt = Date.parse(evidence.issuedAt);
  if (!Number.isFinite(issuedAt) || Math.abs(input.now.getTime() - issuedAt) > LOCAL_GPU_SUBMISSION_EVIDENCE_MAX_SKEW_MS) {
    throw new LocalGpuContractError("LOCAL_GPU_ATTESTATION_STALE");
  }
  if (evidence.verdict === "REJECTED_BEFORE_ENQUEUE" && (
    evidence.basis === "JOB_RECORD" || evidence.basis === null || evidence.submitAuthorizationCount < 1 || evidence.jobStatus !== null
  )) {
    throw invalid();
  }
  return evidence;
}
