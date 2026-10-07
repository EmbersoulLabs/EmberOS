/**
 * Campaign-owned AI Story persistence helpers.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema, CampaignAssetRefError } from "@ceo-agent/db";
import { VISUAL_SEMANTIC_ANALYZER_VERSION } from "@ceo-agent/agents";
import {
  extractProductVariantCandidates,
  planAiStoryAssetLinkUsage,
  resolveProductVariantMapping,
  resolveProductVariantVisualGrounding,
  type ProductVariantSemanticFacts,
  assertAiStoryTransition,
  evaluateStoryVersionFreezeContinuity,
  nextAiStoryVersionNumber,
  type AiStoryAssetSelection,
  type AiStoryStatus,
  type AiStoryStructuredDraft,
  type StoryVersionFreezeBinding,
  type StoryVersionFreezeBlockReason,
  type StoryVersionFreezeScene,
} from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

export class StoryVersionFreezeBlockedError extends Error {
  readonly code: StoryVersionFreezeBlockReason;
  constructor(reason: StoryVersionFreezeBlockReason) {
    super(reason);
    this.code = reason;
  }
}

function freezeScenesFromScript(script: unknown): StoryVersionFreezeScene[] {
  const scenes = (script as { scenes?: unknown[] } | null)?.scenes;
  if (!Array.isArray(scenes)) return [];
  return scenes.flatMap((scene) => {
    if (!scene || typeof scene !== "object") return [];
    const record = scene as {
      characterIds?: unknown[];
      entries?: Array<{ type?: string; speakerId?: string; voiceOwnerId?: string }>;
    };
    const persistentCharacterIds = (record.characterIds ?? []).filter(
      (id): id is string => typeof id === "string"
    );
    const voiceCharacterIds = (record.entries ?? []).flatMap((entry) => {
      if (entry?.type === "DIALOGUE" && entry.speakerId) return [entry.speakerId];
      if (entry?.type === "VO" && entry.voiceOwnerId) return [entry.voiceOwnerId];
      return [];
    });
    return [{ persistentCharacterIds, voiceCharacterIds }];
  });
}

export async function assertCharacterContinuityBeforeStoryVersionFreeze(
  db: Db,
  input: { storyId: string; storyVersionId: string; freezeAt: Date }
) {
  const [story] = await db
    .select({ orgId: schema.aiStories.orgId, workspaceId: schema.aiStories.workspaceId })
    .from(schema.aiStories)
    .where(eq(schema.aiStories.id, input.storyId))
    .limit(1);
  if (!story) throw new Error("Story not found");

  const scripts = await db
    .select({ script: schema.aiStoryScriptVersions.script })
    .from(schema.aiStoryScriptVersions)
    .where(
      and(
        eq(schema.aiStoryScriptVersions.storyId, input.storyId),
        eq(schema.aiStoryScriptVersions.storyVersionId, input.storyVersionId)
      )
    );
  const scenes = scripts.flatMap((row) => freezeScenesFromScript(row.script));
  const rows = await db
    .select()
    .from(schema.aiStoryEpisodeCharacterBindings)
    .where(eq(schema.aiStoryEpisodeCharacterBindings.storyId, input.storyId));
  const bindings: StoryVersionFreezeBinding[] = rows.map((row) => {
    const snapshot = row.snapshot as {
      voiceDnaId?: string | null;
      voiceDnaFingerprint?: string | null;
    };
    return {
      orgId: row.orgId,
      workspaceId: row.workspaceId,
      campaignCharacterId: row.campaignCharacterId,
      reusableCharacterId: row.reusableCharacterId,
      reusableCharacterVersionId: row.reusableCharacterVersionId,
      identityFingerprint: row.identityFingerprint,
      voiceDnaId: snapshot.voiceDnaId ?? null,
      voiceDnaFingerprint: snapshot.voiceDnaFingerprint ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
  const decision = evaluateStoryVersionFreezeContinuity({
    orgId: story.orgId,
    workspaceId: story.workspaceId,
    freezeAt: input.freezeAt.toISOString(),
    scenes,
    bindings,
  });
  if (decision.status === "BLOCK" && decision.reasonCode !== "PASS") {
    throw new StoryVersionFreezeBlockedError(decision.reasonCode);
  }
}

export async function loadCampaignAiStory(
  db: Db,
  campaignId: string,
  storyId: string,
  workspaceId: string
) {
  const [story] = await db
    .select()
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.id, storyId),
        eq(schema.aiStories.campaignId, campaignId),
        eq(schema.aiStories.workspaceId, workspaceId),
        isNull(schema.aiStories.archivedAt)
      )
    )
    .limit(1);
  if (!story) return null;

  const versions = await db
    .select()
    .from(schema.aiStoryVersions)
    .where(eq(schema.aiStoryVersions.storyId, storyId))
    .orderBy(desc(schema.aiStoryVersions.versionNumber));

  const assetLinks = await db
    .select()
    .from(schema.aiStoryAssetLinks)
    .where(eq(schema.aiStoryAssetLinks.storyId, storyId));

  const currentVersion =
    versions.find((v) => v.id === story.currentVersionId) ?? versions[0] ?? null;

  let verificationFixtureState:
    | "CREATING"
    | "FAILED_INCOMPLETE"
    | "LEGACY_PARTIAL_VERIFICATION_FIXTURE"
    | "COMPLETED"
    | null = null;
  if (currentVersion?.sourceContextSnapshot?.verificationFixture === true) {
    const plans = await db
      .select({ id: schema.aiStoryExecutionPlans.id })
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.storyId, storyId));
    const verificationRows = plans.length > 0
      ? await db
          .select({ executionPlanId: schema.aiStoryExecuteVerifications.executionPlanId })
          .from(schema.aiStoryExecuteVerifications)
          .where(
            inArray(
              schema.aiStoryExecuteVerifications.executionPlanId,
              plans.map((plan) => plan.id)
            )
          )
          .limit(1)
      : [];
    verificationFixtureState = verificationRows.length > 0
      ? "COMPLETED"
      : story.status === "failed" || story.status === "archived"
        ? "FAILED_INCOMPLETE"
        : story.status === "ready_for_execution"
          ? "LEGACY_PARTIAL_VERIFICATION_FIXTURE"
          : "CREATING";
  }

  return { story, versions, currentVersion, assetLinks, verificationFixtureState };
}

export async function listCampaignAiStories(
  db: Db,
  campaignId: string,
  workspaceId: string
) {
  return db
    .select()
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.campaignId, campaignId),
        eq(schema.aiStories.workspaceId, workspaceId),
        isNull(schema.aiStories.archivedAt)
      )
    )
    .orderBy(desc(schema.aiStories.updatedAt));
}

export async function setAiStoryStatus(
  db: Db,
  storyId: string,
  from: AiStoryStatus,
  to: AiStoryStatus
) {
  assertAiStoryTransition(from, to);
  await db
    .update(schema.aiStories)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(schema.aiStories.id, storyId));
}

export async function ensureCampaignLibraryAvailability(
  db: Db,
  campaignId: string,
  workspaceId: string,
  assetIds: string[]
) {
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(
      eq(schema.assets.workspaceId, workspaceId),
      inArray(schema.assets.id, unique),
      isNull(schema.assets.deletedAt)
    ));
  if (rows.length !== unique.length) {
    throw new Error("One or more assets are invalid for this workspace");
  }
  await db
    .insert(schema.campaignAssetRefs)
    .values(unique.map((assetId, index) => ({ campaignId, assetId, sortOrder: index })))
    .onConflictDoNothing();
}

export class AiStoryProductVariantAuthorityError extends Error {
  constructor(
    readonly code:
      | "PRODUCT_VARIANT_ANALYSIS_REQUIRED"
      | "PRODUCT_VARIANT_SELECTION_REQUIRED"
      | "PRODUCT_VARIANT_VISUAL_REFERENCE_REQUIRED"
      | "PRODUCT_VARIANT_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "AiStoryProductVariantAuthorityError";
  }
}

function visualSemanticFacts(analysis: unknown): ProductVariantSemanticFacts | null {
  if (!analysis || typeof analysis !== "object") return null;
  const facts = (analysis as { facts?: { visualSemantics?: ProductVariantSemanticFacts } }).facts?.visualSemantics;
  return facts ?? null;
}

/** Freezes confirmed variants from durable semantic facts. Does not invent a variant. */
export async function confirmedProductVariantsForIntake(
  db: Db,
  input: {
    workspaceId: string;
    productAssetIds: readonly string[];
    userIntent: string;
    selections: readonly { assetId: string; variant: string }[];
    confirmed: boolean;
  }
): Promise<Record<string, string | null>> {
  const productAssetIds = [...new Set(input.productAssetIds)];
  if (productAssetIds.length === 0 || !input.confirmed) return {};
  const assets = await db
    .select({ id: schema.assets.id, contentHash: schema.assets.contentHash })
    .from(schema.assets)
    .where(and(
      eq(schema.assets.workspaceId, input.workspaceId),
      inArray(schema.assets.id, productAssetIds),
      isNull(schema.assets.deletedAt)
    ));
  if (assets.length !== productAssetIds.length || assets.some((asset) => !asset.contentHash)) {
    throw new AiStoryProductVariantAuthorityError(
      "PRODUCT_VARIANT_ANALYSIS_REQUIRED",
      "Product variant analysis requires finalized source identity"
    );
  }
  const rows = await db
    .select({
      analyzedContentHash: schema.assetAnalysisSnapshots.analyzedContentHash,
      analysis: schema.assetAnalysisSnapshots.analysis,
      createdAt: schema.assetAnalysisSnapshots.createdAt,
    })
    .from(schema.assetAnalysisSnapshots)
    .where(and(
      eq(schema.assetAnalysisSnapshots.workspaceId, input.workspaceId),
      inArray(schema.assetAnalysisSnapshots.analyzedContentHash, assets.map((asset) => asset.contentHash!)),
      eq(schema.assetAnalysisSnapshots.analyzerVersion, VISUAL_SEMANTIC_ANALYZER_VERSION),
      eq(schema.assetAnalysisSnapshots.schemaVersion, "ai-story-asset-visual-semantics.v1")
    ))
    .orderBy(desc(schema.assetAnalysisSnapshots.createdAt));
  const factsByHash = new Map<string, ProductVariantSemanticFacts | null>();
  for (const row of rows) {
    if (!factsByHash.has(row.analyzedContentHash)) factsByHash.set(row.analyzedContentHash, visualSemanticFacts(row.analysis));
  }
  const confirmedVariants: Record<string, string | null> = {};
  for (const assetId of productAssetIds) {
    const asset = assets.find((candidate) => candidate.id === assetId)!;
    const resolution = resolveProductVariantMapping({
      candidates: extractProductVariantCandidates(factsByHash.get(asset.contentHash!)),
      userIntent: input.userIntent,
      selectedVariant: input.selections.find((item) => item.assetId === assetId)?.variant,
      confirmed: true,
    });
    if (resolution.status === "analysis_required" || resolution.status === "selection_required" || resolution.status === "conflict") {
      throw new AiStoryProductVariantAuthorityError(
        resolution.code ?? "PRODUCT_VARIANT_SELECTION_REQUIRED",
        resolution.status === "conflict"
          ? "The requested product variant is not in the source analysis"
          : resolution.status === "analysis_required"
            ? "Product variant analysis is required before confirming the mapping"
            : "Choose one product variant before confirming the mapping"
      );
    }
    const grounding = resolveProductVariantVisualGrounding({
      sourceAssetId: assetId,
      sourceAssetContentHash: asset.contentHash,
      resolution,
    });
    if (grounding.status !== "confirmed") {
      throw new AiStoryProductVariantAuthorityError(
        grounding.code ?? "PRODUCT_VARIANT_VISUAL_REFERENCE_REQUIRED",
        "Choose or upload a clear reference for the confirmed Product variant"
      );
    }
    confirmedVariants[assetId] = resolution.variant;
  }
  return confirmedVariants;
}

export async function replaceAiStoryAssetLinks(
  db: Db,
  storyId: string,
  assetIds: string[],
  productAssetIds: string[] = [],
  typed: Partial<AiStoryAssetSelection> = {},
  confirmedVariants: Readonly<Record<string, string | null>> = {}
) {
  const plan = planAiStoryAssetLinkUsage({ ...typed, assetIds, productAssetIds });
  await db.delete(schema.aiStoryAssetLinks).where(eq(schema.aiStoryAssetLinks.storyId, storyId));
  if (plan.length === 0) return;
  await db.insert(schema.aiStoryAssetLinks).values(
    plan.map(({ assetId, usageType }) => ({
      storyId,
      assetId,
      usageType,
      confirmedVariant: usageType === "product_source" ? confirmedVariants[assetId] ?? null : null,
    }))
  );
}

export async function assertCampaignAssets(
  db: Db,
  campaignId: string,
  workspaceId: string,
  assetIds: string[]
) {
  if (assetIds.length === 0) return;
  const refs = await db
    .select({ assetId: schema.campaignAssetRefs.assetId })
    .from(schema.campaignAssetRefs)
    .where(
      and(
        eq(schema.campaignAssetRefs.campaignId, campaignId),
        inArray(schema.campaignAssetRefs.assetId, assetIds)
      )
    );
  const allowed = new Set(refs.map((r) => r.assetId));
  for (const id of assetIds) {
    if (!allowed.has(id)) {
      throw new CampaignAssetRefError(
        "CAMPAIGN_ASSET_REF_MISSING",
        `Asset ${id} is not linked to this Campaign`
      );
    }
  }
  const assets = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.workspaceId, workspaceId),
        inArray(schema.assets.id, assetIds)
      )
    );
  if (assets.length !== assetIds.length) {
    throw new Error("One or more assets are invalid for this workspace");
  }
}

export async function createAiStoryVersion(
  db: Db,
  input: {
    storyId: string;
    structuredContent: AiStoryStructuredDraft;
    sourceContextSnapshot: Record<string, unknown>;
    aiMetadata?: Record<string, unknown>;
    userEdited?: boolean;
    createdBy?: string | null;
  }
) {
  const existing = await db
    .select({ versionNumber: schema.aiStoryVersions.versionNumber })
    .from(schema.aiStoryVersions)
    .where(eq(schema.aiStoryVersions.storyId, input.storyId))
    .orderBy(asc(schema.aiStoryVersions.versionNumber));

  const versionNumber = nextAiStoryVersionNumber(existing);
  const [version] = await db
    .insert(schema.aiStoryVersions)
    .values({
      storyId: input.storyId,
      versionNumber,
      structuredContent: input.structuredContent,
      sourceContextSnapshot: input.sourceContextSnapshot,
      aiMetadata: input.aiMetadata ?? {},
      userEdited: input.userEdited ?? false,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (!version) throw new Error("Failed to create AI Story version");

  await db
    .update(schema.aiStories)
    .set({ currentVersionId: version.id, updatedAt: new Date() })
    .where(eq(schema.aiStories.id, input.storyId));

  return version;
}

export async function freezeAiStoryVersion(
  db: Db,
  input: {
    storyId: string;
    versionId: string;
    frozenBy: string;
    fromStatus: AiStoryStatus;
  }
) {
  const [version] = await db
    .select()
    .from(schema.aiStoryVersions)
    .where(
      and(
        eq(schema.aiStoryVersions.id, input.versionId),
        eq(schema.aiStoryVersions.storyId, input.storyId)
      )
    )
    .limit(1);
  if (!version) throw new Error("Story version not found");
  if (version.frozenAt) {
    assertAiStoryTransition(input.fromStatus, "ready_for_animation");
    await setAiStoryStatus(db, input.storyId, input.fromStatus, "ready_for_animation");
    return version;
  }

  const freezeAt = new Date();
  await assertCharacterContinuityBeforeStoryVersionFreeze(db, {
    storyId: input.storyId,
    storyVersionId: input.versionId,
    freezeAt,
  });

  const [frozen] = await db
    .update(schema.aiStoryVersions)
    .set({ frozenAt: freezeAt, frozenBy: input.frozenBy })
    .where(
      and(
        eq(schema.aiStoryVersions.id, input.versionId),
        isNull(schema.aiStoryVersions.frozenAt)
      )
    )
    .returning();
  if (!frozen) throw new Error("Story version is already frozen");

  assertAiStoryTransition(input.fromStatus, "approved");
  await setAiStoryStatus(db, input.storyId, input.fromStatus, "approved");
  assertAiStoryTransition("approved", "ready_for_animation");
  await setAiStoryStatus(db, input.storyId, "approved", "ready_for_animation");

  await db
    .update(schema.aiStories)
    .set({ currentVersionId: frozen.id, updatedAt: new Date() })
    .where(eq(schema.aiStories.id, input.storyId));

  return frozen;
}

export async function freezeSuccessorStoryVersionAfterCharacterBinding(
  db: Db,
  input: {
    storyId: string;
    frozenBy: string;
    bindingCreatedAt: string;
    voiceDnaId?: string | null;
    voiceDnaFingerprint?: string | null;
  }
) {
  const { createAuthorityPreservingSuccessor, lateBindingSuccessorDecision } = await import(
    "@/lib/ai-story-successor-authority"
  );
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai-story-late-character-successor:${input.storyId}`}))`);
    const [story] = await tx
      .select()
      .from(schema.aiStories)
      .where(eq(schema.aiStories.id, input.storyId))
      .limit(1)
      .for("update");
    if (!story?.currentVersionId) return null;
    const versions = await tx
      .select()
      .from(schema.aiStoryVersions)
      .where(eq(schema.aiStoryVersions.storyId, input.storyId))
      .orderBy(asc(schema.aiStoryVersions.versionNumber));
    const current = versions.find((version) => version.id === story.currentVersionId);
    if (!current?.frozenAt) return null;
    const historicalFrozenAt = current.frozenAt;
    const decision = lateBindingSuccessorDecision({
      status: story.status,
      frozenAt: historicalFrozenAt.toISOString(),
      bindingCreatedAt: input.bindingCreatedAt,
    });
    if (decision === "NONE" || decision === "IDEMPOTENT") return null;
    if (decision === "PRESERVE_AUTHORITY") {
      return createAuthorityPreservingSuccessor(tx as unknown as Db, {
        story,
        current,
        versions,
        frozenBy: input.frozenBy,
        bindingCreatedAt: input.bindingCreatedAt,
        voiceDnaId: input.voiceDnaId,
        voiceDnaFingerprint: input.voiceDnaFingerprint,
      });
    }

    const freezeAt = new Date(Math.max(Date.now(), new Date(input.bindingCreatedAt).getTime()));
    await assertCharacterContinuityBeforeStoryVersionFreeze(tx as unknown as Db, {
      storyId: input.storyId,
      storyVersionId: current.id,
      freezeAt,
    });
    const [successor] = await tx
      .insert(schema.aiStoryVersions)
      .values({
        storyId: input.storyId,
        versionNumber: nextAiStoryVersionNumber(versions),
        structuredContent: current.structuredContent,
        sourceContextSnapshot: current.sourceContextSnapshot,
        aiMetadata: current.aiMetadata,
        userEdited: current.userEdited,
        createdBy: input.frozenBy,
        frozenAt: freezeAt,
        frozenBy: input.frozenBy,
      })
      .returning();
    if (!successor) throw new Error("Failed to create successor Story Version");
    const [unchanged] = await tx
      .select({ frozenAt: schema.aiStoryVersions.frozenAt })
      .from(schema.aiStoryVersions)
      .where(eq(schema.aiStoryVersions.id, current.id))
      .limit(1);
    if (unchanged?.frozenAt?.toISOString() !== historicalFrozenAt.toISOString()) {
      throw new Error("Historical Story Version cutoff was mutated");
    }
    const switched = await tx
      .update(schema.aiStories)
      .set({ currentVersionId: successor.id, updatedAt: new Date() })
      .where(and(
        eq(schema.aiStories.id, input.storyId),
        eq(schema.aiStories.currentVersionId, current.id),
      ))
      .returning({ id: schema.aiStories.id });
    if (!switched[0]) throw new Error("Historical Story Version is no longer current");
    return { successor, historicalVersionId: current.id, historicalFrozenAt };
  });
}
