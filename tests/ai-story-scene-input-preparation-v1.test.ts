import { describe, expect, it } from "vitest";
import {
  resolveActiveSceneIntent,
  type NarrativeWorldState,
  type ResolvedActiveSceneIntent,
} from "../packages/agents/src/ai-story/active-intent-world-state";
import {
  AI_STORY_EXISTING_SCENE_PREPARATION_CAPABILITY,
  SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
  SEEDANCE_TEXT_TO_VIDEO_SCENE_INPUT_CAPABILITY,
  certifyPreparedSceneFrame,
  createSceneInputPreparationAuthority,
  isSceneInputPreparationExecutable,
  isSceneInputPreparationIntegrityValid,
  narrativeWorldStateIdentity,
  resolveProviderReadySceneInput,
  sceneInputPreparationUserState,
  selectActiveSceneInputPreparation,
  type RawBusinessAssetSceneAnalysis,
  type SceneInputPreparationAuthority,
} from "../packages/agents/src/ai-story/scene-input-preparation";

const HASH = `sha256:${"a".repeat(64)}`;
const OUTPUT_HASH = `sha256:${"b".repeat(64)}`;

function intent(input: {
  location: string;
  characters?: readonly string[];
  possessions?: readonly { objectId: string; holder: string }[];
  actions?: readonly string[];
  authorityId?: string;
}): ResolvedActiveSceneIntent {
  return resolveActiveSceneIntent([{
    authorityId: input.authorityId ?? "intent-v1",
    kind: "CANONICAL_SCENE_INTENT",
    classification: "ACTIVE",
    governs: [
      "location", "charactersPresent", "actions", "continuityRequirements", "changes",
      "mustNotInherit", "narrativePurpose", "possessions", "incomingTransition", "outgoingTransition",
    ],
    values: {
      location: { id: input.location, label: input.location.toUpperCase() },
      charactersPresent: input.characters ?? [],
      actions: input.actions ?? [],
      continuityRequirements: ["Preserve subject identity"],
      changes: [],
      mustNotInherit: [],
      narrativePurpose: "Current Scene development",
      possessions: input.possessions ?? [],
      incomingTransition: null,
      outgoingTransition: null,
    },
  }]);
}

function world(
  sceneId: string,
  currentLocation: string,
  charactersPresent: readonly string[] = [],
  possessions: readonly { objectId: string; holder: string }[] = []
): NarrativeWorldState {
  return {
    contractVersion: "ai-story-narrative-world-state.v1",
    sceneId,
    currentLocation: { id: currentLocation, label: currentLocation.toUpperCase() },
    historicalLocations: [],
    charactersPresent,
    possessions,
    incomingTransition: null,
    outgoingTransition: null,
  };
}

function raw(overrides: Partial<RawBusinessAssetSceneAnalysis> = {}): RawBusinessAssetSceneAnalysis {
  return {
    assetId: "raw-asset",
    workspaceId: "workspace",
    contentHash: HASH,
    mimeType: "image/jpeg",
    identityCompatibility: "VERIFIED",
    identityFacts: ["recognizable shape", "stable colors", "original packaging"],
    environment: {
      classification: "LOCATION_BOUND",
      locationId: "flower-shop",
      label: "Flower shop workbench",
      facts: ["florist workbench", "shop display"],
    },
    compositionCompatibility: "COMPATIBLE",
    actionCompatibility: "COMPATIBLE",
    charactersPresent: ["mara"],
    possessions: [{ objectId: "bouquet", holder: "mara" }],
    ...overrides,
  };
}

function prepare(input: {
  activeIntent: ResolvedActiveSceneIntent;
  worldState: NarrativeWorldState;
  rawAsset?: RawBusinessAssetSceneAnalysis;
  provider?: typeof SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY;
  version?: number;
  preparationAuthorityId?: string;
  sceneVersionId?: string;
  activeIntentAuthorityId?: string;
  supersedes?: string | null;
}): SceneInputPreparationAuthority {
  return createSceneInputPreparationAuthority({
    preparationAuthorityId: input.preparationAuthorityId ?? "preparation-v1",
    version: input.version ?? 1,
    sceneId: input.worldState.sceneId,
    sceneVersionId: input.sceneVersionId ?? "scene-version-v1",
    retryAuthorityId: null,
    activeIntentAuthorityId: input.activeIntentAuthorityId ?? "intent-v1",
    activeIntent: input.activeIntent,
    worldState: input.worldState,
    rawAsset: input.rawAsset ?? raw(),
    provider: input.provider ?? SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
    supersedesPreparationAuthorityId: input.supersedes ?? null,
    createdAt: `2026-09-03T00:00:0${(input.version ?? 1) - 1}.000Z`,
  });
}

describe("AI Story V1 raw asset / Provider-ready Scene input separation", () => {
  it("allows direct use only when identity, environment, composition, action, presence and possession all match", () => {
    const activeIntent = intent({
      location: "flower-shop",
      characters: ["mara"],
      possessions: [{ objectId: "bouquet", holder: "mara" }],
      actions: ["Mara presents the bouquet at the workbench"],
    });
    const authority = prepare({ activeIntent, worldState: world("scene-1", "flower-shop", ["mara"], [{ objectId: "bouquet", holder: "mara" }]) });
    expect(authority.decision).toBe("DIRECT_USE");
    expect(authority.reasons).toEqual([]);
    expect(authority.environmentFactsNotToInherit).toEqual([]);
    expect(isSceneInputPreparationIntegrityValid(authority)).toBe(true);
    expect(resolveProviderReadySceneInput({ preparation: authority })).toMatchObject({
      sourceKind: "RAW_DIRECT",
      assetId: "raw-asset",
    });
  });

  it("requires preparation for current florist Scene 2 instead of inheriting its workbench background", () => {
    const activeIntent = intent({
      location: "urban-walkway",
      characters: ["mara", "courier"],
      possessions: [{ objectId: "bouquet", holder: "mara" }],
      actions: ["Mara walks forward carrying the bouquet", "A courier passes in the background"],
    });
    const authority = prepare({
      activeIntent,
      worldState: world("scene-001", "urban-walkway", ["mara", "courier"], [{ objectId: "bouquet", holder: "mara" }]),
      rawAsset: raw({
        assetId: "7ca6056f-adac-4539-a535-854908e78d66",
        compositionCompatibility: "CONFLICTING",
        actionCompatibility: "CONFLICTING",
        charactersPresent: [],
        possessions: [{ objectId: "bouquet", holder: "workbench" }],
      }),
    });
    expect(authority.decision).toBe("SCENE_PREPARATION_REQUIRED");
    expect(authority.reasons).toEqual(expect.arrayContaining([
      "RAW_ENVIRONMENT_CONFLICTS_WITH_ACTIVE_SCENE",
      "RAW_ACTION_CONFLICTS_WITH_ACTIVE_SCENE",
      "RAW_COMPOSITION_CONFLICTS_WITH_ACTIVE_SCENE",
      "REQUIRED_CHARACTER_PRESENCE_MISSING",
      "PRODUCT_POSSESSION_START_STATE_CONFLICT",
    ]));
    expect(authority.identityFactsToPreserve).toContain("stable colors");
    expect(authority.environmentFactsNotToInherit).toContain("florist workbench");
    expect(() => resolveProviderReadySceneInput({ preparation: authority })).toThrow("PROVIDER_READY_SCENE_INPUT_REQUIRED");
  });

  it.each([
    { name: "café", objectId: "coffee", person: "customer", rawLocation: "cafe", target: "park" },
    { name: "pet", objectId: "dog", person: "owner", rawLocation: "living-room", target: "park" },
  ])("requires Scene preparation for $name source identity in a new environment", ({ objectId, person, rawLocation, target }) => {
    const activeIntent = intent({
      location: target,
      characters: [person],
      possessions: [{ objectId, holder: person }],
      actions: [`${person} uses ${objectId} in ${target}`],
    });
    const authority = prepare({
      activeIntent,
      worldState: world(`scene-${objectId}`, target, [person], [{ objectId, holder: person }]),
      rawAsset: raw({
        assetId: `raw-${objectId}`,
        environment: { classification: "LOCATION_BOUND", locationId: rawLocation, label: rawLocation, facts: [rawLocation] },
        charactersPresent: [person],
        possessions: [{ objectId, holder: person }],
      }),
    });
    expect(authority.decision).toBe("SCENE_PREPARATION_REQUIRED");
    expect(authority.reasons).toContain("RAW_ENVIRONMENT_CONFLICTS_WITH_ACTIVE_SCENE");
    expect(authority.targetLocation.id).toBe("park");
  });

  it("fails truthfully for unsupported or identity-conflicting input", () => {
    const activeIntent = intent({ location: "park" });
    const authority = prepare({
      activeIntent,
      worldState: world("scene", "park"),
      rawAsset: raw({ mimeType: "video/mp4", identityCompatibility: "CONFLICTING" }),
    });
    expect(authority.decision).toBe("UNUSABLE_FOR_SCENE");
    expect(authority.reasons).toEqual(expect.arrayContaining(["UNSUPPORTED_RAW_ASSET", "SUBJECT_IDENTITY_CONFLICT"]));
  });

  it("uses Provider capability instead of silently emitting an image to TEXT_TO_VIDEO", () => {
    const activeIntent = intent({ location: "flower-shop", characters: ["mara"], possessions: [{ objectId: "bouquet", holder: "mara" }] });
    const authority = createSceneInputPreparationAuthority({
      preparationAuthorityId: "t2v-preparation",
      version: 1,
      sceneId: "scene",
      sceneVersionId: "scene-v1",
      activeIntentAuthorityId: "intent-v1",
      activeIntent,
      worldState: world("scene", "flower-shop", ["mara"], [{ objectId: "bouquet", holder: "mara" }]),
      rawAsset: raw(),
      provider: SEEDANCE_TEXT_TO_VIDEO_SCENE_INPUT_CAPABILITY,
      createdAt: "2026-09-03T00:00:00.000Z",
    });
    expect(authority.compatibility.providerMode).toBe("NOT_APPLICABLE");
    expect(authority.decision).toBe("UNUSABLE_FOR_SCENE");
    expect(authority.reasons).toContain("PROVIDER_MODE_DOES_NOT_ACCEPT_SCENE_FRAME");
  });
});

describe("AI Story V1 prepared-input latest authority and QC", () => {
  it("fails closed when active intent and current world state disagree", () => {
    const activeIntent = intent({ location: "park", characters: ["customer"] });
    expect(() => prepare({
      activeIntent,
      worldState: world("scene", "cafe", ["customer"]),
    })).toThrow("SCENE_INPUT_PREPARATION_ACTIVE_AUTHORITY_CONFLICT");
  });

  it("makes a previous preparation non-executable after a newer intent/world-state authority", () => {
    const oldIntent = intent({ location: "flower-shop", authorityId: "intent-v1" });
    const currentIntent = intent({ location: "urban-walkway", authorityId: "intent-v2" });
    const oldAuthority = prepare({
      activeIntent: oldIntent,
      worldState: world("scene", "flower-shop"),
      preparationAuthorityId: "preparation-v1",
      activeIntentAuthorityId: "intent-v1",
    });
    const currentAuthority = prepare({
      activeIntent: currentIntent,
      worldState: world("scene", "urban-walkway"),
      preparationAuthorityId: "preparation-v2",
      version: 2,
      sceneVersionId: "scene-version-v2",
      activeIntentAuthorityId: "intent-v2",
      supersedes: oldAuthority.preparationAuthorityId,
    });
    const selected = selectActiveSceneInputPreparation({
      authorities: [oldAuthority, currentAuthority],
      sceneId: "scene",
      sceneVersionId: "scene-version-v2",
      activeIntentAuthorityId: "intent-v2",
      narrativeWorldStateIdentity: narrativeWorldStateIdentity(world("scene", "urban-walkway")),
    });
    expect(selected.active.preparationAuthorityId).toBe("preparation-v2");
    expect(selected.historical).toContain(oldAuthority);
    expect(isSceneInputPreparationExecutable({ authority: oldAuthority, currentAuthority: selected.active })).toBe(false);
    expect(isSceneInputPreparationExecutable({ authority: currentAuthority, currentAuthority: selected.active })).toBe(true);
  });

  it("fails closed on two current preparation authorities at the same version", () => {
    const activeIntent = intent({ location: "park" });
    const first = prepare({ activeIntent, worldState: world("scene", "park"), preparationAuthorityId: "a" });
    const second = prepare({ activeIntent, worldState: world("scene", "park"), preparationAuthorityId: "b" });
    expect(() => selectActiveSceneInputPreparation({
      authorities: [first, second],
      sceneId: "scene",
      sceneVersionId: "scene-version-v1",
      activeIntentAuthorityId: "intent-v1",
      narrativeWorldStateIdentity: first.narrativeWorldStateIdentity,
    })).toThrow("CURRENT_SCENE_INPUT_PREPARATION_AUTHORITY_CONFLICT");
  });

  it("requires every preparation QC gate before a derived frame becomes Provider-ready", () => {
    const activeIntent = intent({ location: "urban-walkway", characters: ["mara"], possessions: [{ objectId: "bouquet", holder: "mara" }] });
    const preparation = prepare({ activeIntent, worldState: world("scene", "urban-walkway", ["mara"], [{ objectId: "bouquet", holder: "mara" }]) });
    const passed = certifyPreparedSceneFrame({
      preparation,
      outputAssetId: "prepared-asset",
      outputContentHash: OUTPUT_HASH,
      evidence: {
        subjectIdentity: true,
        currentLocation: true,
        requiredCharacterPresence: true,
        productPossession: true,
        requiredActionStartState: true,
        historicalEnvironmentAbsent: true,
      },
    });
    expect(passed.providerReady).toBe(true);
    expect(resolveProviderReadySceneInput({ preparation, preparedFrame: passed })).toMatchObject({
      sourceKind: "PREPARED_DERIVATIVE",
      assetId: "prepared-asset",
      contentHash: OUTPUT_HASH,
    });
    const blocked = certifyPreparedSceneFrame({
      preparation,
      outputAssetId: "prepared-asset",
      outputContentHash: OUTPUT_HASH,
      evidence: {
        subjectIdentity: true,
        currentLocation: false,
        requiredCharacterPresence: true,
        productPossession: true,
        requiredActionStartState: true,
        historicalEnvironmentAbsent: false,
      },
    });
    expect(blocked.providerReady).toBe(false);
    expect(blocked.qc).toEqual(expect.arrayContaining([
      { gate: "CURRENT_LOCATION", result: "FAIL" },
      { gate: "HISTORICAL_ENVIRONMENT_ABSENT", result: "FAIL" },
    ]));
  });

  it("keeps normal-user state free of Provider and authority terminology", () => {
    expect(sceneInputPreparationUserState("DIRECT_USE")).toBe("SCENE_VISUAL_READY");
    expect(sceneInputPreparationUserState("SCENE_PREPARATION_REQUIRED")).toBe("PREPARING_SCENE");
    expect(sceneInputPreparationUserState("UNUSABLE_FOR_SCENE")).toBe("SCENE_INPUT_UNAVAILABLE");
  });

  it("maps Photo Scene truthfully as component reuse, not a narrative keyframe generator", () => {
    expect(AI_STORY_EXISTING_SCENE_PREPARATION_CAPABILITY).toMatchObject({
      reusableComponents: true,
      supportsNarrativeCharacterActionKeyframes: false,
      reusableAsCompleteScenePreparation: false,
      missingCapability: "SCENE_KEYFRAME_PREPARATION_EXECUTION_CAPABILITY_REQUIRED",
    });
  });
});
