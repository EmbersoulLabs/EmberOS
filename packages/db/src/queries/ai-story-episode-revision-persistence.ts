import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  AiStoryScriptVersionSchema,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  planAiStoryEpisodeRevision,
  sha256CanonicalIntegrityHash,
  type PlanAiStoryEpisodeRevisionInput,
  type PlanAiStoryEpisodeRevisionResult,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { AiStoryScriptAuthorityService } from "./ai-story-script";

type Db = ReturnType<typeof getDb>;

export const REVISION_SOURCE_VERSION_CONFLICT = "REVISION_SOURCE_VERSION_CONFLICT";
export const REVISION_SCOPE_DENIED = "REVISION_SCOPE_DENIED";
export const REVISION_TRANSACTION_FORCED_FAILURE = "REVISION_TRANSACTION_FORCED_FAILURE";

export class AiStoryEpisodeRevisionPersistenceError extends Error {
  constructor(
    readonly code:
      | typeof REVISION_SOURCE_VERSION_CONFLICT
      | typeof REVISION_SCOPE_DENIED
      | typeof REVISION_TRANSACTION_FORCED_FAILURE
      | "REVISION_NOT_FOUND"
      | "CURRENT_SCRIPT_REQUIRED"
      | "CURRENT_STORY_REQUIRED",
    message: string
  ) {
    super(message);
    this.name = "AiStoryEpisodeRevisionPersistenceError";
  }
}

export type AiStoryEpisodeRevisionPersistScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  actorUserId: string;
};

export type PersistAiStoryEpisodeRevisionInput = {
  scope: AiStoryEpisodeRevisionPersistScope;
  snapshot: PlanAiStoryEpisodeRevisionInput;
  expectedScriptVersionId?: string | null;
  expectedStoryVersionId?: string | null;
  expectedEditorialPlanId?: string | null;
  expectedReferenceFingerprint?: string | null;
  idempotencyKey?: string | null;
  failAfterVersionInsert?: boolean;
};

export type PersistAiStoryEpisodeRevisionResult = {
  revisionId: string;
  status: string;
  persistDurableScript: true;
  persisted: true;
  providerCalls: 0;
  spendAuthorizationCreated: false;
  requiresProviderExecution: boolean;
  commercialAuthorizationStatus: PlanAiStoryEpisodeRevisionResult["executionPlan"]["commercialAuthorizationStatus"];
  userStatus: PlanAiStoryEpisodeRevisionResult["userStatus"];
  historyEntry: PlanAiStoryEpisodeRevisionResult["historyEntry"];
  impact: PlanAiStoryEpisodeRevisionResult["impact"];
  executionPlan: PlanAiStoryEpisodeRevisionResult["executionPlan"];
  revisionCostEstimate: PlanAiStoryEpisodeRevisionResult["revisionCostEstimate"];
  liveEpisodeCostEstimate: PlanAiStoryEpisodeRevisionResult["liveEpisodeCostEstimate"];
  current: {
    revisionId: string;
    revisionVersion: number;
    scriptVersionId: string | null;
    storyVersionId: string;
    editorialPlanId: string | null;
    referenceBindingId: string | null;
    assemblyFingerprint: string | null;
  };
  lineage: {
    revisionRequestId: string;
    newScriptVersionId: string | null;
    previousScriptVersionId: string | null;
    supersedesScriptVersionId: string | null;
    newStoryVersionId: string | null;
    previousStoryVersionId: string | null;
    newEditorialPlanId: string | null;
    previousEditorialPlanId: string | null;
    newReferenceBindingId: string | null;
    previousReferenceBindingId: string | null;
    sourceFingerprint: string | null;
    newFingerprint: string | null;
    createdBy: string;
    createdAt: string;
  };
  staleAuthorities: Array<{
    authorityType: string;
    authorityId: string;
    status: string;
  }>;
  historical: {
    previousScriptVersionId: string | null;
    previousStoryVersionId: string | null;
    previousEditorialPlanId: string | null;
    previousAssemblyFingerprint: string | null;
  };
  obsoleteRetryAuthorizationIds: string[];
  nextScript: PlanAiStoryEpisodeRevisionResult["nextScript"];
  nextEditorialPlan: PlanAiStoryEpisodeRevisionResult["nextEditorialPlan"];
};

async function assertRevisionScope(
  db: Pick<Db, "execute">,
  scope: AiStoryEpisodeRevisionPersistScope,
  mutation: boolean
) {
  const rows = await db.execute<{ ok: boolean }>(sql`select exists(
    select 1 from ai_stories s
    join campaigns c on c.id = s.campaign_id
    where s.id = ${scope.storyId}::uuid
      and s.org_id = ${scope.orgId}::uuid
      and s.workspace_id = ${scope.workspaceId}::uuid
      and s.campaign_id = ${scope.campaignId}::uuid
      and c.org_id = ${scope.orgId}::uuid
      and c.workspace_id = ${scope.workspaceId}::uuid
      and exists (
        select 1 from workspace_members wm
        where wm.workspace_id = ${scope.workspaceId}::uuid
          and wm.user_id = ${scope.actorUserId}::uuid
          and (${!mutation}=true or wm.role in ('admin','operator','editor','reviewer'))
      )
  ) as ok`);
  if (!rows[0]?.ok) {
    throw new AiStoryEpisodeRevisionPersistenceError(
      REVISION_SCOPE_DENIED,
      "Episode revision authority scope does not resolve"
    );
  }
}

function asDraft(script: AiStoryScriptVersion): AiStoryScriptVersion {
  return AiStoryScriptVersionSchema.parse({
    ...script,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  });
}

function durableStatus(planned: PlanAiStoryEpisodeRevisionResult): string {
  if (planned.impact.requiresProviderExecution) {
    return planned.executionPlan.commercialAuthorizationStatus === "AUTHORIZED"
      ? "READY_FOR_REGENERATION"
      : "AWAITING_AUTHORIZATION";
  }
  if (planned.impact.requiresAssemblyRebuild) return "REASSEMBLY_REQUIRED";
  return "PERSISTED";
}

function targetIdOf(planned: PlanAiStoryEpisodeRevisionResult): string | null {
  const target = planned.revisionRequest.target;
  if (target.kind === "DIALOGUE_ENTRY") return target.entryId;
  if (target.kind === "MOMENT") {
    return target.generationUnitId ?? target.directorShotId ?? target.sceneId ?? null;
  }
  if (target.kind === "REFERENCE_BINDING") return target.authorityId;
  return planned.revisionRequest.episodeId;
}

function hydrateResult(
  row: typeof schema.aiStoryEpisodeRevisions.$inferSelect,
  current: typeof schema.aiStoryEpisodeRevisionCurrent.$inferSelect | undefined,
  stale: Array<typeof schema.aiStoryRevisionStaleAuthorities.$inferSelect>,
  nextScript: AiStoryScriptVersion | null,
  nextEditorialPlan: PlanAiStoryEpisodeRevisionResult["nextEditorialPlan"]
): PersistAiStoryEpisodeRevisionResult {
  const plannedLike = {
    impact: row.impact,
    executionPlan: row.executionPlan,
  } as Pick<PlanAiStoryEpisodeRevisionResult, "impact" | "executionPlan">;
  const request = row.revisionRequest as PlanAiStoryEpisodeRevisionResult["revisionRequest"];
  const source = row.sourceVersionIds as Record<string, string | null>;
  const result = row.resultVersionIds as Record<string, string | null>;
  const sourceFp = row.sourceFingerprints as Record<string, string | null>;
  const resultFp = row.resultFingerprints as Record<string, string | null>;
  return {
    revisionId: row.revisionId,
    status: row.status,
    persistDurableScript: true,
    persisted: true,
    providerCalls: 0,
    spendAuthorizationCreated: false,
    requiresProviderExecution: row.requiresProviderExecution,
    commercialAuthorizationStatus:
      row.commercialAuthorizationStatus as PersistAiStoryEpisodeRevisionResult["commercialAuthorizationStatus"],
    userStatus: request.status === "COST_CONFIRMATION_REQUIRED"
      ? "Cost confirmation required"
      : request.status === "READY_TO_REGENERATE"
        ? "Ready to regenerate"
        : request.status === "RE_EDITING"
          ? "Re-editing Episode"
          : request.status === "READY_FOR_REVIEW"
            ? "Ready for review"
            : "Analyzing changes",
    historyEntry: {
      version: row.revisionVersion,
      summary: row.impactSummary,
      createdAt: row.createdAt.toISOString(),
      userStatus: "Analyzing changes",
    },
    impact: plannedLike.impact as PersistAiStoryEpisodeRevisionResult["impact"],
    executionPlan: {
      ...(plannedLike.executionPlan as PersistAiStoryEpisodeRevisionResult["executionPlan"]),
      retryAuthorizationIds: [],
    },
    revisionCostEstimate: (row.executionPlan as { estimatedCost?: PersistAiStoryEpisodeRevisionResult["revisionCostEstimate"] }).estimatedCost ?? null,
    liveEpisodeCostEstimate: (row.executionPlan as { liveEpisodeCostEstimate?: PersistAiStoryEpisodeRevisionResult["liveEpisodeCostEstimate"] }).liveEpisodeCostEstimate
      ?? (row.executionPlan as { estimatedCost?: PersistAiStoryEpisodeRevisionResult["liveEpisodeCostEstimate"] }).estimatedCost
      ?? {
        costEstimateId: row.revisionId,
        contractVersion: "ai-story-episode-revision-authority.v1",
        currency: "USD",
        estimatedMin: "0.00",
        estimatedExpected: "0.00",
        estimatedMax: "0.00",
        unitBreakdown: [],
        pricingVersion: "persisted",
        pricingSource: "https://emberos.local/revision-persistence",
        modelId: "persisted",
        resolution: "480p",
        nativeAudioMode: false,
        generatedAt: row.createdAt.toISOString(),
        authorizesSpend: false,
        fingerprint: sha256CanonicalIntegrityHash({ revisionId: row.revisionId }),
      },
    current: {
      revisionId: current?.currentRevisionId ?? row.revisionId,
      revisionVersion: current?.currentRevisionVersion ?? row.revisionVersion,
      scriptVersionId: current?.currentScriptVersionId ?? result.scriptVersionId ?? null,
      storyVersionId: current?.currentStoryVersionId ?? result.storyVersionId ?? row.storyId,
      editorialPlanId: current?.currentEditorialPlanId ?? result.editorialPlanId ?? null,
      referenceBindingId: current?.currentReferenceBindingId ?? result.referenceBindingId ?? null,
      assemblyFingerprint: current?.currentAssemblyFingerprint ?? resultFp.assembly ?? null,
    },
    lineage: {
      revisionRequestId: request.revisionRequestId,
      newScriptVersionId: result.scriptVersionId ?? null,
      previousScriptVersionId: source.scriptVersionId ?? null,
      supersedesScriptVersionId: source.scriptVersionId ?? null,
      newStoryVersionId: result.storyVersionId ?? null,
      previousStoryVersionId: source.storyVersionId ?? null,
      newEditorialPlanId: result.editorialPlanId ?? null,
      previousEditorialPlanId: source.editorialPlanId ?? null,
      newReferenceBindingId: result.referenceBindingId ?? null,
      previousReferenceBindingId: source.referenceBindingId ?? null,
      sourceFingerprint: sourceFp.script ?? sourceFp.story ?? sourceFp.editorial ?? null,
      newFingerprint: resultFp.script ?? resultFp.story ?? resultFp.editorial ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    },
    staleAuthorities: stale.map((item) => ({
      authorityType: item.authorityType,
      authorityId: item.authorityId,
      status: item.status,
    })),
    historical: {
      previousScriptVersionId: source.scriptVersionId ?? null,
      previousStoryVersionId: source.storyVersionId ?? null,
      previousEditorialPlanId: source.editorialPlanId ?? null,
      previousAssemblyFingerprint: sourceFp.assembly ?? null,
    },
    obsoleteRetryAuthorizationIds: row.obsoleteRetryAuthorizationIds,
    nextScript,
    nextEditorialPlan,
  };
}

export class AiStoryEpisodeRevisionPersistenceService {
  constructor(private readonly db: Db = getDb()) {}

  async persist(input: PersistAiStoryEpisodeRevisionInput): Promise<PersistAiStoryEpisodeRevisionResult> {
    const scope = input.scope;
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`episode-revision:${scope.storyId}`}))`);
      await assertRevisionScope(tx, scope, true);

      if (input.idempotencyKey) {
        const existing = await tx.select().from(schema.aiStoryEpisodeRevisions).where(and(
          eq(schema.aiStoryEpisodeRevisions.orgId, scope.orgId),
          eq(schema.aiStoryEpisodeRevisions.workspaceId, scope.workspaceId),
          eq(schema.aiStoryEpisodeRevisions.storyId, scope.storyId),
          eq(schema.aiStoryEpisodeRevisions.idempotencyKey, input.idempotencyKey),
        )).limit(1);
        if (existing[0]) {
          return this.hydrateFromRow(tx, existing[0]);
        }
      }

      const [story] = await tx.select().from(schema.aiStories).where(and(
        eq(schema.aiStories.id, scope.storyId),
        eq(schema.aiStories.orgId, scope.orgId),
        eq(schema.aiStories.workspaceId, scope.workspaceId),
        eq(schema.aiStories.campaignId, scope.campaignId),
      )).limit(1);
      if (!story?.currentVersionId) {
        throw new AiStoryEpisodeRevisionPersistenceError("CURRENT_STORY_REQUIRED", "Canonical current Story version is required");
      }

      const [pointer] = await tx.select().from(schema.aiStoryEpisodeRevisionCurrent).where(
        eq(schema.aiStoryEpisodeRevisionCurrent.storyId, scope.storyId)
      ).limit(1);

      const frozenScripts = await tx.select().from(schema.aiStoryScriptVersions).where(and(
        eq(schema.aiStoryScriptVersions.orgId, scope.orgId),
        eq(schema.aiStoryScriptVersions.workspaceId, scope.workspaceId),
        eq(schema.aiStoryScriptVersions.storyId, scope.storyId),
        eq(schema.aiStoryScriptVersions.status, "FROZEN"),
      ));
      if (frozenScripts.length !== 1) {
        throw new AiStoryEpisodeRevisionPersistenceError("CURRENT_SCRIPT_REQUIRED", "Canonical current Script version is required");
      }
      const currentScript = AiStoryScriptVersionSchema.parse({
        ...frozenScripts[0]!.script,
        status: frozenScripts[0]!.status,
        approvedBy: frozenScripts[0]!.approvedBy,
        approvedAt: frozenScripts[0]!.approvedAt?.toISOString() ?? null,
        frozenAt: frozenScripts[0]!.frozenAt?.toISOString() ?? null,
      });
      const currentScriptId = pointer?.currentScriptVersionId ?? currentScript.scriptVersionId;
      const currentStoryId = pointer?.currentStoryVersionId ?? story.currentVersionId;
      const currentEditorialId = pointer?.currentEditorialPlanId ?? input.snapshot.editorialPlan.editorialPlanId;
      const currentReferenceFingerprint = pointer?.currentReferenceFingerprint ?? null;

      if (input.expectedScriptVersionId && input.expectedScriptVersionId !== currentScriptId) {
        throw new AiStoryEpisodeRevisionPersistenceError(
          REVISION_SOURCE_VERSION_CONFLICT,
          "Script source version changed after the revision plan was created"
        );
      }
      if (input.expectedStoryVersionId && input.expectedStoryVersionId !== currentStoryId) {
        throw new AiStoryEpisodeRevisionPersistenceError(
          REVISION_SOURCE_VERSION_CONFLICT,
          "Story source version changed after the revision plan was created"
        );
      }
      if (input.expectedEditorialPlanId && input.expectedEditorialPlanId !== currentEditorialId) {
        throw new AiStoryEpisodeRevisionPersistenceError(
          REVISION_SOURCE_VERSION_CONFLICT,
          "Editorial source version changed after the revision plan was created"
        );
      }
      if (
        input.expectedReferenceFingerprint &&
        currentReferenceFingerprint &&
        input.expectedReferenceFingerprint !== currentReferenceFingerprint
      ) {
        throw new AiStoryEpisodeRevisionPersistenceError(
          REVISION_SOURCE_VERSION_CONFLICT,
          "Reference binding changed after the revision plan was created"
        );
      }

      const planned = planAiStoryEpisodeRevision({
        ...input.snapshot,
        script: currentScript,
        createdBy: scope.actorUserId,
      });
      const revisionId = planned.revisionRequest.revisionRequestId;
      const now = new Date(planned.revisionRequest.createdAt);
      const scripts = new AiStoryScriptAuthorityService(tx as unknown as Db);
      const scriptScope = {
        orgId: scope.orgId,
        workspaceId: scope.workspaceId,
        campaignId: scope.campaignId,
        storyId: scope.storyId,
        storyVersionId: currentScript.storyVersionId,
        actorUserId: scope.actorUserId,
      };

      await tx.insert(schema.aiStoryEpisodeRevisions).values({
        revisionId,
        orgId: scope.orgId,
        workspaceId: scope.workspaceId,
        campaignId: scope.campaignId,
        storyId: scope.storyId,
        episodeId: planned.revisionRequest.episodeId,
        revisionType: planned.revisionRequest.revisionType,
        targetType: planned.revisionRequest.target.kind,
        targetId: targetIdOf(planned),
        status: "PROPOSED",
        revisionVersion: planned.revisionRequest.revisionVersion,
        contractVersion: planned.revisionRequest.contractVersion,
        idempotencyKey: input.idempotencyKey ?? null,
        revisionRequest: planned.revisionRequest,
        impact: planned.impact,
        executionPlan: {
          ...planned.executionPlan,
          retryAuthorizationIds: [],
          liveEpisodeCostEstimate: planned.liveEpisodeCostEstimate,
        },
        sourceVersionIds: {},
        resultVersionIds: {},
        sourceFingerprints: {},
        resultFingerprints: {},
        impactSummary: planned.historyEntry.summary,
        requiresProviderExecution: planned.impact.requiresProviderExecution,
        requiresAssemblyRebuild: planned.impact.requiresAssemblyRebuild,
        commercialAuthorizationStatus: planned.executionPlan.commercialAuthorizationStatus,
        spendAuthorizationCreated: false,
        obsoleteRetryAuthorizationIds: [...(input.snapshot.retryAuthorizationIds ?? [])],
        createdBy: scope.actorUserId,
        createdAt: now,
        completedAt: null,
      });

      let nextScriptId = currentScript.scriptVersionId;
      let nextScript: AiStoryScriptVersion | null = currentScript;
      if (planned.nextScript) {
        const draft = asDraft(planned.nextScript);
        await scripts.propose(scriptScope, draft);
        await scripts.validate(scriptScope, draft.scriptVersionId);
        await scripts.approve(scriptScope, draft.scriptVersionId);
        nextScript = await scripts.freeze(scriptScope, draft.scriptVersionId);
        nextScriptId = nextScript.scriptVersionId;
      }

      let nextStoryId = currentStoryId;
      if (planned.revisionRequest.revisionType === "ADJUST_ENDING") {
        const [currentVersion] = await tx.select().from(schema.aiStoryVersions).where(
          eq(schema.aiStoryVersions.id, currentStoryId)
        ).limit(1);
        if (!currentVersion) {
          throw new AiStoryEpisodeRevisionPersistenceError("CURRENT_STORY_REQUIRED", "Canonical current Story version is required");
        }
        nextStoryId = randomUUID();
        const endingIntent =
          planned.revisionRequest.requestedChange.kind === "ENDING_INTENT"
            ? planned.revisionRequest.requestedChange.nextIntent
            : "stronger CTA";
        await tx.insert(schema.aiStoryVersions).values({
          id: nextStoryId,
          storyId: scope.storyId,
          versionNumber: currentVersion.versionNumber + 1,
          structuredContent: currentVersion.structuredContent,
          sourceContextSnapshot: {
            ...(currentVersion.sourceContextSnapshot ?? {}),
            endingIntent,
            revisionRequestId: revisionId,
            supersedesStoryVersionId: currentVersion.id,
            storyFingerprint: sha256CanonicalIntegrityHash({
              previous: currentVersion.id,
              endingIntent,
            }),
          },
          aiMetadata: currentVersion.aiMetadata ?? {},
          userEdited: true,
          createdBy: scope.actorUserId,
          createdAt: now,
          frozenAt: now,
          frozenBy: scope.actorUserId,
        });
        await tx.update(schema.aiStories).set({
          currentVersionId: nextStoryId,
          updatedAt: now,
        }).where(eq(schema.aiStories.id, scope.storyId));
      }

      const previousEditorial = planned.previousEditorialPlan;
      const nextEditorial = planned.nextEditorialPlan;
      const resolveScriptFk = async (candidate: string | null | undefined) => {
        if (!candidate) return currentScript.scriptVersionId;
        const [found] = await tx.select({ id: schema.aiStoryScriptVersions.scriptVersionId }).from(schema.aiStoryScriptVersions).where(
          eq(schema.aiStoryScriptVersions.scriptVersionId, candidate)
        ).limit(1);
        return found?.id ?? currentScript.scriptVersionId;
      };
      const resolveStoryFk = async (candidate: string | null | undefined, fallback: string) => {
        if (!candidate) return fallback;
        const [found] = await tx.select({ id: schema.aiStoryVersions.id }).from(schema.aiStoryVersions).where(
          eq(schema.aiStoryVersions.id, candidate)
        ).limit(1);
        return found?.id ?? fallback;
      };
      const [existingPreviousEditorial] = await tx.select().from(schema.aiStoryEditorialPlanVersions).where(
        eq(schema.aiStoryEditorialPlanVersions.editorialPlanId, previousEditorial.editorialPlanId)
      ).limit(1);
      if (!existingPreviousEditorial) {
        await tx.insert(schema.aiStoryEditorialPlanVersions).values({
          editorialPlanId: previousEditorial.editorialPlanId,
          orgId: scope.orgId,
          workspaceId: scope.workspaceId,
          campaignId: scope.campaignId,
          storyId: scope.storyId,
          storyVersionId: await resolveStoryFk(previousEditorial.storyVersionId, currentStoryId),
          scriptVersionId: await resolveScriptFk(previousEditorial.scriptVersionId),
          version: previousEditorial.version,
          status: "FROZEN",
          editorialFingerprint: previousEditorial.editorialFingerprint,
          supersedesEditorialPlanId: null,
          revisionId: null,
          plan: previousEditorial,
          createdBy: previousEditorial.createdBy,
          createdAt: new Date(previousEditorial.createdAt),
        });
      }
      if (nextEditorial.editorialPlanId !== previousEditorial.editorialPlanId) {
        await tx.update(schema.aiStoryEditorialPlanVersions).set({ status: "SUPERSEDED" }).where(and(
          eq(schema.aiStoryEditorialPlanVersions.editorialPlanId, previousEditorial.editorialPlanId),
          eq(schema.aiStoryEditorialPlanVersions.status, "FROZEN"),
        ));
        await tx.insert(schema.aiStoryEditorialPlanVersions).values({
          editorialPlanId: nextEditorial.editorialPlanId,
          orgId: scope.orgId,
          workspaceId: scope.workspaceId,
          campaignId: scope.campaignId,
          storyId: scope.storyId,
          storyVersionId: await resolveStoryFk(nextEditorial.storyVersionId, nextStoryId),
          scriptVersionId: await resolveScriptFk(nextEditorial.scriptVersionId),
          version: nextEditorial.version,
          status: "FROZEN",
          editorialFingerprint: nextEditorial.editorialFingerprint,
          supersedesEditorialPlanId: previousEditorial.editorialPlanId,
          revisionId,
          plan: nextEditorial,
          createdBy: nextEditorial.createdBy,
          createdAt: now,
        });
      }

      let nextReferenceId: string | null = pointer?.currentReferenceBindingId ?? null;
      let nextReferenceFingerprint = currentReferenceFingerprint;
      let previousReferenceId: string | null = pointer?.currentReferenceBindingId ?? null;
      if (planned.referenceBinding) {
        const latest = await tx.select().from(schema.aiStoryReferenceBindingVersions).where(and(
          eq(schema.aiStoryReferenceBindingVersions.storyId, scope.storyId),
          eq(schema.aiStoryReferenceBindingVersions.referenceKind, planned.referenceBinding.referenceKind),
        ));
        const currentBinding = latest.find((row) => row.status === "CURRENT") ?? latest.sort((a, b) => b.version - a.version)[0];
        if (currentBinding) {
          previousReferenceId = currentBinding.referenceBindingId;
          await tx.update(schema.aiStoryReferenceBindingVersions).set({ status: "SUPERSEDED" }).where(
            eq(schema.aiStoryReferenceBindingVersions.referenceBindingId, currentBinding.referenceBindingId)
          );
        } else {
          previousReferenceId = planned.referenceBinding.supersedesId;
          await tx.insert(schema.aiStoryReferenceBindingVersions).values({
            referenceBindingId: planned.referenceBinding.supersedesId ?? randomUUID(),
            orgId: scope.orgId,
            workspaceId: scope.workspaceId,
            campaignId: scope.campaignId,
            storyId: scope.storyId,
            version: 1,
            status: "SUPERSEDED",
            referenceKind: planned.referenceBinding.referenceKind,
            authorityId: planned.revisionRequest.requestedChange.kind === "REFERENCE_BINDING"
              ? planned.revisionRequest.requestedChange.previousAuthorityId
              : planned.referenceBinding.previousAuthorityId,
            sourceAssetId: planned.revisionRequest.requestedChange.kind === "REFERENCE_BINDING"
              ? planned.revisionRequest.requestedChange.previousSourceAssetId ?? null
              : null,
            sourceContentHash: null,
            fingerprint: sha256CanonicalIntegrityHash({
              authorityId: planned.referenceBinding.previousAuthorityId,
              kind: planned.referenceBinding.referenceKind,
            }),
            supersedesBindingId: null,
            revisionId: null,
            binding: {
              authorityId: planned.referenceBinding.previousAuthorityId,
              referenceKind: planned.referenceBinding.referenceKind,
            },
            createdBy: scope.actorUserId,
            createdAt: now,
          });
        }
        nextReferenceId = planned.referenceBinding.referenceBindingId;
        nextReferenceFingerprint = planned.referenceBinding.fingerprint;
        const nextAuthorityId = planned.revisionRequest.requestedChange.kind === "REFERENCE_BINDING"
          ? planned.revisionRequest.requestedChange.nextAuthorityId
          : planned.referenceBinding.nextAuthorityId;
        const nextSourceAssetId = planned.revisionRequest.requestedChange.kind === "REFERENCE_BINDING"
          ? planned.revisionRequest.requestedChange.nextSourceAssetId ?? null
          : null;
        await tx.insert(schema.aiStoryReferenceBindingVersions).values({
          referenceBindingId: nextReferenceId,
          orgId: scope.orgId,
          workspaceId: scope.workspaceId,
          campaignId: scope.campaignId,
          storyId: scope.storyId,
          version: (currentBinding?.version ?? 1) + 1,
          status: "CURRENT",
          referenceKind: planned.referenceBinding.referenceKind,
          authorityId: nextAuthorityId,
          sourceAssetId: nextSourceAssetId,
          sourceContentHash: nextSourceAssetId
            ? sha256CanonicalIntegrityHash({ sourceAssetId: nextSourceAssetId })
            : null,
          fingerprint: nextReferenceFingerprint,
          supersedesBindingId: previousReferenceId,
          revisionId,
          binding: planned.referenceBinding,
          createdBy: scope.actorUserId,
          createdAt: now,
        });
      }

      if (input.failAfterVersionInsert) {
        throw new AiStoryEpisodeRevisionPersistenceError(
          REVISION_TRANSACTION_FORCED_FAILURE,
          "Forced failure after version insert"
        );
      }

      const status = durableStatus(planned);
      const sourceVersionIds = {
        scriptVersionId: currentScript.scriptVersionId,
        storyVersionId: currentStoryId,
        editorialPlanId: previousEditorial.editorialPlanId,
        referenceBindingId: previousReferenceId,
      };
      const resultVersionIds = {
        scriptVersionId: nextScriptId,
        storyVersionId: nextStoryId,
        editorialPlanId: nextEditorial.editorialPlanId,
        referenceBindingId: nextReferenceId,
      };
      const sourceFingerprints: {
        script: string;
        editorial: string;
        assembly: string | null;
        reference: string | null;
      } = {
        script: currentScript.sourceHash,
        editorial: previousEditorial.editorialFingerprint,
        assembly: pointer?.currentAssemblyFingerprint ?? planned.superAdminDiagnostics.newFingerprints.assembly,
        reference: currentReferenceFingerprint,
      };
      const resultFingerprints = {
        script: nextScript?.sourceHash ?? currentScript.sourceHash,
        editorial: nextEditorial.editorialFingerprint,
        assembly: planned.assemblyPlan.assemblyFingerprint,
        reference: nextReferenceFingerprint,
        revision: planned.revisionRequest.revisionFingerprint,
      };

      await tx.update(schema.aiStoryEpisodeRevisions).set({
        status,
        sourceVersionIds,
        resultVersionIds,
        sourceFingerprints,
        resultFingerprints,
        executionPlan: {
          ...planned.executionPlan,
          retryAuthorizationIds: [],
          liveEpisodeCostEstimate: planned.liveEpisodeCostEstimate,
        },
      }).where(eq(schema.aiStoryEpisodeRevisions.revisionId, revisionId));

      await tx.insert(schema.aiStoryEpisodeRevisionCurrent).values({
        storyId: scope.storyId,
        orgId: scope.orgId,
        workspaceId: scope.workspaceId,
        campaignId: scope.campaignId,
        currentRevisionId: revisionId,
        currentRevisionVersion: planned.revisionRequest.revisionVersion,
        currentScriptVersionId: nextScriptId,
        currentStoryVersionId: nextStoryId,
        currentEditorialPlanId: nextEditorial.editorialPlanId,
        currentReferenceBindingId: nextReferenceId,
        currentReferenceFingerprint: nextReferenceFingerprint,
        currentAssemblyFingerprint: planned.assemblyPlan.assemblyFingerprint,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [schema.aiStoryEpisodeRevisionCurrent.storyId],
        set: {
          currentRevisionId: revisionId,
          currentRevisionVersion: planned.revisionRequest.revisionVersion,
          currentScriptVersionId: nextScriptId,
          currentStoryVersionId: nextStoryId,
          currentEditorialPlanId: nextEditorial.editorialPlanId,
          currentReferenceBindingId: nextReferenceId,
          currentReferenceFingerprint: nextReferenceFingerprint,
          currentAssemblyFingerprint: planned.assemblyPlan.assemblyFingerprint,
          updatedAt: now,
        },
      });

      const staleRows: Array<typeof schema.aiStoryRevisionStaleAuthorities.$inferInsert> = [];
      const pushStale = (
        authorityType: string,
        authorityId: string,
        statusValue: "VALID" | "STALE" | "SUPERSEDED",
        payload: Record<string, unknown>
      ) => {
        staleRows.push({
          staleAuthorityId: randomUUID(),
          orgId: scope.orgId,
          workspaceId: scope.workspaceId,
          campaignId: scope.campaignId,
          storyId: scope.storyId,
          revisionId,
          authorityType,
          authorityId,
          status: statusValue,
          sourceVersionId: currentScript.scriptVersionId,
          currentVersionId: nextScriptId,
          historicalPayload: payload,
          createdAt: now,
        });
      };
      for (const unitId of planned.impact.impactedGenerationUnitIds) {
        pushStale("GENERATION_UNIT", unitId, "STALE", {
          previousScriptVersionId: currentScript.scriptVersionId,
          readableForPreviousVersion: true,
        });
        pushStale("PROVIDER_RESULT", unitId, "SUPERSEDED", {
          previousScriptVersionId: currentScript.scriptVersionId,
          readableForPreviousVersion: true,
          deleted: false,
        });
      }
      for (const unitId of planned.impact.preservedGenerationUnitIds) {
        pushStale("GENERATION_UNIT", unitId, "VALID", {
          siblingPreserved: true,
        });
      }
      for (const nativeId of planned.impact.impactedNativeDialogueAuthorityIds) {
        pushStale("NATIVE_DIALOGUE", nativeId, "STALE", {
          previousScriptVersionId: currentScript.scriptVersionId,
          readableForPreviousVersion: true,
        });
      }
      for (const shotId of planned.impact.impactedDirectorShotIds) {
        pushStale("DIRECTOR_SHOT", shotId, "STALE", {
          previousScriptVersionId: currentScript.scriptVersionId,
        });
      }
      for (const entryId of planned.impact.impactedEditorialEntryIds) {
        pushStale("EDITORIAL_ENTRY", entryId, "STALE", {
          previousEditorialPlanId: previousEditorial.editorialPlanId,
        });
      }
      if (planned.impact.requiresAssemblyRebuild) {
        pushStale("ASSEMBLY", planned.revisionRequest.episodeId, "STALE", {
          previousAssemblyFingerprint: sourceFingerprints.assembly,
          currentAssemblyFingerprint: planned.assemblyPlan.assemblyFingerprint,
          historicalReadable: true,
        });
      }
      if (staleRows.length) {
        await tx.insert(schema.aiStoryRevisionStaleAuthorities).values(staleRows);
      }

      const [saved] = await tx.select().from(schema.aiStoryEpisodeRevisions).where(
        eq(schema.aiStoryEpisodeRevisions.revisionId, revisionId)
      ).limit(1);
      const result = await this.hydrateFromRow(tx, saved!, nextScript, nextEditorial);
      result.liveEpisodeCostEstimate = planned.liveEpisodeCostEstimate;
      result.revisionCostEstimate = planned.revisionCostEstimate;
      result.userStatus = planned.userStatus;
      result.historyEntry = planned.historyEntry;
      result.nextScript = nextScript && planned.nextScript ? nextScript : planned.nextScript;
      return result;
    });
  }

  async readCurrent(scope: AiStoryEpisodeRevisionPersistScope): Promise<PersistAiStoryEpisodeRevisionResult | null> {
    await assertRevisionScope(this.db, scope, false);
    const [pointer] = await this.db.select().from(schema.aiStoryEpisodeRevisionCurrent).where(and(
      eq(schema.aiStoryEpisodeRevisionCurrent.storyId, scope.storyId),
      eq(schema.aiStoryEpisodeRevisionCurrent.workspaceId, scope.workspaceId),
    )).limit(1);
    if (!pointer) return null;
    const [row] = await this.db.select().from(schema.aiStoryEpisodeRevisions).where(
      eq(schema.aiStoryEpisodeRevisions.revisionId, pointer.currentRevisionId)
    ).limit(1);
    if (!row) return null;
    return this.hydrateFromRow(this.db, row);
  }

  async history(scope: AiStoryEpisodeRevisionPersistScope) {
    await assertRevisionScope(this.db, scope, false);
    return this.db.select().from(schema.aiStoryEpisodeRevisions).where(and(
      eq(schema.aiStoryEpisodeRevisions.orgId, scope.orgId),
      eq(schema.aiStoryEpisodeRevisions.workspaceId, scope.workspaceId),
      eq(schema.aiStoryEpisodeRevisions.storyId, scope.storyId),
    )).orderBy(asc(schema.aiStoryEpisodeRevisions.revisionVersion));
  }

  private async hydrateFromRow(
    db: Pick<Db, "select">,
    row: typeof schema.aiStoryEpisodeRevisions.$inferSelect,
    nextScript?: AiStoryScriptVersion | null,
    nextEditorialPlan?: PlanAiStoryEpisodeRevisionResult["nextEditorialPlan"]
  ): Promise<PersistAiStoryEpisodeRevisionResult> {
    const [current] = await db.select().from(schema.aiStoryEpisodeRevisionCurrent).where(
      eq(schema.aiStoryEpisodeRevisionCurrent.storyId, row.storyId)
    ).limit(1);
    const stale = await db.select().from(schema.aiStoryRevisionStaleAuthorities).where(
      eq(schema.aiStoryRevisionStaleAuthorities.revisionId, row.revisionId)
    );
    let script: AiStoryScriptVersion | null = nextScript ?? null;
    const resultIds = row.resultVersionIds as { scriptVersionId?: string };
    if (!script && resultIds.scriptVersionId) {
      const [scriptRow] = await db.select().from(schema.aiStoryScriptVersions).where(
        eq(schema.aiStoryScriptVersions.scriptVersionId, resultIds.scriptVersionId)
      ).limit(1);
      if (scriptRow) {
        script = AiStoryScriptVersionSchema.parse({
          ...scriptRow.script,
          status: scriptRow.status,
          approvedBy: scriptRow.approvedBy,
          approvedAt: scriptRow.approvedAt?.toISOString() ?? null,
          frozenAt: scriptRow.frozenAt?.toISOString() ?? null,
        });
      }
    }
    let editorial = nextEditorialPlan;
    const editorialId = (row.resultVersionIds as { editorialPlanId?: string }).editorialPlanId;
    if (!editorial && editorialId) {
      const [editorialRow] = await db.select().from(schema.aiStoryEditorialPlanVersions).where(
        eq(schema.aiStoryEditorialPlanVersions.editorialPlanId, editorialId)
      ).limit(1);
      if (editorialRow) {
        editorial = editorialRow.plan as PlanAiStoryEpisodeRevisionResult["nextEditorialPlan"];
      }
    }
    return hydrateResult(row, current, stale, script, editorial as PlanAiStoryEpisodeRevisionResult["nextEditorialPlan"]);
  }
}

export async function persistAiStoryEpisodeRevision(
  input: PersistAiStoryEpisodeRevisionInput
): Promise<PersistAiStoryEpisodeRevisionResult> {
  return new AiStoryEpisodeRevisionPersistenceService().persist(input);
}
