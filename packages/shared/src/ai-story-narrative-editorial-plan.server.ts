import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import type { AiStoryDirectorShot } from "./ai-story-director-plan";
import type { AiStoryGenerationUnit } from "./ai-story-generation-unit";
import {
  AI_STORY_DECORATIVE_TRANSITIONS,
  AI_STORY_NARRATIVE_EDITORIAL_PLAN_CONTRACT_VERSION,
  AiStoryNarrativeEditorialPlanSchema,
  isRequiredNarrativeShot,
  mapEditorialRoleToPacing,
  mapGenerationUnitToSourceMaterialKind,
  mapShotPurposeToEditorialRole,
  pacingDurationRange,
  type AiStoryEditorialDisposition,
  type AiStoryEditorialSceneBridge,
  type AiStoryEditorialTimelineEntry,
  type AiStoryNarrativeEditorialIssue,
  type AiStoryNarrativeEditorialPlan,
  type AiStoryNarrativeEditorialSceneInput,
} from "./ai-story-narrative-editorial-plan";

export type AiStoryNarrativeEditorialCompileInput = {
  storyId: string;
  storyVersionId: string;
  scriptVersionId: string;
  directorPlanId: string;
  version: number;
  supersedesEditorialPlanId: string | null;
  createdBy: string;
  createdAt: string;
  profileId: "CORE" | "PRODUCT_STORY" | "COMMERCIAL_STORY";
  scenes: readonly AiStoryNarrativeEditorialSceneInput[];
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const CAUSAL_RANK: Record<string, number> = {
  ESTABLISH: 0, DISCOVERY: 1, ACTION: 2, DETAIL: 3, CONSEQUENCE: 4, REACTION: 5, HERO: 6, PAYOFF: 7, CTA: 8, BREATH: 4, BRIDGE: 3, TRANSITION: 3,
};

function shotOf(scene: AiStoryNarrativeEditorialSceneInput, directorShotId: string): AiStoryDirectorShot | undefined {
  return scene.directorDirection.shots.find((shot) => shot.directorShotId === directorShotId);
}

function trimIntents(role: string): { sourceInIntent: AiStoryEditorialTimelineEntry["sourceInIntent"]; sourceOutIntent: AiStoryEditorialTimelineEntry["sourceOutIntent"] } {
  if (role === "ACTION") return { sourceInIntent: "ACTION_ONSET", sourceOutIntent: "ACTION_COMPLETE" };
  if (role === "REACTION") return { sourceInIntent: "REACTION_ONSET", sourceOutIntent: "REACTION_READABLE" };
  if (role === "PAYOFF" || role === "HERO" || role === "CTA") return { sourceInIntent: "MOTION_ESTABLISHED", sourceOutIntent: "HERO_SETTLED" };
  if (role === "DISCOVERY" || role === "CONSEQUENCE") return { sourceInIntent: "MOTION_ESTABLISHED", sourceOutIntent: "BEFORE_REDUNDANT_HOLD" };
  return { sourceInIntent: "FIRST_VALID_FRAME", sourceOutIntent: "BEFORE_DEAD_AIR" };
}

function cutReasons(role: string, continuous: boolean): { cutInReason: AiStoryEditorialTimelineEntry["cutInReason"]; cutOutReason: AiStoryEditorialTimelineEntry["cutOutReason"] } {
  if (continuous) return { cutInReason: "ACTION_CONTINUES", cutOutReason: "ACTION_CONTINUES" };
  if (role === "REACTION") return { cutInReason: "REACTION", cutOutReason: "EMOTIONAL_CHANGE" };
  if (role === "DISCOVERY") return { cutInReason: "DISCOVERY", cutOutReason: "NEW_INFORMATION" };
  if (role === "PAYOFF" || role === "HERO") return { cutInReason: "PAYOFF", cutOutReason: "PAYOFF" };
  if (role === "CTA") return { cutInReason: "CTA_RESOLUTION", cutOutReason: "CTA_RESOLUTION" };
  if (role === "ACTION") return { cutInReason: "ACTION_COMPLETES", cutOutReason: "ACTION_COMPLETES" };
  return { cutInReason: "NEW_INFORMATION", cutOutReason: "PERSPECTIVE_CHANGE" };
}

function compatibleAction(previous: AiStoryGenerationUnit | undefined, current: AiStoryGenerationUnit): boolean {
  if (!previous) return false;
  const previousActions = new Set(previous.supportedActionEntryIds);
  const previousPhases = new Set(previous.supportedActionPhaseIds);
  if (current.supportedActionEntryIds.some((id) => previousActions.has(id))) return true;
  if (current.supportedActionPhaseIds.some((id) => previousPhases.has(id))) return true;
  const prevMax = Math.max(-1, ...previous.supportedStateDeltaIndexes);
  const nextMin = Math.min(Number.POSITIVE_INFINITY, ...current.supportedStateDeltaIndexes);
  return Number.isFinite(nextMin) && nextMin === prevMax + 1;
}

function duplicateSemantics(a: AiStoryDirectorShot, b: AiStoryDirectorShot): boolean {
  return a.shotPurpose === b.shotPurpose
    && a.shotSize === b.shotSize
    && a.cameraFamily === b.cameraFamily
    && a.compositionIntent === b.compositionIntent
    && a.productEmphasis === b.productEmphasis
    && a.focusTarget.kind === b.focusTarget.kind
    && same([...(a.newAudienceInformation)].map((item) => item.trim().toLowerCase()).sort(), [...(b.newAudienceInformation)].map((item) => item.trim().toLowerCase()).sort());
}

export function computeAiStoryNarrativeEditorialPlanSourceHash(input: Pick<AiStoryNarrativeEditorialCompileInput, "storyId" | "storyVersionId" | "scriptVersionId" | "directorPlanId" | "profileId" | "scenes" | "version" | "supersedesEditorialPlanId">): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_NARRATIVE_EDITORIAL_PLAN_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    scriptVersionId: input.scriptVersionId,
    directorPlanId: input.directorPlanId,
    profileId: input.profileId,
    version: input.version,
    supersedesEditorialPlanId: input.supersedesEditorialPlanId,
    generationPlanFingerprints: input.scenes.map((scene) => scene.generationPlan.fingerprint),
    directorShotIds: input.scenes.flatMap((scene) => scene.directorDirection.shots.map((shot) => shot.directorShotId)),
  });
}

export function computeAiStoryNarrativeEditorialPlanFingerprint(input: Pick<AiStoryNarrativeEditorialPlan, "storyId" | "storyVersionId" | "scriptVersionId" | "directorPlanId" | "sourceGenerationPlanFingerprints" | "version" | "profileId" | "timeline" | "dispositions" | "storyPacingIntent" | "sceneBridges" | "editorialReviewRequired" | "sourceHash" | "supersedesEditorialPlanId">): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_NARRATIVE_EDITORIAL_PLAN_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    scriptVersionId: input.scriptVersionId,
    directorPlanId: input.directorPlanId,
    sourceGenerationPlanFingerprints: input.sourceGenerationPlanFingerprints,
    version: input.version,
    profileId: input.profileId,
    timeline: input.timeline,
    dispositions: input.dispositions,
    storyPacingIntent: input.storyPacingIntent,
    sceneBridges: input.sceneBridges,
    editorialReviewRequired: input.editorialReviewRequired,
    sourceHash: input.sourceHash,
    supersedesEditorialPlanId: input.supersedesEditorialPlanId,
  });
}

export function compileAiStoryNarrativeEditorialPlan(input: AiStoryNarrativeEditorialCompileInput): AiStoryNarrativeEditorialPlan {
  const dispositions: AiStoryEditorialDisposition[] = [];
  const timelineDraft: Omit<AiStoryEditorialTimelineEntry, "timelineEntryId">[] = [];
  let previousUsedUnit: AiStoryGenerationUnit | undefined;
  let previousUsedRole: string | undefined;
  let usedIndex = 0;
  for (const scene of input.scenes) {
    const units = [...scene.generationPlan.units].sort((a, b) => a.order - b.order);
    const seenShots: AiStoryDirectorShot[] = [];
    for (const unit of units) {
      const shot = shotOf(scene, unit.directorShotId);
      if (!shot) continue;
      const required = isRequiredNarrativeShot(shot);
      const duplicate = seenShots.some((previous) => duplicateSemantics(previous, shot));
      const omit = duplicate && !required;
      dispositions.push({
        generationUnitId: unit.generationUnitId,
        directorShotId: unit.directorShotId,
        sceneId: scene.sceneId,
        disposition: omit ? "OMIT" : "USE",
        omissionReason: omit ? "REDUNDANT" : null,
        requiredNarrativeShot: required,
      });
      if (omit) continue;
      seenShots.push(shot);
      const role = mapShotPurposeToEditorialRole(shot, scene.sceneVisualRole);
      const pacing = mapEditorialRoleToPacing(role, usedIndex);
      const continuous = role === "ACTION" && previousUsedRole === "ACTION" && compatibleAction(previousUsedUnit, unit);
      const trim = trimIntents(role);
      const cuts = cutReasons(role, continuous);
      timelineDraft.push({
        order: usedIndex,
        sceneId: scene.sceneId,
        sceneVersionId: scene.sceneVersionId,
        directorShotId: unit.directorShotId,
        generationUnitId: unit.generationUnitId,
        sourceMaterialKind: mapGenerationUnitToSourceMaterialKind(unit.unitType),
        editorialRole: role,
        ...trim,
        usesFullSourceDuration: false,
        targetDurationRange: pacingDurationRange(pacing),
        ...cuts,
        continuityRelationship: continuous ? "CONTINUOUS_ACTION" : usedIndex === 0 ? "NONE" : "MATCH_STATE",
        pacingFunction: pacing,
        transitionIntent: continuous ? "CONTINUOUS_ACTION" : "HARD_CUT",
        transitionRationale: continuous ? "Cut on continuous authorized action" : null,
        requiredNarrativeInformation: [...shot.newAudienceInformation],
        mustPreserve: ["Preserve frozen Script, Director Shot, and Product identity"],
        mustAvoid: ["Do not invent Story truth", "Do not use full generated duration by default", "Do not treat concatenation as editing"],
        supportedActionEntryIds: [...unit.supportedActionEntryIds],
        supportedActionPhaseIds: [...unit.supportedActionPhaseIds],
      });
      previousUsedUnit = unit;
      previousUsedRole = role;
      usedIndex += 1;
    }
  }
  const sceneBridges: AiStoryEditorialSceneBridge[] = [];
  for (let index = 1; index < input.scenes.length; index += 1) {
    const from = input.scenes[index - 1]!;
    const to = input.scenes[index]!;
    const locationChange = from.locationId !== to.locationId;
    sceneBridges.push({
      fromSceneId: from.sceneId,
      toSceneId: to.sceneId,
      bridgeType: locationChange ? "LOCATION_CHANGE" : "MATCH_STATE",
      continuityFacts: [
        `Carry Character and Product identity from ${from.sceneId} into ${to.sceneId}`,
        locationChange ? "Location change is explicit Scene authority" : "Location remains continuous unless Scene authority changes it",
      ],
      carriedAction: from.directorDirection.shots.at(-1)?.subjectActionPhase ?? from.directorDirection.servedScriptSceneFunction,
      carriedObjectState: from.productAuthorityIds[0] ?? null,
      carriedCharacterState: from.characterIds[0] ?? null,
      carriedLocationState: to.locationId,
      visualBridgeIntent: locationChange ? "Hard cut on authorized location change" : "Match state across the Scene boundary without a decorative transition",
      temporalRelation: locationChange ? "LATER" : "CONTINUOUS",
      cutMotivation: locationChange ? "TEMPORAL_ADVANCE" : "NEW_INFORMATION",
    });
  }
  const sourceHash = computeAiStoryNarrativeEditorialPlanSourceHash(input);
  const sourceGenerationPlanFingerprints = input.scenes.map((scene) => scene.generationPlan.fingerprint);
  const pacingFunctions = [...new Set(timelineDraft.map((entry) => entry.pacingFunction))] as Array<(typeof timelineDraft)[number]["pacingFunction"]>;
  const withoutIds = {
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    scriptVersionId: input.scriptVersionId,
    directorPlanId: input.directorPlanId,
    sourceGenerationPlanFingerprints,
    version: input.version,
    contractVersion: AI_STORY_NARRATIVE_EDITORIAL_PLAN_CONTRACT_VERSION,
    profileId: input.profileId,
    nonlinearNarrativeAuthority: false as const,
    dispositions,
    storyPacingIntent: {
      storyPacingIntentId: deterministicUuidFromFingerprint("ai-story-editorial-pacing", sourceHash),
      functions: pacingFunctions.length ? pacingFunctions : ["BUILD"],
      defaultTransition: "HARD_CUT" as const,
      notes: ["Hard cut is the default cinematic transition", "A generated clip duration is not the final used duration"],
    },
    sceneBridges,
    editorialReviewRequired: false,
    sourceHash,
    supersedesEditorialPlanId: input.supersedesEditorialPlanId,
  };
  const timeline = timelineDraft.map((entry) => {
    const timelineEntryId = deterministicUuidFromFingerprint("ai-story-editorial-entry", `${sourceHash}:${entry.generationUnitId}:${entry.order}`);
    return { ...entry, timelineEntryId };
  });
  const editorialFingerprint = computeAiStoryNarrativeEditorialPlanFingerprint({ ...withoutIds, timeline });
  return AiStoryNarrativeEditorialPlanSchema.parse({
    ...withoutIds,
    timeline,
    editorialFingerprint,
    editorialPlanId: deterministicUuidFromFingerprint("ai-story-narrative-editorial-plan", editorialFingerprint),
    status: "DRAFT",
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  });
}

function shotLookup(input: AiStoryNarrativeEditorialCompileInput, directorShotId: string): { scene: AiStoryNarrativeEditorialSceneInput; shot: AiStoryDirectorShot } | undefined {
  for (const scene of input.scenes) {
    const shot = shotOf(scene, directorShotId);
    if (shot) return { scene, shot };
  }
  return undefined;
}

export function validateAiStoryNarrativeEditorialPlan(plan: AiStoryNarrativeEditorialPlan, input: AiStoryNarrativeEditorialCompileInput): AiStoryNarrativeEditorialIssue[] {
  const issues: AiStoryNarrativeEditorialIssue[] = [];
  const units = input.scenes.flatMap((scene) => scene.generationPlan.units.map((unit) => ({ scene, unit })));
  const unitById = new Map(units.map((item) => [item.unit.generationUnitId, item]));
  for (const unit of units) {
    const disposition = plan.dispositions.find((item) => item.generationUnitId === unit.unit.generationUnitId);
    if (!disposition) {
      issues.push({ gate: "EDITORIAL_COVERAGE_GATE", severity: "BLOCK", message: `Generation Unit ${unit.unit.generationUnitId} has no editorial disposition` });
      continue;
    }
    const shot = shotOf(unit.scene, unit.unit.directorShotId);
    const required = shot ? isRequiredNarrativeShot(shot) : disposition.requiredNarrativeShot;
    if (disposition.disposition === "OMIT" && !disposition.omissionReason) {
      issues.push({ gate: "EDITORIAL_COVERAGE_GATE", severity: "BLOCK", message: `Omitted Shot ${unit.unit.directorShotId} has no authorized omission reason` });
    }
    if (required && disposition.disposition !== "USE") {
      issues.push({ gate: "EDITORIAL_COVERAGE_GATE", severity: "BLOCK", message: `Required narrative Shot ${unit.unit.directorShotId} has no timeline use and no authorized omission reason` });
    }
    if (required && disposition.disposition === "USE" && !plan.timeline.some((entry) => entry.generationUnitId === unit.unit.generationUnitId)) {
      issues.push({ gate: "EDITORIAL_COVERAGE_GATE", severity: "BLOCK", message: `Required narrative Shot ${unit.unit.directorShotId} is marked USE but is absent from the editorial timeline` });
    }
  }
  const used = [...plan.timeline].sort((a, b) => a.order - b.order);
  for (const entry of used) {
    const bound = unitById.get(entry.generationUnitId);
    if (!bound || bound.unit.directorShotId !== entry.directorShotId || bound.scene.sceneId !== entry.sceneId) {
      issues.push({ gate: "GENERATION_UNIT_BINDING_GATE", severity: "BLOCK", message: `Timeline entry ${entry.timelineEntryId} does not bind an exact Generation Unit / Director Shot` });
    }
    if (entry.supportedActionEntryIds.some((id) => bound && !bound.unit.supportedActionEntryIds.includes(id))) {
      issues.push({ gate: "GENERATION_UNIT_BINDING_GATE", severity: "BLOCK", message: `Timeline entry ${entry.timelineEntryId} invents Script action outside Generation Unit authority` });
    }
  }
  if (!plan.nonlinearNarrativeAuthority) {
    const firstAction = used.findIndex((entry) => entry.editorialRole === "ACTION");
    const firstPayoff = used.findIndex((entry) => entry.editorialRole === "PAYOFF" || entry.editorialRole === "CTA");
    if (firstPayoff >= 0 && firstAction >= 0 && firstPayoff < firstAction) {
      issues.push({ gate: "EDITORIAL_CAUSAL_ORDER_GATE", severity: "BLOCK", message: "End state / payoff appears before required action without nonlinear authority" });
    }
    for (let index = 0; index < used.length; index += 1) {
      const previous = index > 0 ? used[index - 1]! : null;
      const current = used[index]!;
      const previousRank = previous ? CAUSAL_RANK[previous.editorialRole] ?? 3 : -1;
      const prior = used.slice(0, index);
      if (current.editorialRole === "REACTION" && !prior.some((entry) => ["ACTION", "DISCOVERY", "CONSEQUENCE", "DETAIL"].includes(entry.editorialRole))) {
        issues.push({ gate: "EDITORIAL_CAUSAL_ORDER_GATE", severity: "BLOCK", message: "Reaction appears before its triggering action/discovery" });
      }
      if ((current.editorialRole === "PAYOFF" || current.editorialRole === "CTA") && !prior.some((entry) => ["ACTION", "DISCOVERY", "REACTION", "CONSEQUENCE", "HERO", "DETAIL", "ESTABLISH"].includes(entry.editorialRole))) {
        issues.push({ gate: "EDITORIAL_CAUSAL_ORDER_GATE", severity: "BLOCK", message: "Payoff/CTA appears before required action or reveal" });
      }
      if (current.editorialRole === "ESTABLISH" && previous && previousRank >= CAUSAL_RANK.PAYOFF) {
        issues.push({ gate: "EDITORIAL_CAUSAL_ORDER_GATE", severity: "BLOCK", message: "Story returns to an establish/raw state after payoff without nonlinear authority" });
      }
      if (current.editorialRole === "ESTABLISH" && previous && previous.sceneId === current.sceneId && previousRank >= CAUSAL_RANK.CONSEQUENCE) {
        issues.push({ gate: "EDITORIAL_CAUSAL_ORDER_GATE", severity: "BLOCK", message: "Timeline reorders end/restored state before the required establish/problem state" });
      }
    }
  }
  for (let index = 1; index < used.length; index += 1) {
    const previous = used[index - 1]!;
    const current = used[index]!;
    const cutOnAction = current.transitionIntent === "CONTINUOUS_ACTION"
      || current.cutInReason === "ACTION_CONTINUES"
      || (previous.cutOutReason === "ACTION_CONTINUES" && current.editorialRole === "ACTION");
    if (!cutOnAction) continue;
    const previousBound = unitById.get(previous.generationUnitId);
    const currentBound = unitById.get(current.generationUnitId);
    if (previous.editorialRole !== "ACTION" || current.editorialRole !== "ACTION" || !previousBound || !currentBound || !compatibleAction(previousBound.unit, currentBound.unit)) {
      issues.push({ gate: "CUT_ON_ACTION_CONTINUITY_GATE", severity: "BLOCK", message: `Cut-on-action between ${previous.directorShotId} and ${current.directorShotId} is not bound to compatible Script/Motion action progression` });
    }
  }
  for (const scene of input.scenes) {
    const reactionShots = scene.directorDirection.shots.filter((shot) => shot.shotPurpose === "SHOW_REACTION");
    if (!reactionShots.length) continue;
    const usedReaction = used.filter((entry) => entry.sceneId === scene.sceneId && entry.editorialRole === "REACTION");
    const usedTrigger = used.filter((entry) => entry.sceneId === scene.sceneId && ["ACTION", "DISCOVERY", "CONSEQUENCE"].includes(entry.editorialRole));
    if (!usedReaction.length) {
      issues.push({ gate: "REACTION_TIMING_GATE", severity: "BLOCK", message: `Scene ${scene.sceneId} has a reaction Shot serving narrative consequence but the editorial plan omits it` });
    }
    if (usedReaction.length && usedTrigger.length && usedReaction[0]!.order < usedTrigger[0]!.order) {
      issues.push({ gate: "REACTION_TIMING_GATE", severity: "BLOCK", message: `Reaction is placed before its triggering action without nonlinear authority` });
    }
  }
  for (const entry of used) {
    const roleNeedsHold = entry.editorialRole === "BREATH" || entry.pacingFunction === "REACTION_BREATH" || entry.pacingFunction === "PAYOFF_HOLD" || entry.cutOutReason === "BREATH";
    if (entry.usesFullSourceDuration && !roleNeedsHold && entry.requiredNarrativeInformation.length === 0 && !["ACTION", "REACTION", "DISCOVERY"].includes(entry.editorialRole)) {
      issues.push({ gate: "REDUNDANT_HOLD_GATE", severity: "BLOCK", message: `Timeline entry ${entry.timelineEntryId} holds source material with no action, reaction, new information, or deliberate breath` });
    }
  }
  const slideshow = used.length >= 3
    && used.every((entry) => entry.usesFullSourceDuration)
    && used.every((entry) => entry.pacingFunction === used[0]!.pacingFunction)
    && used.every((entry) => entry.transitionIntent === used[0]!.transitionIntent)
    && used.every((entry) => entry.sourceInIntent === used[0]!.sourceInIntent && entry.sourceOutIntent === used[0]!.sourceOutIntent);
  const minimalSlow = used.length <= 3 && used.every((entry) => ["DETAIL", "HERO", "PAYOFF", "CTA", "ESTABLISH"].includes(entry.editorialRole));
  if (slideshow && !minimalSlow) {
    issues.push({ gate: "EDITORIAL_RHYTHM_GATE", severity: "BLOCK", message: "Editorial timeline uses full-source identical rhythm and becomes a slideshow" });
  }
  const decorative = used.filter((entry) => (AI_STORY_DECORATIVE_TRANSITIONS as readonly string[]).includes(entry.transitionIntent));
  if (decorative.some((entry) => !entry.transitionRationale) || decorative.length > 1) {
    issues.push({ gate: "UNJUSTIFIED_TRANSITION_GATE", severity: decorative.length > 1 ? "BLOCK" : "WARN", message: "Decorative dissolve/fade/dip is repeated or lacks narrative rationale; hard cut is the default" });
  }
  for (let index = 1; index < used.length; index += 1) {
    const previous = used[index - 1]!;
    const current = used[index]!;
    const previousShot = shotLookup(input, previous.directorShotId)?.shot;
    const currentShot = shotLookup(input, current.directorShotId)?.shot;
    if (previousShot && currentShot && duplicateSemantics(previousShot, currentShot) && previous.editorialRole === current.editorialRole) {
      issues.push({ gate: "EDITORIAL_DUPLICATION_GATE", severity: "BLOCK", message: `Final timeline retains duplicated ${current.editorialRole} coverage for Shot ${current.directorShotId}` });
    }
  }
  if (plan.profileId === "COMMERCIAL_STORY") {
    const terminal = [...used].reverse().find((entry) => entry.editorialRole === "PAYOFF" || entry.editorialRole === "CTA")
      ?? [...used].reverse().find((entry) => entry.editorialRole === "HERO");
    if (terminal) {
      const before = used.filter((entry) => entry.order < terminal.order);
      const hasStoryCause = before.some((entry) => ["ACTION", "DISCOVERY", "REACTION", "CONSEQUENCE"].includes(entry.editorialRole));
      const adjacent = before.at(-1);
      if (!hasStoryCause || (adjacent && adjacent.continuityRelationship === "HARD_BREAK" && adjacent.editorialRole === "REACTION")) {
        issues.push({ gate: "EDITORIAL_COMMERCIAL_PAYOFF_GATE", severity: "BLOCK", message: "Commercial payoff is attached as an unrelated ending rather than a consequence of Story causality" });
      }
      if (terminal.continuityRelationship === "HARD_BREAK" || (terminal.continuityRelationship === "NONE" && before.some((entry) => entry.editorialRole === "REACTION"))) {
        issues.push({ gate: "EDITORIAL_COMMERCIAL_PAYOFF_GATE", severity: "BLOCK", message: "Commercial payoff does not inherit Story/reaction continuity" });
      }
    }
  }
  return issues;
}

export function compileAndValidateAiStoryNarrativeEditorialPlan(input: AiStoryNarrativeEditorialCompileInput): { plan: AiStoryNarrativeEditorialPlan; issues: AiStoryNarrativeEditorialIssue[] } {
  const plan = compileAiStoryNarrativeEditorialPlan(input);
  return { plan, issues: validateAiStoryNarrativeEditorialPlan(plan, input) };
}
