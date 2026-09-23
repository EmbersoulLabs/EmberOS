import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
  AiStoryCharacterDnaSchema,
  AiStoryReusableCharacterVersionSchema,
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
  applyCharacterDnaToSeedanceRequest,
  approveCharacterDna,
  buildAiStoryCharacterDnaAnalysisJob,
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
  MockCharacterDnaAnalysisProvider,
  assertNoImageGenerationForCharacterDna,
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
      canonicalAssetIds: [IDS.source],
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
