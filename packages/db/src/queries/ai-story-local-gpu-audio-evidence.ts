import { eq } from "drizzle-orm";
import {
  LocalGpuAudioEvidenceSchema,
  LocalGpuGenerationInputAuthoritySchema,
  type AiStoryGenerationResult,
  type AiStoryPostGenerationQcEvaluation,
  type LocalGpuAudioEvidence,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash, deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";

type AudioDb = Pick<ReturnType<typeof getDb>, "insert" | "select">;

function workerOutputHasAudio(result: AiStoryGenerationResult): boolean {
  const authority = LocalGpuGenerationInputAuthoritySchema.parse(result.inputAuthority);
  if (
    authority.workspaceId !== result.ownership.workspaceId
    || authority.sceneExecutionId !== result.sceneExecutionId
    || authority.localGpuJobId.length === 0
  ) {
    throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_MISMATCH");
  }
  return authority.hasAudio;
}

/** Local output deliveries carry the frozen package audio policy; media validation already enforced it. */
function localOutputHasAudio(result: AiStoryGenerationResult): boolean {
  const { generateAudio, audioBlocked } = result.inputAuthority;
  if (typeof generateAudio !== "boolean" || typeof audioBlocked !== "boolean") {
    throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_MISMATCH");
  }
  return generateAudio && !audioBlocked;
}

/** Derived from the immutable Generation Result. Callers do not supply the speech finding. */
export function deriveLocalGpuAudioEvidence(result: AiStoryGenerationResult): LocalGpuAudioEvidence {
  if (result.source.sourceKind !== "LOCAL_GPU_WORKER") throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_MISMATCH");
  const hasAudio = result.source.localGenerationOutputId !== null
    ? localOutputHasAudio(result)
    : workerOutputHasAudio(result);
  const speechContent = hasAudio ? "HUMAN_REVIEW_REQUIRED" as const : "NOT_APPLICABLE" as const;
  const facts = {
    orgId: result.ownership.orgId,
    workspaceId: result.ownership.workspaceId,
    executionPlanId: result.ownership.executionPlanId,
    sceneExecutionId: result.sceneExecutionId,
    generationResultId: result.generationResultId,
    assetId: result.media.assetId,
    contentHash: result.media.contentHash,
    hasAudio,
    speechContent,
  };
  return LocalGpuAudioEvidenceSchema.parse({
    ...facts,
    audioEvidenceId: deterministicPersistenceUuid("local-gpu-audio-evidence.v1", {
      generationResultId: result.generationResultId,
    }),
    evidenceFingerprint: canonicalPersistenceHash(facts),
  });
}

export function stampLocalGpuAudioEvidence<T extends {
  audioEvidenceId?: string;
  generationResultId?: string;
  workspaceId?: string;
  mediaContentHash?: string;
}>(evaluation: T, evidence: LocalGpuAudioEvidence): T & {
  audioEvidenceId: string;
  audioEvidenceFingerprint: string;
  audioSpeechContent: LocalGpuAudioEvidence["speechContent"];
} {
  if (
    (evaluation.generationResultId && evaluation.generationResultId !== evidence.generationResultId)
    || (evaluation.workspaceId && evaluation.workspaceId !== evidence.workspaceId)
    || (evaluation.mediaContentHash && evaluation.mediaContentHash !== evidence.contentHash)
    || (evaluation.audioEvidenceId && evaluation.audioEvidenceId !== evidence.audioEvidenceId)
  ) {
    throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_DROPPED");
  }
  return {
    ...evaluation,
    audioEvidenceId: evidence.audioEvidenceId,
    audioEvidenceFingerprint: evidence.evidenceFingerprint,
    audioSpeechContent: evidence.speechContent,
  };
}

export function assertLocalGpuAudioApproval(
  result: AiStoryGenerationResult,
  qc: AiStoryPostGenerationQcEvaluation | null,
  stored: LocalGpuAudioEvidence | null,
): void {
  if (result.source.sourceKind !== "LOCAL_GPU_WORKER") return;
  const expected = deriveLocalGpuAudioEvidence(result);
  if (!stored) throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_REQUIRED");
  if (stored.workspaceId !== result.ownership.workspaceId || stored.workspaceId !== expected.workspaceId) {
    throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
  }
  if (
    stored.generationResultId !== result.generationResultId
    || stored.assetId !== result.media.assetId
    || stored.contentHash !== result.media.contentHash
    || stored.evidenceFingerprint !== expected.evidenceFingerprint
    || stored.audioEvidenceId !== expected.audioEvidenceId
  ) {
    throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_MISMATCH");
  }
  if (
    !qc
    || qc.generationResultId !== result.generationResultId
    || qc.workspaceId !== result.ownership.workspaceId
    || qc.audioEvidenceId !== stored.audioEvidenceId
    || qc.audioEvidenceFingerprint !== stored.evidenceFingerprint
    || qc.audioSpeechContent !== stored.speechContent
  ) {
    throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_DROPPED");
  }
  if (stored.hasAudio && stored.speechContent !== "HUMAN_REVIEW_REQUIRED") {
    throw new Error("LOCAL_GPU_AUDIO_SPEECH_CONTENT_INVALID");
  }
  if (!stored.hasAudio && stored.speechContent !== "NOT_APPLICABLE") {
    throw new Error("LOCAL_GPU_AUDIO_SPEECH_CONTENT_INVALID");
  }
  if (qc.autoApproved !== false) throw new Error("LOCAL_GPU_AUDIO_AUTO_APPROVAL_DENIED");
}

/** The decision-linked evaluation resolves the stored finding. A missing stamp stays unresolved. */
export function resolveLinkedAudioEvidence(
  evaluation: Pick<AiStoryPostGenerationQcEvaluation, "audioEvidenceId" | "audioEvidenceFingerprint" | "audioSpeechContent" | "generationResultId" | "workspaceId"> | null,
  stored: LocalGpuAudioEvidence | null,
): LocalGpuAudioEvidence | null {
  if (!evaluation?.audioEvidenceId || !evaluation.audioSpeechContent || !stored) return null;
  if (
    evaluation.audioEvidenceId !== stored.audioEvidenceId
    || evaluation.audioEvidenceFingerprint !== stored.evidenceFingerprint
    || evaluation.audioSpeechContent !== stored.speechContent
    || evaluation.generationResultId !== stored.generationResultId
    || evaluation.workspaceId !== stored.workspaceId
  ) {
    throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_MISMATCH");
  }
  return stored;
}

export function localGpuDecisionDisposition(
  existing: { decision: string; actorUserId: string } | null,
  incoming: { decision: string },
): "insert" | "replay" {
  if (!existing) return "insert";
  if (existing.decision !== incoming.decision) throw new Error("GENERATION_RESULT_DECISION_IMMUTABLE_CONFLICT");
  return "replay";
}

export class LocalGpuAudioEvidenceRepository {
  constructor(private readonly db: AudioDb = getDb()) {}

  async get(workspaceId: string, generationResultId: string): Promise<LocalGpuAudioEvidence | null> {
    const [row] = await this.db.select().from(schema.aiStoryLocalGpuAudioEvidence).where(
      eq(schema.aiStoryLocalGpuAudioEvidence.generationResultId, generationResultId),
    ).limit(1);
    if (!row) return null;
    if (row.workspaceId !== workspaceId) throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
    return LocalGpuAudioEvidenceSchema.parse(row.fact);
  }

  async record(evidence: LocalGpuAudioEvidence): Promise<LocalGpuAudioEvidence> {
    const parsed = LocalGpuAudioEvidenceSchema.parse(evidence);
    await this.db.insert(schema.aiStoryLocalGpuAudioEvidence).values({
      audioEvidenceId: parsed.audioEvidenceId,
      orgId: parsed.orgId,
      workspaceId: parsed.workspaceId,
      executionPlanId: parsed.executionPlanId,
      sceneExecutionId: parsed.sceneExecutionId,
      generationResultId: parsed.generationResultId,
      assetId: parsed.assetId,
      contentHash: parsed.contentHash,
      hasAudio: parsed.hasAudio,
      speechContent: parsed.speechContent,
      evidenceFingerprint: parsed.evidenceFingerprint,
      fact: parsed,
      createdAt: new Date(),
    }).onConflictDoNothing();
    const [row] = await this.db.select().from(schema.aiStoryLocalGpuAudioEvidence).where(
      eq(schema.aiStoryLocalGpuAudioEvidence.generationResultId, parsed.generationResultId),
    ).limit(1);
    const stored = row ? LocalGpuAudioEvidenceSchema.parse(row.fact) : null;
    if (!stored) throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_REQUIRED");
    if (stored.workspaceId !== parsed.workspaceId) throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
    if (stored.evidenceFingerprint !== parsed.evidenceFingerprint || stored.generationResultId !== parsed.generationResultId) {
      throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_CONFLICT");
    }
    return stored;
  }
}

export class InMemoryLocalGpuAudioEvidenceLedger {
  private readonly rows = new Map<string, LocalGpuAudioEvidence>();

  record(evidence: LocalGpuAudioEvidence): LocalGpuAudioEvidence {
    const parsed = LocalGpuAudioEvidenceSchema.parse(evidence);
    const current = this.rows.get(parsed.generationResultId);
    if (!current) {
      this.rows.set(parsed.generationResultId, parsed);
      return parsed;
    }
    if (current.workspaceId !== parsed.workspaceId) throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
    if (current.evidenceFingerprint !== parsed.evidenceFingerprint) throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_CONFLICT");
    return current;
  }

  get(workspaceId: string, generationResultId: string): LocalGpuAudioEvidence | null {
    const row = this.rows.get(generationResultId);
    if (!row) return null;
    if (row.workspaceId !== workspaceId) throw new Error("LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH");
    return row;
  }
}
