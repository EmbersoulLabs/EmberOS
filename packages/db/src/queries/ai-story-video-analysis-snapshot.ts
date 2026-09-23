import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  AI_STORY_VIDEO_ANALYSIS_TYPE,
  parseStoredVideoAnalysisSnapshot,
  type AiStoryVideoAnalysisReuseKey,
  type AiStoryVideoAnalysisSnapshotRecord,
  type AiStoryVideoAnalysisSnapshotRepository,
  type AiStoryVideoProviderAttemptEvidence,
} from "@ceo-agent/shared";

type SnapshotRow = {
  id: string;
  org_id: string;
  workspace_id: string;
  asset_id: string;
  asset_content_hash: string;
  analysis_type: string;
  analysis_version: string;
  extractor_version: string;
  observation_json: unknown;
  analysis_json: unknown;
  provider_id: string;
  model_id: string;
  requested_model_id: string | null;
  provider_model_id: string | null;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  input_fingerprint: string;
  cost_usd: string | number;
  created_at: Date | string;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

function mapSnapshot(row: SnapshotRow): AiStoryVideoAnalysisSnapshotRecord {
  return parseStoredVideoAnalysisSnapshot({
    id: row.id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    assetId: row.asset_id,
    assetContentHash: row.asset_content_hash,
    analysisType: row.analysis_type,
    analysisVersion: row.analysis_version,
    extractorVersion: row.extractor_version,
    observation: row.observation_json,
    analysis: row.analysis_json,
    providerId: row.provider_id,
    modelId: row.model_id,
    requestedModelId: row.requested_model_id ?? row.model_id,
    providerModelId: row.provider_model_id,
    providerRequestId: row.provider_request_id,
    inputTokens: Number(row.input_tokens ?? 0),
    outputTokens: Number(row.output_tokens ?? 0),
    inputFingerprint: row.input_fingerprint,
    costUsd: Number(row.cost_usd),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  });
}

async function selectSnapshot(sql: Sql, key: AiStoryVideoAnalysisReuseKey): Promise<AiStoryVideoAnalysisSnapshotRecord | null> {
  const rows = await sql<SnapshotRow[]>`
    SELECT id, org_id, workspace_id, asset_id, asset_content_hash, analysis_type, analysis_version,
           extractor_version, observation_json, analysis_json, provider_id, model_id,
           requested_model_id, provider_model_id, provider_request_id, input_tokens, output_tokens,
           input_fingerprint, cost_usd, created_at
    FROM ai_story_video_analysis_snapshots
    WHERE workspace_id = ${key.workspaceId}
      AND asset_id = ${key.assetId}
      AND asset_content_hash = ${key.assetContentHash}
      AND analysis_version = ${key.analysisVersion}
      AND extractor_version = ${key.extractorVersion}
    LIMIT 1
  `;
  return rows[0] ? mapSnapshot(rows[0]) : null;
}

export function createSqlVideoAnalysisSnapshotRepository(
  sql: Sql,
  options?: { readonly sleep?: (ms: number) => Promise<void> },
): AiStoryVideoAnalysisSnapshotRepository {
  const sleep = options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  return {
    findSucceededSnapshot(key) {
      return selectSnapshot(sql, key);
    },
    async tryClaim(input) {
      const claimId = randomUUID();
      try {
        await sql`
          INSERT INTO ai_story_video_analysis_claims (
            id, org_id, workspace_id, asset_id, asset_content_hash, analysis_type,
            analysis_version, extractor_version, status
          ) VALUES (
            ${claimId}, ${input.orgId}, ${input.workspaceId}, ${input.assetId}, ${input.assetContentHash},
            ${AI_STORY_VIDEO_ANALYSIS_TYPE}, ${input.analysisVersion}, ${input.extractorVersion}, 'CLAIMED'
          )
        `;
        return { acquired: true as const, claimId };
      } catch (error) {
        if (isUniqueViolation(error)) return { acquired: false as const };
        throw error;
      }
    },
    async waitForSettlement(key) {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const claims = await sql<{ status: string; snapshot_id: string | null }[]>`
          SELECT status, snapshot_id
          FROM ai_story_video_analysis_claims
          WHERE workspace_id = ${key.workspaceId}
            AND asset_id = ${key.assetId}
            AND asset_content_hash = ${key.assetContentHash}
            AND analysis_version = ${key.analysisVersion}
            AND extractor_version = ${key.extractorVersion}
            AND status IN ('CLAIMED', 'SUCCEEDED')
          ORDER BY created_at DESC
          LIMIT 1
        `;
        const claim = claims[0];
        if (!claim) return { snapshot: null, failed: true };
        if (claim.status === "SUCCEEDED") {
          return { snapshot: await selectSnapshot(sql, key), failed: false };
        }
        await sleep(40);
      }
      return { snapshot: null, failed: false };
    },
    async insertSnapshot(row) {
      await sql`
        INSERT INTO ai_story_video_analysis_snapshots (
          id, org_id, workspace_id, asset_id, asset_content_hash, analysis_type, analysis_version,
          extractor_version, observation_json, analysis_json, provider_id, model_id, requested_model_id,
          provider_model_id, provider_request_id, input_tokens, output_tokens, input_fingerprint,
          cost_usd, created_at
        ) VALUES (
          ${row.id}, ${row.orgId}, ${row.workspaceId}, ${row.assetId}, ${row.assetContentHash},
          ${row.analysisType}, ${row.analysisVersion}, ${row.extractorVersion},
          ${sql.json(row.observation as never)}, ${sql.json(row.analysis as never)},
          ${row.providerId}, ${row.modelId}, ${row.requestedModelId}, ${row.providerModelId},
          ${row.providerRequestId}, ${row.inputTokens}, ${row.outputTokens}, ${row.inputFingerprint},
          ${row.costUsd}, ${row.createdAt}
        )
      `;
      return row;
    },
    async recordProviderAttempt(claimId, evidence: AiStoryVideoProviderAttemptEvidence) {
      const updated = await sql`
        UPDATE ai_story_video_analysis_claims
        SET provider_id = ${evidence.providerId},
            requested_model_id = ${evidence.requestedModelId},
            provider_model_id = ${evidence.providerModelId},
            provider_request_id = ${evidence.providerRequestId},
            input_tokens = ${evidence.inputTokens},
            output_tokens = ${evidence.outputTokens},
            cost_usd = ${evidence.costUsd},
            attempted_at = ${evidence.attemptedAt},
            updated_at = now()
        WHERE id = ${claimId} AND status = 'CLAIMED'
      `;
      if (updated.count !== 1) {
        throw new Error("VIDEO_ANALYSIS_PROVIDER_ATTEMPT_NOT_RECORDED");
      }
    },
    async completeClaim(claimId, snapshotId) {
      await sql`
        UPDATE ai_story_video_analysis_claims
        SET status = 'SUCCEEDED', snapshot_id = ${snapshotId}, updated_at = now()
        WHERE id = ${claimId} AND status = 'CLAIMED'
      `;
    },
    async failClaim(claimId, errorCode) {
      await sql`
        UPDATE ai_story_video_analysis_claims
        SET status = 'FAILED', error_code = ${errorCode}, updated_at = now()
        WHERE id = ${claimId} AND status = 'CLAIMED'
      `;
    },
  };
}
