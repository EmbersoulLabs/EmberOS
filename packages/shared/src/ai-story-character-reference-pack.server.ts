import { z } from "zod";
import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_CHARACTER_REFERENCE_GENERATION_PACKAGE_CONTRACT_VERSION,
  AI_STORY_CHARACTER_REFERENCE_PACK_CONTRACT_VERSION,
  AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES,
  AiStoryCharacterReferencePackError,
  AiStoryCharacterReferencePackSchema,
  CHARACTER_REFERENCE_PACK_EXECUTION_STRATEGY,
  approvedDependencyViews,
  assertReferencePackAnchorRole,
  referenceViewAssetSemantic,
  resolveCharacterReferencePackAnchor,
  sourcePortraitAssetId,
  validateCharacterReferenceAsset,
  viewsAfterAnchorChange,
  viewsAfterSupersedingRole,
  type AiStoryCharacterReferencePack,
  type AiStoryCharacterReferenceView,
  type AiStoryCharacterReferenceViewRole,
  type CharacterReferenceAssetEvidence,
} from "./ai-story-character-reference-pack";
import {
  AiStoryCharacterDefaultLookSchema,
  AiStoryCharacterIdentityCoreSchema,
  type AiStoryCharacterDefaultLook,
  type AiStoryCharacterIdentityCore,
  type AiStoryReusableCharacterVersion,
} from "./ai-story-reusable-character";

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const ASPECTS = ["1:1", "3:4", "9:16"] as const;
const ORIENTATIONS = ["square", "portrait"] as const;

export const CHARACTER_REFERENCE_VIEW_FRAMING = {
  ANCHOR: {
    recommendedAspect: "3:4",
    orientation: "portrait",
    summary: "Canonical identity anchor",
    requirements: ["Use the exact approved identity anchor", "Do not redesign the person"],
  },
  FACE_FRONT: {
    recommendedAspect: "3:4",
    orientation: "portrait",
    summary: "Front-facing portrait",
    requirements: ["front-facing portrait", "neutral expression", "identity-focused", "clean background"],
  },
  THREE_QUARTER: {
    recommendedAspect: "3:4",
    orientation: "portrait",
    summary: "Three-quarter portrait",
    requirements: ["three-quarter view of the same identity", "neutral expression", "no redesign", "clean background"],
  },
  PROFILE_90: {
    recommendedAspect: "3:4",
    orientation: "portrait",
    summary: "Exact 90 degree side profile",
    requirements: ["exact 90 degree side profile", "same face, hair, and body identity", "no redesign"],
  },
  FULL_BODY_FRONT: {
    recommendedAspect: "9:16",
    orientation: "portrait",
    summary: "Full body from the front",
    requirements: ["full body from the front", "same proportions", "same hairstyle", "same canonical wardrobe"],
  },
  FULL_BODY_BACK: {
    recommendedAspect: "9:16",
    orientation: "portrait",
    summary: "Full body from the rear",
    requirements: ["full body from the rear", "same proportions", "same hairstyle", "same canonical wardrobe"],
  },
  DETAIL_HAIR: {
    recommendedAspect: "1:1",
    orientation: "square",
    summary: "Hair detail",
    requirements: ["close detail of the canonical hairstyle", "same hair identity", "no redesign"],
  },
  DETAIL_FACE: {
    recommendedAspect: "1:1",
    orientation: "square",
    summary: "Face detail",
    requirements: ["close detail of the canonical face", "same facial identity", "neutral expression", "no redesign"],
  },
  DETAIL_WARDROBE: {
    recommendedAspect: "3:4",
    orientation: "portrait",
    summary: "Wardrobe detail",
    requirements: ["detail of the canonical default wardrobe", "same garment identity", "no episode-specific costume"],
  },
} as const satisfies Record<
  AiStoryCharacterReferenceViewRole,
  {
    recommendedAspect: (typeof ASPECTS)[number];
    orientation: (typeof ORIENTATIONS)[number];
    summary: string;
    requirements: readonly string[];
  }
>;

export const AiStoryCharacterReferenceGenerationPackageSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_CHARACTER_REFERENCE_GENERATION_PACKAGE_CONTRACT_VERSION),
    packageId: Id,
    packageFingerprint: Hash,
    executionStrategy: z.literal(CHARACTER_REFERENCE_PACK_EXECUTION_STRATEGY),
    orgId: Id,
    workspaceId: Id,
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    identityFingerprint: Hash,
    anchorAssetId: Id,
    anchorContentHash: Hash,
    requestedViewRole: z.enum(AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES),
    identityCoreFingerprint: Hash,
    defaultLookFingerprint: Hash,
    generationInputFingerprint: Hash,
    identityCore: AiStoryCharacterIdentityCoreSchema,
    defaultLook: AiStoryCharacterDefaultLookSchema,
    mustPreserve: z.array(z.string().trim().min(1)).max(32),
    mustNeverChange: z.array(z.string().trim().min(1)).max(32),
    positiveVisualDirection: z.string().trim().min(1).max(8000),
    negativeVisualConstraints: z.array(z.string().trim().min(1)).max(64),
    referenceAssets: z.array(
      z
        .object({
          role: z.enum(AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES),
          assetId: Id,
          contentHash: Hash,
          characterAssetSemantic: z.enum([
            "IDENTITY_MASTER",
            "SYNTHETIC_IDENTITY_ANCHOR",
            "FRONT_PORTRAIT",
            "THREE_QUARTER",
            "PROFILE",
            "FULL_BODY",
            "FULL_BODY_BACK",
            "DETAIL_REFERENCE",
          ]),
        })
        .strict()
    ),
    outputRequirements: z
      .object({
        media: z.literal("image"),
        recommendedAspect: z.enum(ASPECTS),
        orientation: z.enum(ORIENTATIONS),
        transparentBackgroundOptional: z.literal(true),
        textAllowed: z.literal(false),
        watermarkAllowed: z.literal(false),
      })
      .strict(),
    framing: z
      .object({
        summary: z.string().trim().min(1),
        requirements: z.array(z.string().trim().min(1)).min(1),
      })
      .strict(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AiStoryCharacterReferenceGenerationPackage = z.infer<
  typeof AiStoryCharacterReferenceGenerationPackageSchema
>;

export function characterDescriptionFingerprint(identityCore: AiStoryCharacterIdentityCore) {
  return sha256CanonicalIntegrityHash({
    kind: "character-description",
    identityDescription: identityCore.identityDescription,
    faceIdentityDescription: identityCore.faceIdentityDescription,
    bodyIdentityDescription: identityCore.bodyIdentityDescription,
    distinctiveVisualFacts: identityCore.distinctiveVisualFacts,
    mustPreserve: identityCore.mustPreserve,
    mustNeverChange: identityCore.mustNeverChange,
  });
}

export function styleSnapshotFingerprint(defaultLook: AiStoryCharacterDefaultLook) {
  return sha256CanonicalIntegrityHash({ kind: "character-default-look", defaultLook });
}

function semanticView(view: AiStoryCharacterReferenceView) {
  return {
    role: view.role,
    assetId: view.assetId,
    contentHash: view.contentHash,
    anchorAssetId: view.anchorAssetId,
    anchorContentHash: view.anchorContentHash,
    characterAssetSemantic: view.characterAssetSemantic,
    generationInputFingerprint: view.generationInputFingerprint,
    dependsOn: [...view.dependsOn].sort((a, b) => a.role.localeCompare(b.role) || a.assetId.localeCompare(b.assetId)),
    lineageIndex: view.lineageIndex,
    status: view.status,
  };
}

export function characterReferencePackSemanticIdentity(
  pack: Omit<AiStoryCharacterReferencePack, "packFingerprint" | "referencePackId"> & {
    packFingerprint?: string;
    referencePackId?: string;
  }
) {
  return {
    contractVersion: pack.contractVersion,
    orgId: pack.orgId,
    workspaceId: pack.workspaceId,
    reusableCharacterId: pack.reusableCharacterId,
    reusableCharacterVersionId: pack.reusableCharacterVersionId,
    identityFingerprint: pack.identityFingerprint,
    anchor: pack.anchor,
    styleSnapshotFingerprint: pack.styleSnapshotFingerprint,
    characterDescriptionFingerprint: pack.characterDescriptionFingerprint,
    executionStrategy: pack.executionStrategy,
    views: [...pack.views]
      .map(semanticView)
      .sort((a, b) => a.role.localeCompare(b.role) || a.lineageIndex - b.lineageIndex || a.assetId.localeCompare(b.assetId)),
  };
}

function referencePackIdFor(anchor: AiStoryCharacterReferencePack["anchor"], reusableCharacterVersionId: string) {
  return deterministicUuidFromFingerprint(
    "ai-story-character-reference-pack",
    sha256CanonicalIntegrityHash({
      contractVersion: AI_STORY_CHARACTER_REFERENCE_PACK_CONTRACT_VERSION,
      reusableCharacterVersionId,
      assetId: anchor.assetId,
      contentHash: anchor.contentHash,
      semanticRole: anchor.semanticRole,
    })
  );
}

function commitPack(
  pack: Omit<AiStoryCharacterReferencePack, "packFingerprint" | "referencePackId"> & {
    referencePackId?: string;
    packFingerprint?: string;
  }
): AiStoryCharacterReferencePack {
  const packFingerprint = sha256CanonicalIntegrityHash(characterReferencePackSemanticIdentity(pack));
  return AiStoryCharacterReferencePackSchema.parse({
    ...pack,
    referencePackId: referencePackIdFor(pack.anchor, pack.reusableCharacterVersionId),
    packFingerprint,
    views: [...pack.views].sort(
      (a, b) => a.role.localeCompare(b.role) || a.lineageIndex - b.lineageIndex || a.assetId.localeCompare(b.assetId)
    ),
  });
}

function identityRootFingerprint(input: {
  character: AiStoryReusableCharacterVersion;
  anchor: AiStoryCharacterReferencePack["anchor"];
}) {
  return sha256CanonicalIntegrityHash({
    kind: "IDENTITY_ROOT_ANCHOR",
    reusableCharacterVersionId: input.character.reusableCharacterVersionId,
    identityFingerprint: input.character.identityFingerprint,
    anchor: input.anchor,
  });
}

function assertSameCharacterAuthority(pack: AiStoryCharacterReferencePack, character: AiStoryReusableCharacterVersion) {
  if (
    pack.reusableCharacterId !== character.reusableCharacterId ||
    pack.reusableCharacterVersionId !== character.reusableCharacterVersionId ||
    pack.identityFingerprint !== character.identityFingerprint ||
    pack.orgId !== character.orgId ||
    pack.workspaceId !== character.workspaceId
  ) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_CHARACTER_VERSION_MISMATCH",
      "Reference Pack generation stays pinned to the Character version that created it."
    );
  }
}

export function buildCharacterReferencePack(input: {
  character: AiStoryReusableCharacterVersion;
  anchorAsset: CharacterReferenceAssetEvidence;
  createdBy: string;
  createdAt: string;
}): AiStoryCharacterReferencePack {
  const resolved = resolveCharacterReferencePackAnchor(input.character);
  if (!resolved.ok) {
    throw new AiStoryCharacterReferencePackError(
      resolved.code,
      resolved.code === "REFERENCE_PACK_SOURCE_PORTRAIT_ANCHOR_FORBIDDEN"
        ? "A raw Character DNA source portrait cannot anchor a Reference Pack."
        : "Create a human-approved identity anchor before building a Reference Pack."
    );
  }
  assertReferencePackAnchorRole(resolved.anchor.semanticRole);
  if (input.anchorAsset.id !== resolved.anchor.assetId) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_ANCHOR_MISMATCH",
      "The anchor asset must be the Character version identity root."
    );
  }
  validateCharacterReferenceAsset({
    asset: input.anchorAsset,
    orgId: input.character.orgId,
    workspaceId: input.character.workspaceId,
    contentHash: resolved.anchor.contentHash,
  });
  const generationInputFingerprint = identityRootFingerprint({
    character: input.character,
    anchor: resolved.anchor,
  });
  const anchorView: AiStoryCharacterReferenceView = {
    viewId: deterministicUuidFromFingerprint(
      "ai-story-character-reference-view",
      sha256CanonicalIntegrityHash({
        reusableCharacterVersionId: input.character.reusableCharacterVersionId,
        role: "ANCHOR",
        assetId: resolved.anchor.assetId,
        contentHash: resolved.anchor.contentHash,
        lineageIndex: 1,
        anchorAssetId: resolved.anchor.assetId,
        anchorContentHash: resolved.anchor.contentHash,
      })
    ),
    role: "ANCHOR",
    assetId: resolved.anchor.assetId,
    contentHash: resolved.anchor.contentHash,
    anchorAssetId: resolved.anchor.assetId,
    anchorContentHash: resolved.anchor.contentHash,
    characterAssetSemantic: resolved.anchor.semanticRole,
    generationInputFingerprint,
    dependsOn: [],
    lineageIndex: 1,
    status: "APPROVED",
    boundAt: input.createdAt,
  };
  return commitPack({
    contractVersion: AI_STORY_CHARACTER_REFERENCE_PACK_CONTRACT_VERSION,
    orgId: input.character.orgId,
    workspaceId: input.character.workspaceId,
    reusableCharacterId: input.character.reusableCharacterId,
    reusableCharacterVersionId: input.character.reusableCharacterVersionId,
    identityFingerprint: input.character.identityFingerprint,
    anchor: resolved.anchor,
    styleSnapshotFingerprint: styleSnapshotFingerprint(input.character.defaultLook),
    characterDescriptionFingerprint: characterDescriptionFingerprint(input.character.identityCore),
    executionStrategy: CHARACTER_REFERENCE_PACK_EXECUTION_STRATEGY,
    views: [anchorView],
    createdAt: input.createdAt,
    createdBy: input.createdBy,
  });
}

export function generationInputFingerprintFor(input: {
  character: AiStoryReusableCharacterVersion;
  pack: AiStoryCharacterReferencePack;
  role: Exclude<AiStoryCharacterReferenceViewRole, "ANCHOR">;
  dependsOn: AiStoryCharacterReferenceView["dependsOn"];
}) {
  const framing = CHARACTER_REFERENCE_VIEW_FRAMING[input.role];
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_CHARACTER_REFERENCE_GENERATION_PACKAGE_CONTRACT_VERSION,
    reusableCharacterVersionId: input.character.reusableCharacterVersionId,
    identityFingerprint: input.character.identityFingerprint,
    anchorAssetId: input.pack.anchor.assetId,
    anchorContentHash: input.pack.anchor.contentHash,
    requestedViewRole: input.role,
    identityCoreFingerprint: sha256CanonicalIntegrityHash(input.character.identityCore),
    defaultLookFingerprint: styleSnapshotFingerprint(input.character.defaultLook),
    mustPreserve: input.character.identityCore.mustPreserve,
    mustNeverChange: input.character.identityCore.mustNeverChange,
    dependsOn: input.dependsOn,
    framing: framing.requirements,
  });
}

export function bindGeneratedCharacterReferenceView(input: {
  pack: AiStoryCharacterReferencePack;
  character: AiStoryReusableCharacterVersion;
  role: Exclude<AiStoryCharacterReferenceViewRole, "ANCHOR">;
  asset: CharacterReferenceAssetEvidence;
  boundAt: string;
}): AiStoryCharacterReferencePack {
  assertSameCharacterAuthority(input.pack, input.character);
  const requestedRole: string = input.role;
  if (requestedRole === "ANCHOR") {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_ANCHOR_NOT_GENERATED",
      "The canonical anchor is the identity root. Derived views are generated from it."
    );
  }
  const sourceId = sourcePortraitAssetId(input.character.canonicalAssets);
  if (sourceId && input.asset.id === sourceId) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_SOURCE_PHOTO_LEAK",
      "A Character DNA source portrait cannot be bound as a reference view."
    );
  }
  validateCharacterReferenceAsset({
    asset: input.asset,
    orgId: input.pack.orgId,
    workspaceId: input.pack.workspaceId,
    contentHash: input.asset.contentHash ?? "",
  });
  const dependsOn = approvedDependencyViews(input.pack, input.role);
  const lineageIndex =
    input.pack.views.filter((view) => view.role === input.role).reduce((max, view) => Math.max(max, view.lineageIndex), 0) +
    1;
  const generationInputFingerprint = generationInputFingerprintFor({
    character: input.character,
    pack: input.pack,
    role: input.role,
    dependsOn,
  });
  const view: AiStoryCharacterReferenceView = {
    viewId: deterministicUuidFromFingerprint(
      "ai-story-character-reference-view",
      sha256CanonicalIntegrityHash({
        reusableCharacterVersionId: input.character.reusableCharacterVersionId,
        role: input.role,
        assetId: input.asset.id,
        contentHash: input.asset.contentHash,
        lineageIndex,
        anchorAssetId: input.pack.anchor.assetId,
        anchorContentHash: input.pack.anchor.contentHash,
      })
    ),
    role: input.role,
    assetId: input.asset.id,
    contentHash: input.asset.contentHash ?? "",
    anchorAssetId: input.pack.anchor.assetId,
    anchorContentHash: input.pack.anchor.contentHash,
    characterAssetSemantic: referenceViewAssetSemantic(input.role),
    generationInputFingerprint,
    dependsOn,
    lineageIndex,
    status: "GENERATED",
    boundAt: input.boundAt,
  };
  return commitPack({ ...input.pack, views: [...input.pack.views, view] });
}

export function reviewCharacterReferenceView(input: {
  pack: AiStoryCharacterReferencePack;
  viewId: string;
  decision: "SUBMIT" | "APPROVE" | "REJECT";
}): AiStoryCharacterReferencePack {
  const view = input.pack.views.find((item) => item.viewId === input.viewId);
  if (!view) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_VIEW_NOT_FOUND",
      "That reference view is not part of this Reference Pack."
    );
  }
  if (view.role === "ANCHOR") {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_ANCHOR_NOT_GENERATED",
      "The canonical anchor is already approved identity authority."
    );
  }
  const nextStatus =
    input.decision === "SUBMIT"
      ? "PENDING_HUMAN_REVIEW"
      : input.decision === "APPROVE"
        ? "APPROVED"
        : "REJECTED";
  const allowedFrom = input.decision === "SUBMIT" ? ["GENERATED"] : ["GENERATED", "PENDING_HUMAN_REVIEW"];
  if (!allowedFrom.includes(view.status)) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_REVIEW_STATE_INVALID",
      "Only a generated candidate can be submitted, approved, or rejected."
    );
  }
  if (input.decision === "APPROVE") {
    approvedDependencyViews(input.pack, view.role);
    const dependencyStillCurrent = view.dependsOn.every((dependency) =>
      input.pack.views.some(
        (item) =>
          item.role === dependency.role &&
          item.assetId === dependency.assetId &&
          item.contentHash === dependency.contentHash &&
          item.status === "APPROVED"
      )
    );
    if (!dependencyStillCurrent) {
      throw new AiStoryCharacterReferencePackError(
        "REFERENCE_PACK_DEPENDENCY_MISSING",
        "A candidate cannot be approved after its dependency was superseded."
      );
    }
  }
  return commitPack({
    ...input.pack,
    views: input.pack.views.map((item) => (item.viewId === view.viewId ? { ...item, status: nextStatus } : item)),
  });
}

export function markReferencePackStaleForAnchorChange(
  pack: AiStoryCharacterReferencePack
): AiStoryCharacterReferencePack {
  return commitPack({ ...pack, views: viewsAfterAnchorChange(pack.views) });
}

export function supersedeCharacterReferenceView(input: {
  pack: AiStoryCharacterReferencePack;
  role: AiStoryCharacterReferenceViewRole;
}): AiStoryCharacterReferencePack {
  if (input.role === "ANCHOR") return markReferencePackStaleForAnchorChange(input.pack);
  return commitPack({ ...input.pack, views: viewsAfterSupersedingRole(input.pack.views, input.role) });
}

function negativeConstraints(identityCore: AiStoryCharacterIdentityCore) {
  return [
    "no text",
    "no watermark",
    "no redesign of face, hair, or body identity",
    "no temporary episode expression",
    "no product placement",
    "no temporary location",
    ...identityCore.mustNeverChange.map((fact) => `do not change: ${fact}`),
  ];
}

export function buildCharacterReferenceGenerationPackage(input: {
  pack: AiStoryCharacterReferencePack;
  character: AiStoryReusableCharacterVersion;
  requestedViewRole: Exclude<AiStoryCharacterReferenceViewRole, "ANCHOR">;
  createdAt: string;
}): AiStoryCharacterReferenceGenerationPackage {
  assertSameCharacterAuthority(input.pack, input.character);
  const dependsOn = approvedDependencyViews(input.pack, input.requestedViewRole);
  const framing = CHARACTER_REFERENCE_VIEW_FRAMING[input.requestedViewRole];
  const generationInputFingerprint = generationInputFingerprintFor({
    character: input.character,
    pack: input.pack,
    role: input.requestedViewRole,
    dependsOn,
  });
  const referenceAssets = [
    {
      role: "ANCHOR" as const,
      assetId: input.pack.anchor.assetId,
      contentHash: input.pack.anchor.contentHash,
      characterAssetSemantic: input.pack.anchor.semanticRole,
    },
    ...dependsOn
      .filter((dependency) => dependency.role !== "ANCHOR")
      .map((dependency) => {
        const view = input.pack.views.find(
          (item) => item.role === dependency.role && item.assetId === dependency.assetId && item.status === "APPROVED"
        );
        return {
          role: dependency.role,
          assetId: dependency.assetId,
          contentHash: dependency.contentHash,
          characterAssetSemantic: view?.characterAssetSemantic ?? dependency.role,
        };
      }),
  ];
  const positiveVisualDirection = [
    framing.summary,
    ...framing.requirements,
    `Canonical default wardrobe: ${input.character.defaultLook.wardrobe}.`,
    input.character.defaultLook.hairstyle ? `Canonical hairstyle: ${input.character.defaultLook.hairstyle}.` : null,
    input.character.identityCore.faceIdentityDescription,
    input.character.identityCore.bodyIdentityDescription,
  ]
    .filter((line): line is string => Boolean(line))
    .join(" ");
  const semantic = {
    contractVersion: AI_STORY_CHARACTER_REFERENCE_GENERATION_PACKAGE_CONTRACT_VERSION,
    executionStrategy: CHARACTER_REFERENCE_PACK_EXECUTION_STRATEGY,
    orgId: input.pack.orgId,
    workspaceId: input.pack.workspaceId,
    reusableCharacterId: input.pack.reusableCharacterId,
    reusableCharacterVersionId: input.pack.reusableCharacterVersionId,
    identityFingerprint: input.pack.identityFingerprint,
    anchorAssetId: input.pack.anchor.assetId,
    anchorContentHash: input.pack.anchor.contentHash,
    requestedViewRole: input.requestedViewRole,
    identityCoreFingerprint: sha256CanonicalIntegrityHash(input.character.identityCore),
    defaultLookFingerprint: styleSnapshotFingerprint(input.character.defaultLook),
    identityCore: input.character.identityCore,
    defaultLook: input.character.defaultLook,
    mustPreserve: [...input.character.identityCore.mustPreserve],
    mustNeverChange: [...input.character.identityCore.mustNeverChange],
    positiveVisualDirection,
    negativeVisualConstraints: negativeConstraints(input.character.identityCore),
    referenceAssets,
    outputRequirements: {
      media: "image" as const,
      recommendedAspect: framing.recommendedAspect,
      orientation: framing.orientation,
      transparentBackgroundOptional: true as const,
      textAllowed: false as const,
      watermarkAllowed: false as const,
    },
    framing: { summary: framing.summary, requirements: [...framing.requirements] },
    generationInputFingerprint,
  };
  const packageFingerprint = sha256CanonicalIntegrityHash(semantic);
  return AiStoryCharacterReferenceGenerationPackageSchema.parse({
    ...semantic,
    packageFingerprint,
    packageId: deterministicUuidFromFingerprint(
      "ai-story-character-reference-generation-package",
      packageFingerprint
    ),
    createdAt: input.createdAt,
  });
}

export function renderManualLocalReferenceHandoff(pkg: AiStoryCharacterReferenceGenerationPackage) {
  const look = [
    `Wardrobe: ${pkg.defaultLook.wardrobe}`,
    pkg.defaultLook.hairstyle ? `Hairstyle: ${pkg.defaultLook.hairstyle}` : null,
    pkg.defaultLook.hairColor ? `Hair color: ${pkg.defaultLook.hairColor}` : null,
    pkg.defaultLook.makeup ? `Makeup: ${pkg.defaultLook.makeup}` : null,
    pkg.defaultLook.accessories ? `Accessories: ${pkg.defaultLook.accessories}` : null,
  ].filter((line): line is string => Boolean(line));
  return [
    "Manual local character reference",
    `Execution: ${pkg.executionStrategy}`,
    `Requested view: ${pkg.requestedViewRole}`,
    `Anchor asset: ${pkg.anchorAssetId}`,
    `Anchor content hash: ${pkg.anchorContentHash}`,
    `Character version: ${pkg.reusableCharacterVersionId}`,
    `Identity fingerprint: ${pkg.identityFingerprint}`,
    "Identity facts:",
    pkg.identityCore.identityDescription,
    pkg.identityCore.faceIdentityDescription,
    pkg.identityCore.bodyIdentityDescription,
    ...pkg.identityCore.distinctiveVisualFacts,
    "Must preserve:",
    ...pkg.mustPreserve,
    "Must never change:",
    ...pkg.mustNeverChange,
    "Default look:",
    ...look,
    "View framing:",
    pkg.framing.summary,
    ...pkg.framing.requirements,
    "Output: image",
    `Recommended aspect: ${pkg.outputRequirements.recommendedAspect}`,
    "Transparent background is optional.",
    "No text. No watermark.",
    "Reference assets:",
    ...pkg.referenceAssets.map((asset) => `${asset.role} ${asset.assetId} ${asset.contentHash}`),
  ].join("\n");
}
