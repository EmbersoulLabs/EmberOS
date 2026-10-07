/**
 * Authority-preserving Story Version repair for a Character binding that
 * arrives after an already-approved execution cutoff.
 *
 * Eligible only where Generate Review already treats an approved Animation
 * Package as current execution authority:
 * ready_for_execution, generate_review, and execution_failed.
 * Those are the statuses accepted by the Generate Review route. Earlier
 * authoring statuses still use the bare successor path because they do not
 * yet have that package. Executing and execution_review are not repaired here.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AiStoryCanonicalSceneSchema,
  AiStoryOutlineVersionSchema,
  AiStoryScriptVersionSchema,
  AuthoritativeAnimationPackagePayloadSchema,
  nextAiStoryVersionNumber,
  validatePlanningConsistency,
  type AiStoryCanonicalScene,
  type AiStoryOutlineVersion,
  type AiStoryScriptVersion,
  type AnimationPackagePayload,
} from "@ceo-agent/shared";
import {
  assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent,
  buildAiStoryAnimationPackageCanonicalSceneAuthorityV1,
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  canonicalAiStorySceneIdV1,
  deterministicUuidFromFingerprint,
  finalizeAiStoryCanonicalScene,
  validateAiStoryCanonicalScenes,
} from "@ceo-agent/shared/server";
type Db = ReturnType<typeof getDb>;

export const EXECUTION_AUTHORITY_REPAIR_STATUSES = [
  "ready_for_execution",
  "generate_review",
  "execution_failed",
] as const;

export class StoryVersionSuccessorAuthorityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StoryVersionSuccessorAuthorityError";
    this.code = code;
  }
}

export function executionAuthorityRepairStatus(status: string) {
  return (EXECUTION_AUTHORITY_REPAIR_STATUSES as readonly string[]).includes(status);
}

const BARE_SUCCESSOR_STATUSES = ["draft", "generating", "review", "approved", "ready_for_animation"] as const;

export function lateBindingSuccessorDecision(input: {
  status: string;
  frozenAt: string | null;
  bindingCreatedAt: string;
}): "NONE" | "IDEMPOTENT" | "PRESERVE_AUTHORITY" | "BARE" {
  if (!input.frozenAt) return "NONE";
  if (input.bindingCreatedAt <= input.frozenAt) return "IDEMPOTENT";
  if (executionAuthorityRepairStatus(input.status)) return "PRESERVE_AUTHORITY";
  if ((BARE_SUCCESSOR_STATUSES as readonly string[]).includes(input.status)) return "BARE";
  return "NONE";
}

function fail(code: string, message: string): never {
  throw new StoryVersionSuccessorAuthorityError(code, message);
}

export function reissueFrozenOutline(
  historical: AiStoryOutlineVersion,
  input: {
    successorStoryVersionId: string;
    version: number;
    actorUserId: string;
    frozenAt: string;
  }
): AiStoryOutlineVersion {
  const {
    outlineVersionId: _outlineVersionId,
    contractVersion: _contractVersion,
    sourceHash: _sourceHash,
    status: _status,
    approvedBy: _approvedBy,
    approvedAt: _approvedAt,
    frozenAt: _frozenAt,
    storyVersionId: _storyVersionId,
    version: _version,
    createdBy: _createdBy,
    createdAt: _createdAt,
    supersedesOutlineVersionId: _supersedes,
    ...semantic
  } = historical;
  const draft = buildAiStoryOutlineVersion({
    ...semantic,
    storyVersionId: input.successorStoryVersionId,
    version: input.version,
    supersedesOutlineVersionId: historical.outlineVersionId,
    createdBy: input.actorUserId,
    createdAt: input.frozenAt,
  });
  return AiStoryOutlineVersionSchema.parse({
    ...draft,
    status: "FROZEN",
    approvedBy: input.actorUserId,
    approvedAt: input.frozenAt,
    frozenAt: input.frozenAt,
  });
}

export function reissueFrozenScript(
  historical: AiStoryScriptVersion,
  outline: AiStoryOutlineVersion,
  input: { successorStoryVersionId: string; version: number; actorUserId: string; frozenAt: string }
): AiStoryScriptVersion {
  const {
    scriptVersionId: _scriptVersionId,
    contractVersion: _contractVersion,
    sourceHash: _sourceHash,
    status: _status,
    approvedBy: _approvedBy,
    approvedAt: _approvedAt,
    frozenAt: _frozenAt,
    storyVersionId: _storyVersionId,
    outlineVersionId: _outlineVersionId,
    outlineSourceHash: _outlineSourceHash,
    version: _version,
    createdBy: _createdBy,
    createdAt: _createdAt,
    supersedesScriptVersionId: _supersedes,
    ...semantic
  } = historical;
  const draft = buildAiStoryScriptVersion({
    ...semantic,
    storyVersionId: input.successorStoryVersionId,
    outlineVersionId: outline.outlineVersionId,
    outlineSourceHash: outline.sourceHash,
    version: input.version,
    supersedesScriptVersionId: historical.scriptVersionId,
    createdBy: input.actorUserId,
    createdAt: input.frozenAt,
  });
  return AiStoryScriptVersionSchema.parse({
    ...draft,
    status: "FROZEN",
    approvedBy: input.actorUserId,
    approvedAt: input.frozenAt,
    frozenAt: input.frozenAt,
  });
}

function successorLocation(
  scene: AiStoryCanonicalScene,
  storyId: string,
  sceneId: string
): AiStoryCanonicalScene["locationBinding"] {
  if (scene.locationBinding.scope !== "EPHEMERAL_ENVIRONMENT") return scene.locationBinding;
  return {
    ...scene.locationBinding,
    id: deterministicUuidFromFingerprint("ai-story-ephemeral-environment-v1", sceneId),
    storyId,
    sceneId,
  };
}

export function reissueFrozenCanonicalScenes(input: {
  historicalScenes: readonly AiStoryCanonicalScene[];
  script: AiStoryScriptVersion;
  actorUserId: string;
  frozenAt: string;
}): AiStoryCanonicalScene[] {
  const historical = [...input.historicalScenes].sort((left, right) => left.order - right.order);
  const scriptScenes = [...input.script.scenes].sort((left, right) => left.order - right.order);
  if (!historical.length || historical.length !== scriptScenes.length) {
    fail("EXECUTION_AUTHORITY_ABSENT", "Canonical Scene set does not cover the frozen Script");
  }
  const scenes = historical.map((scene, index) => {
    const scriptScene = scriptScenes[index]!;
    if (scene.order !== index || scriptScene.order !== index) {
      fail("EXECUTION_AUTHORITY_AMBIGUOUS", "Canonical Scene order is not contiguous");
    }
    if (!scene.generationAuthority) {
      fail("EXECUTION_AUTHORITY_ABSENT", "Canonical Scene is missing generation authority");
    }
    const productBindings = scene.productBindings.map((binding) => {
      if (!("visualIdentityRequirement" in binding) || !binding.visualIdentityRequirement) {
        fail("EXECUTION_AUTHORITY_ABSENT", "Canonical Scene Product binding lacks an explicit visual identity requirement");
      }
      return {
        productAuthorityId: binding.productAuthorityId,
        sourceAssetId: binding.sourceAssetId,
        sourceAssetContentHash: binding.sourceAssetContentHash,
        ...(binding.confirmedVariant ? { confirmedVariant: binding.confirmedVariant } : {}),
        visualIdentityRequirement: binding.visualIdentityRequirement,
      };
    });
    const sceneId = canonicalAiStorySceneIdV1(input.script.storyId, input.script.storyVersionId, index);
    const drafted = finalizeAiStoryCanonicalScene({
      sceneId,
      orgId: scene.orgId,
      workspaceId: scene.workspaceId,
      campaignId: scene.campaignId,
      storyId: input.script.storyId,
      storyVersionId: input.script.storyVersionId,
      scriptVersionId: input.script.scriptVersionId,
      version: 1,
      order: index,
      sourceScriptSceneIds: [scriptScene.scriptSceneId],
      sourceScriptEntryIds: scriptScene.entries.map((entry) => entry.entryId),
      sceneFunction: scene.sceneFunction,
      sceneRole: scene.sceneRole,
      importance: scene.importance,
      locationBinding: successorLocation(scene, input.script.storyId, sceneId),
      locationState: scene.locationState,
      castBindings: scene.castBindings,
      productBindings,
      generationAuthority: scene.generationAuthority,
      entryState: scene.entryState,
      events: scriptScene.entries,
      exitState: scene.exitState,
      continuityFacts: scene.continuityFacts,
      timeRelation: scene.timeRelation,
      discontinuity: scene.discontinuity,
      mustKeep: scene.mustKeep,
      mustAvoid: scene.mustAvoid,
      lineageOperation: "CREATE",
      parentSceneVersionIds: [],
      createdBy: input.actorUserId,
      createdAt: input.frozenAt,
    });
    return AiStoryCanonicalSceneSchema.parse({
      ...drafted,
      status: "FROZEN",
      approvedBy: input.actorUserId,
      approvedAt: input.frozenAt,
      frozenAt: input.frozenAt,
    });
  });
  const issues = validateAiStoryCanonicalScenes(scenes, input.script);
  if (issues.some((issue) => issue.severity === "BLOCK")) {
    fail("SUCCESSOR_AUTHORITY_INVALID", "Successor Canonical Scene set failed validation");
  }
  return scenes;
}

export function rebuildSuccessorAnimationPackage(input: {
  historicalPayload: AnimationPackagePayload;
  storyId: string;
  successorStoryVersionId: string;
  scenes: readonly AiStoryCanonicalScene[];
}): AnimationPackagePayload {
  const authority = buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
    storyId: input.storyId,
    storyVersionId: input.successorStoryVersionId,
    scenePlan: input.historicalPayload.scenePlan,
    canonicalScenes: input.scenes,
  });
  const payload = AuthoritativeAnimationPackagePayloadSchema.parse({
    ...input.historicalPayload,
    status: "ready_for_execution",
    canonicalSceneAuthority: authority,
  });
  assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({
    storyId: input.storyId,
    storyVersionId: input.successorStoryVersionId,
    scenePlan: payload.scenePlan,
    canonicalScenes: input.scenes,
    authority: payload.canonicalSceneAuthority,
  });
  const consistencyReport = validatePlanningConsistency(payload);
  if (!consistencyReport.consistent) {
    fail("SUCCESSOR_AUTHORITY_INVALID", "Successor Animation Package is internally inconsistent");
  }
  return { ...payload, narrativeIntegration: consistencyReport, status: "ready_for_execution" };
}

export async function createAuthorityPreservingSuccessor(
  db: Db,
  input: {
    story: typeof schema.aiStories.$inferSelect;
    current: typeof schema.aiStoryVersions.$inferSelect;
    versions: readonly { versionNumber: number }[];
    frozenBy: string;
    bindingCreatedAt: string;
    voiceDnaId?: string | null;
    voiceDnaFingerprint?: string | null;
  }
) {
  if (!input.current.frozenAt) fail("EXECUTION_AUTHORITY_ABSENT", "Historical Story Version is not frozen");
  const historicalFrozenAt = input.current.frozenAt;
  const freezeAt = new Date(Math.max(Date.now(), new Date(input.bindingCreatedAt).getTime()));
  if (input.bindingCreatedAt > freezeAt.toISOString()) {
    fail("SUCCESSOR_AUTHORITY_INVALID", "Successor cutoff is earlier than the Character binding");
  }

  const packages = await db
    .select()
    .from(schema.aiStoryAnimationPackages)
    .where(and(
      eq(schema.aiStoryAnimationPackages.storyId, input.story.id),
      eq(schema.aiStoryAnimationPackages.storyVersionId, input.current.id),
      eq(schema.aiStoryAnimationPackages.status, "ready_for_execution"),
    ));
  if (packages.length === 0) fail("EXECUTION_AUTHORITY_ABSENT", "Approved Animation Package is absent");
  if (packages.length !== 1) fail("EXECUTION_AUTHORITY_AMBIGUOUS", "Approved Animation Package authority is ambiguous");
  const historicalPackage = packages[0]!;
  const historicalPayload = AuthoritativeAnimationPackagePayloadSchema.parse(historicalPackage.payload);

  const outlines = await db
    .select()
    .from(schema.aiStoryOutlineVersions)
    .where(and(
      eq(schema.aiStoryOutlineVersions.storyId, input.story.id),
      eq(schema.aiStoryOutlineVersions.storyVersionId, input.current.id),
      eq(schema.aiStoryOutlineVersions.status, "FROZEN"),
    ));
  if (outlines.length === 0) fail("EXECUTION_AUTHORITY_ABSENT", "Frozen Outline is absent");
  if (outlines.length !== 1) fail("EXECUTION_AUTHORITY_AMBIGUOUS", "Frozen Outline authority is ambiguous");
  const scripts = await db
    .select()
    .from(schema.aiStoryScriptVersions)
    .where(and(
      eq(schema.aiStoryScriptVersions.storyId, input.story.id),
      eq(schema.aiStoryScriptVersions.storyVersionId, input.current.id),
      eq(schema.aiStoryScriptVersions.status, "FROZEN"),
    ));
  if (scripts.length === 0) fail("EXECUTION_AUTHORITY_ABSENT", "Frozen Script is absent");
  if (scripts.length !== 1) fail("EXECUTION_AUTHORITY_AMBIGUOUS", "Frozen Script authority is ambiguous");
  const sceneRows = await db
    .select()
    .from(schema.aiStoryCanonicalSceneVersions)
    .where(and(
      eq(schema.aiStoryCanonicalSceneVersions.storyId, input.story.id),
      eq(schema.aiStoryCanonicalSceneVersions.storyVersionId, input.current.id),
      eq(schema.aiStoryCanonicalSceneVersions.status, "FROZEN"),
    ));
  if (!sceneRows.length) fail("EXECUTION_AUTHORITY_ABSENT", "Frozen Canonical Scene set is absent");

  const historicalOutline = AiStoryOutlineVersionSchema.parse({
    ...outlines[0]!.outline,
    status: outlines[0]!.status,
    approvedBy: outlines[0]!.approvedBy,
    approvedAt: outlines[0]!.approvedAt?.toISOString() ?? null,
    frozenAt: outlines[0]!.frozenAt?.toISOString() ?? null,
  });
  const historicalScript = AiStoryScriptVersionSchema.parse({
    ...scripts[0]!.script,
    status: scripts[0]!.status,
    approvedBy: scripts[0]!.approvedBy,
    approvedAt: scripts[0]!.approvedAt?.toISOString() ?? null,
    frozenAt: scripts[0]!.frozenAt?.toISOString() ?? null,
  });
  const historicalScenes = sceneRows.map((row) => AiStoryCanonicalSceneSchema.parse({
    ...row.snapshot,
    status: row.status,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    frozenAt: row.frozenAt?.toISOString() ?? null,
  }));
  const historicalSceneVersionIds = sceneRows.map((row) => row.sceneVersionId).sort();

  const bindingRows = await db
    .select()
    .from(schema.aiStoryEpisodeCharacterBindings)
    .where(eq(schema.aiStoryEpisodeCharacterBindings.storyId, input.story.id));
  const pinned = bindingRows.find((row) => {
    const snapshot = row.snapshot as { voiceDnaId?: string | null; voiceDnaFingerprint?: string | null };
    return row.createdAt.toISOString() === input.bindingCreatedAt
      && (snapshot.voiceDnaId ?? null) === (input.voiceDnaId ?? null)
      && (snapshot.voiceDnaFingerprint ?? null) === (input.voiceDnaFingerprint ?? null);
  });
  if (!pinned) fail("EXECUTION_AUTHORITY_ABSENT", "Late Character binding is not the exact persisted pin");

  const { assertCharacterContinuityBeforeStoryVersionFreeze } = await import("@/lib/ai-story-service");
  await assertCharacterContinuityBeforeStoryVersionFreeze(db, {
    storyId: input.story.id,
    storyVersionId: input.current.id,
    freezeAt,
  });

  const outlineVersions = await db
    .select({ version: schema.aiStoryOutlineVersions.version })
    .from(schema.aiStoryOutlineVersions)
    .where(eq(schema.aiStoryOutlineVersions.storyId, input.story.id));
  const scriptVersions = await db
    .select({ version: schema.aiStoryScriptVersions.version })
    .from(schema.aiStoryScriptVersions)
    .where(eq(schema.aiStoryScriptVersions.storyId, input.story.id));
  const frozenAt = freezeAt.toISOString();
  const successorId = randomUUID();
  const outline = reissueFrozenOutline(historicalOutline, {
    successorStoryVersionId: successorId,
    version: Math.max(0, ...outlineVersions.map((row) => row.version)) + 1,
    actorUserId: input.frozenBy,
    frozenAt,
  });
  const script = reissueFrozenScript(historicalScript, outline, {
    successorStoryVersionId: successorId,
    version: Math.max(0, ...scriptVersions.map((row) => row.version)) + 1,
    actorUserId: input.frozenBy,
    frozenAt,
  });
  const scenes = reissueFrozenCanonicalScenes({
    historicalScenes,
    script,
    actorUserId: input.frozenBy,
    frozenAt,
  });
  const payload = rebuildSuccessorAnimationPackage({
    historicalPayload,
    storyId: input.story.id,
    successorStoryVersionId: successorId,
    scenes,
  });

  const [successor] = await db.insert(schema.aiStoryVersions).values({
    id: successorId,
    storyId: input.story.id,
    versionNumber: nextAiStoryVersionNumber(input.versions),
    structuredContent: input.current.structuredContent,
    sourceContextSnapshot: {
      ...(input.current.sourceContextSnapshot ?? {}),
      action: "late_character_authority_successor",
      supersedesStoryVersionId: input.current.id,
      reason: "late_character_binding_after_freeze",
    },
    aiMetadata: input.current.aiMetadata,
    userEdited: input.current.userEdited,
    createdBy: input.frozenBy,
    createdAt: freezeAt,
    frozenAt: freezeAt,
    frozenBy: input.frozenBy,
  }).returning();
  if (!successor) fail("SUCCESSOR_AUTHORITY_INVALID", "Failed to create successor Story Version");

  await db.insert(schema.aiStoryOutlineVersions).values({
    outlineVersionId: outline.outlineVersionId,
    orgId: input.story.orgId,
    workspaceId: input.story.workspaceId,
    campaignId: input.story.campaignId,
    storyId: input.story.id,
    storyVersionId: successor.id,
    version: outline.version,
    contractVersion: outline.contractVersion,
    profileId: outline.profile.profileId,
    profileVersion: outline.profile.profileVersion,
    sourceHash: outline.sourceHash,
    status: "FROZEN",
    supersedesOutlineVersionId: historicalOutline.outlineVersionId,
    outline,
    createdBy: input.frozenBy,
    createdAt: freezeAt,
    approvedBy: input.frozenBy,
    approvedAt: freezeAt,
    frozenAt: freezeAt,
  });
  await db.insert(schema.aiStoryScriptVersions).values({
    scriptVersionId: script.scriptVersionId,
    orgId: input.story.orgId,
    workspaceId: input.story.workspaceId,
    campaignId: input.story.campaignId,
    storyId: input.story.id,
    storyVersionId: successor.id,
    outlineVersionId: outline.outlineVersionId,
    version: script.version,
    contractVersion: script.contractVersion,
    profileId: script.profileId,
    profileVersion: script.profileVersion,
    outlineSourceHash: script.outlineSourceHash,
    sourceHash: script.sourceHash,
    status: "FROZEN",
    supersedesScriptVersionId: historicalScript.scriptVersionId,
    script,
    createdBy: input.frozenBy,
    createdAt: freezeAt,
    approvedBy: input.frozenBy,
    approvedAt: freezeAt,
    frozenAt: freezeAt,
  });
  for (const scene of scenes) {
    await db.insert(schema.aiStoryCanonicalScenes).values({
      sceneId: scene.sceneId,
      orgId: scene.orgId,
      workspaceId: scene.workspaceId,
      campaignId: scene.campaignId,
      storyId: scene.storyId,
      currentVersion: scene.version,
      currentSceneVersionId: scene.sceneVersionId,
      status: "FROZEN",
      createdBy: input.frozenBy,
      createdAt: freezeAt,
      updatedAt: freezeAt,
    });
    await db.insert(schema.aiStoryCanonicalSceneVersions).values({
      sceneVersionId: scene.sceneVersionId,
      sceneId: scene.sceneId,
      orgId: scene.orgId,
      workspaceId: scene.workspaceId,
      campaignId: scene.campaignId,
      storyId: scene.storyId,
      storyVersionId: successor.id,
      scriptVersionId: script.scriptVersionId,
      version: scene.version,
      sceneOrder: scene.order,
      contractVersion: scene.contractVersion,
      sourceHash: scene.sourceHash,
      fingerprint: scene.fingerprint,
      status: "FROZEN",
      snapshot: scene,
      createdBy: input.frozenBy,
      createdAt: freezeAt,
      approvedBy: input.frozenBy,
      approvedAt: freezeAt,
      frozenAt: freezeAt,
    });
  }
  const packageId = randomUUID();
  const [animationPackage] = await db.insert(schema.aiStoryAnimationPackages).values({
    id: packageId,
    orgId: input.story.orgId,
    workspaceId: input.story.workspaceId,
    campaignId: input.story.campaignId,
    storyId: input.story.id,
    storyVersionId: successor.id,
    status: "ready_for_execution",
    payload,
    consistencyReport: payload.narrativeIntegration,
    createdAt: freezeAt,
    updatedAt: freezeAt,
    approvedAt: freezeAt,
    approvedBy: input.frozenBy,
  }).returning();
  if (!animationPackage) fail("SUCCESSOR_AUTHORITY_INVALID", "Failed to persist successor Animation Package");

  const [historicalVersion] = await db
    .select({ frozenAt: schema.aiStoryVersions.frozenAt })
    .from(schema.aiStoryVersions)
    .where(eq(schema.aiStoryVersions.id, input.current.id))
    .limit(1);
  if (historicalVersion?.frozenAt?.toISOString() !== historicalFrozenAt.toISOString()) {
    fail("HISTORICAL_STORY_VERSION_MUTATED", "Historical Story Version cutoff was mutated");
  }
  const [historicalPackageAfter] = await db
    .select({
      status: schema.aiStoryAnimationPackages.status,
      storyVersionId: schema.aiStoryAnimationPackages.storyVersionId,
    })
    .from(schema.aiStoryAnimationPackages)
    .where(eq(schema.aiStoryAnimationPackages.id, historicalPackage.id))
    .limit(1);
  if (
    historicalPackageAfter?.status !== "ready_for_execution" ||
    historicalPackageAfter.storyVersionId !== input.current.id
  ) {
    fail("HISTORICAL_STORY_VERSION_MUTATED", "Historical Animation Package was mutated");
  }
  const historicalScenesAfter = await db
    .select({
      sceneVersionId: schema.aiStoryCanonicalSceneVersions.sceneVersionId,
      storyVersionId: schema.aiStoryCanonicalSceneVersions.storyVersionId,
      status: schema.aiStoryCanonicalSceneVersions.status,
    })
    .from(schema.aiStoryCanonicalSceneVersions)
    .where(eq(schema.aiStoryCanonicalSceneVersions.storyVersionId, input.current.id));
  const afterIds = historicalScenesAfter.map((row) => row.sceneVersionId).sort();
  if (
    afterIds.join() !== historicalSceneVersionIds.join() ||
    historicalScenesAfter.some((row) => row.status !== "FROZEN" || row.storyVersionId !== input.current.id)
  ) {
    fail("HISTORICAL_STORY_VERSION_MUTATED", "Historical Canonical Scene versions were mutated");
  }

  const switched = await db
    .update(schema.aiStories)
    .set({ currentVersionId: successor.id, updatedAt: freezeAt })
    .where(and(
      eq(schema.aiStories.id, input.story.id),
      eq(schema.aiStories.currentVersionId, input.current.id),
    ))
    .returning({ id: schema.aiStories.id });
  if (!switched[0]) {
    fail("HISTORICAL_STORY_VERSION_NO_LONGER_CURRENT", "Story current version changed before successor authority was committed");
  }
  return {
    successor,
    animationPackage,
    scenes,
    historicalVersionId: input.current.id,
    historicalFrozenAt,
  };
}
