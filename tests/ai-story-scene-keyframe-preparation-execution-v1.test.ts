import { describe, expect, it } from "vitest";
import {
  resolveActiveSceneIntent,
  type NarrativeWorldState,
  type ResolvedActiveSceneIntent,
} from "../packages/agents/src/ai-story/active-intent-world-state";
import {
  SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
  createSceneInputPreparationAuthority,
  type RawBusinessAssetSceneAnalysis,
  type SceneInputPreparationAuthority,
} from "../packages/agents/src/ai-story/scene-input-preparation";
import {
  SCENE_KEYFRAME_QC_DIMENSIONS,
  compileSceneKeyframeBrief,
  createSceneKeyframeQcReport,
  executeSceneKeyframePreparation,
  isPreparedSceneKeyframeIntegrityValid,
  isSceneKeyframeBriefIntegrityValid,
  promotePreparedSceneKeyframe,
  sceneKeyframePrompt,
  sceneKeyframeUserState,
  type PreparedSceneKeyframeAsset,
  type SceneKeyframeBrief,
  type SceneKeyframeExecutionRepository,
  type SceneKeyframeGenerationAdapter,
  type SceneKeyframeQcAdapter,
  type SceneKeyframeQcEvidence,
  type SceneKeyframeReference,
  type SceneKeyframeScope,
} from "../packages/agents/src/ai-story/scene-keyframe-preparation";
import {
  OpenAiSceneKeyframeAdapter,
  OpenAiSceneKeyframeQcAdapter,
} from "../packages/agents/src/ai-story/openai-scene-keyframe-adapter";

const RAW_HASH = "sha256:431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460";
const CHARACTER_HASH = RAW_HASH;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

const scope: SceneKeyframeScope = {
  tenantId: "org-1",
  workspaceId: "workspace-1",
  storyId: "story-1",
  sceneId: "scene-2",
  sceneVersionId: "scene-2-v1",
};

function intent(input: {
  authorityId?: string;
  location: string;
  locationLabel: string;
  characters: readonly string[];
  possessions: readonly { objectId: string; holder: string }[];
  actions: readonly string[];
  mustNotInherit?: readonly string[];
}): ResolvedActiveSceneIntent {
  const authorityId = input.authorityId ?? "intent-v1";
  return resolveActiveSceneIntent([{
    authorityId,
    kind: "CANONICAL_SCENE_INTENT",
    classification: "ACTIVE",
    governs: [
      "location", "charactersPresent", "actions", "continuityRequirements", "changes",
      "mustNotInherit", "narrativePurpose", "possessions", "incomingTransition", "outgoingTransition",
    ],
    values: {
      location: { id: input.location, label: input.locationLabel },
      charactersPresent: input.characters,
      actions: input.actions,
      continuityRequirements: ["Preserve approved recurring identity"],
      changes: [],
      mustNotInherit: input.mustNotInherit ?? [],
      narrativePurpose: "Advance the current narrative action",
      possessions: input.possessions,
      incomingTransition: null,
      outgoingTransition: null,
    },
  }]);
}

function world(input: {
  sceneId?: string;
  location: string;
  locationLabel: string;
  characters: readonly string[];
  possessions: readonly { objectId: string; holder: string }[];
  history?: readonly { id: string; label: string }[];
}): NarrativeWorldState {
  return {
    contractVersion: "ai-story-narrative-world-state.v1",
    sceneId: input.sceneId ?? scope.sceneId,
    currentLocation: { id: input.location, label: input.locationLabel },
    historicalLocations: input.history ?? [],
    charactersPresent: input.characters,
    possessions: input.possessions,
    incomingTransition: null,
    outgoingTransition: null,
  };
}

function raw(input: {
  assetId?: string;
  objectId: string;
  rawLocation: string;
  rawLabel: string;
  identityFacts: readonly string[];
}): RawBusinessAssetSceneAnalysis {
  return {
    assetId: input.assetId ?? "7ca6056f-adac-4539-a535-854908e78d66",
    workspaceId: scope.workspaceId,
    contentHash: RAW_HASH,
    mimeType: "image/jpeg",
    identityCompatibility: "VERIFIED",
    identityFacts: input.identityFacts,
    environment: {
      classification: "LOCATION_BOUND",
      locationId: input.rawLocation,
      label: input.rawLabel,
      facts: [input.rawLabel, "static subject presentation"],
    },
    compositionCompatibility: "CONFLICTING",
    actionCompatibility: "CONFLICTING",
    charactersPresent: [],
    possessions: [{ objectId: input.objectId, holder: "surface" }],
  };
}

function preparation(input: {
  activeIntent: ResolvedActiveSceneIntent;
  worldState: NarrativeWorldState;
  rawAsset: RawBusinessAssetSceneAnalysis;
  authorityId?: string;
  version?: number;
  sceneVersionId?: string;
  activeIntentAuthorityId?: string;
  supersedes?: string | null;
}): SceneInputPreparationAuthority {
  return createSceneInputPreparationAuthority({
    preparationAuthorityId: input.authorityId ?? "preparation-v1",
    version: input.version ?? 1,
    sceneId: input.worldState.sceneId,
    sceneVersionId: input.sceneVersionId ?? scope.sceneVersionId,
    activeIntentAuthorityId: input.activeIntentAuthorityId ?? "intent-v1",
    activeIntent: input.activeIntent,
    worldState: input.worldState,
    rawAsset: input.rawAsset,
    provider: SEEDANCE_FIRST_FRAME_SCENE_INPUT_CAPABILITY,
    supersedesPreparationAuthorityId: input.supersedes ?? null,
    createdAt: "2026-09-03T00:00:00.000Z",
  });
}

function references(rawAsset: RawBusinessAssetSceneAnalysis, characters: readonly string[]): SceneKeyframeReference[] {
  return [
    {
      assetId: rawAsset.assetId,
      contentHash: rawAsset.contentHash,
      mimeType: rawAsset.mimeType,
      role: "RAW_SUBJECT",
      subjectId: rawAsset.possessions[0]?.objectId ?? "subject",
      authorityId: "raw-authority",
      authorityClassification: "ACTIVE",
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      storyId: scope.storyId,
    },
    ...characters.map((character) => ({
      assetId: `identity-${character}`,
      contentHash: CHARACTER_HASH,
      mimeType: "image/png",
      role: "CHARACTER_IDENTITY" as const,
      subjectId: character,
      authorityId: `canonical-${character}`,
      authorityClassification: "CONTINUITY_REFERENCE" as const,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      storyId: scope.storyId,
    })),
  ];
}

function floristFixture(overrides: { authorityId?: string; sceneVersionId?: string; location?: string; label?: string } = {}) {
  const currentIntent = intent({
    authorityId: overrides.authorityId,
    location: overrides.location ?? "urban-walkway",
    locationLabel: overrides.label ?? "Urban walkway",
    characters: ["mara", "courier"],
    possessions: [{ objectId: "bouquet", holder: "mara" }],
    actions: ["Mara carries the bouquet while beginning forward movement", "Courier visible in background context"],
    mustNotInherit: ["historical rejected Scene wording", "shop-owner presentation pose"],
  });
  const currentWorld = world({
    location: overrides.location ?? "urban-walkway",
    locationLabel: overrides.label ?? "Urban walkway",
    characters: ["mara", "courier"],
    possessions: [{ objectId: "bouquet", holder: "mara" }],
    history: [{ id: "flower-shop", label: "Florist workbench" }],
  });
  const rawAsset = raw({
    objectId: "bouquet",
    rawLocation: "flower-shop",
    rawLabel: "florist workbench",
    identityFacts: ["bouquet identity", "bouquet colors", "bouquet wrapping", "recognizable floral arrangement"],
  });
  const prep = preparation({
    activeIntent: currentIntent,
    worldState: currentWorld,
    rawAsset,
    authorityId: overrides.authorityId === "intent-v2" ? "preparation-v2" : "preparation-v1",
    version: overrides.authorityId === "intent-v2" ? 2 : 1,
    sceneVersionId: overrides.sceneVersionId,
    activeIntentAuthorityId: overrides.authorityId,
    supersedes: overrides.authorityId === "intent-v2" ? "preparation-v1" : null,
  });
  const sceneScope = { ...scope, sceneVersionId: overrides.sceneVersionId ?? scope.sceneVersionId };
  const brief = compileSceneKeyframeBrief({
    scope: sceneScope,
    preparation: prep,
    activeIntent: currentIntent,
    worldState: currentWorld,
    sourceAssetReferences: references(rawAsset, ["mara", "courier"]),
    compositionRequirements: ["Courier remains background context", "Mara has a walking-ready carrying posture"],
  });
  return { currentIntent, currentWorld, rawAsset, prep, brief, sceneScope };
}

function passEvidence(overrides: Partial<SceneKeyframeQcEvidence> = {}): SceneKeyframeQcEvidence {
  return Object.fromEntries(SCENE_KEYFRAME_QC_DIMENSIONS.map((dimension) => [
    dimension,
    overrides[dimension] ?? { verdict: "PASS", note: `${dimension} verified` },
  ])) as SceneKeyframeQcEvidence;
}

class DeterministicGenerator implements SceneKeyframeGenerationAdapter {
  readonly providerId = "deterministic-certification";
  readonly modelId = "narrative-keyframe-fixture-v1";
  readonly adapterVersion = "1.0.0";
  readonly externalPaidCall = false;
  readonly referenceConditioned = true as const;
  readonly narrativeCharacterComposition = true as const;
  readonly possessionComposition = true as const;
  readonly actionStartStateComposition = true as const;
  calls = 0;
  fail = false;

  async generate() {
    this.calls += 1;
    if (this.fail) throw new Error("SYNTHETIC_GENERATION_FAILED");
    return { bytes: PNG, mimeType: "image/png" as const, providerRequestId: `fixture-${this.calls}` };
  }
}

class DeterministicQc implements SceneKeyframeQcAdapter {
  readonly evaluatorId = "deterministic-keyframe-qc";
  readonly evaluatorVersion = "1.0.0";
  readonly externalPaidCall = false;
  calls = 0;
  constructor(private readonly evidence: SceneKeyframeQcEvidence = passEvidence()) {}
  async evaluate() { this.calls += 1; return this.evidence; }
}

class MemoryRepository implements SceneKeyframeExecutionRepository {
  readonly assets: PreparedSceneKeyframeAsset[] = [];
  async findByExecutionIdentity(identity: string, requestedScope: SceneKeyframeScope) {
    return this.assets.find((asset) => asset.executionIdentity === identity
      && JSON.stringify(asset.scope) === JSON.stringify(requestedScope)) ?? null;
  }
  async findActiveForScene(requestedScope: SceneKeyframeScope) {
    return [...this.assets].reverse().find((asset) =>
      asset.scope.tenantId === requestedScope.tenantId
      && asset.scope.workspaceId === requestedScope.workspaceId
      && asset.scope.storyId === requestedScope.storyId
      && asset.scope.sceneId === requestedScope.sceneId
      && asset.supersessionState === "ACTIVE"
    ) ?? null;
  }
  async commitPreparedAsset(input: { asset: PreparedSceneKeyframeAsset; bytes: Buffer; expectedActiveAssetId: string | null }) {
    if (input.bytes.length === 0) throw new Error("EMPTY_ASSET");
    const active = await this.findActiveForScene(input.asset.scope);
    if ((active?.assetId ?? null) !== input.expectedActiveAssetId) throw new Error("SCENE_KEYFRAME_ACTIVE_ASSET_CONFLICT");
    if (active) {
      const index = this.assets.findIndex((asset) => asset.assetId === active.assetId);
      this.assets[index] = { ...active, supersessionState: "SUPERSEDED" };
    }
    this.assets.push(input.asset);
    return input.asset;
  }
}

async function execute(brief: SceneKeyframeBrief, prep: SceneInputPreparationAuthority, options: {
  repository?: MemoryRepository;
  generator?: DeterministicGenerator;
  qc?: DeterministicQc;
  assetId?: string;
} = {}) {
  return executeSceneKeyframePreparation({
    brief,
    preparation: prep,
    repository: options.repository ?? new MemoryRepository(),
    generator: options.generator ?? new DeterministicGenerator(),
    qcEvaluator: options.qc ?? new DeterministicQc(),
    readReferenceBytes: async () => PNG,
    newAssetId: () => options.assetId ?? "prepared-scene-2-v1",
    now: () => "2026-09-03T01:00:00.000Z",
  });
}

describe("AI Story V1 Scene Keyframe Brief", () => {
  it("compiles the current Scene 2 KEEP / CREATE / EXCLUDE authority deterministically", () => {
    const { brief } = floristFixture();
    const second = floristFixture().brief;
    expect(brief.fingerprint).toBe(second.fingerprint);
    expect(isSceneKeyframeBriefIntegrityValid(brief)).toBe(true);
    expect(brief.PRODUCT_OR_OBJECT_IDENTITY[0]).toMatchObject({
      objectId: "bouquet",
      observableIdentityFacts: expect.arrayContaining([
        "bouquet identity", "bouquet colors", "bouquet wrapping", "recognizable floral arrangement",
      ]),
    });
    expect(brief.ENVIRONMENT_TO_CREATE).toEqual(["Urban walkway"]);
    expect(brief.CHARACTERS_REQUIRED).toEqual(["courier", "mara"]);
    expect(brief.PRODUCT_POSSESSION).toEqual([{ objectId: "bouquet", holder: "mara" }]);
    expect(brief.REQUIRED_ACTION_START_STATE.join(" ")).toMatch(/forward movement/);
    expect(brief.COMPOSITION_REQUIREMENTS.join(" ")).toMatch(/Courier remains background/);
    expect(brief.HISTORICAL_ENVIRONMENTS_TO_EXCLUDE).toEqual(expect.arrayContaining([
      "Florist workbench", "florist workbench", "static subject presentation",
      "shop-owner presentation pose", "historical rejected Scene wording",
    ]));
    expect(sceneKeyframePrompt(brief)).toContain("references establish identity only");
  });

  it("rejects cross-workspace references and stale character identity", () => {
    const fixture = floristFixture();
    const foreign = fixture.brief.SOURCE_ASSET_REFERENCES.map((reference, index) =>
      index === 0 ? { ...reference, workspaceId: "foreign" } : reference
    );
    expect(() => compileSceneKeyframeBrief({
      scope: fixture.sceneScope,
      preparation: fixture.prep,
      activeIntent: fixture.currentIntent,
      worldState: fixture.currentWorld,
      sourceAssetReferences: foreign,
    })).toThrow("SCENE_KEYFRAME_CROSS_WORKSPACE_REFERENCE_DENIED");

    const stale = [...references(fixture.rawAsset, ["mara"]), {
      ...references(fixture.rawAsset, ["mara"])[1]!, assetId: "old-owner", subjectId: "shop-owner",
    }];
    expect(() => compileSceneKeyframeBrief({
      scope: fixture.sceneScope,
      preparation: fixture.prep,
      activeIntent: fixture.currentIntent,
      worldState: fixture.currentWorld,
      sourceAssetReferences: stale,
    })).toThrow("SCENE_KEYFRAME_STALE_CHARACTER_IDENTITY_REFERENCE");
  });
});

describe("AI Story V1 Scene Keyframe execution", () => {
  it("creates a distinct immutable derived asset and promotes only after all QC dimensions pass", async () => {
    const { brief, prep } = floristFixture();
    const result = await execute(brief, prep);
    expect(result.status).toBe("READY");
    if (result.status !== "READY") return;
    expect(result.asset.contractVersion).toBe("ai-story-prepared-scene-frame.v1");
    expect(result.asset.assetId).not.toBe(prep.sourceRawAssetId);
    expect(result.asset.sourceRawAssetId).toBe("7ca6056f-adac-4539-a535-854908e78d66");
    expect(result.asset.generationIdentity).toMatchObject({
      providerId: "deterministic-certification",
      modelId: "narrative-keyframe-fixture-v1",
    });
    expect(result.asset.qc.dimensions).toHaveLength(10);
    expect(result.asset.qc.result).toBe("PASS");
    expect(result.asset.providerReady).toBe(true);
    expect(isPreparedSceneKeyframeIntegrityValid(result.asset)).toBe(true);
    expect(result.providerInput).toMatchObject({
      contractVersion: "ai-story-provider-ready-scene-input.v1",
      sourceKind: "PREPARED_DERIVATIVE",
      assetId: result.asset.assetId,
    });
  });

  it("is idempotent for the same source/scene/intent/world/preparation/brief", async () => {
    const { brief, prep } = floristFixture();
    const repository = new MemoryRepository();
    const generator = new DeterministicGenerator();
    const first = await execute(brief, prep, { repository, generator });
    const second = await execute(brief, prep, { repository, generator });
    expect(first.status).toBe("READY");
    expect(second).toMatchObject({ status: "READY", reused: true });
    expect(generator.calls).toBe(1);
    expect(repository.assets).toHaveLength(1);
  });

  it("fails closed without raw fallback and never automatically regenerates", async () => {
    const { brief, prep } = floristFixture();
    const generator = new DeterministicGenerator();
    generator.fail = true;
    const result = await execute(brief, prep, { generator });
    expect(result).toEqual({ status: "FAILED_CLOSED", code: "SYNTHETIC_GENERATION_FAILED" });
    expect(generator.calls).toBe(1);
    expect(JSON.stringify(result)).not.toContain(prep.sourceRawAssetId);
    expect(sceneKeyframeUserState(result)).toBe("NEEDS_YOUR_REVIEW");
  });

  it.each([
    ["IDENTITY_PRESERVATION", "REJECT"],
    ["CHARACTER_EXCLUSION", "REJECT"],
    ["CURRENT_LOCATION", "REGENERATE_REQUIRED"],
    ["CHARACTER_PRESENCE", "REGENERATE_REQUIRED"],
    ["PRODUCT_POSSESSION", "REGENERATE_REQUIRED"],
    ["ACTION_START_STATE", "REGENERATE_REQUIRED"],
    ["HISTORICAL_ENVIRONMENT_EXCLUSION", "REGENERATE_REQUIRED"],
    ["SCENE_INTENT_ALIGNMENT", "REGENERATE_REQUIRED"],
    ["COMPOSITION_SUITABILITY", "REGENERATE_REQUIRED"],
    ["PROVIDER_MODE_SUITABILITY", "REGENERATE_REQUIRED"],
  ] as const)("gates Provider-ready promotion when %s fails", async (dimension, expected) => {
    const { brief, prep } = floristFixture();
    const qc = new DeterministicQc(passEvidence({ [dimension]: { verdict: "FAIL", note: "fixture failure" } }));
    const result = await execute(brief, prep, { qc });
    expect(result.status).toBe("NEEDS_REVIEW");
    if (result.status !== "NEEDS_REVIEW") return;
    expect(result.asset.qc.result).toBe(expected);
    expect(result.asset.providerReady).toBe(false);
  });

  it("uses HUMAN_CONFIRMATION_REQUIRED for insufficient QC confidence", () => {
    const report = createSceneKeyframeQcReport(passEvidence({
      ACTION_START_STATE: { verdict: "UNKNOWN", note: "ambiguous posture" },
    }));
    expect(report.result).toBe("HUMAN_CONFIRMATION_REQUIRED");
  });

  it("supersedes older output authority and prevents old Provider-ready reuse", async () => {
    const first = floristFixture();
    const repository = new MemoryRepository();
    const firstResult = await execute(first.brief, first.prep, { repository, assetId: "old-keyframe" });
    expect(firstResult.status).toBe("READY");
    if (firstResult.status !== "READY") return;

    const current = floristFixture({
      authorityId: "intent-v2",
      sceneVersionId: "scene-2-v2",
      location: "home",
      label: "Mara's home",
    });
    const secondResult = await execute(current.brief, current.prep, { repository, assetId: "current-keyframe" });
    expect(secondResult.status).toBe("READY");
    expect(repository.assets[0]?.supersessionState).toBe("SUPERSEDED");
    expect(repository.assets[1]?.supersedesAssetId).toBe("old-keyframe");
    expect(() => promotePreparedSceneKeyframe({
      asset: firstResult.asset,
      currentActiveAsset: repository.assets[1]!,
      currentPreparation: current.prep,
    })).toThrow("SCENE_KEYFRAME_PROVIDER_READY_PROMOTION_DENIED");
  });

  it("stops before an OpenAI paid image edit without explicit authorization", async () => {
    const { brief, prep } = floristFixture();
    let calls = 0;
    const adapter = new OpenAiSceneKeyframeAdapter({
      images: { edit: async () => { calls += 1; return { data: [] }; } },
    } as never);
    const result = await executeSceneKeyframePreparation({
      brief,
      preparation: prep,
      generator: adapter,
      qcEvaluator: new DeterministicQc(),
      repository: new MemoryRepository(),
      readReferenceBytes: async () => PNG,
    });
    expect(result).toMatchObject({
      status: "AUTHORIZATION_REQUIRED",
      code: "LIVE_KEYFRAME_IMAGE_GENERATION_AUTHORIZATION_REQUIRED",
      provider: "openai",
      model: "gpt-image-2",
      estimatedCallCount: 1,
    });
    expect(calls).toBe(0);
  });

  it("maps canonical references to one OpenAI image edit and parses independent visual QC", async () => {
    const { brief } = floristFixture();
    let imageEditBody: Record<string, unknown> | null = null;
    const generator = new OpenAiSceneKeyframeAdapter({
      images: {
        edit: async (body: Record<string, unknown>) => {
          imageEditBody = body;
          return { data: [{ b64_json: PNG.toString("base64"), revised_prompt: "bounded revision" }] };
        },
      },
    } as never);
    const generation = await generator.generate({
      brief,
      prompt: sceneKeyframePrompt(brief),
      references: brief.SOURCE_ASSET_REFERENCES.map((reference) => ({ reference, bytes: PNG })),
      idempotencyKey: "fixture-idempotency",
    });
    expect(imageEditBody).toMatchObject({ model: "gpt-image-2", n: 1, quality: "high", size: "1536x1024" });
    expect((imageEditBody as { image: unknown[] } | null)?.image).toHaveLength(brief.SOURCE_ASSET_REFERENCES.length);
    expect(generation.bytes).toEqual(PNG);

    const dimensions = Object.fromEntries(SCENE_KEYFRAME_QC_DIMENSIONS.map((dimension) => [
      dimension, { verdict: "PASS", note: "visible" },
    ]));
    const qc = new OpenAiSceneKeyframeQcAdapter({
      chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ dimensions }) } }] }) } },
    } as never);
    expect(await qc.evaluate({
      brief,
      generated: generation,
      references: brief.SOURCE_ASSET_REFERENCES.map((reference) => ({ reference, bytes: PNG })),
    })).toEqual(passEvidence(Object.fromEntries(SCENE_KEYFRAME_QC_DIMENSIONS.map((dimension) => [
      dimension, { verdict: "PASS", note: "visible" },
    ])) as Partial<SceneKeyframeQcEvidence>));
  });
});

describe("cross-industry narrative Scene preparation fixtures", () => {
  it.each([
    {
      industry: "FLORIST", objectId: "bouquet", person: "mara", rawLocation: "flower-shop",
      rawLabel: "florist workbench", target: "urban-walkway", targetLabel: "Urban walkway",
      action: "Mara begins walking forward carrying the bouquet",
    },
    {
      industry: "CAFÉ", objectId: "coffee", person: "customer", rawLocation: "cafe",
      rawLabel: "café interior", target: "park", targetLabel: "Park",
      action: "Customer holds the coffee and begins a drinking gesture",
    },
    {
      industry: "PET", objectId: "dog", person: "dog", rawLocation: "home",
      rawLabel: "home interior", target: "park", targetLabel: "Park",
      action: "Dog adopts a forward running start posture",
    },
  ])("executes $industry identity/environment/presence/possession/action pipeline", async (fixture) => {
    const currentIntent = intent({
      location: fixture.target,
      locationLabel: fixture.targetLabel,
      characters: [fixture.person],
      possessions: [{ objectId: fixture.objectId, holder: fixture.person }],
      actions: [fixture.action],
    });
    const currentWorld = world({
      location: fixture.target,
      locationLabel: fixture.targetLabel,
      characters: [fixture.person],
      possessions: [{ objectId: fixture.objectId, holder: fixture.person }],
      history: [{ id: fixture.rawLocation, label: fixture.rawLabel }],
    });
    const rawAsset = raw({
      assetId: `raw-${fixture.objectId}`,
      objectId: fixture.objectId,
      rawLocation: fixture.rawLocation,
      rawLabel: fixture.rawLabel,
      identityFacts: [`${fixture.objectId} recognizable identity`, `${fixture.objectId} dominant colors`],
    });
    const prep = preparation({ activeIntent: currentIntent, worldState: currentWorld, rawAsset });
    const brief = compileSceneKeyframeBrief({
      scope,
      preparation: prep,
      activeIntent: currentIntent,
      worldState: currentWorld,
      sourceAssetReferences: references(rawAsset, [fixture.person]),
    });
    expect(brief.ENVIRONMENT_TO_CREATE).toEqual([fixture.targetLabel]);
    expect(brief.HISTORICAL_ENVIRONMENTS_TO_EXCLUDE).toContain(fixture.rawLabel);
    expect(brief.PRODUCT_POSSESSION).toContainEqual({ objectId: fixture.objectId, holder: fixture.person });
    expect(await execute(brief, prep)).toMatchObject({ status: "READY" });
  });
});
