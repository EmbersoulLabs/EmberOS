import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_CHARACTER_REFERENCE_GENERATION_PACKAGE_CONTRACT_VERSION,
  AI_STORY_CHARACTER_REFERENCE_PACK_CONTRACT_VERSION,
  AiStoryCharacterReferencePackError,
  AiStoryCharacterReferencePackSchema,
  CHARACTER_REFERENCE_PACK_OPTIONAL_VIEWS,
  CHARACTER_REFERENCE_PACK_PAID_IMAGE_GENERATION,
  CHARACTER_REFERENCE_PACK_PROVIDER_IMAGE_CALLS,
  CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS,
  additionalReferenceRoles,
  assertReferencePackAnchorRole,
  episodePresentationLeakedIntoReferenceIdentity,
  referencePackAppliesToCharacterVersion,
  resolveCharacterReferencePackAnchor,
  selectCharacterReferences,
  summarizeCharacterReferencePackSurface,
  type AiStoryCharacterReferenceViewRole,
  type CharacterReferenceAssetEvidence,
} from "@ceo-agent/shared";
import {
  AiStoryCharacterReferenceGenerationPackageSchema,
  bindGeneratedCharacterReferenceView,
  buildAiStoryReusableCharacterVersion,
  buildCharacterReferenceGenerationPackage,
  buildCharacterReferencePack,
  mapCharacterDnaToIdentityCore,
  markReferencePackStaleForAnchorChange,
  mockCharacterDnaFixture,
  renderManualLocalReferenceHandoff,
  reviewCharacterReferenceView,
  supersedeCharacterReferenceView,
  type AiStoryReusableCharacterVersion,
} from "@ceo-agent/shared/server";

const IDS = {
  org: "91000000-0000-4000-8000-000000000001",
  workspace: "91000000-0000-4000-8000-000000000002",
  otherWorkspace: "91000000-0000-4000-8000-000000000003",
  actor: "91000000-0000-4000-8000-000000000004",
  character: "91000000-0000-4000-8000-000000000005",
  master: "91000000-0000-4000-8000-000000000006",
  source: "91000000-0000-4000-8000-000000000007",
  synthetic: "91000000-0000-4000-8000-000000000008",
  face: "91000000-0000-4000-8000-000000000009",
  profile: "91000000-0000-4000-8000-00000000000a",
  profileNext: "91000000-0000-4000-8000-00000000000b",
  back: "91000000-0000-4000-8000-00000000000c",
  detailFace: "91000000-0000-4000-8000-00000000000d",
  detailHair: "91000000-0000-4000-8000-00000000000e",
  frontBody: "91000000-0000-4000-8000-00000000000f",
};

const HASH = (mark: string) => `sha256:${mark.repeat(64).slice(0, 64)}`;
const EPISODE = {
  wardrobe: null,
  makeup: null,
  accessories: null,
  hairstyle: null,
  hairColor: null,
  expression: "surprised wide-eyed episode expression",
  pose: null,
  location: "standing on the night-market pier",
  action: null,
  product: "holding the seasonal mango carton",
  dialogue: null,
};

function imageAsset(id: string, hash: string, workspaceId = IDS.workspace): CharacterReferenceAssetEvidence {
  return {
    id,
    orgId: IDS.org,
    workspaceId,
    type: "image",
    mimeType: "image/png",
    status: "ready",
    contentHash: hash,
    storagePath: `${workspaceId}/library/${id}.png`,
    deletedAt: null,
  };
}

function visualCharacter(version = 1) {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: IDS.character,
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    name: "Alicia",
    identityCore: {
      identityDescription: "Alicia is a synthetic restaurant spokesperson.",
      faceIdentityDescription: "Oval face, dark brown eyes, defined brows, medium nose.",
      bodyIdentityDescription: "Average adult height with balanced shoulders.",
      distinctiveVisualFacts: ["small beauty mark near the left eye"],
      mustPreserve: ["face identity", "body proportions", "beauty mark"],
      mustNeverChange: ["canonical face identity"],
    },
    defaultLook: {
      wardrobe: "white outfit",
      makeup: "natural",
      accessories: null,
      hairstyle: "shoulder length",
      hairColor: "dark brown",
    },
    mutableLookPolicy: {
      wardrobeAllowed: true,
      makeupAllowed: true,
      accessoriesAllowed: true,
      hairstyleAllowed: true,
      hairColorAllowed: false,
    },
    canonicalAssets: [{ assetId: IDS.master, contentHash: HASH("a"), role: "IDENTITY_MASTER", source: "USER_APPROVED" }],
    status: "ACTIVE",
    version,
    supersedesReusableCharacterVersionId: null,
    createdBy: IDS.actor,
    createdAt: `2026-10-06T00:0${version}:00.000Z`,
  });
}

const DNA = mockCharacterDnaFixture({ sourceAssetId: IDS.source, sourceContentHash: HASH("1") });

function dnaCharacter(
  assets: AiStoryReusableCharacterVersion["canonicalAssets"],
  version = 1
) {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: IDS.character,
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    name: "Alicia DNA",
    identityCore: mapCharacterDnaToIdentityCore(DNA),
    defaultLook: {
      wardrobe: "default commercial wardrobe",
      makeup: null,
      accessories: null,
      hairstyle: null,
      hairColor: null,
    },
    mutableLookPolicy: {
      wardrobeAllowed: true,
      makeupAllowed: true,
      accessoriesAllowed: true,
      hairstyleAllowed: false,
      hairColorAllowed: false,
    },
    canonicalAssets: assets,
    status: "ACTIVE",
    version,
    supersedesReusableCharacterVersionId: null,
    createdBy: IDS.actor,
    createdAt: `2026-10-06T01:0${version}:00.000Z`,
    identityMode: "CHARACTER_DNA",
    characterDna: DNA,
  });
}

function errorCode(run: () => void) {
  try {
    run();
  } catch (error) {
    return error instanceof AiStoryCharacterReferencePackError ? error.code : "THROWN";
  }
  return "NONE";
}

function packFor(character: AiStoryReusableCharacterVersion, assetId = IDS.master, hash = HASH("a")) {
  return buildCharacterReferencePack({
    character,
    anchorAsset: imageAsset(assetId, hash),
    createdBy: IDS.actor,
    createdAt: "2026-10-06T02:00:00.000Z",
  });
}

function approve(
  pack: ReturnType<typeof packFor>,
  character: AiStoryReusableCharacterVersion,
  role: Exclude<AiStoryCharacterReferenceViewRole, "ANCHOR">,
  asset: CharacterReferenceAssetEvidence,
  at: string
) {
  const generated = bindGeneratedCharacterReferenceView({ pack, character, role, asset, boundAt: at });
  const view = generated.views.find((item) => item.assetId === asset.id && item.role === role && item.status === "GENERATED");
  if (!view) throw new Error("generated view missing");
  return reviewCharacterReferenceView({ pack: generated, viewId: view.viewId, decision: "APPROVE" });
}

describe("character reference pack v1", () => {
  it("A. accepts identity master and synthetic anchor, and rejects a source portrait", () => {
    const visual = visualCharacter();
    const visualAnchor = resolveCharacterReferencePackAnchor(visual);
    expect(visualAnchor.ok && visualAnchor.anchor.semanticRole).toBe("IDENTITY_MASTER");
    const hybrid = dnaCharacter([
      { assetId: IDS.source, contentHash: HASH("1"), role: "CHARACTER_SOURCE_PORTRAIT", source: "USER_APPROVED" },
      { assetId: IDS.synthetic, contentHash: HASH("2"), role: "SYNTHETIC_IDENTITY_ANCHOR", source: "USER_APPROVED" },
    ]);
    const hybridAnchor = resolveCharacterReferencePackAnchor(hybrid);
    expect(hybridAnchor.ok && hybridAnchor.anchor).toMatchObject({
      assetId: IDS.synthetic,
      semanticRole: "SYNTHETIC_IDENTITY_ANCHOR",
    });
    const soft = dnaCharacter([
      { assetId: IDS.source, contentHash: HASH("1"), role: "CHARACTER_SOURCE_PORTRAIT", source: "USER_APPROVED" },
    ]);
    expect(resolveCharacterReferencePackAnchor(soft)).toEqual({ ok: false, code: "REFERENCE_PACK_ANCHOR_REQUIRED" });
    expect(errorCode(() => assertReferencePackAnchorRole("CHARACTER_SOURCE_PORTRAIT"))).toBe(
      "REFERENCE_PACK_SOURCE_PORTRAIT_ANCHOR_FORBIDDEN"
    );
    expect(errorCode(() => packFor(soft, IDS.source, HASH("1")))).toBe("REFERENCE_PACK_ANCHOR_REQUIRED");
  });

  it("B. fails closed when the anchor asset belongs to another workspace", () => {
    const character = visualCharacter();
    expect(
      errorCode(() =>
        buildCharacterReferencePack({
          character,
          anchorAsset: imageAsset(IDS.master, HASH("a"), IDS.otherWorkspace),
          createdBy: IDS.actor,
          createdAt: "2026-10-06T02:00:00.000Z",
        })
      )
    ).toBe("REFERENCE_PACK_CROSS_WORKSPACE");
  });

  it("C. keeps the semantic fingerprint stable for the same version, anchor, and view set", () => {
    const character = visualCharacter();
    const first = approve(
      packFor(character),
      character,
      "FACE_FRONT",
      imageAsset(IDS.face, HASH("f")),
      "2026-10-06T02:01:00.000Z"
    );
    const second = approve(
      buildCharacterReferencePack({
        character,
        anchorAsset: imageAsset(IDS.master, HASH("a")),
        createdBy: IDS.actor,
        createdAt: "2026-10-06T05:00:00.000Z",
      }),
      character,
      "FACE_FRONT",
      imageAsset(IDS.face, HASH("f")),
      "2026-10-06T05:02:00.000Z"
    );
    expect(first.packFingerprint).toBe(second.packFingerprint);
    expect(first.referencePackId).toBe(second.referencePackId);
    expect(first.createdAt).not.toBe(second.createdAt);
  });

  it("D. does not let a version 1 pack be consumed as version 2", () => {
    const versionOne = visualCharacter(1);
    const versionTwo = visualCharacter(2);
    const pack = packFor(versionOne);
    expect(referencePackAppliesToCharacterVersion(pack, versionOne)).toBe(true);
    expect(referencePackAppliesToCharacterVersion(pack, versionTwo)).toBe(false);
    expect(versionOne.identityFingerprint).toBe(versionTwo.identityFingerprint);
    expect(
      errorCode(() =>
        selectCharacterReferences({
          pack,
          reusableCharacterVersionId: versionTwo.reusableCharacterVersionId,
          identityFingerprint: versionTwo.identityFingerprint,
          maxReferenceCount: 4,
        })
      )
    ).toBe("REFERENCE_PACK_CHARACTER_VERSION_MISMATCH");
  });

  it("E. records anchor lineage and the generation input fingerprint on every derived view", () => {
    const character = visualCharacter();
    const before = structuredClone(character);
    const pack = approve(packFor(character), character, "PROFILE_90", imageAsset(IDS.profile, HASH("3")), "2026-10-06T02:03:00.000Z");
    const view = pack.views.find((item) => item.role === "PROFILE_90");
    const pkg = buildCharacterReferenceGenerationPackage({
      pack: packFor(character),
      character,
      requestedViewRole: "PROFILE_90",
      createdAt: "2026-10-06T02:02:00.000Z",
    });
    expect(view).toMatchObject({
      anchorAssetId: IDS.master,
      anchorContentHash: HASH("a"),
      generationInputFingerprint: pkg.generationInputFingerprint,
    });
    expect(pack.reusableCharacterVersionId).toBe(character.reusableCharacterVersionId);
    expect(character).toEqual(before);
    expect(errorCode(() =>
      bindGeneratedCharacterReferenceView({
        pack: packFor(character),
        character,
        role: "DETAIL_FACE",
        asset: imageAsset(IDS.detailFace, HASH("d")),
        boundAt: "2026-10-06T02:04:00.000Z",
      })
    )).toBe("REFERENCE_PACK_DEPENDENCY_MISSING");
  });

  it("F. keeps generated and rejected views out of downstream consumption", () => {
    const character = visualCharacter();
    const generated = bindGeneratedCharacterReferenceView({
      pack: packFor(character),
      character,
      role: "FACE_FRONT",
      asset: imageAsset(IDS.face, HASH("f")),
      boundAt: "2026-10-06T02:05:00.000Z",
    });
    const candidate = generated.views.find((view) => view.role === "FACE_FRONT");
    expect(candidate?.status).toBe("GENERATED");
    expect(selectCharacterReferences({
      pack: generated,
      reusableCharacterVersionId: character.reusableCharacterVersionId,
      identityFingerprint: character.identityFingerprint,
      maxReferenceCount: 4,
    }).refs.map((ref) => ref.assetId)).not.toContain(IDS.face);

    const approved = reviewCharacterReferenceView({ pack: generated, viewId: candidate!.viewId, decision: "APPROVE" });
    expect(selectCharacterReferences({
      pack: approved,
      reusableCharacterVersionId: character.reusableCharacterVersionId,
      identityFingerprint: character.identityFingerprint,
      maxReferenceCount: 4,
    }).refs.map((ref) => ref.role)).toEqual(["ANCHOR", "FACE_FRONT"]);

    const rejected = reviewCharacterReferenceView({
      pack: generated,
      viewId: candidate!.viewId,
      decision: "REJECT",
    });
    expect(selectCharacterReferences({
      pack: rejected,
      reusableCharacterVersionId: character.reusableCharacterVersionId,
      identityFingerprint: character.identityFingerprint,
      maxReferenceCount: 4,
    }).refs.map((ref) => ref.assetId)).not.toContain(IDS.face);
  });

  it("G. marks every derived view stale when the anchor changes and leaves historical assets unchanged", () => {
    const character = visualCharacter();
    const face = imageAsset(IDS.face, HASH("f"));
    const profile = imageAsset(IDS.profile, HASH("3"));
    const frozenFace = structuredClone(face);
    let pack = packFor(character);
    pack = approve(pack, character, "FACE_FRONT", face, "2026-10-06T02:06:00.000Z");
    pack = approve(pack, character, "PROFILE_90", profile, "2026-10-06T02:07:00.000Z");
    const stale = markReferencePackStaleForAnchorChange(pack);
    expect(stale.views.filter((view) => view.role !== "ANCHOR").every((view) => view.status === "STALE")).toBe(true);
    expect(stale.views.find((view) => view.role === "FACE_FRONT")?.contentHash).toBe(HASH("f"));
    expect(face).toEqual(frozenFace);
    expect(errorCode(() => selectCharacterReferences({
      pack: stale,
      reusableCharacterVersionId: character.reusableCharacterVersionId,
      identityFingerprint: character.identityFingerprint,
      anchorContentHash: HASH("7"),
      maxReferenceCount: 4,
    }))).toBe("REFERENCE_PACK_ANCHOR_MISMATCH");
  });

  it("H. stales face and hair details when face front is superseded, and keeps profile and back", () => {
    const character = visualCharacter();
    let pack = packFor(character);
    pack = approve(pack, character, "FACE_FRONT", imageAsset(IDS.face, HASH("f")), "2026-10-06T02:08:00.000Z");
    pack = approve(pack, character, "PROFILE_90", imageAsset(IDS.profile, HASH("3")), "2026-10-06T02:09:00.000Z");
    pack = approve(pack, character, "FULL_BODY_BACK", imageAsset(IDS.back, HASH("b")), "2026-10-06T02:10:00.000Z");
    pack = approve(pack, character, "DETAIL_FACE", imageAsset(IDS.detailFace, HASH("d")), "2026-10-06T02:11:00.000Z");
    pack = approve(pack, character, "DETAIL_HAIR", imageAsset(IDS.detailHair, HASH("5")), "2026-10-06T02:12:00.000Z");
    const next = supersedeCharacterReferenceView({ pack, role: "FACE_FRONT" });
    const status = (role: AiStoryCharacterReferenceViewRole) => next.views.find((view) => view.role === role)?.status;
    expect(status("DETAIL_FACE")).toBe("STALE");
    expect(status("DETAIL_HAIR")).toBe("STALE");
    expect(status("FACE_FRONT")).toBe("STALE");
    expect(status("PROFILE_90")).toBe("APPROVED");
    expect(status("FULL_BODY_BACK")).toBe("APPROVED");
    expect(status("ANCHOR")).toBe("APPROVED");
  });

  it("I. creates a new profile view on regenerate and keeps the old asset historical", () => {
    const character = visualCharacter();
    const before = structuredClone(character);
    const original = imageAsset(IDS.profile, HASH("3"));
    const frozen = structuredClone(original);
    const first = approve(packFor(character), character, "PROFILE_90", original, "2026-10-06T02:13:00.000Z");
    const regenerated = bindGeneratedCharacterReferenceView({
      pack: first,
      character,
      role: "PROFILE_90",
      asset: imageAsset(IDS.profileNext, HASH("4")),
      boundAt: "2026-10-06T02:14:00.000Z",
    });
    const profiles = regenerated.views.filter((view) => view.role === "PROFILE_90");
    expect(profiles.map((view) => view.assetId).sort()).toEqual([IDS.profile, IDS.profileNext].sort());
    expect(profiles.find((view) => view.assetId === IDS.profile)).toMatchObject({ status: "APPROVED", contentHash: HASH("3") });
    expect(profiles.find((view) => view.assetId === IDS.profileNext)?.status).toBe("GENERATED");
    expect(original).toEqual(frozen);
    expect(character.version).toBe(before.version);
    expect(character.reusableCharacterVersionId).toBe(before.reusableCharacterVersionId);
  });

  it("J. does not copy episode expression, location, or product into reference identity", () => {
    const character = visualCharacter();
    const pack = packFor(character);
    const pkg = buildCharacterReferenceGenerationPackage({
      pack,
      character,
      requestedViewRole: "FACE_FRONT",
      createdAt: "2026-10-06T02:15:00.000Z",
    });
    const text = `${JSON.stringify(pkg)} ${renderManualLocalReferenceHandoff(pkg)}`;
    expect(episodePresentationLeakedIntoReferenceIdentity({
      identityCore: character.identityCore,
      defaultLook: character.defaultLook,
      text,
      episodeLook: EPISODE,
    })).toEqual([]);
    expect(pkg.mustPreserve).toEqual(character.identityCore.mustPreserve);
    expect(pkg.identityCore).toEqual(character.identityCore);
  });

  it("K. never selects the Character DNA source portrait as a canonical reference", () => {
    const hybrid = dnaCharacter([
      { assetId: IDS.source, contentHash: HASH("1"), role: "CHARACTER_SOURCE_PORTRAIT", source: "USER_APPROVED" },
      { assetId: IDS.synthetic, contentHash: HASH("2"), role: "SYNTHETIC_IDENTITY_ANCHOR", source: "USER_APPROVED" },
    ]);
    const pack = packFor(hybrid, IDS.synthetic, HASH("2"));
    expect(pack.anchor.semanticRole).toBe("SYNTHETIC_IDENTITY_ANCHOR");
    expect(pack.views.some((view) => view.assetId === IDS.source || view.characterAssetSemantic === "CHARACTER_SOURCE_PORTRAIT")).toBe(false);
    const selected = selectCharacterReferences({
      pack,
      reusableCharacterVersionId: hybrid.reusableCharacterVersionId,
      identityFingerprint: hybrid.identityFingerprint,
      maxReferenceCount: 4,
    });
    expect(selected.refs.map((ref) => ref.assetId)).not.toContain(IDS.source);
    expect(errorCode(() => bindGeneratedCharacterReferenceView({
      pack,
      character: hybrid,
      role: "FACE_FRONT",
      asset: imageAsset(IDS.source, HASH("1")),
      boundAt: "2026-10-06T02:16:00.000Z",
    }))).toBe("REFERENCE_PACK_SOURCE_PHOTO_LEAK");
    const summary = summarizeCharacterReferencePackSurface({ character: hybrid, pack });
    expect(summary.sourcePortraitIsAnchor).toBe(false);
    expect(summary.anchor?.semanticRole).toBe("SYNTHETIC_IDENTITY_ANCHOR");
  });

  it("L. returns only current approved refs and respects the reference budget", () => {
    const character = visualCharacter();
    let pack = packFor(character);
    const pending = bindGeneratedCharacterReferenceView({
      pack,
      character,
      role: "THREE_QUARTER",
      asset: imageAsset(IDS.frontBody, HASH("6")),
      boundAt: "2026-10-06T02:17:00.000Z",
    });
    pack = approve(pack, character, "FACE_FRONT", imageAsset(IDS.face, HASH("f")), "2026-10-06T02:18:00.000Z");
    pack = approve(pack, character, "PROFILE_90", imageAsset(IDS.profile, HASH("3")), "2026-10-06T02:19:00.000Z");
    pack = approve(pack, character, "FULL_BODY_BACK", imageAsset(IDS.back, HASH("b")), "2026-10-06T02:20:00.000Z");
    const selection = selectCharacterReferences({
      pack,
      reusableCharacterVersionId: character.reusableCharacterVersionId,
      identityFingerprint: character.identityFingerprint,
      maxReferenceCount: 2,
    });
    expect(selection.refs).toHaveLength(2);
    expect(selection.refs.map((ref) => ref.role)).toEqual(["ANCHOR", "FACE_FRONT"]);
    expect(selection.refs.every((ref) => ref.contentHash.length > 0)).toBe(true);
    expect(selection.refs.map((ref) => ref.assetId)).not.toContain(IDS.frontBody);
    expect(pending.views.find((view) => view.role === "THREE_QUARTER")?.status).toBe("GENERATED");
    expect(CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS).toEqual(["ANCHOR", "FACE_FRONT", "PROFILE_90", "FULL_BODY_BACK"]);
    expect(CHARACTER_REFERENCE_PACK_OPTIONAL_VIEWS).toEqual([
      "THREE_QUARTER",
      "FULL_BODY_FRONT",
      "DETAIL_HAIR",
      "DETAIL_FACE",
      "DETAIL_WARDROBE",
    ]);
  });

  it("M-O. stays off sequential, duration, style, and voice authority and names no image provider", () => {
    const contract = readFileSync(resolve(process.cwd(), "packages/shared/src/ai-story-character-reference-pack.ts"), "utf8");
    const server = readFileSync(resolve(process.cwd(), "packages/shared/src/ai-story-character-reference-pack.server.ts"), "utf8");
    const source = `${contract}\n${server}`;
    for (const token of ["OpenAI", "Qwen", "ComfyUI", "GPT Image", "gpt-image", "recommended-duration", "recommendedDuration", "visual-style", "audio-dna", "sequential-local"]) {
      expect(source.toLowerCase()).not.toContain(token.toLowerCase());
    }
    expect(additionalReferenceRoles()).not.toContain("FULL_BODY_BACK");
    expect(additionalReferenceRoles()).not.toContain("DETAIL_REFERENCE");
    const character = visualCharacter();
    const pack = packFor(character);
    expect(AiStoryCharacterReferencePackSchema.safeParse({ ...pack, provider: "local-node" }).success).toBe(false);
    const pkg = buildCharacterReferenceGenerationPackage({
      pack,
      character,
      requestedViewRole: "FULL_BODY_BACK",
      createdAt: "2026-10-06T02:21:00.000Z",
    });
    expect(AiStoryCharacterReferenceGenerationPackageSchema.safeParse({ ...pkg, provider: "local-node" }).success).toBe(false);
    expect(pkg.contractVersion).toBe(AI_STORY_CHARACTER_REFERENCE_GENERATION_PACKAGE_CONTRACT_VERSION);
    expect(pack.contractVersion).toBe(AI_STORY_CHARACTER_REFERENCE_PACK_CONTRACT_VERSION);
    expect(CHARACTER_REFERENCE_PACK_PROVIDER_IMAGE_CALLS).toBe("NONE");
    expect(CHARACTER_REFERENCE_PACK_PAID_IMAGE_GENERATION).toBe("NONE");
    const handoff = renderManualLocalReferenceHandoff(pkg);
    expect(handoff).toContain("full body from the rear");
    expect(handoff).toContain("same canonical wardrobe");
    expect(handoff).not.toContain("{");
    const faceHandoff = renderManualLocalReferenceHandoff(buildCharacterReferenceGenerationPackage({
      pack,
      character,
      requestedViewRole: "FACE_FRONT",
      createdAt: "2026-10-06T02:22:00.000Z",
    }));
    expect(faceHandoff).toContain("front-facing portrait");
    expect(faceHandoff).toContain("neutral expression");
    const profileHandoff = renderManualLocalReferenceHandoff(buildCharacterReferenceGenerationPackage({
      pack,
      character,
      requestedViewRole: "PROFILE_90",
      createdAt: "2026-10-06T02:23:00.000Z",
    }));
    expect(profileHandoff).toContain("exact 90 degree side profile");
  });
});
