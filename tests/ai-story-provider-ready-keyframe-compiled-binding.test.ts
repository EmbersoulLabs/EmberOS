import { describe, expect, it } from "vitest";
import { assertAiStoryCompiledProviderWireModeCompatibility } from "@ceo-agent/shared";
import {
  resolveActiveSceneIntent,
  type NarrativeWorldState,
  type ResolvedActiveSceneIntent,
} from "../packages/agents/src/ai-story/active-intent-world-state";
import {
  SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
  SEEDANCE_TEXT_TO_VIDEO_SCENE_INPUT_CAPABILITY,
  certifyPreparedSceneFrame,
  createSceneInputPreparationAuthority,
  type PreparedSceneFrameAuthority,
  type RawBusinessAssetSceneAnalysis,
  type SceneInputPreparationAuthority,
} from "../packages/agents/src/ai-story/scene-input-preparation";
import {
  computeAiStoryCompiledRequestFingerprint,
  compileImmutableSeedanceRequestFromSceneCompilation,
  previewAiStorySeedanceWireRequest,
  validateAiStoryCompiledRequestFingerprint,
} from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

/** Historical raw workbench asset that must lose execution authority. */
const RAW_ASSET_ID = "7ca6056f-adac-4539-a535-854908e78d66";
const RAW_CONTENT_HASH = `sha256:${"a".repeat(64)}`;
/** Certified Provider-ready Scene 2 keyframe. */
const PREPARED_ASSET_ID = "fb7a5783-99b2-58dd-bb79-f0dac81681a4";
const PREPARED_CONTENT_HASH =
  "sha256:99ae66fa4faaab1076d8a83e49c6aece3f739051f2db98f9ea3a76bcccb3fffa";

const AUTHORITY = {
  qcEvaluationId: "30000000-0000-4000-8000-000000000001",
  qcFingerprint: `sha256:${"a".repeat(64)}`,
  qcCapabilityVersion: "seedance-modelark-test.v1",
  directorFingerprint: `sha256:${"b".repeat(64)}`,
  motionFingerprint: `sha256:${"c".repeat(64)}`,
} as const;

const SCENE_LOCATION = "urban-walkway";
const SCENE_ACTION = "Mara walks forward along the urban walkway carrying the bouquet";

function scene2Intent(): ResolvedActiveSceneIntent {
  return resolveActiveSceneIntent([{
    authorityId: "intent-scene2-v1",
    kind: "CANONICAL_SCENE_INTENT",
    classification: "ACTIVE",
    governs: [
      "location", "charactersPresent", "actions", "continuityRequirements", "changes",
      "mustNotInherit", "narrativePurpose", "possessions", "incomingTransition", "outgoingTransition",
    ],
    values: {
      location: { id: SCENE_LOCATION, label: "URBAN WALKWAY" },
      charactersPresent: ["mara"],
      actions: [SCENE_ACTION],
      continuityRequirements: ["Preserve subject identity"],
      changes: [],
      mustNotInherit: ["florist workbench", "shop display"],
      narrativePurpose: "Courier delivery in progress",
      possessions: [{ objectId: "bouquet", holder: "mara" }],
      incomingTransition: null,
      outgoingTransition: null,
    },
  }]);
}

function scene2World(): NarrativeWorldState {
  return {
    contractVersion: "ai-story-narrative-world-state.v1",
    sceneId: "scene-2",
    currentLocation: { id: SCENE_LOCATION, label: "URBAN WALKWAY" },
    historicalLocations: [{ id: "flower-shop", label: "FLOWER SHOP" }],
    charactersPresent: ["mara"],
    possessions: [{ objectId: "bouquet", holder: "mara" }],
    incomingTransition: null,
    outgoingTransition: null,
  };
}

/** Raw workbench capture: identity is usable, but the environment is another Scene. */
function rawWorkbenchAsset(
  overrides: Partial<RawBusinessAssetSceneAnalysis> = {}
): RawBusinessAssetSceneAnalysis {
  return {
    assetId: RAW_ASSET_ID,
    workspaceId: "workspace",
    contentHash: RAW_CONTENT_HASH,
    mimeType: "image/jpeg",
    identityCompatibility: "VERIFIED",
    identityFacts: ["recognizable bouquet", "stable colors"],
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

function preparation(input: {
  readonly rawAsset?: RawBusinessAssetSceneAnalysis;
  readonly provider?: typeof SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY;
  readonly version?: number;
} = {}): SceneInputPreparationAuthority {
  return createSceneInputPreparationAuthority({
    preparationAuthorityId: `scene2-preparation-v${input.version ?? 1}`,
    version: input.version ?? 1,
    sceneId: "scene-2",
    sceneVersionId: "scene-2-version-v1",
    retryAuthorityId: null,
    activeIntentAuthorityId: "intent-scene2-v1",
    activeIntent: scene2Intent(),
    worldState: scene2World(),
    rawAsset: input.rawAsset ?? rawWorkbenchAsset(),
    provider: input.provider ?? SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
    supersedesPreparationAuthorityId: null,
    createdAt: "2026-09-03T00:00:00.000Z",
  });
}

function preparedKeyframe(input: {
  readonly preparation: SceneInputPreparationAuthority;
  readonly historicalEnvironmentAbsent?: boolean;
}): PreparedSceneFrameAuthority {
  return certifyPreparedSceneFrame({
    preparation: input.preparation,
    outputAssetId: PREPARED_ASSET_ID,
    outputContentHash: PREPARED_CONTENT_HASH,
    evidence: {
      subjectIdentity: true,
      currentLocation: true,
      requiredCharacterPresence: true,
      productPossession: true,
      requiredActionStartState: true,
      historicalEnvironmentAbsent: input.historicalEnvironmentAbsent ?? true,
    },
  });
}

/** Scene 2 compilation still carrying the historical raw asset as its reference. */
function scene2Compilation() {
  const compilation = makePhase2aCompilation({ sceneOrder: [0] });
  const baseIntent = compilation.intents[0]!;
  const baseInstructions = compilation.instructionsBySceneExecutionId[
    baseIntent.identity.sceneExecutionId
  ]!;
  const generationAuthority = {
    strategy: "PRODUCT_GROUNDED_VIDEO" as const,
    referenceSource: "STORY_INHERITED" as const,
    effectiveReferenceIds: [RAW_ASSET_ID],
    firstFrameAssetId: RAW_ASSET_ID,
    productVisualIdentityRequirement: "REQUIRED" as const,
  };
  return {
    intent: {
      ...baseIntent,
      referencedAssetIds: [RAW_ASSET_ID],
      generationAuthority,
    },
    instructions: {
      ...baseInstructions,
      referencedAssetIds: [RAW_ASSET_ID],
      generationAuthority,
    },
  };
}

const REFERENCE_ASSETS = [
  { assetId: RAW_ASSET_ID, mediaType: "image/jpeg", storagePath: "workspace/library/raw-workbench.jpg" },
  { assetId: PREPARED_ASSET_ID, mediaType: "image/jpeg", storagePath: "workspace/library/scene2-keyframe.jpg" },
];

function compileScene2(overrides: {
  readonly sceneInputPreparation?: SceneInputPreparationAuthority | null;
  readonly preparedSceneFrame?: PreparedSceneFrameAuthority | null;
  readonly compiledAt?: string;
} = {}) {
  const selected = scene2Compilation();
  return compileImmutableSeedanceRequestFromSceneCompilation({
    ...selected,
    authority: AUTHORITY,
    adapterVersion: "1.0.0",
    compiledAt: overrides.compiledAt ?? "2026-09-04T00:00:00.000Z",
    resolution: "480p",
    referenceAssets: REFERENCE_ASSETS,
    ...(overrides.sceneInputPreparation !== undefined
      ? { sceneInputPreparation: overrides.sceneInputPreparation }
      : {}),
    ...(overrides.preparedSceneFrame !== undefined
      ? { preparedSceneFrame: overrides.preparedSceneFrame }
      : {}),
  });
}

describe("Provider-ready keyframe compiled first-frame binding", () => {
  it("proves the unprepared compilation still binds the historical raw asset", () => {
    const compiled = compileScene2();
    expect(compiled.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
    expect(compiled.referenceMappings).toHaveLength(1);
    expect(compiled.referenceMappings[0]).toMatchObject({
      assetId: RAW_ASSET_ID,
      wireRole: "first_frame",
    });
    expect(compiled.providerReadySceneInput).toBeUndefined();
  });

  it("binds the Provider-ready keyframe as the sole first frame under Latest Authority Wins", () => {
    const active = preparation();
    expect(active.decision).toBe("SCENE_PREPARATION_REQUIRED");
    const compiled = compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: preparedKeyframe({ preparation: active }),
    });

    expect(compiled.referenceMappings).toHaveLength(1);
    expect(compiled.referenceMappings[0]).toMatchObject({
      assetId: PREPARED_ASSET_ID,
      wireRole: "first_frame",
    });
    expect(compiled.providerReadySceneInput).toMatchObject({
      contractVersion: "ai-story-provider-ready-scene-input.v1",
      sourceKind: "PREPARED_DERIVATIVE",
      assetId: PREPARED_ASSET_ID,
      contentHash: PREPARED_CONTENT_HASH,
      providerMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
    });
    expect(validateAiStoryCompiledRequestFingerprint(compiled)).toBe(true);
    expect(() => assertAiStoryCompiledProviderWireModeCompatibility(compiled)).not.toThrow();
  });

  it("demotes the historical raw asset to lineage-only audit evidence", () => {
    const active = preparation();
    const compiled = compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: preparedKeyframe({ preparation: active }),
    });

    const emittedAssetIds = compiled.referenceMappings.map((reference) => reference.assetId);
    expect(emittedAssetIds).not.toContain(RAW_ASSET_ID);
    expect(compiled.referenceMappings.filter((r) => r.wireRole === "reference_image")).toEqual([]);

    const rawLineage = compiled.storyReferenceMappings?.find(
      (reference) => reference.assetId === RAW_ASSET_ID
    );
    expect(rawLineage).toMatchObject({
      semanticRole: "STORY_VISUAL_REFERENCE",
      providerEmitted: false,
    });
    expect(rawLineage?.providerWireRole).toBeUndefined();
  });

  it("fails closed when preparation is required but no prepared frame exists", () => {
    const active = preparation();
    expect(() => compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: null,
    })).toThrowError(
      expect.objectContaining({ code: "PROVIDER_READY_SCENE_INPUT_REQUIRED" })
    );
  });

  it("fails closed instead of falling back to raw when keyframe QC did not pass", () => {
    const active = preparation();
    const failedQc = preparedKeyframe({
      preparation: active,
      historicalEnvironmentAbsent: false,
    });
    expect(failedQc.providerReady).toBe(false);
    expect(() => compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: failedQc,
    })).toThrowError(
      expect.objectContaining({ code: "PROVIDER_READY_SCENE_INPUT_REQUIRED" })
    );
  });

  it("fails closed when a prepared frame belongs to a superseded preparation authority", () => {
    const superseded = preparation({ version: 1 });
    const current = preparation({ version: 2 });
    expect(() => compileScene2({
      sceneInputPreparation: current,
      preparedSceneFrame: preparedKeyframe({ preparation: superseded }),
    })).toThrowError(
      expect.objectContaining({ code: "PROVIDER_READY_SCENE_INPUT_REQUIRED" })
    );
  });

  it("fails closed rather than dropping preparation authority into a T2V compilation", () => {
    const active = preparation({ provider: SEEDANCE_TEXT_TO_VIDEO_SCENE_INPUT_CAPABILITY });
    const selected = scene2Compilation();
    const t2vAuthority = {
      strategy: "TEXT_TO_VIDEO" as const,
      referenceSource: "REFERENCE_FREE_T2V" as const,
      effectiveReferenceIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE" as const,
    };
    expect(() => compileImmutableSeedanceRequestFromSceneCompilation({
      intent: { ...selected.intent, referencedAssetIds: [], generationAuthority: t2vAuthority },
      instructions: { ...selected.instructions, referencedAssetIds: [], generationAuthority: t2vAuthority },
      authority: AUTHORITY,
      adapterVersion: "1.0.0",
      compiledAt: "2026-09-04T00:00:00.000Z",
      sceneInputPreparation: active,
    })).toThrowError(
      expect.objectContaining({ code: "PROVIDER_READY_SCENE_INPUT_REQUIRED" })
    );
  });

  it("binds the raw asset only when preparation certifies direct use", () => {
    const directUse = createSceneInputPreparationAuthority({
      preparationAuthorityId: "scene2-direct-use-v1",
      version: 1,
      sceneId: "scene-2",
      sceneVersionId: "scene-2-version-v1",
      retryAuthorityId: null,
      activeIntentAuthorityId: "intent-scene2-v1",
      activeIntent: scene2Intent(),
      worldState: scene2World(),
      rawAsset: rawWorkbenchAsset({
        environment: {
          classification: "LOCATION_BOUND",
          locationId: SCENE_LOCATION,
          label: "Urban walkway",
          facts: ["urban walkway"],
        },
      }),
      provider: SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
      supersedesPreparationAuthorityId: null,
      createdAt: "2026-09-03T00:00:00.000Z",
    });
    expect(directUse.decision).toBe("DIRECT_USE");

    const compiled = compileScene2({ sceneInputPreparation: directUse });
    expect(compiled.providerReadySceneInput).toMatchObject({
      sourceKind: "RAW_DIRECT",
      assetId: RAW_ASSET_ID,
    });
    expect(compiled.referenceMappings[0]).toMatchObject({
      assetId: RAW_ASSET_ID,
      wireRole: "first_frame",
    });
  });

  it("rejects a compiled request whose first frame drifts from the Provider-ready authority", () => {
    const active = preparation();
    const valid = compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: preparedKeyframe({ preparation: active }),
    });
    const drifted = {
      ...valid,
      referenceMappings: [
        { ...valid.referenceMappings[0]!, assetId: RAW_ASSET_ID },
      ],
    };
    const { requestFingerprint: _stale, ...hashInput } = drifted;
    const tampered = {
      ...drifted,
      requestFingerprint: computeAiStoryCompiledRequestFingerprint(hashInput),
    };
    expect(tampered.requestFingerprint).not.toBe(valid.requestFingerprint);
    expect(() => assertAiStoryCompiledProviderWireModeCompatibility(tampered)).toThrowError(
      expect.objectContaining({ code: "SEEDANCE_FIRST_FRAME_I2V_WIRE_MODE_INVALID" })
    );
  });

  it("compiles the Provider-ready binding idempotently", () => {
    const active = preparation();
    const frame = preparedKeyframe({ preparation: active });
    const first = compileScene2({ sceneInputPreparation: active, preparedSceneFrame: frame });
    const replay = compileScene2({ sceneInputPreparation: active, preparedSceneFrame: frame });
    expect(replay).toEqual(first);
    expect(replay.requestFingerprint).toBe(first.requestFingerprint);
  });

  it("projects only the Provider-ready keyframe onto the Provider wire", async () => {
    const active = preparation();
    const compiled = compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: preparedKeyframe({ preparation: active }),
    });
    const resolved: string[] = [];
    const wire = await previewAiStorySeedanceWireRequest({
      request: compiled,
      assetAccess: {
        resolveHttpsAsset: async ({ assetId }) => {
          resolved.push(assetId);
          return `https://staging.invalid/${assetId}.jpg`;
        },
      },
    });

    const images = wire.content.filter((item) => item.type === "image_url");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ role: "first_frame" });
    expect(images.filter((item) => item.role === "reference_image")).toEqual([]);
    expect(resolved).toEqual([PREPARED_ASSET_ID]);
    expect(resolved).not.toContain(RAW_ASSET_ID);
    expect(JSON.stringify(wire)).not.toContain(RAW_ASSET_ID);
    expect(wire.generate_audio).toBe(false);
  });

  it("refuses to preview a wire request whose first frame was tampered", async () => {
    const active = preparation();
    const valid = compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: preparedKeyframe({ preparation: active }),
    });
    const drifted = {
      ...valid,
      referenceMappings: [{ ...valid.referenceMappings[0]!, assetId: RAW_ASSET_ID }],
    };
    const { requestFingerprint: _stale, ...hashInput } = drifted;
    await expect(previewAiStorySeedanceWireRequest({
      request: {
        ...drifted,
        requestFingerprint: computeAiStoryCompiledRequestFingerprint(hashInput),
      },
      assetAccess: {
        resolveHttpsAsset: async () => {
          throw new Error("ASSET_ACCESS_MUST_NOT_BE_REACHED");
        },
      },
    })).rejects.toThrowError(
      expect.objectContaining({ code: "SEEDANCE_FIRST_FRAME_I2V_WIRE_MODE_INVALID" })
    );
  });

  it("changes the compiled fingerprint when the bound keyframe changes", () => {
    const active = preparation();
    const prepared = compileScene2({
      sceneInputPreparation: active,
      preparedSceneFrame: preparedKeyframe({ preparation: active }),
    });
    const rawBound = compileScene2();
    expect(prepared.requestFingerprint).not.toBe(rawBound.requestFingerprint);
  });
});
