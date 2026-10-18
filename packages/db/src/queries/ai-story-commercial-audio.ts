import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  commerciallyLicensedTrack,
  decideCommercialAudio,
  selectCommercialBgm,
  LOCAL_GPU_NATIVE_AMBIENT_CERTIFIED,
  LOCAL_GPU_NATIVE_DIALOGUE_CERTIFIED,
  type CommercialAudioDecision,
} from "@ceo-agent/shared";
import { getDb } from "../client";

export class CommercialAudioError extends Error {
  constructor(readonly code: "COMMERCIAL_AUDIO_RETRY_EXHAUSTED" | "COMMERCIAL_AUDIO_TRACK_UNLICENSED" | "COMMERCIAL_AUDIO_NOT_ASSEMBLED" | "MISSING_LICENSED_MUSIC") {
    super(code);
  }
}

export type CommercialAudioAssembly = {
  assemblyId: string;
  generationResultId: string;
  sourceAssetId: string;
  sourceContentHash: string;
  sourceStoragePath: string | null;
  finalPolicy: "EXPLICIT_SILENCE" | "LICENSED_BGM" | "NATIVE_PLUS_BGM";
  generationPolicy: "SILENT_GENERATION" | "NATIVE_PRESERVED";
  bgmTrackId: string | null;
  bgmLicense: string | null;
  bgmLicenseUrl: string | null;
  outputAssetId: string | null;
  outputContentHash: string | null;
  outputStoragePath: string | null;
  hasAudio: boolean;
  state: "PENDING" | "RUNNING" | "ASSEMBLED" | "FAILED" | "SUPERSEDED";
  errorCode: string | null;
  blockers: string[];
};

type DialogueLine = { offscreen?: boolean; text?: string };
type PackageAudioFacts = {
  dialogue?: DialogueLine[];
  prompt?: string;
  worldDescription?: string;
  mustKeep?: string[];
};

const projection = sql`a.assembly_id AS "assemblyId", a.generation_result_id AS "generationResultId",
  a.source_asset_id AS "sourceAssetId", a.source_content_hash AS "sourceContentHash",
  src.storage_path AS "sourceStoragePath", a.final_policy AS "finalPolicy", a.generation_policy AS "generationPolicy",
  a.bgm_track_id AS "bgmTrackId", a.bgm_license AS "bgmLicense", a.bgm_license_url AS "bgmLicenseUrl",
  a.output_asset_id AS "outputAssetId", a.output_content_hash AS "outputContentHash",
  out.storage_path AS "outputStoragePath", a.has_audio AS "hasAudio", a.state, a.error_code AS "errorCode",
  a.blockers, a.org_id AS "orgId", a.workspace_id AS "workspaceId", a.campaign_id AS "campaignId",
  a.execution_plan_id AS "executionPlanId", a.scene_execution_id AS "sceneExecutionId", a.package_id AS "packageId",
  a.actor_user_id AS "actorUserId"`;

function decisionFor(pkg: PackageAudioFacts, explicitSilence: boolean): CommercialAudioDecision {
  const dialogue = pkg.dialogue ?? [];
  return decideCommercialAudio({
    visibleDialogueCount: dialogue.filter((line) => !line.offscreen && line.text?.trim()).length,
    narrationDesired: dialogue.some((line) => line.offscreen),
    explicitSilence,
    nativeDialogueCertified: LOCAL_GPU_NATIVE_DIALOGUE_CERTIFIED,
    nativeAmbientCertified: LOCAL_GPU_NATIVE_AMBIENT_CERTIFIED,
    licensedMusicAvailable: selectCommercialBgm({ brief: pkg.prompt ?? "" }).blocker === null,
    voiceoverAuthorized: false,
  });
}

export class AiStoryCommercialAudioRepository {
  constructor(private readonly db = getDb()) {}

  async describe(input: { workspaceId: string; executionPlanId: string; packageId: string; generationResultId: string }) {
    const [pkgRow] = await this.db.execute(sql`SELECT package FROM ai_story_local_generation_packages
      WHERE workspace_id = ${input.workspaceId} AND execution_plan_id = ${input.executionPlanId} AND package_id = ${input.packageId} LIMIT 1`);
    const pkg = (pkgRow?.package ?? {}) as PackageAudioFacts;
    const brief = [pkg.prompt, pkg.worldDescription, ...(pkg.mustKeep ?? [])].filter(Boolean).join("\n");
    const selected = selectCommercialBgm({ brief });
    return {
      decision: decisionFor(pkg, false),
      assembly: await this.current(input.workspaceId, input.generationResultId),
      recommendation: selected.track ? {
        trackId: selected.track.id,
        name: selected.track.name,
        license: selected.track.license ?? null,
        licenseUrl: selected.track.licenseUrl ?? null,
        alternatives: (selected.recommendation?.alternatives ?? [])
          .map((item) => commerciallyLicensedTrack(item.trackId))
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .slice(0, 6)
          .map((item) => ({ trackId: item.id, name: item.name, license: item.license ?? null })),
      } : null,
    };
  }

  async current(workspaceId: string, generationResultId: string): Promise<CommercialAudioAssembly | null> {
    const rows = await this.db.execute(sql`SELECT ${projection}
      FROM ai_story_commercial_audio_assemblies a
      LEFT JOIN assets src ON src.id = a.source_asset_id
      LEFT JOIN assets out ON out.id = a.output_asset_id
      WHERE a.workspace_id = ${workspaceId} AND a.generation_result_id = ${generationResultId}
        AND a.state <> 'SUPERSEDED'
      ORDER BY a.created_at DESC LIMIT 1`);
    return (rows[0] as CommercialAudioAssembly | undefined) ?? null;
  }

  async request(input: {
    workspaceId: string;
    executionPlanId: string;
    packageId: string;
    generationResultId: string;
    actorUserId: string;
    explicitSilence?: boolean;
    trackId?: string | null;
  }): Promise<{ decision: CommercialAudioDecision; assembly: CommercialAudioAssembly | null }> {
    return this.db.transaction(async (tx) => {
      const [result] = await tx.execute(sql`SELECT org_id AS "orgId", campaign_id AS "campaignId",
        scene_execution_id AS "sceneExecutionId", asset_id AS "assetId", content_hash AS "contentHash"
        FROM ai_story_generation_results
        WHERE workspace_id = ${input.workspaceId} AND execution_plan_id = ${input.executionPlanId}
          AND generation_result_id = ${input.generationResultId} LIMIT 1`);
      const [pkgRow] = await tx.execute(sql`SELECT package FROM ai_story_local_generation_packages
        WHERE workspace_id = ${input.workspaceId} AND package_id = ${input.packageId} LIMIT 1`);
      if (!result || !pkgRow) throw new CommercialAudioError("COMMERCIAL_AUDIO_NOT_ASSEMBLED");
      const pkg = pkgRow.package as PackageAudioFacts;
      const decision = decisionFor(pkg, input.explicitSilence === true);
      if (decision.finalPolicy === "BLOCKED") throw new CommercialAudioError("MISSING_LICENSED_MUSIC");
      if (decision.finalPolicy === "PRESERVE_NATIVE") return { decision, assembly: null };
      const brief = [pkg.prompt, pkg.worldDescription, ...(pkg.mustKeep ?? [])].filter(Boolean).join("\n");
      const selected = input.explicitSilence
        ? null
        : input.trackId
          ? commerciallyLicensedTrack(input.trackId)
          : selectCommercialBgm({ brief }).track;
      if (!input.explicitSilence && !selected) throw new CommercialAudioError("COMMERCIAL_AUDIO_TRACK_UNLICENSED");
      const finalPolicy = input.explicitSilence ? "EXPLICIT_SILENCE" as const : decision.finalPolicy === "NATIVE_PLUS_BGM" ? "NATIVE_PLUS_BGM" as const : "LICENSED_BGM" as const;
      const [existing] = await tx.execute(sql`SELECT ${projection}
        FROM ai_story_commercial_audio_assemblies a
        LEFT JOIN assets src ON src.id = a.source_asset_id
        LEFT JOIN assets out ON out.id = a.output_asset_id
        WHERE a.workspace_id = ${input.workspaceId} AND a.generation_result_id = ${input.generationResultId}
          AND a.state IN ('PENDING', 'RUNNING', 'ASSEMBLED')
          AND a.final_policy = ${finalPolicy}
          AND a.bgm_track_id IS NOT DISTINCT FROM ${selected?.id ?? null}
        ORDER BY a.created_at DESC LIMIT 1`);
      if (existing) return { decision, assembly: existing as CommercialAudioAssembly };
      const [failures] = await tx.execute(sql`SELECT count(*)::int AS n FROM ai_story_commercial_audio_assemblies
        WHERE workspace_id = ${input.workspaceId} AND generation_result_id = ${input.generationResultId}
          AND state = 'FAILED' AND bgm_track_id IS NOT DISTINCT FROM ${selected?.id ?? null}`);
      if (Number(failures?.n ?? 0) >= 2) throw new CommercialAudioError("COMMERCIAL_AUDIO_RETRY_EXHAUSTED");
      await tx.execute(sql`UPDATE ai_story_commercial_audio_assemblies SET state = 'SUPERSEDED'
        WHERE workspace_id = ${input.workspaceId} AND generation_result_id = ${input.generationResultId}
          AND state IN ('PENDING', 'ASSEMBLED', 'FAILED')`);
      const assemblyId = randomUUID();
      await tx.execute(sql`INSERT INTO ai_story_commercial_audio_assemblies(
        assembly_id, org_id, workspace_id, campaign_id, execution_plan_id, scene_execution_id, package_id,
        generation_result_id, source_asset_id, source_content_hash, generation_policy, final_policy, blockers,
        bgm_track_id, bgm_license, bgm_license_url, state, actor_user_id)
        VALUES (${assemblyId}, ${result.orgId}, ${input.workspaceId}, ${result.campaignId}, ${input.executionPlanId},
          ${result.sceneExecutionId}, ${input.packageId}, ${input.generationResultId}, ${result.assetId},
          ${result.contentHash}, ${decision.generationPolicy}, ${finalPolicy}, ${JSON.stringify(decision.blockers)}::jsonb,
          ${selected?.id ?? null}, ${selected?.license ?? null}, ${selected?.licenseUrl ?? null},
          ${input.explicitSilence ? "ASSEMBLED" : "PENDING"}, ${input.actorUserId})`);
      const [created] = await tx.execute(sql`SELECT ${projection}
        FROM ai_story_commercial_audio_assemblies a
        LEFT JOIN assets src ON src.id = a.source_asset_id
        LEFT JOIN assets out ON out.id = a.output_asset_id
        WHERE a.assembly_id = ${assemblyId}`);
      return { decision, assembly: created as CommercialAudioAssembly };
    });
  }

  async claim(): Promise<(CommercialAudioAssembly & {
    orgId: string; workspaceId: string; campaignId: string; executionPlanId: string;
    sceneExecutionId: string; packageId: string; actorUserId: string;
  }) | null> {
    const token = randomUUID();
    const rows = await this.db.execute(sql`UPDATE ai_story_commercial_audio_assemblies a SET state = 'RUNNING',
      claim_token = ${token}, lease_until = now() + interval '5 minutes', error_code = NULL
      WHERE a.assembly_id = (
        SELECT assembly_id FROM ai_story_commercial_audio_assemblies
        WHERE state = 'PENDING' OR (state = 'RUNNING' AND lease_until < now())
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING a.assembly_id`);
    const claimed = rows[0] as { assembly_id?: string; assemblyId?: string } | undefined;
    const assemblyId = claimed?.assemblyId ?? claimed?.assembly_id;
    if (!assemblyId) return null;
    const [row] = await this.db.execute(sql`SELECT ${projection}
      FROM ai_story_commercial_audio_assemblies a
      LEFT JOIN assets src ON src.id = a.source_asset_id
      LEFT JOIN assets out ON out.id = a.output_asset_id
      WHERE a.assembly_id = ${assemblyId}`);
    return (row as CommercialAudioAssembly & {
      orgId: string; workspaceId: string; campaignId: string; executionPlanId: string;
      sceneExecutionId: string; packageId: string; actorUserId: string;
    } | undefined) ?? null;
  }

  async finish(assemblyId: string, output: { assetId: string; contentHash: string; hasAudio: true } | { failed: string }): Promise<void> {
    if ("failed" in output) {
      await this.db.execute(sql`UPDATE ai_story_commercial_audio_assemblies
        SET state = 'FAILED', error_code = ${output.failed}, claim_token = NULL, lease_until = NULL
        WHERE assembly_id = ${assemblyId} AND state = 'RUNNING'`);
      return;
    }
    await this.db.execute(sql`UPDATE ai_story_commercial_audio_assemblies
      SET state = 'ASSEMBLED', output_asset_id = ${output.assetId}, output_content_hash = ${output.contentHash},
        has_audio = true, error_code = NULL, claim_token = NULL, lease_until = NULL
      WHERE assembly_id = ${assemblyId} AND state = 'RUNNING'`);
  }
}

export async function enqueueCommercialAudioAfterValidation(job: {
  workspaceId: string; executionPlanId: string; packageId: string; assetId: string | null; actorUserId: string;
}): Promise<void> {
  if (!job.assetId) return;
  const db = getDb();
  const [result] = await db.execute(sql`SELECT generation_result_id AS "generationResultId"
    FROM ai_story_generation_results
    WHERE workspace_id = ${job.workspaceId} AND execution_plan_id = ${job.executionPlanId} AND asset_id = ${job.assetId}
    LIMIT 1`);
  if (!result?.generationResultId) return;
  await new AiStoryCommercialAudioRepository(db).request({
    workspaceId: job.workspaceId,
    executionPlanId: job.executionPlanId,
    packageId: job.packageId,
    generationResultId: String(result.generationResultId),
    actorUserId: job.actorUserId,
  });
}
