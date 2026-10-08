import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_AUDIO_QC_EXPECTATION_KINDS,
  AiStoryLocalGenerationPackageSchema,
  assertDistinctLocalGpuSecrets,
  assertLocalGpuPackageCompatibility,
  assertLocalGpuRequestExpiry,
  assertLocalGpuResultEnvironment,
  assertLocalGpuUploadBinding,
  buildLocalGpuDesktopSubmit,
  canonicalLocalGpuSigningPayload,
  LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
  LOCAL_GPU_CAPABILITIES_ACTION,
  LOCAL_GPU_CLAIM_ORDER,
  LOCAL_GPU_SUBMIT_ACTION,
  readLocalGpuUpstreamFailure,
  LOCAL_GPU_PROVIDER_ID,
  LOCAL_GPU_PUBLIC_DUMMY_SIGNING_SECRET,
  LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  localGpuPlannedDurationMs,
  localGpuUploadBindingDigest,
  mapLocalGpuAudioPolicy,
  selectLocalGpuReferences,
} from "@ceo-agent/shared";
import { createProductionProviderRegistry, MemoryPayloadResolver } from "@ceo-agent/agents/provider-adapters";
import {
  assertGenerationResultApproval,
  materializeLocalGpuGenerationResult,
} from "../packages/agents/src/ai-story/generation-result-service";
import { assertLocalGpuAccess, localGpuActorFromResolution } from "../packages/agents/src/ai-story/local-gpu-access";
import { LocalGpuCloudAdapter, LocalGpuSubmitFailedError, createLocalGpuProviderRegistry } from "../packages/agents/src/ai-story/local-gpu-adapter";
import { loadLocalGpuConfigFromEnv, redactLocalGpuConfig } from "../packages/agents/src/ai-story/local-gpu-config";
import { handoffLocalGpuToExistingReview } from "../packages/agents/src/ai-story/local-gpu-handoff";
import { signLocalGpuRequest } from "../packages/agents/src/ai-story/local-gpu-signing";
import {
  AiStoryPostGenerationQcService,
  FakeAiStoryVisualEvidenceProvider,
  InMemoryAiStoryPostGenerationQcRepository,
} from "../packages/agents/src/ai-story/post-generation-qc-service";

const root = join(__dirname, "..");
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = `sha256:${"ab".repeat(32)}`;
const referenceUrl = "https://storage.example.test/reference.png";
const uploadUrl = "https://storage.example.test/upload/result.mp4";

function approvedReference(role: "CHARACTER" | "PRODUCT" = "CHARACTER", assetUrl = referenceUrl) {
  return { approval: "APPROVED" as const, role, assetUrl, contentHash: hash };
}

function secureUpload() {
  return {
    environment: "staging" as const,
    method: "PUT",
    url: uploadUrl,
    headers: { "content-type": "video/mp4" },
    assetId: id(90),
  };
}
const now = new Date("2026-10-07T04:00:00.000Z");
const secret = "staging-signing-secret";
const productionSecret = "production-signing-secret";

function pkg() {
  return AiStoryLocalGenerationPackageSchema.parse({
    version: "local-generation-package.v1",
    packageId: id(1),
    packageFingerprint: hash,
    executionMode: "MANUAL_LOCAL",
    organizationId: id(2),
    workspaceId: id(3),
    campaignId: id(4),
    storyId: id(5),
    storyVersionId: id(6),
    executionPlanId: id(7),
    runtimeAuthorizationId: id(8),
    unitId: id(9),
    sceneExecutionId: id(9),
    sceneId: "scene-1",
    order: 1,
    durationSec: 4,
    aspectRatio: "9:16",
    resolutionIntent: "720p",
    recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
    generationMode: "TEXT_TO_VIDEO",
    prompt: "A deterministic synthetic Scene.",
    negativePrompt: "",
    dialogue: [{ speakerLabel: "Yuki", text: "Look at this.", offscreen: false, locale: "en-SG" }],
    generateAudio: false,
    audioBlocked: true,
    characterAuthority: {
      characterId: id(30),
      characterVersionId: id(31),
      dnaFingerprint: hash,
      sourcePhotoSentToVideoProvider: false,
    },
    productAuthority: { assetId: id(32), contentHash: hash, confirmedVariant: "Pavlova" },
    worldDescription: "Synthetic room",
    mustKeep: [],
    mustAvoid: [],
    qcRequirements: [],
    continuityRequirements: [],
    previousUnitEndState: [],
    currentUnitStartState: [],
    expectedEndState: [],
    references: [
      { assetId: id(40), contentHash: hash, authorityType: "CHARACTER", authorityId: id(30), displayName: "Approved character" },
      { assetId: id(41), contentHash: hash, authorityType: "PRODUCT", authorityId: id(32), displayName: "Product" },
    ],
    sourceAuthority: {
      schedulingAuthorityId: id(10),
      schedulingAuthorityFingerprint: hash,
      plannerSnapshotId: id(11),
      compiledRequestId: id(12),
      compiledRequestFingerprint: hash,
      sceneFingerprint: hash,
      semanticPlanFingerprint: hash,
      preGenerationQcEvaluationId: id(13),
      preGenerationQcFingerprint: hash,
      directorFingerprint: hash,
      motionFingerprint: hash,
      castSnapshotFingerprint: hash,
      locationSnapshotFingerprint: hash,
      productSnapshotFingerprint: hash,
    },
    planningAuthority: {
      planningLineageSource: "LEGACY_COMPILED_V1",
      sceneVersion: 1,
      scriptVersionId: null,
      handoffId: null,
      handoffFingerprint: null,
    },
    instructions: "Render locally",
    state: "AWAITING_LOCAL_OUTPUT",
    retryOfPackageId: null,
    retryNumber: 0,
    createdAt: now.toISOString(),
  });
}

function actor(status: "ACTIVE_GRANT" | "BOOTSTRAP_ELIGIBLE" | "DENIED" = "ACTIVE_GRANT", plan: string | null = null) {
  return localGpuActorFromResolution({
    userId: id(16),
    workspaceId: id(3),
    organizationPlan: plan,
    resolution: { status },
  });
}

function config(environment: "staging" | "production" = "staging", enabled = true, signingSecret: string | null = secret) {
  return loadLocalGpuConfigFromEnv({
    LOCAL_GPU_PROVIDER_ENABLED: enabled ? "true" : "false",
    LOCAL_GPU_BASE_URL: "https://local-gpu.embersoullabs.com",
    LOCAL_GPU_ENVIRONMENT: environment,
    LOCAL_GPU_SIGNING_SECRET: signingSecret ?? undefined,
    AGENCY_LOCAL_GPU_ENABLED: "false",
  });
}

type Call = { method: string; url: string; headers: Record<string, string>; body?: string };

function harness(handler: (call: Call) => { status: number; body: string }, environment: "staging" | "production" = "staging", enabled = true) {
  const calls: Call[] = [];
  let nonce = 0;
  const client = new LocalGpuCloudAdapter(config(environment, enabled), async (call) => {
    calls.push(call);
    return handler(call);
  }, { now: () => now, nonce: () => `nonce-${++nonce}` });
  return { client, calls };
}

const expiresAtMs = Date.parse("2026-10-07T04:02:00.000Z");

function signedFields(environment: "staging" | "production" = "staging") {
  return {
    v: 1 as const,
    environment,
    action: LOCAL_GPU_SUBMIT_ACTION,
    jobId: id(70),
    workspaceId: id(3),
    actorId: id(16),
    authority: "SUPERADMIN",
    workflow: "MINIMAX_H3_R2V",
    sceneExecutionId: id(9),
    expiresAt: expiresAtMs,
    nonce: "nonce-1",
    uploadBinding: {},
  };
}

const DUMMY_CAPABILITIES_CLAIMS = {
  v: 1 as const,
  environment: "production" as const,
  action: LOCAL_GPU_CAPABILITIES_ACTION,
  jobId: id(70),
  workspaceId: id(3),
  actorId: id(16),
  authority: "SUPERADMIN",
  workflow: "",
  sceneExecutionId: "",
  expiresAt: expiresAtMs,
  nonce: "nonce-1",
  uploadBinding: {},
};
const DESKTOP_DUMMY_PAYLOAD = "eyJ2IjoxLCJlbnZpcm9ubWVudCI6InByb2R1Y3Rpb24iLCJhY3Rpb24iOiJjYXBhYmlsaXRpZXMiLCJqb2JJZCI6IjAwMDAwMDcwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMCIsIndvcmtzcGFjZUlkIjoiMDAwMDAwMDMtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAwIiwiYWN0b3JJZCI6IjAwMDAwMDE2LTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMCIsImF1dGhvcml0eSI6IlNVUEVSQURNSU4iLCJ3b3JrZmxvdyI6IiIsInNjZW5lRXhlY3V0aW9uSWQiOiIiLCJleHBpcmVzQXQiOjE3OTEzNDU3MjAwMDAsIm5vbmNlIjoibm9uY2UtMSIsInVwbG9hZEJpbmRpbmciOnt9fQ";
const DESKTOP_DUMMY_SIGNATURE = "ansdm4e94jw7GeqUCdtgMN9wmX0JRzyvrXBXg_it5bI";

describe("LOCAL_GPU cloud adapter", () => {
  it("keeps the provider disabled until the environment enables it", async () => {
    const { client, calls } = harness(() => ({ status: 500, body: "" }), "staging", false);
    await expect(client.health()).resolves.toMatchObject({ state: "DISABLED", providerId: "LOCAL_GPU" });
    await expect(client.submit({
      actor: actor(),
      package: pkg(),
      recommendedDurationAuthority: { decision: { plannedDurationMs: 5000 } },
      workerWorkflows: ["MINIMAX_H3_R2V"],
    })).rejects.toThrow("LOCAL_GPU_PROVIDER_DISABLED");
    expect(calls).toHaveLength(0);
  });

  it("requires a server-side secret and never redacts it into logs", () => {
    expect(() => config("staging", true, null)).toThrow("LOCAL_GPU_SIGNING_SECRET_REQUIRED");
    const redacted = redactLocalGpuConfig(config());
    expect(redacted.signingSecret).toBe("[REDACTED]");
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(readFileSync(join(root, ".env.example"), "utf8")).not.toMatch(/LOCAL_GPU_SIGNING_SECRET=\S+/);
    expect(assertDistinctLocalGpuSecrets(secret, productionSecret)).toBeUndefined();
    expect(() => assertDistinctLocalGpuSecrets(secret, secret)).toThrow("LOCAL_GPU_SECRETS_MUST_DIFFER");
  });

  it("maps health success and failure without a browser call", async () => {
    const ok = harness(() => ({ status: 200, body: JSON.stringify({ status: "ok", comfyui: "reachable" }) }));
    await expect(ok.client.health()).resolves.toMatchObject({ state: "AVAILABLE" });
    expect(ok.calls[0]?.url).toBe("https://local-gpu.embersoullabs.com/health");
    expect(ok.calls[0]?.headers.authorization).toBeUndefined();
    const failed = harness(() => { throw new Error("socket"); });
    await expect(failed.client.health()).resolves.toMatchObject({ state: "UNAVAILABLE" });
  });

  it("parses worker capabilities", async () => {
    const { client, calls } = harness(() => ({ status: 200, body: JSON.stringify({ workflows: [{ id: "MINIMAX_H3_R2V" }] }) }));
    await expect(client.capabilities({ actor: actor(), workspaceId: id(3), workflow: "CAPABILITIES" })).resolves.toEqual({
      workflows: ["MINIMAX_H3_R2V"],
    });
    const token = calls[0]?.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as { uploadBinding: unknown };
    expect(claims.uploadBinding).toEqual({});
  });

  it("allows only an active superadmin grant", () => {
    expect(() => assertLocalGpuAccess(actor(), { workspaceId: id(3) })).not.toThrow();
    expect(() => assertLocalGpuAccess(actor("DENIED"), { workspaceId: id(3) })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => assertLocalGpuAccess(actor("BOOTSTRAP_ELIGIBLE"), { workspaceId: id(3) })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => assertLocalGpuAccess(actor("DENIED", "agency"), { workspaceId: id(3) }, { agencyLocalGpuEnabled: false })).toThrow("LOCAL_GPU_ACCESS_DENIED");
    expect(() => assertLocalGpuAccess({ ...actor("DENIED"), isSuperadmin: true } as never, { workspaceId: id(3) })).toThrow("LOCAL_GPU_CLIENT_AUTHORITY_REJECTED");
  });

  it("signs environment, nonce, and epoch-millisecond expiry over the base64url payload", () => {
    const staging = signLocalGpuRequest(secret, signedFields("staging"));
    const reordered = signLocalGpuRequest(secret, {
      uploadBinding: {},
      nonce: "nonce-1",
      expiresAt: expiresAtMs,
      sceneExecutionId: id(9),
      workflow: "MINIMAX_H3_R2V",
      authority: "SUPERADMIN",
      actorId: id(16),
      workspaceId: id(3),
      jobId: id(70),
      action: LOCAL_GPU_SUBMIT_ACTION,
      environment: "staging",
      v: 1,
    });
    const production = signLocalGpuRequest(productionSecret, signedFields("production"));
    expect(staging).toEqual(reordered);
    expect(Object.keys(JSON.parse(staging.canonicalPayload))).toEqual([...LOCAL_GPU_CLAIM_ORDER]);
    expect(staging.canonicalPayload).toContain('"environment":"staging"');
    expect(staging.canonicalPayload).toContain('"nonce":"nonce-1"');
    expect(staging.canonicalPayload).toContain(`"expiresAt":${expiresAtMs}`);
    expect(staging.canonicalPayload).not.toContain("2026-10-07T04:02:00.000Z");
    expect(staging.signature).toBe(createHmac("sha256", Buffer.from(secret, "utf8")).update(staging.payload, "utf8").digest("base64url"));
    expect(staging.signature).not.toBe(createHmac("sha256", secret).update(staging.canonicalPayload, "utf8").digest("hex"));
    expect(staging.token).toBe(`Bearer ${staging.payload}.${staging.signature}`.replace(/^Bearer /, ""));
    expect(staging.payload.includes("=")).toBe(false);
    expect(staging.signature.includes("=")).toBe(false);
    expect(staging.signature).not.toBe(production.signature);
    expect(staging.token).not.toContain(secret);
    expect(staging.token).not.toContain("GET");
    expect(staging.token).not.toContain("/v1/");
    expect(canonicalLocalGpuSigningPayload(signedFields("staging"))).toBe(staging.canonicalPayload);
    expect(() => assertLocalGpuRequestExpiry(now.getTime() - 1, now)).toThrow("LOCAL_GPU_REQUEST_EXPIRY_INVALID");
    expect(() => assertLocalGpuRequestExpiry(now.getTime() + 600_001, now)).toThrow("LOCAL_GPU_REQUEST_EXPIRY_INVALID");
    const signer = readFileSync(join(root, "packages/agents/src/ai-story/local-gpu-signing.ts"), "utf8");
    expect(signer).toContain('Buffer.from(secret, "utf8")');
    expect(signer).not.toContain('Buffer.from(secret, "hex")');
    expect(signer).not.toContain("hexToBytes");
    expect(signer).not.toContain("decodeHex");
  });

  it("matches the public desktop dummy capabilities vector byte for byte", () => {
    const signed = signLocalGpuRequest(LOCAL_GPU_PUBLIC_DUMMY_SIGNING_SECRET, DUMMY_CAPABILITIES_CLAIMS);
    expect(signed.payload).toBe(DESKTOP_DUMMY_PAYLOAD);
    expect(signed.signature).toBe(DESKTOP_DUMMY_SIGNATURE);
    expect(signed.token).toBe(`${DESKTOP_DUMMY_PAYLOAD}.${DESKTOP_DUMMY_SIGNATURE}`);
    expect(LOCAL_GPU_PUBLIC_DUMMY_SIGNING_SECRET).not.toBe(secret);
    expect(LOCAL_GPU_PUBLIC_DUMMY_SIGNING_SECRET).not.toBe(productionSecret);
    const decoded = JSON.parse(Buffer.from(signed.payload, "base64url").toString("utf8")) as {
      action: string;
      environment: string;
      expiresAt: number;
    };
    expect(decoded.action).toBe("capabilities");
    expect(decoded.environment).toBe("production");
    expect(decoded.expiresAt).toBe(expiresAtMs);
    expect(signed.canonicalPayload).not.toContain("/v1/capabilities");
  });

  it("maps the certified execution package without recalculating duration or collapsing references", async () => {
    const authority = Object.freeze({ decision: Object.freeze({ plannedDurationMs: 5000 }) });
    const { client, calls } = harness(() => ({ status: 202, body: JSON.stringify({ state: "QUEUED" }) }));
    const receipt = await client.submit({
      actor: actor(),
      package: pkg(),
      recommendedDurationAuthority: authority,
      workerWorkflows: ["MINIMAX_H3_R2V"],
      audioExpectationKind: "SILENT_OUTPUT",
      references: [approvedReference("CHARACTER"), approvedReference("PRODUCT", "https://storage.example.test/product.png")],
      upload: secureUpload(),
      pinnedVoiceDna: {
        voiceDnaId: id(60),
        voiceDnaFingerprint: hash,
        status: "APPROVED",
        performanceInstruction: "Warm and exact.",
      },
    });
    expect(localGpuPlannedDurationMs(authority)).toBe(5000);
    expect(authority.decision.plannedDurationMs).toBe(5000);
    const body = JSON.parse(calls[0]!.body!);
    expect(body).toMatchObject({
      environment: "staging",
      workflow: "MINIMAX_H3_R2V",
      durationSec: 5,
      durationSource: "RECOMMENDED_DURATION_AUTHORITY",
      audioPolicy: "REMOVE_AUDIO",
      prompt: "A deterministic synthetic Scene.",
      aspectRatio: "9:16",
      voiceInstructions: "Warm and exact.",
    });
    expect(body.references).toHaveLength(2);
    expect(body.upload).toMatchObject({ environment: "staging", method: "PUT", url: uploadUrl });
    expect(body.authority).toBeUndefined();
    expect(body.uploadBinding).toBeUndefined();
    expect(body.plannedDurationMs).toBeUndefined();
    expect(body.actorId).toBeUndefined();
    expect(body.characterReferences).toBeUndefined();
    expect(body.productReferences).toBeUndefined();
    expect(body.voiceDna).toBeUndefined();
    expect(body.generationMode).toBeUndefined();
    const token = calls[0]?.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as { uploadBinding: string; authority: string };
    expect(claims.authority).toBe("SUPERADMIN");
    expect(claims.uploadBinding).toBe(localGpuUploadBindingDigest(body.upload));
    expect(claims.uploadBinding).toBe(createHash("sha256").update(`staging\nPUT\n${uploadUrl}`, "utf8").digest("hex"));
    expect(body.class_type).toBeUndefined();
    expect(calls[0]?.headers.authorization?.startsWith("Bearer ")).toBe(true);
    expect(receipt).toMatchObject({
      providerId: "LOCAL_GPU",
      state: "QUEUED",
      automaticGenerationRetry: 0,
      remoteProviderFallback: 0,
      plannedDurationMs: 5000,
    });
    expect(mapLocalGpuAudioPolicy({ generateAudio: true, audioBlocked: false, expectationKind: "NATIVE_CHARACTER_DIALOGUE" })).toBe("NATIVE");
    expect(mapLocalGpuAudioPolicy({ generateAudio: false, audioBlocked: true, expectationKind: "PRESERVE_SOURCE_AUDIO" })).toBe("PRESERVE");
    expect(selectLocalGpuReferences({
      packageReferences: [],
      characterReferencePack: null,
      predecessorAuthorityPresent: true,
      predecessorFrame: { assetId: id(80), contentHash: hash },
    }).predecessorFrame?.assetId).toBe(id(80));
    expect(selectLocalGpuReferences({
      packageReferences: [],
      predecessorAuthorityPresent: false,
      predecessorFrame: { assetId: id(80), contentHash: hash },
    }).predecessorFrame).toBeNull();
  });

  it("normalizes status, cancel, and result without retry or filesystem identity", async () => {
    const scope = { actor: actor(), workspaceId: id(3), workflow: "MINIMAX_H3_R2V", sceneExecutionId: id(9), storyId: id(5), storyVersionId: id(6) };
    const failed = harness(() => ({ status: 200, body: JSON.stringify({ state: "FAILED" }) }));
    const status = await failed.client.status(id(70), scope);
    expect(status.disposition).toEqual({ state: "FAILED", automaticGenerationRetry: 0, remoteProviderFallback: null });
    expect(failed.calls).toHaveLength(1);
    const cancel = harness((call) => ({
      status: 200,
      body: JSON.stringify({ state: call.url.endsWith("/cancel") ? "CANCELLED" : "QUEUED" }),
    }));
    await expect(cancel.client.cancel(id(70), scope)).resolves.toEqual({ jobId: id(70), confirmed: true, state: "CANCELLED" });
    const unconfirmed = harness(() => ({ status: 202, body: JSON.stringify({ accepted: true }) }));
    await expect(unconfirmed.client.cancel(id(70), scope)).resolves.toMatchObject({ confirmed: false, state: "CANCELLATION_REQUESTED" });
    const result = harness(() => ({
      status: 200,
      body: JSON.stringify({
        state: "COMPLETED",
        contentHash: hash,
        durationMs: 5167,
        width: 720,
        height: 1280,
        fps: 24,
        hasAudio: false,
        path: "C:\\ComfyUI\\output\\clip.mp4",
      }),
    }));
    const media = await result.client.result(id(70), scope);
    expect(media).toMatchObject({ contentHash: hash, durationMs: 5167, width: 720, height: 1280, fps: 24, hasAudio: false });
    expect(media).not.toHaveProperty("path");
  });

  it("hands a completed worker result to Generation Result, Audio QC, and Post-QC without approval", async () => {
    const authority = { decision: { plannedDurationMs: 5000 } };
    const result = materializeLocalGpuGenerationResult({
      package: pkg(),
      serverEnvironment: "staging",
      jobId: id(70),
      workflow: "MINIMAX_H3_R2V",
      audioPolicy: "REMOVE_AUDIO",
      plannedDurationMs: localGpuPlannedDurationMs(authority),
      animationPackageId: id(17),
      sceneId: "scene-1",
      sceneOrder: 0,
      assetId: id(15),
      contentHash: hash,
      byteSize: 2000,
      actualDurationMs: 5167,
      width: 720,
      height: 1280,
      fps: 24,
      hasAudio: false,
      createdAt: now.toISOString(),
    });
    expect(authority.decision.plannedDurationMs).toBe(5000);
    expect(result.source).toEqual({
      sourceKind: "LOCAL_GPU_WORKER",
      providerAttemptId: null,
      localGenerationOutputId: null,
      localWorkerOutputId: result.source.localWorkerOutputId,
    });
    expect(result.media.durationMs).toBe(5167);
    expect(result.inputAuthority).toMatchObject({ plannedDurationMs: 5000, actualDurationMs: 5167, localGpuEnvironment: "staging" });
    expect(result.media.storagePath.startsWith(`${id(3)}/`)).toBe(true);
    expect(() => assertLocalGpuResultEnvironment("production", "staging")).toThrow("LOCAL_GPU_ENVIRONMENT_ISOLATION");
    const handoff = handoffLocalGpuToExistingReview({
      result,
      package: pkg(),
      audioQcExpectationKind: "SILENT_OUTPUT",
    });
    expect(handoff.autoApproved).toBe(false);
    expect(handoff.automaticGenerationRetry).toBe(0);
    expect(handoff.remoteProviderFallback).toBe(0);
    expect(handoff.audioQcExpectationKind).toBe("SILENT_OUTPUT");
    expect(AI_STORY_AUDIO_QC_EXPECTATION_KINDS).toEqual([
      "SILENT_OUTPUT",
      "NATIVE_CHARACTER_DIALOGUE",
      "TTS_SPEECH",
      "FINAL_AUDIO_MIX",
      "PRESERVE_SOURCE_AUDIO",
    ]);
    expect(handoff.postQcInput.sourceKind).toBe("LOCAL_GPU_WORKER");
    expect(() => assertGenerationResultApproval(result, null)).toThrow("POST_QC_REQUIRED");
    const evaluation = (await new AiStoryPostGenerationQcService({
      repository: new InMemoryAiStoryPostGenerationQcRepository(),
      evidenceProvider: new FakeAiStoryVisualEvidenceProvider([]),
      now: () => now.toISOString(),
    }).evaluate(handoff.postQcInput)).evaluation;
    expect(evaluation.generationResultId).toBe(result.generationResultId);
    expect(evaluation.providerAttemptId).toBeNull();
    expect("decision" in handoff).toBe(false);
  });

  it("registers LOCAL_GPU outside the remote provider registry", async () => {
    const registry = createLocalGpuProviderRegistry(config());
    expect(registry.get(LOCAL_GPU_PROVIDER_ID)).toMatchObject({
      providerId: "LOCAL_GPU",
      executionClass: "LOCAL_GPU",
      remoteProvider: false,
      automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
      remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
      environment: "staging",
      baseUrl: "https://local-gpu.embersoullabs.com",
      agencyEnabled: false,
    });
    const production = await createProductionProviderRegistry(new MemoryPayloadResolver()).snapshot();
    expect(production.declarations.map((item) => item.providerId)).not.toContain("LOCAL_GPU");
    const source = ["local-gpu-adapter.ts", "local-gpu-handoff.ts", "local-gpu-signing.ts"].map((file) => readFileSync(join(root, "packages/agents/src/ai-story", file), "utf8")).join("\n");
    expect(source).not.toContain("seedance");
    expect(source).not.toContain("runway");
  });

  it("does not infer the environment from the shared URL", () => {
    const staging = config("staging");
    const production = config("production");
    expect(staging.baseUrl).toBe(production.baseUrl);
    expect(staging.environment).toBe("staging");
    expect(production.environment).toBe("production");
    expect(() => loadLocalGpuConfigFromEnv({
      LOCAL_GPU_PROVIDER_ENABLED: "true",
      LOCAL_GPU_BASE_URL: "https://local-gpu.embersoullabs.com",
      LOCAL_GPU_SIGNING_SECRET: secret,
    })).toThrow("LOCAL_GPU_ENVIRONMENT_REQUIRED");
  });

  it("keeps a non-2xx Desktop response as a redacted structured failure and does not retry", async () => {
    const failure = readLocalGpuUpstreamFailure(422, {
      code: "WORKFLOW_REJECTED",
      message: "Bearer secret-token workflow is not allowed https://user:password@uploads.example/put",
      correlationId: "corr-8c268e0f",
      authorization: "Bearer raw-token",
      signature: "raw-signature",
    });
    expect(failure).toEqual({
      code: "LOCAL_GPU_SUBMIT_FAILED",
      httpStatus: 422,
      upstreamCode: "WORKFLOW_REJECTED",
      upstreamMessage: "[REDACTED] workflow is not allowed [REDACTED]",
      correlationId: "corr-8c268e0f",
    });
    expect(JSON.stringify(failure)).not.toContain("secret-token");
    expect(JSON.stringify(failure)).not.toContain("password");
    expect(JSON.stringify(failure)).not.toContain("raw-token");
    expect(JSON.stringify(failure)).not.toContain("raw-signature");
    const nested = readLocalGpuUpstreamFailure(401, {
      error: { code: "SIGNATURE_MISMATCH", message: "signature: abc.def" },
      requestId: "req-1",
    });
    expect(nested.upstreamCode).toBe("SIGNATURE_MISMATCH");
    expect(nested.upstreamMessage).toBe("[REDACTED]");
    expect(nested.correlationId).toBe("req-1");
    expect(readLocalGpuUpstreamFailure(500, null)).toMatchObject({
      httpStatus: 500,
      upstreamCode: null,
      upstreamMessage: null,
      correlationId: null,
    });

    const { client, calls } = harness(() => ({
      status: 422,
      body: JSON.stringify({ code: "WORKFLOW_REJECTED", message: "workflow", requestId: "req-submit" }),
    }));
    const rejected = client.submit({
      actor: actor(),
      package: pkg(),
      recommendedDurationAuthority: { decision: { plannedDurationMs: 5000 } },
      workerWorkflows: ["MINIMAX_H3_R2V"],
      references: [approvedReference()],
      upload: secureUpload(),
    });
    await expect(rejected).rejects.toBeInstanceOf(LocalGpuSubmitFailedError);
    await expect(rejected).rejects.toMatchObject({
      message: "LOCAL_GPU_SUBMIT_FAILED",
      failure: {
        code: "LOCAL_GPU_SUBMIT_FAILED",
        httpStatus: 422,
        upstreamCode: "WORKFLOW_REJECTED",
        upstreamMessage: "workflow",
        correlationId: "req-submit",
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://local-gpu.embersoullabs.com/v1/jobs");
  });

  it("accepts one staging submit token and body under Desktop verifier semantics", async () => {
    const { client, calls } = harness(() => ({ status: 202, body: JSON.stringify({ state: "QUEUED" }) }));
    await client.submit({
      actor: actor(),
      package: pkg(),
      recommendedDurationAuthority: { decision: { plannedDurationMs: 5000 } },
      workerWorkflows: ["MINIMAX_H3_R2V"],
      audioExpectationKind: "NATIVE_CHARACTER_DIALOGUE",
      references: [approvedReference()],
      upload: secureUpload(),
    });
    const call = calls[0]!;
    const token = call.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const [payload, signature] = token.split(".");
    expect(payload?.includes("=")).toBe(false);
    expect(signature?.includes("=")).toBe(false);
    expect(signature).toBe(createHmac("sha256", Buffer.from(secret, "utf8")).update(payload!, "utf8").digest("base64url"));
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
    expect(Object.keys(claims)).toEqual([...LOCAL_GPU_CLAIM_ORDER]);
    expect(claims.action).toBe(LOCAL_GPU_SUBMIT_ACTION);
    expect(claims.action).not.toBe("POST");
    expect(String(claims.action)).not.toContain("/v1/jobs");
    expect(claims.environment).toBe("staging");
    expect(claims.workflow).toBe("MINIMAX_H3_R2V");
    expect(claims.authority).toBe("SUPERADMIN");
    expect(claims.uploadBinding).toBe(localGpuUploadBindingDigest({
      environment: "staging",
      method: "PUT",
      url: uploadUrl,
    }));
    expect(typeof claims.expiresAt).toBe("number");
    expect(typeof claims.nonce).toBe("string");
    const body = JSON.parse(call.body!) as Record<string, unknown> & {
      upload: { environment: string; method: string; url: string };
    };
    expect(body.environment).toBe(claims.environment);
    expect(body.jobId).toBe(claims.jobId);
    expect(body.workspaceId).toBe(claims.workspaceId);
    expect(body.actorId).toBeUndefined();
    expect(body.authority).toBeUndefined();
    expect(body.workflow).toBe("MINIMAX_H3_R2V");
    expect(body.workflow).not.toBe("MINIMAX_H3_NATIVE_DIALOGUE");
    expect(body.sceneExecutionId).toBe(claims.sceneExecutionId);
    expect(body.uploadBinding).toBeUndefined();
    expect(body.durationSec).toBe(5);
    expect(body.durationSource).toBe("RECOMMENDED_DURATION_AUTHORITY");
    expect(body.audioPolicy).toBe("NATIVE");
    expect(body.prompt).toBe("A deterministic synthetic Scene.");
    expect(claims.uploadBinding).toBe(localGpuUploadBindingDigest(body.upload));
    expect(Array.isArray(body.references)).toBe(true);
    expect(call.body).not.toContain(secret);
    expect(token).not.toContain(secret);
  });

  it("matches the certified Desktop job contract and rejects incompatible packages before HTTP", async () => {
    const fixture = JSON.parse(readFileSync(join(root, "tests/fixtures/desktop-post-v1-jobs.contract.json"), "utf8")) as {
      action: string;
      workflow: string;
      durationSource: string;
      durationSec: { min: number; max: number };
      referenceCount: { min: number; max: number };
      requiredBodyFields: string[];
      requiredUploadFields: string[];
      requiredReferenceFields: string[];
      forbiddenBodyFields: string[];
    };
    const base = {
      environment: "staging" as const,
      jobId: id(70),
      sceneExecutionId: id(9),
      workspaceId: id(3),
      workflow: "MINIMAX_H3_R2V",
      prompt: "A deterministic synthetic Scene.",
      plannedDurationMs: 5000,
      references: [approvedReference()],
      audioPolicy: "NATIVE",
      upload: secureUpload(),
      generationMode: "TEXT_TO_VIDEO",
    };
    const accepted = buildLocalGpuDesktopSubmit(base);
    expect(fixture.action).toBe("submit");
    expect(fixture.workflow).toBe("MINIMAX_H3_R2V");
    expect(accepted.body.workflow).toBe(fixture.workflow);
    expect(accepted.body.durationSource).toBe(fixture.durationSource);
    expect(accepted.body.durationSec).toBeGreaterThanOrEqual(fixture.durationSec.min);
    expect(accepted.body.durationSec).toBeLessThanOrEqual(fixture.durationSec.max);
    expect(accepted.body.references.length).toBeGreaterThanOrEqual(fixture.referenceCount.min);
    expect(accepted.body.references.length).toBeLessThanOrEqual(fixture.referenceCount.max);
    for (const field of fixture.requiredBodyFields) expect(accepted.body).toHaveProperty(field);
    for (const field of fixture.requiredUploadFields) expect(accepted.body.upload).toHaveProperty(field);
    for (const field of fixture.requiredReferenceFields) expect(accepted.body.references[0]).toHaveProperty(field);
    for (const field of fixture.forbiddenBodyFields) expect(accepted.body).not.toHaveProperty(field);
    expect(accepted.uploadBinding).toBe(localGpuUploadBindingDigest(accepted.body.upload));
    assertLocalGpuUploadBinding(accepted.body.upload, accepted.uploadBinding);

    const two = buildLocalGpuDesktopSubmit({
      ...base,
      references: [approvedReference("CHARACTER"), approvedReference("PRODUCT", "https://storage.example.test/product.png")],
    });
    expect(two.body.references).toHaveLength(2);
    expect(buildLocalGpuDesktopSubmit({ ...base, plannedDurationMs: 5000 }).body.durationSec).toBe(5);
    expect(buildLocalGpuDesktopSubmit({ ...base, plannedDurationMs: 15000 }).body.durationSec).toBe(15);
    expect(buildLocalGpuDesktopSubmit({ ...base, audioPolicy: "NATIVE" }).body.audioPolicy).toBe("NATIVE");
    expect(buildLocalGpuDesktopSubmit({ ...base, audioPolicy: "REMOVE_AUDIO" }).body.audioPolicy).toBe("REMOVE_AUDIO");
    expect(buildLocalGpuDesktopSubmit({ ...base, audioPolicy: "NATIVE" }).body.workflow).not.toBe("MINIMAX_H3_NATIVE_DIALOGUE");

    const binding = accepted.uploadBinding;
    expect(() => assertLocalGpuUploadBinding({ ...accepted.body.upload, environment: "production" }, binding)).toThrow("LOCAL_GPU_UPLOAD_BINDING_MISMATCH");
    expect(() => assertLocalGpuUploadBinding({ ...accepted.body.upload, method: "POST" }, binding)).toThrow("LOCAL_GPU_UPLOAD_BINDING_MISMATCH");
    expect(() => assertLocalGpuUploadBinding({ ...accepted.body.upload, url: `${uploadUrl}?changed=1` }, binding)).toThrow("LOCAL_GPU_UPLOAD_BINDING_MISMATCH");

    expect(() => buildLocalGpuDesktopSubmit({ ...base, references: [] })).toThrow("LOCAL_GPU_REFERENCES_REQUIRED");
    expect(() => buildLocalGpuDesktopSubmit({
      ...base,
      references: [
        approvedReference(),
        approvedReference("PRODUCT", "https://storage.example.test/product.png"),
        { approval: "APPROVED" as const, role: "STYLE" as const, assetUrl: "https://storage.example.test/style.png", contentHash: hash },
      ],
    })).toThrow("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
    expect(() => buildLocalGpuDesktopSubmit({
      ...base,
      references: [{ ...approvedReference(), approval: "PENDING" as "APPROVED" }],
    })).toThrow("LOCAL_GPU_REFERENCE_NOT_APPROVED");
    expect(() => buildLocalGpuDesktopSubmit({
      ...base,
      references: [{ ...approvedReference(), assetUrl: "" }],
    })).toThrow("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    expect(() => buildLocalGpuDesktopSubmit({
      ...base,
      references: [{ ...approvedReference(), contentHash: "" }],
    })).toThrow("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    expect(() => buildLocalGpuDesktopSubmit({ ...base, plannedDurationMs: 4000 })).toThrow("LOCAL_GPU_DURATION_UNSUPPORTED");
    expect(() => buildLocalGpuDesktopSubmit({ ...base, plannedDurationMs: 16000 })).toThrow("LOCAL_GPU_DURATION_UNSUPPORTED");
    expect(() => buildLocalGpuDesktopSubmit({ ...base, workflow: "MINIMAX_H3_NATIVE_DIALOGUE" })).toThrow("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(() => buildLocalGpuDesktopSubmit({ ...base, workflow: "OTHER_WORKFLOW" })).toThrow("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    expect(() => assertLocalGpuPackageCompatibility({
      recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      plannedDurationMs: 4000,
      generationMode: "TEXT_TO_VIDEO",
      references: [],
      audioPolicy: "NATIVE",
    })).toThrow("LOCAL_GPU_DURATION_UNSUPPORTED");

    const denied = harness(() => ({ status: 202, body: JSON.stringify({ state: "QUEUED" }) }));
    await expect(denied.client.submit({
      actor: actor(),
      package: pkg(),
      recommendedDurationAuthority: { decision: { plannedDurationMs: 4000 } },
      workerWorkflows: ["MINIMAX_H3_R2V"],
      references: [approvedReference()],
      upload: secureUpload(),
    })).rejects.toThrow("LOCAL_GPU_DURATION_UNSUPPORTED");
    await expect(denied.client.submit({
      actor: actor(),
      package: pkg(),
      recommendedDurationAuthority: { decision: { plannedDurationMs: 5000 } },
      workerWorkflows: ["MINIMAX_H3_R2V"],
      references: [],
      upload: secureUpload(),
    })).rejects.toThrow("LOCAL_GPU_REFERENCES_REQUIRED");
    expect(denied.calls).toHaveLength(0);
    expect(JSON.stringify(accepted.body)).not.toContain("Authorization");
    expect(accepted.uploadBinding).not.toContain(uploadUrl);
  });
});
