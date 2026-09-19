import type { AiStoryCanonicalScene } from "@ceo-agent/shared";

export const AI_STORY_ACTIVE_INTENT_CONTRACT_VERSION = "ai-story-active-intent.v1" as const;
export const AI_STORY_NARRATIVE_WORLD_STATE_CONTRACT_VERSION = "ai-story-narrative-world-state.v1" as const;

export const AI_STORY_CREATIVE_AUTHORITY_PRECEDENCE = Object.freeze([
  "GENERIC_DEFAULT",
  "CONTINUITY_REFERENCE",
  "CANONICAL_SCENE_INTENT",
  "REVIEW_RETRY_TARGET",
  "HUMAN_REVIEW_CORRECTION",
] as const);

export type CreativeAuthorityKind = (typeof AI_STORY_CREATIVE_AUTHORITY_PRECEDENCE)[number];
export type CreativeAuthorityClassification =
  | "ACTIVE"
  | "CONTINUITY_REFERENCE"
  | "HISTORICAL_ONLY"
  | "SUPERSEDED"
  | "REJECTED";

export type NarrativeTransition =
  | { readonly type: "ENTER_LOCATION" | "EXIT_LOCATION"; readonly locationId: string }
  | { readonly type: "MOVE_TO_LOCATION"; readonly fromLocationId: string | null; readonly toLocationId: string }
  | { readonly type: "CHARACTER_ENTERS" | "CHARACTER_EXITS"; readonly characterId: string }
  | { readonly type: "ACQUIRE_OBJECT" | "RELEASE_OBJECT"; readonly objectId: string; readonly holderId: string }
  | { readonly type: "TRANSFER_OBJECT"; readonly objectId: string; readonly fromHolderId: string; readonly toHolderId: string };

export type ActiveSceneIntentValues = {
  readonly location: { readonly id: string; readonly label: string };
  readonly charactersPresent: readonly string[];
  readonly actions: readonly string[];
  readonly continuityRequirements: readonly string[];
  readonly changes: readonly string[];
  readonly mustNotInherit: readonly string[];
  readonly narrativePurpose: string;
  readonly possessions: readonly { readonly objectId: string; readonly holder: string }[];
  readonly incomingTransition: NarrativeTransition | null;
  readonly outgoingTransition: NarrativeTransition | null;
};

export type ActiveSceneIntentField = keyof ActiveSceneIntentValues;

export type CreativeAuthorityLayer = {
  readonly authorityId: string;
  readonly kind: CreativeAuthorityKind;
  readonly classification: "ACTIVE" | "CONTINUITY_REFERENCE" | "HISTORICAL_ONLY" | "SUPERSEDED" | "REJECTED";
  readonly governs: readonly ActiveSceneIntentField[];
  readonly values: Partial<ActiveSceneIntentValues>;
};

export type ResolvedActiveSceneIntent = ActiveSceneIntentValues & {
  readonly contractVersion: typeof AI_STORY_ACTIVE_INTENT_CONTRACT_VERSION;
  readonly fieldAuthority: Readonly<Record<ActiveSceneIntentField, string>>;
  readonly sources: readonly {
    readonly authorityId: string;
    readonly kind: CreativeAuthorityKind;
    readonly classification: CreativeAuthorityClassification;
  }[];
};

export type ActiveAuthorityProjection = {
  readonly values: Partial<ActiveSceneIntentValues>;
  readonly fieldAuthority: Readonly<Partial<Record<ActiveSceneIntentField, string>>>;
  readonly sources: readonly {
    readonly authorityId: string;
    readonly kind: CreativeAuthorityKind;
    readonly classification: CreativeAuthorityClassification;
  }[];
};

const fields: readonly ActiveSceneIntentField[] = [
  "location",
  "charactersPresent",
  "actions",
  "continuityRequirements",
  "changes",
  "mustNotInherit",
  "narrativePurpose",
  "possessions",
  "incomingTransition",
  "outgoingTransition",
];

const precedence = new Map<CreativeAuthorityKind, number>(
  AI_STORY_CREATIVE_AUTHORITY_PRECEDENCE.map((kind, index) => [kind, index])
);

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Resolves execution-facing creative authority field-by-field. A source marked
 * historical/superseded/rejected is never eligible. An active source that
 * claims a field must supply it; the resolver fails closed instead of falling
 * back to an older value.
 */
export function resolveActiveAuthorityProjection(
  layers: readonly CreativeAuthorityLayer[],
  requiredFields: readonly ActiveSceneIntentField[]
): ActiveAuthorityProjection {
  const eligible = layers
    .filter((layer) => layer.classification === "ACTIVE" || layer.classification === "CONTINUITY_REFERENCE")
    .sort((left, right) => (precedence.get(right.kind) ?? -1) - (precedence.get(left.kind) ?? -1));
  const resolved: Partial<ActiveSceneIntentValues> = {};
  const fieldAuthority = {} as Record<ActiveSceneIntentField, string>;

  for (const field of requiredFields) {
    const owner = eligible.find((layer) => layer.governs.includes(field));
    if (!owner) throw new Error(`ACTIVE_SCENE_INTENT_MISSING:${field}`);
    const value = owner.values[field];
    if (value === undefined) throw new Error(`ACTIVE_SCENE_INTENT_AUTHORITY_INCOMPLETE:${owner.authorityId}:${field}`);
    (resolved as Record<ActiveSceneIntentField, unknown>)[field] = value;
    fieldAuthority[field] = owner.authorityId;
  }

  const activeOwners = new Set(Object.values(fieldAuthority));
  return {
    values: resolved,
    fieldAuthority,
    sources: layers.map((layer) => ({
      authorityId: layer.authorityId,
      kind: layer.kind,
      classification:
        layer.classification === "ACTIVE" && !activeOwners.has(layer.authorityId)
          ? "SUPERSEDED"
          : layer.classification,
    })),
  };
}

export function resolveActiveSceneIntent(layers: readonly CreativeAuthorityLayer[]): ResolvedActiveSceneIntent {
  const projection = resolveActiveAuthorityProjection(layers, fields);
  const resolved = projection.values as ActiveSceneIntentValues;
  return {
    contractVersion: AI_STORY_ACTIVE_INTENT_CONTRACT_VERSION,
    ...resolved,
    charactersPresent: unique(resolved.charactersPresent),
    actions: unique(resolved.actions),
    continuityRequirements: unique(resolved.continuityRequirements),
    changes: unique(resolved.changes),
    mustNotInherit: unique(resolved.mustNotInherit),
    fieldAuthority: projection.fieldAuthority as Readonly<Record<ActiveSceneIntentField, string>>,
    sources: projection.sources,
  };
}

export type NarrativeSceneSnapshot = {
  readonly sceneId: string;
  readonly order: number;
  readonly location: { readonly id: string; readonly label: string };
  readonly charactersPresent: readonly string[];
  readonly possessionFacts: readonly { readonly objectId: string; readonly holder: string }[];
  readonly transitions?: readonly NarrativeTransition[];
};

export type NarrativeWorldState = {
  readonly contractVersion: typeof AI_STORY_NARRATIVE_WORLD_STATE_CONTRACT_VERSION;
  readonly sceneId: string;
  readonly currentLocation: { readonly id: string; readonly label: string };
  readonly historicalLocations: readonly { readonly id: string; readonly label: string }[];
  readonly charactersPresent: readonly string[];
  readonly possessions: readonly { readonly objectId: string; readonly holder: string }[];
  readonly incomingTransition: NarrativeTransition | null;
  readonly outgoingTransition: NarrativeTransition | null;
};

/** Latest ordered Scene state replaces location/presence and latest possession wins. */
export function projectNarrativeWorldState(
  scenes: readonly NarrativeSceneSnapshot[],
  targetSceneId: string
): NarrativeWorldState {
  const ordered = [...scenes].sort((left, right) => left.order - right.order);
  const targetIndex = ordered.findIndex((scene) => scene.sceneId === targetSceneId);
  if (targetIndex < 0) throw new Error(`NARRATIVE_WORLD_STATE_SCENE_MISSING:${targetSceneId}`);
  const target = ordered[targetIndex]!;
  const prior = ordered.slice(0, targetIndex);
  const previous = prior.at(-1) ?? null;
  const next = ordered[targetIndex + 1] ?? null;
  const possessionMap = new Map<string, string>();
  for (const scene of ordered.slice(0, targetIndex + 1)) {
    for (const fact of scene.possessionFacts) possessionMap.set(fact.objectId, fact.holder);
    for (const transition of scene.transitions ?? []) {
      if (transition.type === "ACQUIRE_OBJECT") possessionMap.set(transition.objectId, transition.holderId);
      if (transition.type === "RELEASE_OBJECT" && possessionMap.get(transition.objectId) === transition.holderId) possessionMap.delete(transition.objectId);
      if (transition.type === "TRANSFER_OBJECT") possessionMap.set(transition.objectId, transition.toHolderId);
    }
  }

  const incomingTransition = target.transitions?.find((transition) =>
    transition.type === "ENTER_LOCATION" || transition.type === "MOVE_TO_LOCATION"
  ) ?? (previous && previous.location.id !== target.location.id
    ? { type: "MOVE_TO_LOCATION" as const, fromLocationId: previous.location.id, toLocationId: target.location.id }
    : null);
  const outgoingTransition = target.transitions?.find((transition) => transition.type === "EXIT_LOCATION")
    ?? (next && next.location.id !== target.location.id
      ? { type: "MOVE_TO_LOCATION" as const, fromLocationId: target.location.id, toLocationId: next.location.id }
      : null);

  return {
    contractVersion: AI_STORY_NARRATIVE_WORLD_STATE_CONTRACT_VERSION,
    sceneId: target.sceneId,
    currentLocation: target.location,
    historicalLocations: [...new Map(prior.map((scene) => [scene.location.id, scene.location])).values()]
      .filter((location) => location.id !== target.location.id),
    // Presence is a current-Scene fact, never a cumulative union.
    charactersPresent: unique(target.charactersPresent),
    possessions: [...possessionMap.entries()].map(([objectId, holder]) => ({ objectId, holder })),
    incomingTransition,
    outgoingTransition,
  };
}

function locationLabel(scene: AiStoryCanonicalScene): string {
  return scene.locationBinding.scope === "EPHEMERAL_ENVIRONMENT"
    ? scene.locationBinding.displayName
    : `${scene.locationBinding.scope}:${scene.locationBinding.id}`;
}

export function canonicalSceneSnapshot(scene: AiStoryCanonicalScene): NarrativeSceneSnapshot {
  const possessions = [...scene.entryState, ...scene.exitState]
    .filter((fact) => fact.dimension === "POSSESSION")
    .map((fact) => ({ objectId: fact.subjectId, holder: fact.value }));
  return {
    sceneId: scene.sceneId,
    order: scene.order,
    location: { id: scene.locationBinding.id, label: locationLabel(scene) },
    charactersPresent: scene.castBindings.map((cast) => cast.id),
    possessionFacts: possessions,
  };
}

export function resolveCanonicalSceneActiveIntent(scene: AiStoryCanonicalScene): ResolvedActiveSceneIntent {
  const snapshot = canonicalSceneSnapshot(scene);
  const world = projectNarrativeWorldState([snapshot], scene.sceneId);
  const actions = scene.events.filter((event) => event.type === "ACTION").map((event) => event.action);
  return resolveActiveSceneIntent([{
    authorityId: scene.sceneVersionId,
    kind: "CANONICAL_SCENE_INTENT",
    classification: "ACTIVE",
    governs: fields,
    values: {
      location: world.currentLocation,
      charactersPresent: world.charactersPresent,
      actions,
      continuityRequirements: scene.continuityFacts,
      changes: scene.exitState.map((fact) => `${fact.subjectId}:${fact.dimension}=${fact.value}`),
      mustNotInherit: scene.mustAvoid,
      narrativePurpose: scene.sceneFunction,
      possessions: world.possessions,
      incomingTransition: world.incomingTransition,
      outgoingTransition: world.outgoingTransition,
    },
  }]);
}
