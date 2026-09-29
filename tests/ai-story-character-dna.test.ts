import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_CHARACTER_DNA_COPY,
  AI_STORY_CHARACTER_DNA_FROM_PHOTO,
  CHARACTER_CONSISTENCY_MODE,
  CHARACTER_DNA_ANALYSIS,
  CHARACTER_DNA_TO_EPISODE_PROMPT,
  CHARACTER_SOURCE_PORTRAIT,
  CHARACTER_VIRTUALIZER_PATH,
  NO_BIOMETRIC_CHARACTER_DNA,
  NO_FACE_RECOGNITION_CHARACTER_DNA,
  NO_SENSITIVE_TRAIT_INFERENCE,
  PHOTO_TO_DESCRIPTION_FLOW,
  SOURCE_PHOTO_EXCLUDED_FROM_VIDEO_PROVIDER,
  AiStoryCharacterDnaAnalysisJobSchema,
  AiStoryCharacterDnaError,
  AiStoryCharacterDnaSchema,
  AiStoryCharacterDnaVisionOutputSchema,
  AiStoryReusableCharacterVersionSchema,
  characterDnaAnalysisCostEstimate,
  publicCharacterDnaJob,
  containsForbiddenCharacterDnaLanguage,
  evaluateReusableCharacterGenerationAuthority,
  isCharacterDnaIdentity,
  mapCharacterDnaToIdentityCore,
  publicReusableCharacterCard,
  seedanceIdentityAssetIdsForCharacter,
  sourcePhotoSentToVideoProviderForDna,
  validateCanonicalIdentityRoot,
} from "@ceo-agent/shared";
import {
  applyCharacterDnaAnalysisFailure,
  applyCharacterDnaAnalysisSuccess,
  applyCharacterDnaToSeedanceRequest,
  approveCharacterDna,
  buildAiStoryCharacterDnaAnalysisJob,
  characterDnaAnalysisOutputFingerprint,
  classifyCharacterDnaAnalysisFailure,
  buildAiStoryReusableCharacterVersion,
  buildCampaignProjectionFromReusableCharacter,
  buildEpisodeCharacterBinding,
  compileCharacterDnaIdentityBlock,
  computeCharacterDnaFingerprint,
  computeCompiledCharacterIdentityFingerprint,
  mockCharacterDnaFixture,
  sanitizeCharacterDnaAnalysisOutput,
} from "@ceo-agent/shared/server";
import {
  CHARACTER_DNA_VISION_REQUEST_OPTIONS,
  CHARACTER_DNA_VISION_SCHEMA_NAME,
  MockCharacterDnaAnalysisProvider,
  characterDnaVisionResponseFormat,
  VisionCharacterDnaAnalysisProvider,
  assertNoImageGenerationForCharacterDna,
  type CharacterDnaVisionCaller,
} from "../packages/agents/src/ai-story/character-dna-analysis";

const IDS = {
  org: "81000000-0000-4000-8000-000000000001",
  workspace: "81000000-0000-4000-8000-000000000002",
  otherWorkspace: "81000000-0000-4000-8000-000000000003",
  actor: "81000000-0000-4000-8000-000000000004",
  source: "81000000-0000-4000-8000-000000000005",
  master: "81000000-0000-4000-8000-000000000006",
  campaign: "81000000-0000-4000-8000-000000000007",
  character: "81000000-0000-4000-8000-000000000008",
  storyA: "81000000-0000-4000-8000-000000000009",
  storyB: "81000000-0000-4000-8000-00000000000a",
};
const HASH = `sha256:${"c".repeat(64)}`;
const MASTER_HASH = `sha256:${"a".repeat(64)}`;

function dna(overrides: Partial<ReturnType<typeof mockCharacterDnaFixture>> = {}) {
  return {
    ...mockCharacterDnaFixture({
      sourceAssetId: IDS.source,
      sourceContentHash: HASH,
    }),
    ...overrides,
  };
}

function dnaCharacter(version = 1, approved = dna()) {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: IDS.character,
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    name: "Alicia",
    identityCore: mapCharacterDnaToIdentityCore(approved),
    defaultLook: { wardrobe: "default commercial wardrobe", makeup: null, accessories: null, hairstyle: null, hairColor: null },
    mutableLookPolicy: { wardrobeAllowed: true, makeupAllowed: true, accessoriesAllowed: true, hairstyleAllowed: false, hairColorAllowed: false },
    canonicalAssets: [{ assetId: IDS.source, contentHash: HASH, role: "CHARACTER_SOURCE_PORTRAIT", source: "USER_APPROVED" }],
    status: "ACTIVE",
    version,
    supersedesReusableCharacterVersionId: null,
    createdBy: IDS.actor,
    createdAt: `2026-09-23T00:0${version}:00.000Z`,
    identityMode: "CHARACTER_DNA",
    characterDna: approved,
    characterConsistencyMode: CHARACTER_CONSISTENCY_MODE,
  });
}

function visualAlicia() {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: IDS.character,
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    name: "Alicia",
    identityCore: {
      identityDescription: "Alicia is a synthetic restaurant spokesperson.",
      faceIdentityDescription: "Oval face, dark brown eyes.",
      bodyIdentityDescription: "Balanced adult proportions.",
      distinctiveVisualFacts: ["small beauty mark near the left eye"],
      mustPreserve: ["face identity"],
      mustNeverChange: ["canonical face identity"],
    },
    defaultLook: { wardrobe: "white outfit", makeup: null, accessories: null, hairstyle: null, hairColor: null },
    mutableLookPolicy: { wardrobeAllowed: true, makeupAllowed: true, accessoriesAllowed: true, hairstyleAllowed: true, hairColorAllowed: false },
    canonicalAssets: [{ assetId: IDS.master, contentHash: MASTER_HASH, role: "IDENTITY_MASTER", source: "USER_APPROVED" }],
    status: "ACTIVE",
    version: 1,
    supersedesReusableCharacterVersionId: null,
    createdBy: IDS.actor,
    createdAt: "2026-09-22T00:00:00.000Z",
  });
}

describe("AI Story Character DNA from Photo V1", () => {
  it("1. photo upload remains CHARACTER_SOURCE_PORTRAIT", () => {
    const job = buildAiStoryCharacterDnaAnalysisJob({
      orgId: IDS.org, workspaceId: IDS.workspace, sourceAssetId: IDS.source, sourceContentHash: HASH,
      permissionConfirmed: true, createdBy: IDS.actor, createdAt: "2026-09-23T00:00:00.000Z",
    });
    expect(job.sourceSemantic).toBe(CHARACTER_SOURCE_PORTRAIT);
    expect(job.sourceSemantic).not.toBe("IDENTITY_MASTER");
  });

  it("2. Analyze Character returns structured Character DNA", async () => {
    const result = await new MockCharacterDnaAnalysisProvider().analyzeCharacter({
      sourceAssetId: IDS.source, sourceContentHash: HASH, imageDataUrl: "data:image/png;base64,AA==",
      createdAt: "2026-09-23T00:00:00.000Z",
    });
    expect(AiStoryCharacterDnaSchema.parse(result.dna).hair.length).toContain("shoulder-length");
    expect(result.costUsd).toMatch(/^\d+\.\d{4}$/);
  });

  it("3. source portrait never automatically becomes IDENTITY_MASTER", () => {
    const character = dnaCharacter();
    expect(character.canonicalAssets.map((asset) => asset.role)).toEqual(["CHARACTER_SOURCE_PORTRAIT"]);
    expect(character.canonicalAssets.some((asset) => asset.role === "IDENTITY_MASTER")).toBe(false);
    expect(validateCanonicalIdentityRoot({
      canonicalAssets: character.canonicalAssets,
      plannedAssetIds: [],
      identityMode: "CHARACTER_DNA",
    })).toEqual([]);
  });

  it("4-5. no image-generation or gpt-image adapter is called", async () => {
    const result = await new MockCharacterDnaAnalysisProvider().analyzeCharacter({
      sourceAssetId: IDS.source, sourceContentHash: HASH, imageDataUrl: "data:image/png;base64,AA==",
      createdAt: "2026-09-23T00:00:00.000Z",
    });
    expect(result.imageGenerationCalls).toBe(0);
    expect(result.gptImageCalls).toBe(0);
    expect(result.provider).not.toContain("gpt-image");
    expect(() => assertNoImageGenerationForCharacterDna(result)).not.toThrow();
    expect(CHARACTER_DNA_ANALYSIS).toBe("CHARACTER_DNA_ANALYSIS");
  });

  function visionOutput(overrides: Record<string, unknown> = {}) {
    const { sourceAssetId: _source, sourceContentHash: _hash, analysisVersion: _version, createdAt: _created, ...visible } = dna();
    return { ...visible, ...overrides };
  }

  it("configures the real Character DNA Vision SDK request with zero retries", async () => {
    let received: Parameters<CharacterDnaVisionCaller>[0] | undefined;
    const fakeVision: CharacterDnaVisionCaller = async (input) => {
      received = input;
      return {
        result: visionOutput(),
        usage: { input: 10, output: 20, costUsd: 0.001 },
      };
    };
    const result = await new VisionCharacterDnaAnalysisProvider(fakeVision).analyzeCharacter({
      sourceAssetId: IDS.source,
      sourceContentHash: HASH,
      imageDataUrl: "data:image/jpeg;base64,AA==",
      createdAt: "2026-09-23T00:00:00.000Z",
    });

    expect(CHARACTER_DNA_VISION_REQUEST_OPTIONS).toEqual({ maxRetries: 0 });
    expect(received?.requestOptions).toEqual({ maxRetries: 0 });
    expect(received?.schema).toBe(AiStoryCharacterDnaVisionOutputSchema);
    expect(received?.schemaName).toBe(CHARACTER_DNA_VISION_SCHEMA_NAME);
    expect(result.providerModel).toBe("gpt-4o");
    expect(result.dna.sourceAssetId).toBe(IDS.source);
    expect(result.dna.sourceContentHash).toBe(HASH);
    expect(result.imageGenerationCalls).toBe(0);
    expect(result.gptImageCalls).toBe(0);
  });

  it("6-7. human can edit AI-derived DNA and save requires approval", () => {
    const queued = buildAiStoryCharacterDnaAnalysisJob({
      orgId: IDS.org, workspaceId: IDS.workspace, sourceAssetId: IDS.source, sourceContentHash: HASH,
      permissionConfirmed: true, createdBy: IDS.actor, createdAt: "2026-09-23T00:00:00.000Z",
    });
    expect(() => approveCharacterDna(queued, dna())).toThrow(/reviewed Character DNA/i);
    const succeeded = { ...queued, status: "SUCCEEDED" as const, proposedDna: dna() };
    const edited = { ...dna(), hair: { ...dna().hair, length: "chin-length hair" } };
    const approved = approveCharacterDna(succeeded, edited);
    expect(approved.dna.hair.length).toBe("chin-length hair");
    expect(approved.job.approvalStatus).toBe("APPROVED");
  });

  it("8. Character DNA creates a reusable Character version in CHARACTER_DNA mode", () => {
    const character = dnaCharacter();
    expect(character.identityMode).toBe("CHARACTER_DNA");
    expect(character.characterDnaFingerprint).toBe(computeCharacterDnaFingerprint(character.characterDna!));
    expect(isCharacterDnaIdentity(character)).toBe(true);
  });

  it("9. existing visual-reference Characters remain readable", () => {
    const visual = visualAlicia();
    const { identityMode: _mode, characterDna: _dna, characterDnaFingerprint: _fp, characterConsistencyMode: _cm, ...legacy } = visual;
    const parsed = AiStoryReusableCharacterVersionSchema.parse(legacy);
    expect(parsed.identityMode).toBe("VISUAL_REFERENCE");
    expect(parsed.canonicalAssets[0]?.role).toBe("IDENTITY_MASTER");
    expect(visual.reusableCharacterVersionId).toBeTruthy();
  });

  it("10-12. Episode A/B pin the same DNA and keep Episode Look separate", () => {
    const character = dnaCharacter();
    const projection = buildCampaignProjectionFromReusableCharacter({
      reusable: character, campaignId: IDS.campaign, campaignCharacterId: IDS.character,
      createdBy: IDS.actor, createdAt: "2026-09-23T01:00:00.000Z",
    }).projection;
    const episodeA = buildEpisodeCharacterBinding({
      storyId: IDS.storyA, reusable: character, projection,
      episodeLook: { wardrobe: "white blouse", makeup: null, accessories: null, hairstyle: null, hairColor: null, expression: null, pose: null, location: "warm modern café", action: null, product: null, dialogue: null },
      createdBy: IDS.actor, createdAt: "2026-09-23T01:00:00.000Z",
    });
    const episodeB = buildEpisodeCharacterBinding({
      storyId: IDS.storyB, reusable: character, projection,
      episodeLook: { wardrobe: "blue jacket", makeup: null, accessories: null, hairstyle: null, hairColor: null, expression: null, pose: null, location: "flower shop", action: null, product: null, dialogue: null },
      createdBy: IDS.actor, createdAt: "2026-09-23T02:00:00.000Z",
    });
    expect(episodeA.reusableCharacterVersionId).toBe(episodeB.reusableCharacterVersionId);
    expect(episodeA.characterDnaFingerprint).toBe(character.characterDnaFingerprint);
    expect(episodeB.characterDnaFingerprint).toBe(character.characterDnaFingerprint);
    expect(episodeA.episodeLook.wardrobe).toBe("white blouse");
    expect(episodeB.episodeLook.wardrobe).toBe("blue jacket");
    expect(episodeA.sourcePhotoSentToVideoProvider).toBe(false);
    expect(episodeA.canonicalAssetIds).toEqual([]);
  });

  it("13-15. Seedance DNA compile is deterministic and excludes the source photo", () => {
    const approved = dna();
    const first = compileCharacterDnaIdentityBlock(approved);
    const second = compileCharacterDnaIdentityBlock(approved);
    expect(first).toBe(second);
    expect(first).toContain("CHARACTER IDENTITY — LOCKED");
    expect(computeCompiledCharacterIdentityFingerprint(approved)).toBe(computeCompiledCharacterIdentityFingerprint(approved));
    const seeded = applyCharacterDnaToSeedanceRequest({
      request: {
        compiledPrompt: "Scene: café greeting.",
        referenceMappings: [{ assetId: IDS.source }, { assetId: IDS.master }],
      },
      dna: approved,
      episodeLook: { wardrobe: "white blouse", location: "warm modern café" },
    });
    expect(seeded.compiledPrompt).toContain("CHARACTER IDENTITY — LOCKED");
    expect(seeded.compiledPrompt).toContain("white blouse");
    expect(seeded.referenceMappings).toEqual([{ assetId: IDS.master }]);
    expect(seeded.sourcePhotoSentToVideoProvider).toBe(false);
    expect(sourcePhotoSentToVideoProviderForDna()).toBe(false);
    expect(seedanceIdentityAssetIdsForCharacter({
      identityMode: "CHARACTER_DNA",
      characterDnaFingerprint: computeCharacterDnaFingerprint(approved),
      canonicalAssets: [
        { assetId: IDS.source, role: "CHARACTER_SOURCE_PORTRAIT" },
      ],
    })).toEqual([]);
  });

  it("16-17. sensitive traits and biometric identity are blocked", () => {
    expect(containsForbiddenCharacterDnaLanguage("looks Malaysian")).toBe(true);
    expect(containsForbiddenCharacterDnaLanguage("oval face")).toBe(false);
    expect(() => sanitizeCharacterDnaAnalysisOutput({
      payload: { ...dna(), race: "inferred" },
      sourceAssetId: IDS.source,
      sourceContentHash: HASH,
      createdAt: "2026-09-23T00:00:00.000Z",
    })).toThrow(/could not be turned into a Character description/i);
    expect(() => sanitizeCharacterDnaAnalysisOutput({
      payload: { ...dna(), identityDescription: "beautiful attractive Malaysian woman" },
      sourceAssetId: IDS.source,
      sourceContentHash: HASH,
      createdAt: "2026-09-23T00:00:00.000Z",
    })).toThrow();
    expect(NO_BIOMETRIC_CHARACTER_DNA).toBe(true);
    expect(NO_FACE_RECOGNITION_CHARACTER_DNA).toBe(true);
    expect(NO_SENSITIVE_TRAIT_INFERENCE).toBe(true);
    expect(JSON.stringify(dna())).not.toMatch(/embedding|similarityScore|faceRecognition/i);
  });

  it("18-19. editing DNA creates a new Character version without mutating history", () => {
    const v1 = dnaCharacter(1);
    const edited = dna({ hair: { ...dna().hair, length: "chin-length hair" } });
    const v2 = dnaCharacter(2, edited);
    expect(v2.reusableCharacterVersionId).not.toBe(v1.reusableCharacterVersionId);
    expect(v2.characterDnaFingerprint).not.toBe(v1.characterDnaFingerprint);
    expect(v1.characterDna?.hair.length).toContain("shoulder-length");
  });

  it("20. cross-Workspace DNA Character is blocked by scope", () => {
    const character = dnaCharacter();
    expect(character.workspaceId).toBe(IDS.workspace);
    expect(character.workspaceId).not.toBe(IDS.otherWorkspace);
    const authority = evaluateReusableCharacterGenerationAuthority({
      workspaceId: IDS.otherWorkspace,
      visibleRecurringCharacter: true,
      identityLockRequired: true,
      generationMode: "REFERENCE_FREE_T2V",
      hasIdentityGroundedKeyframe: false,
      hasExactIdentityReferenceImage: false,
      reusable: character,
      binding: {
        reusableCharacterId: character.reusableCharacterId,
        reusableCharacterVersionId: character.reusableCharacterVersionId,
        identityFingerprint: character.identityFingerprint,
        canonicalAssetIds: [],
      },
      resolvedVersionId: character.reusableCharacterVersionId,
      currentLibraryVersionId: character.reusableCharacterVersionId,
      plannedAssetIds: [],
      continuityAnchors: [],
      referenceNeeds: [],
    });
    expect(authority.issues.some((issue) => issue.gate === "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE")).toBe(true);
  });

  it("DNA mode allows reference-free Seedance generation", () => {
    const character = dnaCharacter();
    const authority = evaluateReusableCharacterGenerationAuthority({
      workspaceId: IDS.workspace,
      visibleRecurringCharacter: true,
      identityLockRequired: true,
      generationMode: "REFERENCE_FREE_T2V",
      hasIdentityGroundedKeyframe: false,
      hasExactIdentityReferenceImage: false,
      reusable: character,
      binding: {
        reusableCharacterId: character.reusableCharacterId,
        reusableCharacterVersionId: character.reusableCharacterVersionId,
        identityFingerprint: character.identityFingerprint,
        canonicalAssetIds: [],
      },
      resolvedVersionId: character.reusableCharacterVersionId,
      currentLibraryVersionId: character.reusableCharacterVersionId,
      plannedAssetIds: [],
      continuityAnchors: [],
      referenceNeeds: [],
    });
    expect(authority.grounding).toBe("PASS");
  });

  it("library card labels Character DNA and Source photo", () => {
    const card = publicReusableCharacterCard(dnaCharacter(), 2);
    expect(card.characterDnaCertified).toBe(true);
    expect(card.portraitLabel).toBe("Source photo");
    expect(card.portraitAssetId).toBe(IDS.source);
    expect(CHARACTER_CONSISTENCY_MODE).toBe("SOFT_DESCRIPTION_BASED");
    expect(CHARACTER_VIRTUALIZER_PATH).toBe("LEGACY / ADVANCED / INTERNAL");
    expect(AI_STORY_CHARACTER_DNA_FROM_PHOTO).toBe("CERTIFIED");
    expect(PHOTO_TO_DESCRIPTION_FLOW).toBe("CERTIFIED");
    expect(CHARACTER_DNA_TO_EPISODE_PROMPT).toBe("CERTIFIED");
    expect(SOURCE_PHOTO_EXCLUDED_FROM_VIDEO_PROVIDER).toBe("CERTIFIED");
  });

  it("records safe Character DNA analysis failure diagnostics without raw model output", async () => {
    const queued = buildAiStoryCharacterDnaAnalysisJob({
      orgId: IDS.org, workspaceId: IDS.workspace, sourceAssetId: IDS.source, sourceContentHash: HASH,
      permissionConfirmed: true, createdBy: IDS.actor, createdAt: "2026-09-23T00:00:00.000Z",
    });
    const request = {
      sourceAssetId: IDS.source, sourceContentHash: HASH, imageDataUrl: "data:image/jpeg;base64,AA==",
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    const persist = (error: unknown) => applyCharacterDnaAnalysisFailure(
      queued,
      "2026-09-23T00:01:00.000Z",
      classifyCharacterDnaAnalysisFailure(error)
    );

    let providerCalls = 0;
    const providerError = Object.assign(new Error("provider body SECRET_PROVIDER_BODY"), { request_id: "req_safe_123", model: "gpt-4o-2024-08-06" });
    await expect(new VisionCharacterDnaAnalysisProvider(async () => {
      providerCalls += 1;
      throw providerError;
    }).analyzeCharacter(request)).rejects.toBeInstanceOf(AiStoryCharacterDnaError);
    expect(providerCalls).toBe(1);
    const providerJob = persist(await new VisionCharacterDnaAnalysisProvider(async () => {
      throw providerError;
    }).analyzeCharacter(request).catch((error) => error));
    expect(providerJob.failureCode).toBe("CHARACTER_DNA_PROVIDER_CALL_FAILED");
    expect(providerJob.failureStage).toBe("PROVIDER");
    expect(providerJob.providerRequestId).toBe("req_safe_123");
    expect(providerJob.requestedModelId).toBe("gpt-4o");
    expect(providerJob.providerModelId).toBe("gpt-4o-2024-08-06");
    expect(providerJob.inputTokens).toBeNull();
    expect(providerJob.outputTokens).toBeNull();
    expect(providerJob.costUsd).toBeNull();
    expect(providerJob.provider).toBe("pending");
    expect(JSON.stringify(providerJob)).not.toContain("SECRET_PROVIDER_BODY");

    const parseJob = persist(await new VisionCharacterDnaAnalysisProvider(async () => {
      throw new SyntaxError("Unexpected token SECRET_JSON_BODY");
    }).analyzeCharacter(request).catch((error) => error));
    expect(parseJob.failureCode).toBe("CHARACTER_DNA_JSON_PARSE_FAILED");
    expect(parseJob.failureStage).toBe("JSON_PARSE");
    expect(parseJob.failureFieldPaths).toBeNull();
    expect(JSON.stringify(parseJob)).not.toContain("SECRET_JSON_BODY");

    const leakedShape = { leaked: "LEAKED_SCHEMA_VALUE_42" };
    const schemaPayload = {
      ...dna(),
      face: { ...dna().face, shape: leakedShape },
      hair: { ...dna().hair, parting: undefined },
      body: { ...dna().body, heightImpression: 12 },
      appearance: { ...dna().appearance, presentationStyle: null },
    };
    delete schemaPayload.hair.parting;
    let schemaError: unknown;
    try {
      sanitizeCharacterDnaAnalysisOutput({
        payload: schemaPayload,
        sourceAssetId: IDS.source,
        sourceContentHash: HASH,
        createdAt: "2026-09-23T00:00:00.000Z",
      });
    } catch (error) {
      schemaError = error;
    }
    const schemaJob = persist(schemaError);
    expect(schemaJob.failureCode).toBe("CHARACTER_DNA_SCHEMA_VALIDATION_FAILED");
    expect(schemaJob.failureStage).toBe("SCHEMA");
    expect(schemaJob.failureFieldPaths).toEqual(expect.arrayContaining([
      "face.shape",
      "hair.parting",
      "body.heightImpression",
      "appearance.presentationStyle",
    ]));
    expect(schemaJob.outputFingerprint).toBe(characterDnaAnalysisOutputFingerprint(schemaPayload));
    const schemaJson = JSON.stringify(schemaJob);
    expect(schemaJson).not.toContain("LEAKED_SCHEMA_VALUE_42");
    expect(schemaJson).not.toContain("Expected");
    expect(schemaJob.proposedDna).toBeNull();

    const sensitiveKey = { ...dna(), race: "SECRET_SENSITIVE_VALUE" };
    const keyJob = persist(await Promise.resolve().then(() => sanitizeCharacterDnaAnalysisOutput({
      payload: sensitiveKey,
      sourceAssetId: IDS.source,
      sourceContentHash: HASH,
      createdAt: "2026-09-23T00:00:00.000Z",
    })).catch((error) => error));
    expect(keyJob.failureCode).toBe("SENSITIVE_TRAIT_INFERENCE_BLOCKED");
    expect(keyJob.failureStage).toBe("SAFETY");
    expect(keyJob.failureFieldPaths).toBeNull();
    expect(keyJob.outputFingerprint).toBe(characterDnaAnalysisOutputFingerprint(sensitiveKey));
    expect(JSON.stringify(keyJob)).not.toContain("SECRET_SENSITIVE_VALUE");
    expect(JSON.stringify(keyJob.failureFieldPaths)).toBe("null");

    const sensitiveLanguage = { ...dna(), identityDescription: "SECRET_BEAUTIFUL_SENTENCE" };
    const languageJob = persist(await Promise.resolve().then(() => sanitizeCharacterDnaAnalysisOutput({
      payload: sensitiveLanguage,
      sourceAssetId: IDS.source,
      sourceContentHash: HASH,
      createdAt: "2026-09-23T00:00:00.000Z",
    })).catch((error) => error));
    expect(languageJob.failureCode).toBe("SENSITIVE_TRAIT_INFERENCE_BLOCKED");
    expect(languageJob.failureStage).toBe("SAFETY");
    expect(languageJob.failureFieldPaths).toBeNull();
    expect(JSON.stringify(languageJob)).not.toContain("SECRET_BEAUTIFUL_SENTENCE");
    expect(JSON.stringify(languageJob)).not.toContain("beautiful");

    const succeeded = applyCharacterDnaAnalysisSuccess(queued, {
      dna: dna(),
      provider: "mock",
      providerModel: "character-dna-mock.v1",
      inputTokens: 120,
      outputTokens: 80,
      costUsd: "0.0010",
      completedAt: "2026-09-23T00:01:00.000Z",
    });
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.proposedDna?.identityDescription).toContain("Oval-faced");
    expect(succeeded.failureCode).toBeNull();
    expect(succeeded.outputFingerprint).toBeNull();

    const legacy = { ...queued, status: "FAILED" as const, approvalStatus: "DISCARDED" as const, userSafeError: AI_STORY_CHARACTER_DNA_COPY.analysisFailed, completedAt: "2026-09-23T00:01:00.000Z" };
    delete (legacy as { failureCode?: unknown }).failureCode;
    delete (legacy as { failureStage?: unknown }).failureStage;
    delete (legacy as { failureFieldPaths?: unknown }).failureFieldPaths;
    delete (legacy as { providerRequestId?: unknown }).providerRequestId;
    delete (legacy as { requestedModelId?: unknown }).requestedModelId;
    delete (legacy as { providerModelId?: unknown }).providerModelId;
    delete (legacy as { outputFingerprint?: unknown }).outputFingerprint;
    const readable = AiStoryCharacterDnaAnalysisJobSchema.parse(legacy);
    expect(readable.status).toBe("FAILED");
    expect(readable.approvalStatus).toBe("DISCARDED");
    expect(readable.failureCode).toBeNull();
    expect(readable.proposedDna).toBeNull();
    expect(legacy).not.toHaveProperty("failureCode");

    expect(characterDnaAnalysisCostEstimate().automaticRetry).toBe(false);
    expect(CHARACTER_DNA_VISION_REQUEST_OPTIONS).toEqual({ maxRetries: 0 });
    const imageJob = persist(new AiStoryCharacterDnaError(
      "CHARACTER_DNA_IMAGE_GENERATION_BLOCKED",
      "Character DNA analysis cannot call image generation."
    ));
    expect(imageJob.failureCode).toBe("CHARACTER_DNA_IMAGE_GENERATION_BLOCKED");
    expect(imageJob.failureStage).toBe("SAFETY");
    expect(imageJob.imageGenerationCalls).toBe(0);
    expect(imageJob.gptImageCalls).toBe(0);
    expect(imageJob.seedanceVideoCalls).toBe(0);

    const published = publicCharacterDnaJob(schemaJob);
    expect(published.failureCode).toBe("CHARACTER_DNA_SCHEMA_VALIDATION_FAILED");
    expect(published.userSafeError).toBe(AI_STORY_CHARACTER_DNA_COPY.analysisFailed);
    expect(published).not.toHaveProperty("failureFieldPaths");
    expect(published).not.toHaveProperty("providerRequestId");
    expect(published).not.toHaveProperty("outputFingerprint");
    expect(JSON.stringify(published)).not.toContain("LEAKED_SCHEMA_VALUE_42");
  });

  it("enforces strict vision arrays and keeps usage when canonical validation rejects", async () => {
    const format = characterDnaVisionResponseFormat();
    const responseSchema = format.json_schema.schema as {
      additionalProperties?: boolean;
      properties: Record<string, { type?: string; items?: { type?: string; $ref?: string } }>;
      required?: string[];
      definitions?: Record<string, { type?: string }>;
    };
    const factItems = responseSchema.properties.distinctiveVisualFacts?.items;
    const factItemKey = factItems?.$ref?.split("/").pop() ?? "";
    expect(format.type).toBe("json_schema");
    expect(responseSchema.additionalProperties).toBe(false);
    expect(responseSchema.properties.distinctiveVisualFacts?.type).toBe("array");
    expect(responseSchema.definitions?.[factItemKey]?.type).toBe("string");
    expect(responseSchema.required).toEqual(expect.arrayContaining(["distinctiveVisualFacts", "mustPreserve", "mutableTraits"]));
    expect(responseSchema.properties.sourceAssetId).toBeUndefined();
    expect(readFileSync(resolve(process.cwd(), "packages/agents/src/llm.ts"), "utf8")).toContain(
      "maxRetries: input.requestOptions?.maxRetries ?? 0"
    );

    expect(AiStoryCharacterDnaVisionOutputSchema.safeParse(visionOutput()).success).toBe(true);
    const missing = visionOutput();
    delete (missing as { distinctiveVisualFacts?: unknown }).distinctiveVisualFacts;
    expect(AiStoryCharacterDnaVisionOutputSchema.safeParse(missing).success).toBe(false);
    expect(AiStoryCharacterDnaVisionOutputSchema.safeParse(visionOutput({
      distinctiveVisualFacts: "STRING_FACT_SENTINEL_QQ",
    })).success).toBe(false);
    expect(AiStoryCharacterDnaVisionOutputSchema.safeParse(visionOutput({
      distinctiveVisualFacts: [],
    })).success).toBe(true);

    const request = {
      sourceAssetId: IDS.source, sourceContentHash: HASH, imageDataUrl: "data:image/jpeg;base64,AA==",
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    const queued = buildAiStoryCharacterDnaAnalysisJob({
      orgId: IDS.org, workspaceId: IDS.workspace, sourceAssetId: IDS.source, sourceContentHash: HASH,
      permissionConfirmed: true, createdBy: IDS.actor, createdAt: "2026-09-23T00:00:00.000Z",
    });
    const usage = { input: 321, output: 45, costUsd: 0.0012 };
    const persist = async (result: unknown) => applyCharacterDnaAnalysisFailure(
      queued,
      "2026-09-23T00:01:00.000Z",
      classifyCharacterDnaAnalysisFailure(result)
    );

    const empty = await new VisionCharacterDnaAnalysisProvider(async () => ({
      result: visionOutput({ distinctiveVisualFacts: [] }),
      usage,
      providerRequestId: "chatcmpl-empty",
      requestedModelId: "gpt-4o",
      providerModelId: "gpt-4o-2024-08-06",
    })).analyzeCharacter(request);
    expect(empty.dna.distinctiveVisualFacts).toEqual([]);
    expect(empty.dna.sourceAssetId).toBe(IDS.source);
    expect(empty.dna.sourceContentHash).toBe(HASH);

    const sensitivePayload = visionOutput({ distinctiveVisualFacts: ["SECRET_BEAUTIFUL_FACT"] });
    const sensitiveJob = await persist(await new VisionCharacterDnaAnalysisProvider(async () => ({
      result: sensitivePayload,
      usage,
      providerRequestId: "chatcmpl-sensitive",
      requestedModelId: "gpt-4o",
      providerModelId: "gpt-4o-2024-08-06",
    })).analyzeCharacter(request).catch((error) => error));
    expect(sensitiveJob.failureCode).toBe("SENSITIVE_TRAIT_INFERENCE_BLOCKED");
    expect(sensitiveJob.failureStage).toBe("SAFETY");
    expect(sensitiveJob.proposedDna).toBeNull();
    expect(sensitiveJob.inputTokens).toBe(321);
    expect(sensitiveJob.outputTokens).toBe(45);
    expect(sensitiveJob.costUsd).toBe("0.0012");
    expect(sensitiveJob.provider).toBe("openai-vision");
    expect(sensitiveJob.providerModel).toBe("gpt-4o-2024-08-06");
    expect(JSON.stringify(sensitiveJob)).not.toContain("SECRET_BEAUTIFUL_FACT");

    const stringJob = await persist(await new VisionCharacterDnaAnalysisProvider(async () => ({
      result: visionOutput({ distinctiveVisualFacts: "STRING_FACT_SENTINEL_QQ" }),
      usage,
      providerRequestId: "chatcmpl-string",
      requestedModelId: "gpt-4o",
      providerModelId: "gpt-4o-2024-08-06",
    })).analyzeCharacter(request).catch((error) => error));
    expect(stringJob.failureCode).toBe("CHARACTER_DNA_SCHEMA_VALIDATION_FAILED");
    expect(stringJob.failureStage).toBe("SCHEMA");
    expect(stringJob.failureFieldPaths).toContain("distinctiveVisualFacts");
    expect(stringJob.inputTokens).toBe(321);
    expect(stringJob.costUsd).toBe("0.0012");
    expect(stringJob.proposedDna).toBeNull();
    expect(JSON.stringify(stringJob)).not.toContain("STRING_FACT_SENTINEL_QQ");

    const missingJob = await persist(await new VisionCharacterDnaAnalysisProvider(async () => ({
      result: missing,
      usage,
      providerRequestId: "chatcmpl-missing",
    })).analyzeCharacter(request).catch((error) => error));
    expect(missingJob.failureFieldPaths).toContain("distinctiveVisualFacts");
    expect(missingJob.inputTokens).toBe(321);
    expect(missingJob.outputTokens).toBe(45);
    expect(missingJob.costUsd).toBe("0.0012");
  });

  it("normal UI no longer exposes Premium 3D generation", () => {
    const library = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/ReusableCharacterLibraryPanel.tsx"), "utf8");
    const wizard = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/CharacterDnaWizard.tsx"), "utf8");
    expect(library).toContain("CharacterDnaWizard");
    expect(library).toContain("character-dna-badge");
    expect(wizard).toContain("character-analyze");
    expect(wizard).not.toContain("Premium 3D");
    expect(wizard).not.toContain("Create Virtual Character");
    expect(wizard).not.toContain("Generate Again");
  });
});
