import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AiStoryAssemblyV2PlanSchema,
  AiStoryAssemblyV2SourceMediaSchema,
  type AiStoryAssemblyV2FailureCode,
  type AiStoryAssemblyV2OutputProfile,
  type AiStoryAssemblyV2Plan,
  type AiStoryAssemblyV2ResolvedTimelineEntry,
  type AiStoryAssemblyV2SourceMedia,
  AI_STORY_ASSEMBLY_V2_CONTRACT_VERSION,
  AI_STORY_ASSEMBLY_V2_RUNTIME_POLICY_VERSION,
} from "./ai-story-assembly-v2";
import {
  computeAiStoryNarrativeEditorialPlanFingerprint,
} from "./ai-story-narrative-editorial-plan.server";
import type { AiStoryGenerationPlan, AiStoryGenerationUnit } from "./ai-story-generation-unit";
import type {
  AiStoryEditorialTimelineEntry,
  AiStoryNarrativeEditorialPlan,
} from "./ai-story-narrative-editorial-plan";

export class AiStoryAssemblyV2PlanError extends Error {
  constructor(
    readonly code: AiStoryAssemblyV2FailureCode,
    message: string
  ) {
    super(message);
    this.name = "AiStoryAssemblyV2PlanError";
  }
}

export type CompileAiStoryAssemblyV2PlanInput = {
  readonly editorialPlan: AiStoryNarrativeEditorialPlan;
  readonly generationPlans: readonly AiStoryGenerationPlan[];
  readonly acceptedSourceMedia: readonly AiStoryAssemblyV2SourceMedia[];
  readonly outputProfile: AiStoryAssemblyV2OutputProfile;
  readonly optionalResolutionPolicy: "EXCLUDE_ALL";
};

function fail(code: AiStoryAssemblyV2FailureCode, message: string): never {
  throw new AiStoryAssemblyV2PlanError(code, message);
}

function preferredDurationMs(entry: AiStoryEditorialTimelineEntry): {
  minimumDurationMs: number;
  preferredDurationMs: number;
  maximumDurationMs: number;
} {
  const minimumDurationMs = Math.round(entry.targetDurationRange.minSeconds * 1000);
  const maximumDurationMs = Math.round(entry.targetDurationRange.maxSeconds * 1000);
  const preferred = (minimumDurationMs + maximumDurationMs) / 2;
  return {
    minimumDurationMs,
    preferredDurationMs: Math.round(preferred),
    maximumDurationMs,
  };
}

function resolveTrimWindow(
  entry: AiStoryEditorialTimelineEntry,
  source: AiStoryAssemblyV2SourceMedia
): AiStoryAssemblyV2ResolvedTimelineEntry["trimWindow"] {
  const target = preferredDurationMs(entry);
  if (source.durationMs < target.minimumDurationMs) {
    fail(
      "SOURCE_SHORTER_THAN_REQUIRED",
      `Source ${source.sourceResultId} is shorter than the editorial minimum`
    );
  }

  const inEvidence = source.semanticTimingEvidence.find(
    (evidence) => evidence.semantic === entry.sourceInIntent
  );
  const outEvidence = source.semanticTimingEvidence.find(
    (evidence) => evidence.semantic === entry.sourceOutIntent
  );
  if (inEvidence && outEvidence) {
    const durationMs = outEvidence.timestampMs - inEvidence.timestampMs;
    if (
      inEvidence.timestampMs >= 0 &&
      outEvidence.timestampMs <= source.durationMs &&
      durationMs >= target.minimumDurationMs &&
      durationMs <= target.maximumDurationMs
    ) {
      return {
        sourceStartMs: inEvidence.timestampMs,
        sourceEndMs: outEvidence.timestampMs,
        durationMs,
        ...target,
        sourceInIntent: entry.sourceInIntent,
        sourceOutIntent: entry.sourceOutIntent,
        resolutionMethod: "CERTIFIED_EVENT_METADATA",
        evidenceIds: [inEvidence.evidenceId, outEvidence.evidenceId],
      };
    }
  }

  const durationMs = Math.min(target.preferredDurationMs, source.durationMs);
  if (durationMs < target.minimumDurationMs || durationMs > target.maximumDurationMs) {
    fail("TRIM_WINDOW_INVALID", `No bounded trim window exists for ${entry.timelineEntryId}`);
  }
  return {
    sourceStartMs: 0,
    sourceEndMs: durationMs,
    durationMs,
    ...target,
    sourceInIntent: entry.sourceInIntent,
    sourceOutIntent: entry.sourceOutIntent,
    resolutionMethod: "DETERMINISTIC_FALLBACK",
    evidenceIds: [],
  };
}

function resolveTransition(
  entry: AiStoryEditorialTimelineEntry,
  previous: AiStoryAssemblyV2ResolvedTimelineEntry | undefined,
  trimDurationMs: number
): AiStoryAssemblyV2ResolvedTimelineEntry["transitionFromPrevious"] {
  if (!previous) {
    return {
      editorialIntent: "HARD_CUT",
      executionKind: "HARD_CUT",
      durationMs: 0,
      resolutionMethod: "EDITORIAL_AUTHORITY",
    };
  }
  if (entry.transitionIntent === "DISSOLVE") {
    const durationMs = Math.min(
      250,
      Math.floor(previous.trimWindow.durationMs / 4),
      Math.floor(trimDurationMs / 4)
    );
    if (durationMs <= 0) {
      fail("TRIM_WINDOW_INVALID", "Authorized dissolve has no bounded overlap");
    }
    return {
      editorialIntent: entry.transitionIntent,
      executionKind: "DISSOLVE",
      durationMs,
      resolutionMethod: "EDITORIAL_AUTHORITY",
    };
  }
  if (entry.transitionIntent === "MATCH_CUT") {
    return {
      editorialIntent: entry.transitionIntent,
      executionKind: "MATCH_CUT",
      durationMs: 0,
      resolutionMethod: "EDITORIAL_AUTHORITY",
    };
  }
  if (
    entry.transitionIntent === "HARD_CUT" ||
    entry.transitionIntent === "CONTINUOUS_ACTION"
  ) {
    return {
      editorialIntent: entry.transitionIntent,
      executionKind: "HARD_CUT",
      durationMs: 0,
      resolutionMethod: "EDITORIAL_AUTHORITY",
    };
  }
  fail(
    "UNSUPPORTED_TRANSITION",
    `Assembly V2 does not execute ${entry.transitionIntent}`
  );
}

function assertCausalOrder(
  plan: AiStoryNarrativeEditorialPlan,
  entries: readonly AiStoryEditorialTimelineEntry[]
): void {
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index]!;
    const prior = entries.slice(0, index);
    if (
      current.editorialRole === "REACTION" &&
      !prior.some((entry) =>
        ["ACTION", "DISCOVERY", "CONSEQUENCE", "DETAIL"].includes(entry.editorialRole)
      )
    ) {
      fail("EDITORIAL_CAUSAL_ORDER_INVALID", "Reaction precedes its Story cause");
    }
    if (
      ["PAYOFF", "CTA"].includes(current.editorialRole) &&
      !prior.some((entry) =>
        ["ACTION", "DISCOVERY", "REACTION", "CONSEQUENCE", "HERO", "DETAIL", "ESTABLISH"].includes(
          entry.editorialRole
        )
      )
    ) {
      fail("EDITORIAL_CAUSAL_ORDER_INVALID", "Commercial payoff precedes Story resolution");
    }
  }
  if (plan.profileId === "COMMERCIAL_STORY") {
    let payoffIndex = -1;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      if (["PAYOFF", "CTA"].includes(entries[index]!.editorialRole)) {
        payoffIndex = index;
        break;
      }
    }
    if (payoffIndex >= 0 && payoffIndex !== entries.length - 1) {
      fail(
        "EDITORIAL_CAUSAL_ORDER_INVALID",
        "Commercial payoff/CTA must remain the terminal editorial resolution"
      );
    }
  }
}

function assertExactFrozenEditorialPlan(plan: AiStoryNarrativeEditorialPlan): void {
  if (plan.status !== "FROZEN") {
    fail("EDITORIAL_PLAN_NOT_FROZEN", "Assembly V2 requires a frozen Editorial Plan");
  }
  const fingerprint = computeAiStoryNarrativeEditorialPlanFingerprint(plan);
  if (fingerprint !== plan.editorialFingerprint) {
    fail(
      "EDITORIAL_PLAN_FINGERPRINT_MISMATCH",
      "Frozen Editorial Plan fingerprint does not match its contents"
    );
  }
}

function assertOutputCompatibility(
  source: AiStoryAssemblyV2SourceMedia,
  output: AiStoryAssemblyV2OutputProfile
): void {
  const sourceRatio = source.width / source.height;
  const outputRatio = output.width / output.height;
  if (Math.abs(sourceRatio - outputRatio) > 0.01) {
    fail(
      "OUTPUT_PROFILE_INCOMPATIBLE",
      `Source ${source.sourceResultId} aspect ratio cannot be normalized without creative cropping`
    );
  }
}

function generationUnitMap(
  generationPlans: readonly AiStoryGenerationPlan[]
): Map<string, AiStoryGenerationUnit> {
  const result = new Map<string, AiStoryGenerationUnit>();
  for (const unit of generationPlans.flatMap((plan) => plan.units)) {
    if (result.has(unit.generationUnitId)) {
      fail("EDITORIAL_ENTRY_BINDING_MISMATCH", "Generation Unit identity is duplicated");
    }
    result.set(unit.generationUnitId, unit);
  }
  return result;
}

export function computeAiStoryAssemblyV2Fingerprint(
  input: Pick<
    AiStoryAssemblyV2Plan,
    | "storyId"
    | "storyVersionId"
    | "editorialPlanId"
    | "editorialFingerprint"
    | "sourceGenerationPlanFingerprints"
    | "resolvedTimeline"
    | "omittedGenerationUnitIds"
    | "optionalExcludedGenerationUnitIds"
    | "outputProfile"
    | "expectedOutputDurationMs"
  >
): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_ASSEMBLY_V2_CONTRACT_VERSION,
    runtimePolicyVersion: AI_STORY_ASSEMBLY_V2_RUNTIME_POLICY_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    editorialPlanId: input.editorialPlanId,
    editorialFingerprint: input.editorialFingerprint,
    sourceGenerationPlanFingerprints: input.sourceGenerationPlanFingerprints,
    resolvedTimeline: input.resolvedTimeline,
    omittedGenerationUnitIds: input.omittedGenerationUnitIds,
    optionalExcludedGenerationUnitIds: input.optionalExcludedGenerationUnitIds,
    outputProfile: input.outputProfile,
    expectedOutputDurationMs: input.expectedOutputDurationMs,
  });
}

export function compileAiStoryAssemblyV2Plan(
  input: CompileAiStoryAssemblyV2PlanInput
): AiStoryAssemblyV2Plan {
  assertExactFrozenEditorialPlan(input.editorialPlan);
  if (input.optionalResolutionPolicy !== "EXCLUDE_ALL") {
    fail(
      "EDITORIAL_DISPOSITION_INVALID",
      "Assembly V2 requires an explicit certified OPTIONAL resolution policy"
    );
  }
  const outputProfile = AiStoryAssemblyV2PlanSchema.shape.outputProfile.parse(
    input.outputProfile
  );
  const sources = input.acceptedSourceMedia.map((source) =>
    AiStoryAssemblyV2SourceMediaSchema.parse(source)
  );
  const sourceByUnit = new Map<string, AiStoryAssemblyV2SourceMedia>();
  for (const source of sources) {
    if (sourceByUnit.has(source.generationUnitId)) {
      fail("EDITORIAL_ENTRY_SOURCE_UNRESOLVED", "Generation Unit has multiple accepted sources");
    }
    sourceByUnit.set(source.generationUnitId, source);
  }

  const sourcePlanFingerprints = input.generationPlans.map((plan) => plan.fingerprint);
  if (
    JSON.stringify(sourcePlanFingerprints) !==
    JSON.stringify(input.editorialPlan.sourceGenerationPlanFingerprints)
  ) {
    fail(
      "EDITORIAL_ENTRY_BINDING_MISMATCH",
      "Generation Plan fingerprints do not match frozen Editorial authority"
    );
  }

  const unitById = generationUnitMap(input.generationPlans);
  const dispositionByUnit = new Map(
    input.editorialPlan.dispositions.map((disposition) => [
      disposition.generationUnitId,
      disposition,
    ])
  );
  const orderedEditorialEntries = [...input.editorialPlan.timeline].sort(
    (a, b) => a.order - b.order
  );
  if (
    orderedEditorialEntries.some((entry, index) => entry.order !== index) ||
    new Set(orderedEditorialEntries.map((entry) => entry.timelineEntryId)).size !==
      orderedEditorialEntries.length
  ) {
    fail(
      "EDITORIAL_CAUSAL_ORDER_INVALID",
      "Frozen Editorial timeline order or identity is not contiguous and unique"
    );
  }
  assertCausalOrder(input.editorialPlan, orderedEditorialEntries);

  const seenUsedUnits = new Set<string>();
  const selectedEntries: AiStoryEditorialTimelineEntry[] = [];
  for (const entry of orderedEditorialEntries) {
    const disposition = dispositionByUnit.get(entry.generationUnitId);
    if (!disposition) {
      fail("EDITORIAL_DISPOSITION_INVALID", "Timeline entry has no editorial disposition");
    }
    if (disposition.disposition === "OMIT") {
      fail("EDITORIAL_DISPOSITION_INVALID", "OMIT material appears in the Editorial timeline");
    }
    if (disposition.disposition === "OPTIONAL") {
      continue;
    }
    if (seenUsedUnits.has(entry.generationUnitId)) {
      fail("EDITORIAL_DISPOSITION_INVALID", "USE Generation Unit appears more than once");
    }
    seenUsedUnits.add(entry.generationUnitId);
    selectedEntries.push(entry);
  }

  for (const disposition of input.editorialPlan.dispositions) {
    const appearances = selectedEntries.filter(
      (entry) => entry.generationUnitId === disposition.generationUnitId
    ).length;
    if (disposition.disposition === "USE" && appearances !== 1) {
      fail("EDITORIAL_DISPOSITION_INVALID", "USE material must appear exactly once");
    }
    if (disposition.disposition === "OMIT" && appearances !== 0) {
      fail("EDITORIAL_DISPOSITION_INVALID", "OMIT material must not appear");
    }
  }
  if (!selectedEntries.length) {
    fail("EDITORIAL_DISPOSITION_INVALID", "Assembly V2 has no USE entries");
  }

  const resolvedTimeline: AiStoryAssemblyV2ResolvedTimelineEntry[] = [];
  for (const entry of selectedEntries) {
    const unit = unitById.get(entry.generationUnitId);
    const source = sourceByUnit.get(entry.generationUnitId);
    if (!unit || !source) {
      fail(
        "EDITORIAL_ENTRY_SOURCE_UNRESOLVED",
        `No exact accepted source resolves ${entry.generationUnitId}`
      );
    }
    if (
      unit.directorShotId !== entry.directorShotId ||
      source.directorShotId !== entry.directorShotId ||
      source.generationUnitId !== unit.generationUnitId
    ) {
      fail(
        "EDITORIAL_ENTRY_BINDING_MISMATCH",
        "Source, Generation Unit, and Director Shot binding do not match"
      );
    }
    if (source.mediaType !== "video/mp4") {
      fail(
        "EDITORIAL_ENTRY_SOURCE_UNRESOLVED",
        "Non-video material has no certified Assembly V2 local-render path"
      );
    }
    assertOutputCompatibility(source, outputProfile);
    const trimWindow = resolveTrimWindow(entry, source);
    const previous = resolvedTimeline.at(-1);
    const transitionFromPrevious = resolveTransition(
      entry,
      previous,
      trimWindow.durationMs
    );
    const priorEditorial = selectedEntries[resolvedTimeline.length - 1];
    const cutOnAction =
      Boolean(previous) &&
      (entry.continuityRelationship === "CONTINUOUS_ACTION" ||
        entry.transitionIntent === "CONTINUOUS_ACTION");
    const sceneBridge = previous && previous.sceneId !== entry.sceneId
      ? input.editorialPlan.sceneBridges.find(
          (bridge) =>
            bridge.fromSceneId === previous.sceneId && bridge.toSceneId === entry.sceneId
        )
      : undefined;
    if (previous && previous.sceneId !== entry.sceneId && !sceneBridge) {
      fail("EDITORIAL_ENTRY_BINDING_MISMATCH", "Cross-Scene entry has no frozen Scene bridge");
    }
    resolvedTimeline.push({
      timelineEntryId: entry.timelineEntryId,
      order: resolvedTimeline.length,
      sceneId: entry.sceneId,
      sceneVersionId: entry.sceneVersionId,
      directorShotId: entry.directorShotId,
      generationUnitId: entry.generationUnitId,
      sourceResultId: source.sourceResultId,
      sourceUri: source.sourceUri,
      sourceContentHash: source.contentHash,
      sourceDurationMs: source.durationMs,
      sourceWidth: source.width,
      sourceHeight: source.height,
      sourceFrameRate: source.frameRate,
      editorialRole: entry.editorialRole,
      trimWindow,
      transitionFromPrevious,
      sceneBridgeExecution: sceneBridge
        ? {
            fromSceneId: sceneBridge.fromSceneId,
            toSceneId: sceneBridge.toSceneId,
            bridgeType: sceneBridge.bridgeType,
            executionKind:
              transitionFromPrevious.executionKind === "DISSOLVE"
                ? "AUTHORIZED_DISSOLVE"
                : "ORDER_AND_CUT_PRESERVED",
          }
        : null,
      cutOnActionExecution: !cutOnAction
        ? "NOT_APPLICABLE"
        : previous?.trimWindow.resolutionMethod === "CERTIFIED_EVENT_METADATA" &&
            trimWindow.resolutionMethod === "CERTIFIED_EVENT_METADATA" &&
            priorEditorial?.editorialRole === "ACTION" &&
            entry.editorialRole === "ACTION"
          ? "CUT_ON_ACTION_EXACT_CERTIFIED_METADATA"
          : "CUT_ON_ACTION_APPROXIMATE",
    });
  }

  const expectedOutputDurationMs =
    resolvedTimeline.reduce((sum, entry) => sum + entry.trimWindow.durationMs, 0) -
    resolvedTimeline.reduce(
      (sum, entry) => sum + entry.transitionFromPrevious.durationMs,
      0
    );
  if (expectedOutputDurationMs <= 0) {
    fail("TRIM_WINDOW_INVALID", "Resolved Assembly V2 duration is invalid");
  }

  const withoutIdentity = {
    storyId: input.editorialPlan.storyId,
    storyVersionId: input.editorialPlan.storyVersionId,
    editorialPlanId: input.editorialPlan.editorialPlanId,
    editorialFingerprint: input.editorialPlan.editorialFingerprint,
    sourceGenerationPlanFingerprints: sourcePlanFingerprints,
    resolvedTimeline,
    omittedGenerationUnitIds: input.editorialPlan.dispositions
      .filter((disposition) => disposition.disposition === "OMIT")
      .map((disposition) => disposition.generationUnitId),
    optionalExcludedGenerationUnitIds: input.editorialPlan.dispositions
      .filter((disposition) => disposition.disposition === "OPTIONAL")
      .map((disposition) => disposition.generationUnitId),
    outputProfile,
    expectedOutputDurationMs,
  };
  const assemblyFingerprint = computeAiStoryAssemblyV2Fingerprint(withoutIdentity);
  return AiStoryAssemblyV2PlanSchema.parse({
    ...withoutIdentity,
    assemblyV2PlanId: deterministicUuidFromFingerprint(
      "ai-story-assembly-v2-plan",
      assemblyFingerprint
    ),
    contractVersion: AI_STORY_ASSEMBLY_V2_CONTRACT_VERSION,
    runtimePolicyVersion: AI_STORY_ASSEMBLY_V2_RUNTIME_POLICY_VERSION,
    assemblyRoute: "ASSEMBLY_V2_EDITORIAL",
    assemblyFingerprint,
    videoOnly: true,
  });
}
