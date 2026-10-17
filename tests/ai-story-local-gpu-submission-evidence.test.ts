import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalGpuContractError } from "@ceo-agent/shared/server";
import { LocalGpuCloudAdapter } from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv } from "../packages/agents/src/ai-story/local-gpu-config";
import { verifyLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";
import {
  LOCAL_GPU_SUBMISSION_EVIDENCE_CONTRACT,
  verifyLocalGpuSubmissionEvidence,
  type LocalGpuSubmissionEvidence,
} from "../packages/agents/src/ai-story/local-gpu-submission-evidence";

/** Signed by the real Desktop signSubmissionEvidence; the same bytes are pinned in ember-local-gpu-desktop. */
const FIXTURE = "tests/fixtures/local-gpu-submission-evidence-golden-vector.json";
const FIXTURE_SHA256 = "c8f455628990b629c1c8d095749e04d7ccb86a73a1b16bfd939b8f04406c1940";

const raw = readFileSync(FIXTURE, "utf8");
const vector = JSON.parse(raw) as {
  testOnlySecret: { utf8: string };
  verifyAt: string;
  evidence: LocalGpuSubmissionEvidence;
  signed: { payload: string; signature: string };
};
const expected = {
  environment: vector.evidence.environment,
  jobId: vector.evidence.jobId,
  workspaceId: vector.evidence.workspaceId,
  sceneExecutionId: vector.evidence.sceneExecutionId,
  workflow: vector.evidence.workflow,
  challenge: vector.evidence.challenge,
};

function sign(evidence: LocalGpuSubmissionEvidence, secret = vector.testOnlySecret.utf8) {
  const payload = Buffer.from(JSON.stringify(evidence), "utf8").toString("base64url");
  return { payload, signature: createHmac("sha256", secret).update(`${LOCAL_GPU_SUBMISSION_EVIDENCE_CONTRACT}.${payload}`).digest("base64url") };
}

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof LocalGpuContractError ? error.message : String(error);
  }
  return "";
}

function verify(signed: unknown, overrides: Partial<typeof expected> = {}, now = new Date(vector.verifyAt), secret = vector.testOnlySecret.utf8) {
  return verifyLocalGpuSubmissionEvidence({ signed, secret, now, expected: { ...expected, ...overrides } });
}

describe("Desktop submission evidence verification", () => {
  it("verifies the Desktop-signed golden vector byte for byte", () => {
    expect(createHash("sha256").update(raw, "utf8").digest("hex")).toBe(FIXTURE_SHA256);
    expect(verify(vector.signed)).toEqual(vector.evidence);
    expect(sign(vector.evidence)).toEqual(vector.signed);
  });

  it("rejects a wrong secret, tampered payload, and any identity or challenge mismatch", () => {
    expect(code(() => verify(vector.signed, {}, new Date(vector.verifyAt), "another-secret"))).toBe("LOCAL_GPU_ATTESTATION_INVALID");
    const tampered = { ...vector.signed, payload: sign({ ...vector.evidence, verdict: "ACCEPTED" }).payload };
    expect(code(() => verify(tampered))).toBe("LOCAL_GPU_ATTESTATION_INVALID");
    for (const field of ["environment", "jobId", "workspaceId", "sceneExecutionId", "workflow", "challenge"] as const) {
      expect(code(() => verify(vector.signed, { [field]: field === "environment" ? "staging" : "other" }))).toBe("LOCAL_GPU_ATTESTATION_INVALID");
    }
    expect(code(() => verify(null))).toBe("LOCAL_GPU_ATTESTATION_INVALID");
    expect(code(() => verify({ payload: vector.signed.payload }))).toBe("LOCAL_GPU_ATTESTATION_INVALID");
  });

  it("rejects stale or future evidence, so a captured attestation cannot be replayed later", () => {
    expect(code(() => verify(vector.signed, {}, new Date(Date.parse(vector.evidence.issuedAt) + 6 * 60_000)))).toBe("LOCAL_GPU_ATTESTATION_STALE");
    expect(code(() => verify(vector.signed, {}, new Date(Date.parse(vector.evidence.issuedAt) - 6 * 60_000)))).toBe("LOCAL_GPU_ATTESTATION_STALE");
  });

  it("refuses a self-contradictory rejection verdict even when correctly signed", () => {
    const contradictions: Partial<LocalGpuSubmissionEvidence>[] = [
      { basis: "JOB_RECORD" },
      { basis: null },
      { submitAuthorizationCount: 0 },
      { jobStatus: "QUEUED" },
    ];
    for (const patch of contradictions) {
      expect(code(() => verify(sign({ ...vector.evidence, ...patch })))).toBe("LOCAL_GPU_ATTESTATION_INVALID");
    }
  });
});

describe("LocalGpuCloudAdapter.submissionEvidence", () => {
  const secret = vector.testOnlySecret.utf8;
  const now = new Date(vector.verifyAt);
  const adapter = (http: ConstructorParameters<typeof LocalGpuCloudAdapter>[1]) => new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv({
    LOCAL_GPU_PROVIDER_ENABLED: "true",
    LOCAL_GPU_ENVIRONMENT: "production",
    LOCAL_GPU_SIGNING_SECRET: secret,
    LOCAL_GPU_BASE_URL: "https://local-gpu.example.test",
  }), http, { now: () => now, nonce: () => "nonce-evidence" });
  const scope = {
    actor: { userId: "00000016-0000-4000-8000-000000000000", workspaceId: expected.workspaceId, organizationPlan: null, platformAdminStatus: "ACTIVE_GRANT" as const },
    workspaceId: expected.workspaceId,
    sceneExecutionId: expected.sceneExecutionId,
    workflow: expected.workflow,
    challenge: expected.challenge,
  };

  it("sends a job-bound evidence token with the challenge and verifies the signed response", async () => {
    const calls: { method: string; url: string; authorization: string }[] = [];
    const result = await adapter(async (request) => {
      calls.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
      return { status: 200, body: JSON.stringify(vector.signed) };
    }).submissionEvidence(expected.jobId, scope);
    expect(result.available).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(`https://local-gpu.example.test/v1/jobs/${expected.jobId}/submission-evidence?challenge=${expected.challenge}`);
    const claims = verifyLocalGpuRequest({
      secret, token: calls[0].authorization.replace("Bearer ", ""), now, workspaceId: expected.workspaceId, environment: "production",
    });
    expect(claims).toMatchObject({ action: "evidence", jobId: expected.jobId, authority: "SUPERADMIN", sceneExecutionId: expected.sceneExecutionId, workflow: expected.workflow });
  });

  it("reports an old or unreachable Desktop as unavailable instead of proof", async () => {
    expect(await adapter(async () => ({ status: 404, body: "{\"error\":{\"code\":\"LOCAL_GPU_NOT_FOUND\"}}" })).submissionEvidence(expected.jobId, scope))
      .toEqual({ available: false, httpStatus: 404 });
    expect(await adapter(async () => { throw new Error("connect ECONNREFUSED"); }).submissionEvidence(expected.jobId, scope))
      .toEqual({ available: false, httpStatus: null });
    await expect(adapter(async () => ({ status: 200, body: JSON.stringify({ ...vector.signed, signature: "x" }) })).submissionEvidence(expected.jobId, scope))
      .rejects.toThrow("LOCAL_GPU_ATTESTATION_INVALID");
  });
});
