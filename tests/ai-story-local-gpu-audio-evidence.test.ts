import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LocalGpuAudioEvidenceSchema,
  LocalGpuGenerationInputAuthoritySchema,
  localGpuResultStoragePath,
  type AiStoryPostGenerationQcEvaluation,
} from "@ceo-agent/shared";
import {
  InMemoryLocalGpuAudioEvidenceLedger,
  assertLocalGpuAudioApproval,
  canonicalPersistenceHash,
  deriveLocalGpuAudioEvidence,
  localGpuDecisionDisposition,
  materializeGenerationResult,
  resolveLinkedAudioEvidence,
  stampLocalGpuAudioEvidence,
} from "@ceo-agent/db";
import { planLocalGpuCompletion } from "../packages/agents/src/ai-story/local-gpu-result-finalization";
import { resolveExplicitLocalGpuProviderAuthority } from "../packages/agents/src/ai-story/local-gpu-access";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const hash = `sha256:${"a".repeat(64)}`;
const contentHash = `sha256:${"b".repeat(64)}`;

function result(hasAudio: boolean) {
  const authority = LocalGpuGenerationInputAuthoritySchema.parse({
    localGpuEnvironment: "staging",
    localGpuJobId: id(31),
    localGpuWorkflow: "DESKTOP_WORKFLOW_UNBOUND",
    workspaceId: id(3),
    storyId: id(5),
    storyVersionId: id(6),
    sceneExecutionId: id(9),
    audioPolicy: hasAudio ? "PRESERVE" : "REMOVE_AUDIO",
    plannedDurationMs: 6000,
    actualDurationMs: 4000,
    fps: 24,
    hasAudio,
    localPackageId: id(1),
    localPackageFingerprint: hash,
    characterAuthority: null,
    productAuthority: null,
    references: [],
    generationMode: "TEXT_TO_VIDEO",
    generateAudio: hasAudio,
    audioBlocked: !hasAudio,
    sourceAuthority: { localSourceAuthorityId: id(30), localSourceAuthorityFingerprint: hash, workspaceId: id(3) },
    planningAuthority: { planningLineageSource: "LEGACY_COMPILED_V1", sceneVersion: 1, scriptVersionId: null, handoffId: null, handoffFingerprint: null },
  });
  const storagePath = localGpuResultStoragePath(id(3), contentHash);
  return materializeGenerationResult({
    ownership: {
      orgId: id(2), workspaceId: id(3), campaignId: id(4), storyId: id(5), storyVersionId: id(6),
      animationPackageId: id(17), executionPlanId: id(7),
    },
    runtimeAuthorizationId: id(8),
    generationUnitId: id(9),
    sceneExecutionId: id(9),
    sceneId: "scene-1",
    sceneOrder: 1,
    source: { sourceKind: "LOCAL_GPU_WORKER", providerAttemptId: null, localGenerationOutputId: null, localWorkerOutputId: id(25) },
    compiledRequestId: null,
    compiledRequestFingerprint: null,
    localSourceAuthorityId: id(30),
    localSourceAuthorityFingerprint: hash,
    inputAuthorityFingerprint: canonicalPersistenceHash(authority),
    inputAuthority: authority,
    media: {
      assetId: id(15), contentHash, durableObjectReference: storagePath, storagePath, byteSize: 2000,
      mediaType: "video/mp4", durationMs: 4000, width: 720, height: 1280, readable: true, decodable: true,
    },
    createdAt: "2026-10-01T00:00:00.000Z",
  });
}

function qc(gpu: ReturnType<typeof result>, evidence: ReturnType<typeof deriveLocalGpuAudioEvidence>, patch: Partial<AiStoryPostGenerationQcEvaluation> = {}) {
  return {
    generationResultId: gpu.generationResultId,
    workspaceId: gpu.ownership.workspaceId,
    audioEvidenceId: evidence.audioEvidenceId,
    audioEvidenceFingerprint: evidence.evidenceFingerprint,
    audioSpeechContent: evidence.speechContent,
    autoApproved: false,
    ...patch,
  } as AiStoryPostGenerationQcEvaluation;
}

describe("LOCAL_GPU audio evidence lineage", () => {
  it("keeps the same speech finding across later evaluations and the linked decision", () => {
    const gpu = result(true);
    const ledger = new InMemoryLocalGpuAudioEvidenceLedger();
    const stored = ledger.record(deriveLocalGpuAudioEvidence(gpu));
    expect(ledger.record(deriveLocalGpuAudioEvidence(gpu)).audioEvidenceId).toBe(stored.audioEvidenceId);
    const first = stampLocalGpuAudioEvidence({ generationResultId: gpu.generationResultId, workspaceId: gpu.ownership.workspaceId, mediaContentHash: gpu.media.contentHash, evaluationVersion: 1 }, stored);
    const second = stampLocalGpuAudioEvidence({ generationResultId: gpu.generationResultId, workspaceId: gpu.ownership.workspaceId, mediaContentHash: gpu.media.contentHash, evaluationVersion: 2 }, stored);
    expect(second.audioEvidenceId).toBe(first.audioEvidenceId);
    expect(second.audioSpeechContent).toBe("HUMAN_REVIEW_REQUIRED");
    expect(resolveLinkedAudioEvidence(qc(gpu, stored), stored)?.speechContent).toBe("HUMAN_REVIEW_REQUIRED");
    assertLocalGpuAudioApproval(gpu, qc(gpu, stored), stored);
    expect(LocalGpuAudioEvidenceSchema.safeParse({ ...stored, speechContent: "PASS" }).success).toBe(false);
    expect(qc(gpu, stored).autoApproved).toBe(false);
  });

  it("blocks missing, mismatched, and cross-workspace evidence, and allows explicit silence", () => {
    const gpu = result(true);
    const stored = deriveLocalGpuAudioEvidence(gpu);
    expect(() => assertLocalGpuAudioApproval(gpu, qc(gpu, stored), null)).toThrow("LOCAL_GPU_AUDIO_EVIDENCE_REQUIRED");
    expect(() => assertLocalGpuAudioApproval(gpu, qc(gpu, stored, { audioEvidenceId: undefined, audioSpeechContent: undefined, audioEvidenceFingerprint: undefined }), stored)).toThrow("LOCAL_GPU_AUDIO_EVIDENCE_DROPPED");
    expect(() => assertLocalGpuAudioApproval(gpu, qc(gpu, stored), { ...stored, generationResultId: id(99) })).toThrow("LOCAL_GPU_AUDIO_EVIDENCE_MISMATCH");
    expect(() => assertLocalGpuAudioApproval(gpu, qc(gpu, stored), { ...stored, workspaceId: id(99) })).toThrow("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
    const ledger = new InMemoryLocalGpuAudioEvidenceLedger();
    ledger.record(stored);
    expect(() => ledger.get(id(99), gpu.generationResultId)).toThrow("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
    const silent = result(false);
    const silentEvidence = deriveLocalGpuAudioEvidence(silent);
    expect(silentEvidence.speechContent).toBe("NOT_APPLICABLE");
    expect(silentEvidence.hasAudio).toBe(false);
    assertLocalGpuAudioApproval(silent, qc(silent, silentEvidence), silentEvidence);
    assertLocalGpuAudioApproval({ source: { sourceKind: "MANUAL_LOCAL" } } as never, null, null);
  });

  it("preserves the first reviewer decision and leaves execution disabled", () => {
    const gpu = result(true);
    const existing = { decision: "APPROVED", actorUserId: id(16) };
    expect(localGpuDecisionDisposition(existing, { decision: "APPROVED" })).toBe("replay");
    expect(() => localGpuDecisionDisposition(existing, { decision: "REJECTED" })).toThrow("GENERATION_RESULT_DECISION_IMMUTABLE_CONFLICT");
    expect(planLocalGpuCompletion({
      jobId: id(31),
      existingResultId: gpu.generationResultId,
      contentHash,
    })).toMatchObject({ action: "reuse", generationResultId: gpu.generationResultId, submit: false });
    expect(() => resolveExplicitLocalGpuProviderAuthority({ requestedProvider: "LOCAL_GPU" })).toThrow("LOCAL_GPU_PROVIDER_DISABLED");
    const execute = readFileSync(join(root, "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"), "utf8");
    const sql = readFileSync(join(root, "packages/db/sql/ai-story-local-gpu-audio-evidence-v1.sql"), "utf8");
    expect(execute).not.toContain("LOCAL_GPU");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sql).not.toMatch(/UPDATE\s+ai_story_post_generation_qc/i);
    const ledger = new InMemoryLocalGpuAudioEvidenceLedger();
    ledger.record(deriveLocalGpuAudioEvidence(gpu));
    expect(() => ledger.record({
      ...deriveLocalGpuAudioEvidence(result(false)),
      generationResultId: gpu.generationResultId,
      audioEvidenceId: deriveLocalGpuAudioEvidence(gpu).audioEvidenceId,
    })).toThrow("LOCAL_GPU_AUDIO_EVIDENCE_CONFLICT");
  });
});
