import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION,
  AiStoryEpisodeCostEstimateSchema,
  AiStoryEpisodeRevisionExecutionPlanSchema,
  AiStoryEpisodeRevisionRequestSchema,
  AiStoryRevisionImpactSchema,
  ENDING_REVISION_SCOPE_GATE,
  REFERENCE_REVISION_IMPACT_GATE,
  REGENERATE_APPROVED_MOMENT_DENIED,
  mapRevisionInternalStatusToUserStatus,
  type AiStoryEpisodeCommercialAuthorizationStatus,
  type AiStoryEpisodeCostEstimate,
  type AiStoryEpisodeRevisionExecutionPlan,
  type AiStoryEpisodeRevisionHistoryEntry,
  type AiStoryEpisodeRevisionInternalStatus,
  type AiStoryEpisodeRevisionRequest,
  type AiStoryEpisodeRevisionRequestedChange,
  type AiStoryEpisodeRevisionTarget,
  type AiStoryEpisodeRevisionType,
  type AiStoryRevisionImpact,
} from "./ai-story-episode-revision-authority";
import {
  AiStoryScriptVersionSchema,
  type AiStoryScriptVersion,
} from "./ai-story-script";

type AiStoryScriptDialogueEntry = Extract<
  AiStoryScriptVersion["scenes"][number]["entries"][number],
  { type: "DIALOGUE" }
>;
import { buildAiStoryScriptVersion } from "./ai-story-script.server";
import type { AiStoryGenerationPlan, AiStoryGenerationUnit } from "./ai-story-generation-unit";
import {
  AiStoryNarrativeEditorialPlanSchema,
  type AiStoryEditorialTimelineEntry,
  type AiStoryNarrativeEditorialPlan,
} from "./ai-story-narrative-editorial-plan";
import { computeAiStoryNarrativeEditorialPlanFingerprint } from "./ai-story-narrative-editorial-plan.server";
import {
  compileAiStoryAssemblyV2Plan,
  type CompileAiStoryAssemblyV2PlanInput,
} from "./ai-story-assembly-v2.server";
import type { AiStoryAssemblyV2Plan, AiStoryAssemblyV2SourceMedia } from "./ai-story-assembly-v2";
import {
  compileAiStoryCharacterDialoguePerformanceAuthority,
} from "./ai-story-native-dialogue.server";
import type { AiStoryCharacterDialoguePerformanceAuthority } from "./ai-story-native-dialogue";
import {
  CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL,
  CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
  ProviderUsdPricingRuleSchema,
  estimateProviderCostUsd,
  withIntegrity,
  type ProviderUsdPricingRule,
} from "./certification-commercial-authority";

export class AiStoryEpisodeRevisionError extends Error {
  constructor(
    readonly code:
      | "REVISION_REQUEST_INVALID"
      | "DIALOGUE_ENTRY_NOT_FOUND"
      | "DIALOGUE_TEXT_UNCHANGED"
      | "MOMENT_TARGET_UNRESOLVED"
      | "HISTORICAL_SCRIPT_MUTATION_DENIED"
      | typeof ENDING_REVISION_SCOPE_GATE
      | typeof REFERENCE_REVISION_IMPACT_GATE
      | typeof REGENERATE_APPROVED_MOMENT_DENIED
      | "COMMERCIAL_AUTHORIZATION_REQUIRED"
      | "COST_ESTIMATE_UNSUPPORTED_RESOLUTION"
      | "PACING_SOURCE_MEDIA_INSUFFICIENT"
      | "REVISION_SOURCE_VERSION_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "AiStoryEpisodeRevisionError";
  }
}

function fail(
  code: AiStoryEpisodeRevisionError["code"],
  message: string
): never {
  throw new AiStoryEpisodeRevisionError(code, message);
}

const EARLY_EDITORIAL_ROLES = new Set([
  "ESTABLISH",
  "ACTION",
  "DETAIL",
  "DISCOVERY",
]);
const ENDING_EDITORIAL_ROLES = new Set(["PAYOFF", "HERO", "CTA"]);

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function addMoney(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + Number(value), 0);
  return (Math.round(total * 100) / 100).toFixed(2);
}

function outputPixels(
  resolution: "480p" | "720p" | "1080p",
  aspectRatio: "9:16" | "16:9" | "1:1"
): { width: number; height: number } {
  const short = resolution === "480p" ? 480 : resolution === "720p" ? 720 : 1080;
  if (aspectRatio === "9:16") {
    return { width: short, height: resolution === "480p" ? 854 : Math.round((short * 16) / 9) };
  }
  if (aspectRatio === "16:9") {
    return { width: resolution === "480p" ? 854 : Math.round((short * 16) / 9), height: short };
  }
  return { width: short, height: short };
}

export function certifiedSeedanceEpisodePricingRule(input: {
  readonly durationSeconds: number;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly resolution: "480p" | "720p" | "1080p";
  readonly createdBy: string;
  readonly createdAt?: string;
}): ProviderUsdPricingRule {
  if (input.resolution !== "480p") {
    fail(
      "COST_ESTIMATE_UNSUPPORTED_RESOLUTION",
      "Live Episode cost estimate uses the certified Seedance 2.0 480p official token rate only"
    );
  }
  const pixels = outputPixels(input.resolution, input.aspectRatio);
  return ProviderUsdPricingRuleSchema.parse(
    withIntegrity({
      contractVersion: "1" as const,
      providerUsdPricingRuleId: deterministicUuidFromFingerprint(
        "ai-story-episode-pricing-rule",
        `${input.durationSeconds}:${input.aspectRatio}:${input.resolution}`
      ),
      providerKey: "BYTEPLUS_MODELARK" as const,
      modelId: CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID,
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
      durationSeconds: input.durationSeconds,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      inputVideoIncluded: false as const,
      outputWidthPixels: pixels.width,
      outputHeightPixels: pixels.height,
      outputFrameRate: 24,
      currency: "USD" as const,
      usdPerMillionTokens: CERTIFIED_BYTEPLUS_SEEDANCE_20_NO_VIDEO_INPUT_480P_USD_PER_MILLION,
      costBasis: "OFFICIAL_TOKEN_RATE_ESTIMATE" as const,
      sourceUrl: CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL,
      version: CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      effectiveTo: null,
      createdBy: input.createdBy,
      createdAt: input.createdAt ?? "2026-09-21T00:00:00.000Z",
    })
  );
}

export function computeAiStoryRevisionFingerprint(
  input: Pick<
    AiStoryEpisodeRevisionRequest,
    | "storyId"
    | "storyVersionId"
    | "episodeId"
    | "revisionType"
    | "target"
    | "requestedChange"
    | "sourceVersionFingerprint"
    | "sourceVersion"
    | "revisionVersion"
    | "supersedesRevisionRequestId"
  >
): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION,
    ...input,
  });
}

export function createAiStoryEpisodeRevisionRequest(input: {
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly episodeId: string;
  readonly revisionType: AiStoryEpisodeRevisionType;
  readonly target: AiStoryEpisodeRevisionTarget;
  readonly requestedChange: AiStoryEpisodeRevisionRequestedChange;
  readonly sourceVersionFingerprint: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly sourceVersion?: number;
  readonly revisionVersion?: number;
  readonly supersedesRevisionRequestId?: string | null;
  readonly status?: AiStoryEpisodeRevisionInternalStatus;
}): AiStoryEpisodeRevisionRequest {
  const sourceVersion = input.sourceVersion ?? 1;
  const revisionVersion = input.revisionVersion ?? sourceVersion + 1;
  const withoutIdentity = {
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    episodeId: input.episodeId,
    revisionType: input.revisionType,
    target: input.target,
    requestedChange: input.requestedChange,
    sourceVersionFingerprint: input.sourceVersionFingerprint,
    sourceVersion,
    revisionVersion,
    supersedesRevisionRequestId: input.supersedesRevisionRequestId ?? null,
  };
  const revisionFingerprint = computeAiStoryRevisionFingerprint(withoutIdentity);
  return AiStoryEpisodeRevisionRequestSchema.parse({
    ...withoutIdentity,
    revisionRequestId: deterministicUuidFromFingerprint(
      "ai-story-episode-revision-request",
      revisionFingerprint
    ),
    contractVersion: AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    status: input.status ?? "REQUESTED",
    revisionFingerprint,
  });
}

function findDialogueEntry(
  script: AiStoryScriptVersion,
  entryId: string
): { scene: AiStoryScriptVersion["scenes"][number]; entry: AiStoryScriptDialogueEntry } {
  for (const scene of script.scenes) {
    const entry = scene.entries.find((candidate) => candidate.entryId === entryId);
    if (entry?.type === "DIALOGUE") return { scene, entry };
  }
  fail("DIALOGUE_ENTRY_NOT_FOUND", `No Script DIALOGUE entry ${entryId}`);
}

export function applyAiStoryDialogueRevision(input: {
  readonly script: AiStoryScriptVersion;
  readonly entryId: string;
  readonly nextText: string;
  readonly createdBy: string;
  readonly createdAt: string;
}): {
  readonly previousScript: AiStoryScriptVersion;
  readonly nextScript: AiStoryScriptVersion;
} {
  const originalSnapshot = JSON.stringify(input.script);
  const previousScript = AiStoryScriptVersionSchema.parse(
    JSON.parse(originalSnapshot)
  );
  const located = findDialogueEntry(previousScript, input.entryId);
  const nextText = input.nextText.trim();
  if (!nextText) fail("REVISION_REQUEST_INVALID", "Dialogue text is empty");
  if (located.entry.line === nextText) {
    fail("DIALOGUE_TEXT_UNCHANGED", "Requested dialogue equals the frozen Script line");
  }
  const nextScenes = previousScript.scenes.map((scene) => ({
    ...scene,
    entries: scene.entries.map((entry) =>
      entry.entryId === input.entryId && entry.type === "DIALOGUE"
        ? { ...entry, line: nextText }
        : entry
    ),
  }));
  const {
    scriptVersionId: _id,
    contractVersion: _cv,
    sourceHash: _hash,
    status: _status,
    approvedBy: _approvedBy,
    approvedAt: _approvedAt,
    frozenAt: _frozenAt,
    ...createInput
  } = previousScript;
  const draft = buildAiStoryScriptVersion({
    ...createInput,
    version: previousScript.version + 1,
    scenes: nextScenes,
    supersedesScriptVersionId: previousScript.scriptVersionId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
  const nextScript = AiStoryScriptVersionSchema.parse({
    ...draft,
    status: "FROZEN",
    approvedBy: input.createdBy,
    approvedAt: input.createdAt,
    frozenAt: input.createdAt,
  });
  if (JSON.stringify(input.script) !== originalSnapshot) {
    fail("HISTORICAL_SCRIPT_MUTATION_DENIED", "Historical Script object was mutated");
  }
  const originalLine = findDialogueEntry(input.script, input.entryId).entry.line;
  if (originalLine === nextText) {
    fail("HISTORICAL_SCRIPT_MUTATION_DENIED", "Historical Script dialogue was mutated in place");
  }
  return { previousScript, nextScript };
}

export function resolveRevisionMomentTarget(input: {
  readonly target: AiStoryEpisodeRevisionTarget;
  readonly units: readonly AiStoryGenerationUnit[];
  readonly editorialPlan: AiStoryNarrativeEditorialPlan;
}): AiStoryGenerationUnit {
  if (input.target.kind !== "MOMENT") {
    fail("MOMENT_TARGET_UNRESOLVED", "Moment target required");
  }
  const target = input.target;
  const matches = input.units.filter((unit) => {
    const checks: boolean[] = [];
    if (target.generationUnitId) {
      checks.push(unit.generationUnitId === target.generationUnitId);
    }
    if (target.directorShotId) {
      checks.push(unit.directorShotId === target.directorShotId);
    }
    if (target.sceneId) {
      checks.push(unit.sceneId === target.sceneId);
    }
    if (target.editorialTimelineEntryId) {
      const entry = input.editorialPlan.timeline.find(
        (candidate) => candidate.timelineEntryId === target.editorialTimelineEntryId
      );
      checks.push(entry?.generationUnitId === unit.generationUnitId);
    }
    if (target.momentId) {
      checks.push(
        unit.generationUnitId === target.momentId ||
          unit.directorShotId === target.momentId
      );
    }
    return checks.length > 0 && checks.every(Boolean);
  });
  const uniqueUnits = unique(matches.map((unit) => unit.generationUnitId));
  if (uniqueUnits.length !== 1) {
    fail(
      "MOMENT_TARGET_UNRESOLVED",
      "Moment target must resolve to exactly one Generation Unit using canonical identity"
    );
  }
  return matches[0]!;
}

function editorialRoleOf(
  unitId: string,
  editorialPlan: AiStoryNarrativeEditorialPlan
): string | null {
  return (
    editorialPlan.timeline.find((entry) => entry.generationUnitId === unitId)?.editorialRole ??
    null
  );
}

function unitsUsingDialogue(
  units: readonly AiStoryGenerationUnit[],
  entryId: string
): AiStoryGenerationUnit[] {
  return units.filter((unit) => (unit.nativeDialogueEntryIds ?? []).includes(entryId));
}

function unitsUsingReference(
  units: readonly AiStoryGenerationUnit[],
  change: Extract<AiStoryEpisodeRevisionRequestedChange, { kind: "REFERENCE_BINDING" }>
): AiStoryGenerationUnit[] {
  return units.filter((unit) => {
    if (change.referenceKind === "PRODUCT" || change.referenceKind === "VISUAL") {
      return (
        unit.sourceAuthority.productAuthorityIds.includes(change.previousAuthorityId) ||
        unit.inheritedContinuity.productAuthorityIds.includes(change.previousAuthorityId) ||
        (change.previousSourceAssetId
          ? unit.sourceAuthority.productSourceAssetIds.includes(change.previousSourceAssetId)
          : false)
      );
    }
    if (change.referenceKind === "LOCATION") {
      return (
        unit.sourceAuthority.locationId === change.previousAuthorityId ||
        unit.inheritedContinuity.locationId === change.previousAuthorityId
      );
    }
    if (change.referenceKind === "CHARACTER") {
      return (
        unit.sourceAuthority.characterIds.includes(change.previousAuthorityId) ||
        unit.inheritedContinuity.characterIds.includes(change.previousAuthorityId)
      );
    }
    return (
      unit.sourceAuthority.productAuthorityIds.includes(change.previousAuthorityId) ||
      unit.sourceAuthority.characterIds.includes(change.previousAuthorityId)
    );
  });
}

function endingUnits(
  units: readonly AiStoryGenerationUnit[],
  editorialPlan: AiStoryNarrativeEditorialPlan
): AiStoryGenerationUnit[] {
  const byRole = units.filter((unit) =>
    ENDING_EDITORIAL_ROLES.has(editorialRoleOf(unit.generationUnitId, editorialPlan) ?? "")
  );
  if (byRole.length) return byRole;
  const lastOrder = Math.max(...units.map((unit) => unit.order));
  return units.filter((unit) => unit.order === lastOrder);
}

export function computeAiStoryRevisionImpact(input: {
  readonly revisionRequest: AiStoryEpisodeRevisionRequest;
  readonly script: AiStoryScriptVersion;
  readonly units: readonly AiStoryGenerationUnit[];
  readonly editorialPlan: AiStoryNarrativeEditorialPlan;
  readonly nativeDialogueAuthorities?: readonly AiStoryCharacterDialoguePerformanceAuthority[];
  readonly sourceMedia?: readonly AiStoryAssemblyV2SourceMedia[];
}): AiStoryRevisionImpact {
  const request = AiStoryEpisodeRevisionRequestSchema.parse(input.revisionRequest);
  const allUnitIds = input.units.map((unit) => unit.generationUnitId);
  let impactedUnits: AiStoryGenerationUnit[] = [];
  let impactedScriptEntryIds: string[] = [];
  let impactedNativeDialogueAuthorityIds: string[] = [];
  let requiresProviderExecution = false;
  let providerRegenerationReason: string | null = null;
  let requiresEditorialRecompile = true;
  let endingScopeGate: "PASS" | "BLOCK" | undefined;
  let referenceImpactGate: "PASS" | "BLOCK" | undefined;

  if (request.revisionType === "EDIT_DIALOGUE") {
    const entryId =
      request.target.kind === "DIALOGUE_ENTRY"
        ? request.target.entryId
        : request.requestedChange.kind === "DIALOGUE_TEXT"
          ? request.requestedChange.entryId
          : "";
    findDialogueEntry(input.script, entryId);
    impactedScriptEntryIds = [entryId];
    impactedUnits = unitsUsingDialogue(input.units, entryId);
    if (!impactedUnits.length) {
      fail("DIALOGUE_ENTRY_NOT_FOUND", "Dialogue revision has no bound Generation Unit");
    }
    impactedNativeDialogueAuthorityIds = (input.nativeDialogueAuthorities ?? [])
      .filter((authority) => authority.dialogueEntryId === entryId)
      .map((authority) => authority.dialogueAuthorityId);
    requiresProviderExecution = true;
    providerRegenerationReason =
      "Spoken Script text changed; native dialogue performance on the affected Unit is stale";
  } else if (request.revisionType === "ADJUST_ENDING") {
    impactedUnits = endingUnits(input.units, input.editorialPlan);
    const early = impactedUnits.filter((unit) =>
      EARLY_EDITORIAL_ROLES.has(editorialRoleOf(unit.generationUnitId, input.editorialPlan) ?? "")
    );
    if (!impactedUnits.length || early.length || impactedUnits.length === input.units.length) {
      endingScopeGate = "BLOCK";
      fail(
        ENDING_REVISION_SCOPE_GATE,
        "Ending revision must version only ending-related Story/Unit authority"
      );
    }
    endingScopeGate = "PASS";
    requiresProviderExecution = request.requestedChange.kind === "ENDING_INTENT"
      && request.requestedChange.nextIntent !== "no CTA";
    if (request.requestedChange.kind === "ENDING_INTENT" && request.requestedChange.nextIntent === "no CTA") {
      requiresProviderExecution = false;
      providerRegenerationReason = null;
      requiresEditorialRecompile = true;
    } else {
      providerRegenerationReason = "Ending intent changed; final narrative beat Units are stale";
    }
  } else if (request.revisionType === "ADJUST_PACING") {
    impactedUnits = [];
    requiresProviderExecution = false;
    requiresEditorialRecompile = true;
    if (input.sourceMedia?.length) {
      const insufficient = input.editorialPlan.timeline.filter((entry) => {
        const source = input.sourceMedia!.find(
          (media) => media.generationUnitId === entry.generationUnitId
        );
        if (!source) return false;
        const requiredMs = Math.round(scalePacingRange(entry, request).maxSeconds * 1000);
        return source.durationMs < requiredMs;
      });
      if (insufficient.length) {
        impactedUnits = input.units.filter((unit) =>
          insufficient.some((entry) => entry.generationUnitId === unit.generationUnitId)
        );
        requiresProviderExecution = true;
        providerRegenerationReason =
          "Existing source media cannot satisfy the revised pacing duration authority";
      }
    }
  } else if (request.revisionType === "REPLACE_REFERENCE") {
    if (request.requestedChange.kind !== "REFERENCE_BINDING") {
      fail("REVISION_REQUEST_INVALID", "Reference revision requires a reference binding change");
    }
    impactedUnits = unitsUsingReference(input.units, request.requestedChange);
    referenceImpactGate = "PASS";
    if (impactedUnits.length === input.units.length && request.requestedChange.referenceKind === "PRODUCT") {
      referenceImpactGate = "BLOCK";
      fail(
        REFERENCE_REVISION_IMPACT_GATE,
        "Product reference replacement must not invalidate unrelated Units"
      );
    }
    requiresProviderExecution = impactedUnits.length > 0;
    providerRegenerationReason = requiresProviderExecution
      ? "Reference binding changed for Units grounded to the replaced identity"
      : null;
  } else if (request.revisionType === "REGENERATE_MOMENT") {
    const unit = resolveRevisionMomentTarget({
      target: request.target.kind === "MOMENT"
        ? request.target
        : {
            kind: "MOMENT",
            generationUnitId:
              request.requestedChange.kind === "REGENERATE_MOMENT"
                ? request.requestedChange.generationUnitId
                : undefined,
          },
      units: input.units,
      editorialPlan: input.editorialPlan,
    });
    impactedUnits = [unit];
    requiresProviderExecution = true;
    providerRegenerationReason = "Exact Unit regeneration requested";
  } else {
    fail("REVISION_REQUEST_INVALID", "Unknown revision type");
  }

  const impactedGenerationUnitIds = unique(
    impactedUnits.map((unit) => unit.generationUnitId)
  );
  const preservedGenerationUnitIds = allUnitIds.filter(
    (id) => !impactedGenerationUnitIds.includes(id)
  );
  const impactedDirectorShotIds = unique(
    impactedUnits.map((unit) => unit.directorShotId)
  );
  const impactedSceneIds = unique(impactedUnits.map((unit) => unit.sceneId));
  const impactedEditorialEntryIds = unique(
    input.editorialPlan.timeline
      .filter((entry) => impactedGenerationUnitIds.includes(entry.generationUnitId))
      .map((entry) => entry.timelineEntryId)
  );
  const requiresAssemblyRebuild =
    requiresEditorialRecompile || requiresProviderExecution || request.revisionType === "ADJUST_PACING";

  return AiStoryRevisionImpactSchema.parse({
    revisionRequestId: request.revisionRequestId,
    impactedScriptEntryIds,
    impactedSceneIds,
    impactedDirectorShotIds,
    impactedGenerationUnitIds,
    preservedGenerationUnitIds,
    impactedEditorialEntryIds,
    impactedNativeDialogueAuthorityIds,
    requiresProviderExecution,
    requiresEditorialRecompile,
    requiresAssemblyRebuild,
    providerRegenerationReason,
    endingScopeGate,
    referenceImpactGate,
    fingerprint: sha256CanonicalIntegrityHash({
      revisionRequestId: request.revisionRequestId,
      impactedGenerationUnitIds,
      preservedGenerationUnitIds,
      requiresProviderExecution,
    }),
  });
}

function scalePacingRange(
  entry: AiStoryEditorialTimelineEntry,
  request: AiStoryEpisodeRevisionRequest
): { minSeconds: number; maxSeconds: number } {
  const current = entry.targetDurationRange;
  const change =
    request.requestedChange.kind === "EPISODE_PACING" ? request.requestedChange : null;
  const pacing = change?.nextPacing ?? "NATURAL";
  const reactionSpeed = change?.reactionSpeed;
  const heroHold = change?.heroHold;
  const cutRhythm = change?.cutRhythm;
  if (pacing === "NATURAL" && !reactionSpeed && !heroHold && !cutRhythm) {
    return current;
  }
  let min = current.minSeconds;
  let max = current.maxSeconds;
  if (pacing === "FAST" || cutRhythm === "FAST") {
    min = Math.max(1, Number((min * 0.7).toFixed(2)));
    max = Math.max(min, Number((max * 0.7).toFixed(2)));
  }
  if (pacing === "RELAXED" || cutRhythm === "RELAXED") {
    min = Number((min * 1.1).toFixed(2));
    max = Number((max * 1.25).toFixed(2));
  }
  if (entry.pacingFunction === "REACTION_BREATH" || entry.editorialRole === "REACTION") {
    if (pacing === "FAST" || reactionSpeed === "FAST") {
      min = 1;
      max = Math.min(max, 2);
    } else if (reactionSpeed === "SLOW") {
      min = Math.max(min, 2);
      max = Math.max(max, 3);
    }
  }
  if (
    entry.pacingFunction === "PAYOFF_HOLD" ||
    entry.editorialRole === "HERO" ||
    entry.editorialRole === "PAYOFF"
  ) {
    if (pacing === "FAST" || heroHold === "SHORT") {
      min = Math.max(1, Number((min * 0.75).toFixed(2)));
      max = Math.max(min, Number((max * 0.75).toFixed(2)));
    } else if (heroHold === "LONG") {
      max = Number((max * 1.25).toFixed(2));
    }
  }
  if (max < min) max = min;
  return { minSeconds: min, maxSeconds: max };
}

export function applyAiStoryPacingRevision(input: {
  readonly editorialPlan: AiStoryNarrativeEditorialPlan;
  readonly revisionRequest: AiStoryEpisodeRevisionRequest;
  readonly createdBy: string;
  readonly createdAt: string;
}): AiStoryNarrativeEditorialPlan {
  const previous = input.editorialPlan;
  const timeline = previous.timeline.map((entry) => ({
    ...entry,
    targetDurationRange: scalePacingRange(entry, input.revisionRequest),
    usesFullSourceDuration: false as const,
  }));
  const withoutFingerprint = {
    ...previous,
    editorialPlanId: deterministicUuidFromFingerprint(
      "ai-story-editorial-plan",
      `${previous.editorialPlanId}:${input.revisionRequest.revisionFingerprint}`
    ),
    version: previous.version + 1,
    timeline,
    storyPacingIntent: {
      ...previous.storyPacingIntent,
      storyPacingIntentId: deterministicUuidFromFingerprint(
        "ai-story-story-pacing-intent",
        input.revisionRequest.revisionFingerprint
      ),
      notes: [
        ...previous.storyPacingIntent.notes,
        `Episode pacing revision ${
          input.revisionRequest.requestedChange.kind === "EPISODE_PACING"
            ? input.revisionRequest.requestedChange.nextPacing
            : "NATURAL"
        }`,
      ],
    },
    supersedesEditorialPlanId: previous.editorialPlanId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    approvedBy: input.createdBy,
    approvedAt: input.createdAt,
    frozenAt: input.createdAt,
    status: "FROZEN" as const,
  };
  const editorialFingerprint = computeAiStoryNarrativeEditorialPlanFingerprint(withoutFingerprint);
  return AiStoryNarrativeEditorialPlanSchema.parse({
    ...withoutFingerprint,
    editorialFingerprint,
  });
}

export function applyAiStoryEndingRevision(input: {
  readonly editorialPlan: AiStoryNarrativeEditorialPlan;
  readonly revisionRequest: AiStoryEpisodeRevisionRequest;
  readonly createdBy: string;
  readonly createdAt: string;
}): AiStoryNarrativeEditorialPlan {
  const intent =
    input.revisionRequest.requestedChange.kind === "ENDING_INTENT"
      ? input.revisionRequest.requestedChange.nextIntent
      : "stronger CTA";
  const omitCta = intent === "no CTA";
  const timeline = omitCta
    ? input.editorialPlan.timeline
        .filter((entry) => entry.editorialRole !== "CTA")
        .map((entry, order) => ({ ...entry, order }))
    : input.editorialPlan.timeline.map((entry, order) =>
        ENDING_EDITORIAL_ROLES.has(entry.editorialRole)
          ? {
              ...entry,
              order,
              requiredNarrativeInformation: [
                ...entry.requiredNarrativeInformation,
                `Ending intent: ${intent}`,
              ],
            }
          : entry
      );
  const dispositions = omitCta
    ? input.editorialPlan.dispositions.map((disposition) => {
        const entry = input.editorialPlan.timeline.find(
          (item) => item.generationUnitId === disposition.generationUnitId
        );
        if (entry?.editorialRole !== "CTA") return disposition;
        return {
          ...disposition,
          disposition: "OMIT" as const,
          omissionReason: "EDITORIAL_COMPRESSION" as const,
        };
      })
    : input.editorialPlan.dispositions;
  const withoutFingerprint = {
    ...input.editorialPlan,
    editorialPlanId: deterministicUuidFromFingerprint(
      "ai-story-editorial-plan",
      `${input.editorialPlan.editorialPlanId}:${input.revisionRequest.revisionFingerprint}`
    ),
    version: input.editorialPlan.version + 1,
    timeline,
    dispositions,
    storyPacingIntent: {
      ...input.editorialPlan.storyPacingIntent,
      notes: [
        ...input.editorialPlan.storyPacingIntent.notes,
        `Episode ending revision: ${intent}`,
      ],
    },
    supersedesEditorialPlanId: input.editorialPlan.editorialPlanId,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    approvedBy: input.createdBy,
    approvedAt: input.createdAt,
    frozenAt: input.createdAt,
    status: "FROZEN" as const,
  };
  return AiStoryNarrativeEditorialPlanSchema.parse({
    ...withoutFingerprint,
    editorialFingerprint: computeAiStoryNarrativeEditorialPlanFingerprint(withoutFingerprint),
  });
}

export function applyAiStoryReferenceBindingRevision(input: {
  readonly previousBindingFingerprint: string;
  readonly change: Extract<AiStoryEpisodeRevisionRequestedChange, { kind: "REFERENCE_BINDING" }>;
  readonly createdBy: string;
  readonly createdAt: string;
}): {
  readonly previousFingerprint: string;
  readonly nextBinding: {
    readonly referenceBindingId: string;
    readonly version: number;
    readonly supersedesId: string | null;
    readonly referenceKind: string;
    readonly previousAuthorityId: string;
    readonly nextAuthorityId: string;
    readonly fingerprint: string;
    readonly createdBy: string;
    readonly createdAt: string;
  };
} {
  const fingerprint = sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION,
    change: input.change,
    previous: input.previousBindingFingerprint,
  });
  return {
    previousFingerprint: input.previousBindingFingerprint,
    nextBinding: {
      referenceBindingId: deterministicUuidFromFingerprint(
        "ai-story-reference-binding",
        fingerprint
      ),
      version: 2,
      supersedesId: deterministicUuidFromFingerprint(
        "ai-story-reference-binding",
        input.previousBindingFingerprint
      ),
      referenceKind: input.change.referenceKind,
      previousAuthorityId: input.change.previousAuthorityId,
      nextAuthorityId: input.change.nextAuthorityId,
      fingerprint,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    },
  };
}

export function estimateAiStoryEpisodeCost(input: {
  readonly units: readonly Pick<
    AiStoryGenerationUnit,
    "generationUnitId" | "nativeAvMode"
  >[];
  readonly durationSecondsByUnitId: Readonly<Record<string, number>>;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly resolution: "480p" | "720p" | "1080p";
  readonly createdBy: string;
  readonly generatedAt: string;
}): AiStoryEpisodeCostEstimate {
  const breakdown = input.units.map((unit) => {
    const durationSeconds = input.durationSecondsByUnitId[unit.generationUnitId] ?? 8;
    const rule = certifiedSeedanceEpisodePricingRule({
      durationSeconds,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      createdBy: input.createdBy,
      createdAt: input.generatedAt,
    });
    return {
      generationUnitId: unit.generationUnitId,
      durationSeconds,
      nativeAudio: unit.nativeAvMode === "NATIVE_AUDIO_VIDEO",
      estimatedUsd: estimateProviderCostUsd(rule),
    };
  });
  const expected = addMoney(breakdown.map((item) => item.estimatedUsd));
  const fingerprint = sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION,
    breakdown,
    pricingVersion: CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
  });
  return AiStoryEpisodeCostEstimateSchema.parse({
    costEstimateId: deterministicUuidFromFingerprint(
      "ai-story-episode-cost-estimate",
      fingerprint
    ),
    contractVersion: AI_STORY_EPISODE_REVISION_AUTHORITY_CONTRACT_VERSION,
    currency: "USD",
    estimatedMin: expected,
    estimatedExpected: expected,
    estimatedMax: expected,
    unitBreakdown: breakdown,
    pricingVersion: CERTIFIED_BYTEPLUS_SEEDANCE_20_PRICING_VERSION,
    pricingSource: CERTIFIED_BYTEPLUS_SEEDANCE_20_OFFICIAL_SOURCE_URL,
    modelId: CERTIFIED_BYTEPLUS_SEEDANCE_20_MODEL_ID,
    resolution: input.resolution,
    nativeAudioMode: breakdown.some((item) => item.nativeAudio),
    generatedAt: input.generatedAt,
    authorizesSpend: false,
    fingerprint,
  });
}

export function evaluateApprovedMomentRegeneration(input: {
  readonly unit: AiStoryGenerationUnit;
  readonly unitStatus: "accepted" | "ready" | "failed" | "pre_dispatch";
  readonly paidProviderCallOccurred: boolean;
  readonly retryAuthorizationIds: readonly string[];
  readonly commercialAuthorizationStatus: AiStoryEpisodeCommercialAuthorizationStatus;
  readonly revisionIntentPresent: boolean;
}): { readonly allowed: true } | { readonly allowed: false; readonly code: typeof REGENERATE_APPROVED_MOMENT_DENIED } {
  if (input.unitStatus === "pre_dispatch" || !input.paidProviderCallOccurred) {
    return { allowed: true };
  }
  if (
    (input.unitStatus === "accepted" || input.unitStatus === "ready") &&
    (!input.revisionIntentPresent ||
      input.commercialAuthorizationStatus !== "AUTHORIZED" ||
      input.retryAuthorizationIds.length === 0)
  ) {
    return { allowed: false, code: REGENERATE_APPROVED_MOMENT_DENIED };
  }
  if (
    input.unitStatus === "failed" &&
    input.retryAuthorizationIds.length === 0 &&
    input.commercialAuthorizationStatus !== "AUTHORIZED"
  ) {
    return { allowed: false, code: REGENERATE_APPROVED_MOMENT_DENIED };
  }
  return { allowed: true };
}

export type PlanAiStoryEpisodeRevisionInput = {
  readonly revisionType: AiStoryEpisodeRevisionType;
  readonly target: AiStoryEpisodeRevisionTarget;
  readonly requestedChange: AiStoryEpisodeRevisionRequestedChange;
  readonly script: AiStoryScriptVersion;
  readonly units: readonly AiStoryGenerationUnit[];
  readonly generationPlans: readonly AiStoryGenerationPlan[];
  readonly editorialPlan: AiStoryNarrativeEditorialPlan;
  readonly acceptedSourceMedia: readonly AiStoryAssemblyV2SourceMedia[];
  readonly assemblyCompileInput: CompileAiStoryAssemblyV2PlanInput;
  readonly nativeDialogueAuthorities?: readonly AiStoryCharacterDialoguePerformanceAuthority[];
  readonly acceptedGenerationUnitIds: readonly string[];
  readonly failedGenerationUnitIds?: readonly string[];
  readonly paidProviderCallOccurredByUnitId?: Readonly<Record<string, boolean>>;
  readonly commercialAuthorizationStatus: AiStoryEpisodeCommercialAuthorizationStatus;
  readonly retryAuthorizationIds?: readonly string[];
  readonly durationSecondsByUnitId?: Readonly<Record<string, number>>;
  readonly aspectRatio?: "9:16" | "16:9" | "1:1";
  readonly resolution?: "480p" | "720p" | "1080p";
  readonly createdBy: string;
  readonly createdAt: string;
  readonly simulateAuthorizedResult?: boolean;
};

export type PlanAiStoryEpisodeRevisionResult = {
  readonly revisionRequest: AiStoryEpisodeRevisionRequest;
  readonly impact: AiStoryRevisionImpact;
  readonly executionPlan: AiStoryEpisodeRevisionExecutionPlan;
  readonly liveEpisodeCostEstimate: AiStoryEpisodeCostEstimate;
  readonly revisionCostEstimate: AiStoryEpisodeCostEstimate | null;
  readonly previousScript: AiStoryScriptVersion;
  readonly nextScript: AiStoryScriptVersion | null;
  readonly previousEditorialPlan: AiStoryNarrativeEditorialPlan;
  readonly nextEditorialPlan: AiStoryNarrativeEditorialPlan;
  readonly previousNativeDialogueAuthority:
    | AiStoryCharacterDialoguePerformanceAuthority
    | null;
  readonly nextNativeDialogueAuthority:
    | AiStoryCharacterDialoguePerformanceAuthority
    | null;
  readonly referenceBinding: ReturnType<
    typeof applyAiStoryReferenceBindingRevision
  >["nextBinding"] | null;
  readonly assemblyPlan: AiStoryAssemblyV2Plan;
  readonly userStatus: ReturnType<typeof mapRevisionInternalStatusToUserStatus>;
  readonly historyEntry: AiStoryEpisodeRevisionHistoryEntry;
  readonly providerCalls: 0;
  readonly costEstimateAuthorizesSpend: false;
  readonly superAdminDiagnostics: {
    readonly revisionRequestId: string;
    readonly impactFingerprint: string;
    readonly invalidatedAuthorities: {
      readonly scriptEntryIds: readonly string[];
      readonly generationUnitIds: readonly string[];
      readonly editorialEntryIds: readonly string[];
    };
    readonly preservedGenerationUnitIds: readonly string[];
    readonly costEstimate: AiStoryEpisodeCostEstimate | null;
    readonly commercialAuthorizationStatus: AiStoryEpisodeCommercialAuthorizationStatus;
    readonly retryAuthorizationIds: readonly string[];
    readonly newFingerprints: {
      readonly revision: string;
      readonly script: string | null;
      readonly editorial: string;
      readonly assembly: string;
    };
  };
};

function durationMapFromMedia(
  units: readonly AiStoryGenerationUnit[],
  media: readonly AiStoryAssemblyV2SourceMedia[],
  override?: Readonly<Record<string, number>>
): Record<string, number> {
  const mapped: Record<string, number> = { ...(override ?? {}) };
  for (const unit of units) {
    if (mapped[unit.generationUnitId]) continue;
    const source = media.find((item) => item.generationUnitId === unit.generationUnitId);
    mapped[unit.generationUnitId] = source ? source.durationMs / 1000 : 8;
  }
  return mapped;
}

function historySummary(type: AiStoryEpisodeRevisionType, change: AiStoryEpisodeRevisionRequestedChange): string {
  if (type === "EDIT_DIALOGUE") return "Dialogue updated";
  if (type === "ADJUST_ENDING") return "Ending changed";
  if (type === "ADJUST_PACING") return "Pacing changed";
  if (type === "REGENERATE_MOMENT") return "Moment regeneration requested";
  if (change.kind === "REFERENCE_BINDING") {
    if (change.referenceKind === "PRODUCT") return "Product reference replaced";
    if (change.referenceKind === "LOCATION") return "Store reference replaced";
    if (change.referenceKind === "CHARACTER") return "Character reference replaced";
    if (change.referenceKind === "BRAND") return "Brand reference replaced";
    return "Visual reference replaced";
  }
  return "Dialogue updated";
}

export function planAiStoryEpisodeRevision(
  input: PlanAiStoryEpisodeRevisionInput
): PlanAiStoryEpisodeRevisionResult {
  const previousScript = AiStoryScriptVersionSchema.parse(
    JSON.parse(JSON.stringify(input.script))
  );
  const previousEditorialPlan = input.editorialPlan;
  const revisionRequest = createAiStoryEpisodeRevisionRequest({
    storyId: input.script.storyId,
    storyVersionId: input.script.storyVersionId,
    episodeId: input.script.storyId,
    revisionType: input.revisionType,
    target: input.target,
    requestedChange: input.requestedChange,
    sourceVersionFingerprint: input.script.sourceHash,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    sourceVersion: input.script.version,
  });

  if (input.revisionType === "REGENERATE_MOMENT") {
    const unit = resolveRevisionMomentTarget({
      target:
        input.target.kind === "MOMENT"
          ? input.target
          : {
              kind: "MOMENT",
              generationUnitId:
                input.requestedChange.kind === "REGENERATE_MOMENT"
                  ? input.requestedChange.generationUnitId
                  : undefined,
            },
      units: input.units,
      editorialPlan: input.editorialPlan,
    });
    const failed = (input.failedGenerationUnitIds ?? []).includes(unit.generationUnitId);
    const accepted = input.acceptedGenerationUnitIds.includes(unit.generationUnitId);
    const paid = input.paidProviderCallOccurredByUnitId?.[unit.generationUnitId] ?? accepted;
    const decision = evaluateApprovedMomentRegeneration({
      unit,
      unitStatus: failed ? "failed" : paid && accepted ? "accepted" : paid ? "ready" : "pre_dispatch",
      paidProviderCallOccurred: paid,
      retryAuthorizationIds: input.retryAuthorizationIds ?? [],
      commercialAuthorizationStatus: input.commercialAuthorizationStatus,
      revisionIntentPresent: true,
    });
    if (!decision.allowed) {
      fail(
        REGENERATE_APPROVED_MOMENT_DENIED,
        "Approved material cannot regenerate without canonical revision and commercial retry authorization"
      );
    }
  }

  const impact = computeAiStoryRevisionImpact({
    revisionRequest,
    script: previousScript,
    units: input.units,
    editorialPlan: input.editorialPlan,
    nativeDialogueAuthorities: input.nativeDialogueAuthorities,
    sourceMedia: input.acceptedSourceMedia,
  });

  if (
    impact.requiresProviderExecution &&
    input.commercialAuthorizationStatus !== "AUTHORIZED" &&
    input.commercialAuthorizationStatus !== "NOT_REQUIRED"
  ) {
    // Analyze only. Paid execution stays blocked.
  }

  let nextScript: AiStoryScriptVersion | null = null;
  let previousNativeDialogueAuthority: AiStoryCharacterDialoguePerformanceAuthority | null =
    input.nativeDialogueAuthorities?.[0] ?? null;
  let nextNativeDialogueAuthority: AiStoryCharacterDialoguePerformanceAuthority | null = null;
  if (input.revisionType === "EDIT_DIALOGUE") {
    const entryId =
      input.requestedChange.kind === "DIALOGUE_TEXT"
        ? input.requestedChange.entryId
        : input.target.kind === "DIALOGUE_ENTRY"
          ? input.target.entryId
          : "";
    const nextText =
      input.requestedChange.kind === "DIALOGUE_TEXT"
        ? input.requestedChange.nextText
        : "";
    const revised = applyAiStoryDialogueRevision({
      script: previousScript,
      entryId,
      nextText,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });
    nextScript = revised.nextScript;
    const affected = input.units.find((unit) =>
      impact.impactedGenerationUnitIds.includes(unit.generationUnitId)
    );
    if (affected && previousNativeDialogueAuthority) {
      const rebound = {
        ...affected,
        sourceAuthority: {
          ...affected.sourceAuthority,
          scriptVersionId: nextScript.scriptVersionId,
        },
      };
      nextNativeDialogueAuthority = compileAiStoryCharacterDialoguePerformanceAuthority({
        script: nextScript,
        generationUnit: rebound,
        scriptSceneId: rebound.sceneId,
        dialogueEntryId: entryId,
        primaryLocale: previousNativeDialogueAuthority.primaryLocale,
        secondaryLocales: previousNativeDialogueAuthority.secondaryLocales,
        codeSwitchPolicy: previousNativeDialogueAuthority.codeSwitchPolicy,
        deliveryStyle: previousNativeDialogueAuthority.deliveryStyle,
        performanceIntent: previousNativeDialogueAuthority.performanceIntent,
        emotionIntent: previousNativeDialogueAuthority.emotionIntent,
        speechIntensity: previousNativeDialogueAuthority.speechIntensity,
        paceIntent: previousNativeDialogueAuthority.paceIntent,
      });
    }
  }

  let nextEditorialPlan = previousEditorialPlan;
  if (input.revisionType === "ADJUST_PACING") {
    nextEditorialPlan = applyAiStoryPacingRevision({
      editorialPlan: previousEditorialPlan,
      revisionRequest,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });
  } else if (input.revisionType === "ADJUST_ENDING") {
    nextEditorialPlan = applyAiStoryEndingRevision({
      editorialPlan: previousEditorialPlan,
      revisionRequest,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });
  } else if (impact.requiresEditorialRecompile && nextScript) {
    const withoutFingerprint = {
      ...previousEditorialPlan,
      editorialPlanId: deterministicUuidFromFingerprint(
        "ai-story-editorial-plan",
        `${previousEditorialPlan.editorialPlanId}:${nextScript.sourceHash}`
      ),
      scriptVersionId: nextScript.scriptVersionId,
      version: previousEditorialPlan.version + 1,
      supersedesEditorialPlanId: previousEditorialPlan.editorialPlanId,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
      approvedBy: input.createdBy,
      approvedAt: input.createdAt,
      frozenAt: input.createdAt,
      status: "FROZEN" as const,
    };
    nextEditorialPlan = AiStoryNarrativeEditorialPlanSchema.parse({
      ...withoutFingerprint,
      editorialFingerprint: computeAiStoryNarrativeEditorialPlanFingerprint(withoutFingerprint),
    });
  }

  let referenceBinding: PlanAiStoryEpisodeRevisionResult["referenceBinding"] = null;
  if (
    input.revisionType === "REPLACE_REFERENCE" &&
    input.requestedChange.kind === "REFERENCE_BINDING"
  ) {
    referenceBinding = applyAiStoryReferenceBindingRevision({
      previousBindingFingerprint: sha256CanonicalIntegrityHash({
        authorityId: input.requestedChange.previousAuthorityId,
        kind: input.requestedChange.referenceKind,
      }),
      change: input.requestedChange,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    }).nextBinding;
  }

  const durations = durationMapFromMedia(
    input.units,
    input.acceptedSourceMedia,
    input.durationSecondsByUnitId
  );
  const liveEpisodeCostEstimate = estimateAiStoryEpisodeCost({
    units: input.units,
    durationSecondsByUnitId: durations,
    aspectRatio: input.aspectRatio ?? "9:16",
    resolution: input.resolution ?? "480p",
    createdBy: input.createdBy,
    generatedAt: input.createdAt,
  });
  const revisionUnits = input.units.filter((unit) =>
    impact.impactedGenerationUnitIds.includes(unit.generationUnitId)
  );
  const revisionCostEstimate =
    impact.requiresProviderExecution && revisionUnits.length
      ? estimateAiStoryEpisodeCost({
          units: revisionUnits,
          durationSecondsByUnitId: durations,
          aspectRatio: input.aspectRatio ?? "9:16",
          resolution: input.resolution ?? "480p",
          createdBy: input.createdBy,
          generatedAt: input.createdAt,
        })
      : null;

  const commercialAuthorizationStatus: AiStoryEpisodeCommercialAuthorizationStatus =
    !impact.requiresProviderExecution
      ? "NOT_REQUIRED"
      : input.commercialAuthorizationStatus === "AUTHORIZED"
        ? "AUTHORIZED"
        : "REQUIRED";

  if (
    impact.requiresProviderExecution &&
    commercialAuthorizationStatus !== "AUTHORIZED" &&
    input.simulateAuthorizedResult
  ) {
    fail(
      "COMMERCIAL_AUTHORIZATION_REQUIRED",
      "Simulated Provider result requires commercial retry authorization"
    );
  }

  let acceptedSourceMedia = [...input.acceptedSourceMedia];
  if (input.simulateAuthorizedResult && impact.requiresProviderExecution) {
    acceptedSourceMedia = acceptedSourceMedia.map((media) => {
      if (!impact.impactedGenerationUnitIds.includes(media.generationUnitId)) return media;
      return {
        ...media,
        sourceResultId: deterministicUuidFromFingerprint(
          "ai-story-assembly-source",
          `${media.sourceResultId}:revised`
        ),
        contentHash: sha256CanonicalIntegrityHash({
          previous: media.contentHash,
          revision: revisionRequest.revisionFingerprint,
        }),
        sourceUri: `${media.sourceUri}#revised`,
      };
    });
  }

  let status: AiStoryEpisodeRevisionInternalStatus = "ANALYZING";
  if (impact.requiresProviderExecution && commercialAuthorizationStatus === "REQUIRED") {
    status = "COST_CONFIRMATION_REQUIRED";
  } else if (impact.requiresProviderExecution && commercialAuthorizationStatus === "AUTHORIZED") {
    status = input.simulateAuthorizedResult ? "READY_FOR_REVIEW" : "READY_TO_REGENERATE";
  } else if (impact.requiresEditorialRecompile) {
    status = "RE_EDITING";
  }
  if (!impact.requiresProviderExecution && impact.requiresAssemblyRebuild) {
    status = "READY_FOR_REVIEW";
  }

  const assemblyInput: CompileAiStoryAssemblyV2PlanInput = {
    ...input.assemblyCompileInput,
    editorialPlan: nextEditorialPlan,
    acceptedSourceMedia,
  };
  const assemblyPlan = compileAiStoryAssemblyV2Plan(assemblyInput);

  const executionPlan = AiStoryEpisodeRevisionExecutionPlanSchema.parse({
    revisionRequestId: revisionRequest.revisionRequestId,
    impactedScriptEntries: impact.impactedScriptEntryIds,
    impactedScenes: impact.impactedSceneIds,
    impactedShots: impact.impactedDirectorShotIds,
    impactedGenerationUnits: impact.impactedGenerationUnitIds,
    impactedEditorialEntries: impact.impactedEditorialEntryIds,
    requiresProviderExecution: impact.requiresProviderExecution,
    requiresEditorialRecompile: impact.requiresEditorialRecompile,
    requiresAssemblyRebuild: impact.requiresAssemblyRebuild,
    preservedGenerationUnits: impact.preservedGenerationUnitIds,
    estimatedCost: revisionCostEstimate,
    commercialAuthorizationStatus,
    retryAuthorizationIds: [...(input.retryAuthorizationIds ?? [])],
    fingerprint: sha256CanonicalIntegrityHash({
      revisionRequestId: revisionRequest.revisionRequestId,
      impact: impact.fingerprint,
      commercialAuthorizationStatus,
    }),
  });

  const stampedRequest = AiStoryEpisodeRevisionRequestSchema.parse({
    ...revisionRequest,
    status,
  });

  return {
    revisionRequest: stampedRequest,
    impact,
    executionPlan,
    liveEpisodeCostEstimate,
    revisionCostEstimate,
    previousScript,
    nextScript,
    previousEditorialPlan,
    nextEditorialPlan,
    previousNativeDialogueAuthority,
    nextNativeDialogueAuthority,
    referenceBinding,
    assemblyPlan,
    userStatus: mapRevisionInternalStatusToUserStatus(status),
    historyEntry: {
      version: stampedRequest.revisionVersion,
      summary: historySummary(input.revisionType, input.requestedChange),
      createdAt: input.createdAt,
      userStatus: mapRevisionInternalStatusToUserStatus(status),
    },
    providerCalls: 0,
    costEstimateAuthorizesSpend: false,
    superAdminDiagnostics: {
      revisionRequestId: stampedRequest.revisionRequestId,
      impactFingerprint: impact.fingerprint,
      invalidatedAuthorities: {
        scriptEntryIds: impact.impactedScriptEntryIds,
        generationUnitIds: impact.impactedGenerationUnitIds,
        editorialEntryIds: impact.impactedEditorialEntryIds,
      },
      preservedGenerationUnitIds: impact.preservedGenerationUnitIds,
      costEstimate: revisionCostEstimate,
      commercialAuthorizationStatus,
      retryAuthorizationIds: input.retryAuthorizationIds ?? [],
      newFingerprints: {
        revision: stampedRequest.revisionFingerprint,
        script: nextScript?.sourceHash ?? null,
        editorial: nextEditorialPlan.editorialFingerprint,
        assembly: assemblyPlan.assemblyFingerprint,
      },
    },
  };
}

export function plannedEpisodeCostFromUnitCount(input: {
  readonly unitCount: number;
  readonly durationSeconds: number;
  readonly aspectRatio: "9:16" | "16:9" | "1:1";
  readonly resolution: "480p" | "720p" | "1080p";
  readonly nativeAudio: boolean;
  readonly createdBy: string;
  readonly generatedAt: string;
}): AiStoryEpisodeCostEstimate {
  const units = Array.from({ length: input.unitCount }, (_, index) => ({
    generationUnitId: deterministicUuidFromFingerprint(
      "ai-story-planned-unit",
      `${input.createdBy}:${index}:${input.durationSeconds}`
    ),
    nativeAvMode: input.nativeAudio ? ("NATIVE_AUDIO_VIDEO" as const) : ("VIDEO_ONLY" as const),
  }));
  const durationSecondsByUnitId = Object.fromEntries(
    units.map((unit) => [unit.generationUnitId, input.durationSeconds])
  );
  return estimateAiStoryEpisodeCost({
    units,
    durationSecondsByUnitId,
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    createdBy: input.createdBy,
    generatedAt: input.generatedAt,
  });
}
