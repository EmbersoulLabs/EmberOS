import { z } from "zod";
import {
  AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES,
  type AiStoryCharacterEpisodeLook,
  type AiStoryReusableCharacterCanonicalAsset,
  type AiStoryReusableCharacterVersion,
} from "./ai-story-reusable-character";
import { HYBRID_CHARACTER_CONSISTENCY_MODE } from "./ai-story-character-dna";

export const AI_STORY_CHARACTER_REFERENCE_PACK_CONTRACT_VERSION =
  "ai-story-character-reference-pack.v1" as const;
export const AI_STORY_CHARACTER_REFERENCE_GENERATION_PACKAGE_CONTRACT_VERSION =
  "ai-story-character-reference-generation-package.v1" as const;
export const CHARACTER_REFERENCE_PACK_EXECUTION_STRATEGY =
  "MANUAL_LOCAL_REFERENCE_GENERATION" as const;
export const REFERENCE_PACK_ANCHOR_REQUIRED = "REFERENCE_PACK_ANCHOR_REQUIRED" as const;
export const CHARACTER_REFERENCE_PACK_PROVIDER_IMAGE_CALLS = "NONE" as const;
export const CHARACTER_REFERENCE_PACK_PAID_IMAGE_GENERATION = "NONE" as const;

export const AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES = [
  "ANCHOR",
  "FACE_FRONT",
  "THREE_QUARTER",
  "PROFILE_90",
  "FULL_BODY_FRONT",
  "FULL_BODY_BACK",
  "DETAIL_HAIR",
  "DETAIL_FACE",
  "DETAIL_WARDROBE",
] as const;
export const CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS = [
  "ANCHOR",
  "FACE_FRONT",
  "PROFILE_90",
  "FULL_BODY_BACK",
] as const;
export const CHARACTER_REFERENCE_PACK_OPTIONAL_VIEWS = [
  "THREE_QUARTER",
  "FULL_BODY_FRONT",
  "DETAIL_HAIR",
  "DETAIL_FACE",
  "DETAIL_WARDROBE",
] as const;
export const CHARACTER_REFERENCE_SELECTION_ORDER = [
  ...CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS,
  ...CHARACTER_REFERENCE_PACK_OPTIONAL_VIEWS,
] as const;
export const AI_STORY_CHARACTER_REFERENCE_VIEW_STATUSES = [
  "GENERATED",
  "PENDING_HUMAN_REVIEW",
  "APPROVED",
  "REJECTED",
  "STALE",
] as const;
export const CHARACTER_REFERENCE_PACK_ANCHOR_SEMANTIC_ROLES = [
  "IDENTITY_MASTER",
  "SYNTHETIC_IDENTITY_ANCHOR",
] as const;
export const CHARACTER_REFERENCE_VIEW_DEPENDENCIES = {
  ANCHOR: [],
  FACE_FRONT: ["ANCHOR"],
  THREE_QUARTER: ["ANCHOR"],
  PROFILE_90: ["ANCHOR"],
  FULL_BODY_FRONT: ["ANCHOR"],
  FULL_BODY_BACK: ["ANCHOR"],
  DETAIL_HAIR: ["ANCHOR", "FACE_FRONT"],
  DETAIL_FACE: ["ANCHOR", "FACE_FRONT"],
  DETAIL_WARDROBE: ["ANCHOR", "FULL_BODY_FRONT"],
} as const satisfies Record<
  (typeof AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES)[number],
  readonly (typeof AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES)[number][]
>;

const VIEW_ASSET_SEMANTICS = {
  FACE_FRONT: "FRONT_PORTRAIT",
  THREE_QUARTER: "THREE_QUARTER",
  PROFILE_90: "PROFILE",
  FULL_BODY_FRONT: "FULL_BODY",
  FULL_BODY_BACK: "FULL_BODY_BACK",
  DETAIL_HAIR: "DETAIL_REFERENCE",
  DETAIL_FACE: "DETAIL_REFERENCE",
  DETAIL_WARDROBE: "DETAIL_REFERENCE",
} as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

export const AiStoryCharacterReferenceDependencySchema = z
  .object({
    role: z.enum(AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES),
    assetId: Id,
    contentHash: Hash,
  })
  .strict();

export const AiStoryCharacterReferenceViewSchema = z
  .object({
    viewId: Id,
    role: z.enum(AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES),
    assetId: Id,
    contentHash: Hash,
    anchorAssetId: Id,
    anchorContentHash: Hash,
    characterAssetSemantic: z.enum(AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES),
    generationInputFingerprint: Hash,
    dependsOn: z.array(AiStoryCharacterReferenceDependencySchema),
    lineageIndex: z.number().int().positive(),
    status: z.enum(AI_STORY_CHARACTER_REFERENCE_VIEW_STATUSES),
    boundAt: z.string().datetime(),
  })
  .strict();

export const AiStoryCharacterReferencePackSchema = z
  .object({
    contractVersion: z.literal(AI_STORY_CHARACTER_REFERENCE_PACK_CONTRACT_VERSION),
    referencePackId: Id,
    orgId: Id,
    workspaceId: Id,
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    identityFingerprint: Hash,
    anchor: z
      .object({
        assetId: Id,
        contentHash: Hash,
        semanticRole: z.enum(CHARACTER_REFERENCE_PACK_ANCHOR_SEMANTIC_ROLES),
      })
      .strict(),
    styleSnapshotFingerprint: Hash,
    characterDescriptionFingerprint: Hash,
    executionStrategy: z.literal(CHARACTER_REFERENCE_PACK_EXECUTION_STRATEGY),
    views: z.array(AiStoryCharacterReferenceViewSchema),
    packFingerprint: Hash,
    createdAt: z.string().datetime(),
    createdBy: Id,
  })
  .strict()
  .superRefine((pack, ctx) => {
    const viewIds = new Set<string>();
    for (const view of pack.views) {
      if (viewIds.has(view.viewId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reference view ids must be unique" });
      }
      viewIds.add(view.viewId);
      if (view.anchorAssetId !== pack.anchor.assetId || view.anchorContentHash !== pack.anchor.contentHash) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Every reference view must trace to the pack anchor",
        });
      }
      if (view.characterAssetSemantic === "CHARACTER_SOURCE_PORTRAIT") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A source portrait cannot be a reference pack view",
        });
      }
    }
  });

export const CharacterReferenceSelectionSchema = z
  .object({
    referencePackId: Id,
    packFingerprint: Hash,
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    identityFingerprint: Hash,
    anchorAssetId: Id,
    anchorContentHash: Hash,
    maxReferenceCount: z.number().int().nonnegative(),
    refs: z
      .array(
        z
          .object({
            role: z.enum(AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES),
            assetId: Id,
            contentHash: Hash,
            characterAssetSemantic: z.enum(AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES),
            lineageIndex: z.number().int().positive(),
          })
          .strict()
      )
      .max(CHARACTER_REFERENCE_SELECTION_ORDER.length),
  })
  .strict();

export type AiStoryCharacterReferenceViewRole = (typeof AI_STORY_CHARACTER_REFERENCE_VIEW_ROLES)[number];
export type AiStoryCharacterReferenceViewStatus = (typeof AI_STORY_CHARACTER_REFERENCE_VIEW_STATUSES)[number];
export type AiStoryCharacterReferenceView = z.infer<typeof AiStoryCharacterReferenceViewSchema>;
export type AiStoryCharacterReferencePack = z.infer<typeof AiStoryCharacterReferencePackSchema>;
export type CharacterReferenceSelection = z.infer<typeof CharacterReferenceSelectionSchema>;
export type CharacterReferencePackAnchor = AiStoryCharacterReferencePack["anchor"];

export class AiStoryCharacterReferencePackError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiStoryCharacterReferencePackError";
  }
}

export type CharacterReferenceAssetEvidence = {
  id: string;
  orgId: string;
  workspaceId: string;
  type: string;
  mimeType: string | null;
  status: string;
  contentHash: string | null;
  storagePath: string;
  deletedAt: string | null;
};

const EPISODE_PRESENTATION_FIELDS = ["expression", "pose", "location", "action", "product", "dialogue"] as const;

export function referenceViewAssetSemantic(
  role: Exclude<AiStoryCharacterReferenceViewRole, "ANCHOR">
): (typeof AI_STORY_REUSABLE_CHARACTER_ASSET_ROLES)[number] {
  return VIEW_ASSET_SEMANTICS[role];
}

export function assertReferencePackAnchorRole(role: string) {
  if (role === "CHARACTER_SOURCE_PORTRAIT") {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_SOURCE_PORTRAIT_ANCHOR_FORBIDDEN",
      "A raw Character DNA source portrait cannot anchor a Reference Pack."
    );
  }
  if (
    role !== "IDENTITY_MASTER" &&
    role !== "SYNTHETIC_IDENTITY_ANCHOR"
  ) {
    throw new AiStoryCharacterReferencePackError(
      REFERENCE_PACK_ANCHOR_REQUIRED,
      "A Reference Pack requires IDENTITY_MASTER or SYNTHETIC_IDENTITY_ANCHOR."
    );
  }
  return role;
}

export function resolveCharacterReferencePackAnchor(
  character: Pick<
    AiStoryReusableCharacterVersion,
    "identityMode" | "characterConsistencyMode" | "canonicalAssets"
  >
): { ok: true; anchor: CharacterReferencePackAnchor } | { ok: false; code: typeof REFERENCE_PACK_ANCHOR_REQUIRED | "REFERENCE_PACK_SOURCE_PORTRAIT_ANCHOR_FORBIDDEN" } {
  const source = character.canonicalAssets.find((asset) => asset.role === "CHARACTER_SOURCE_PORTRAIT");
  const master = character.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER");
  const synthetic = character.canonicalAssets.find((asset) => asset.role === "SYNTHETIC_IDENTITY_ANCHOR");
  if (character.identityMode === "CHARACTER_DNA") {
    const hybrid =
      character.characterConsistencyMode === HYBRID_CHARACTER_CONSISTENCY_MODE || Boolean(synthetic);
    if (!hybrid || !synthetic) {
      return { ok: false, code: REFERENCE_PACK_ANCHOR_REQUIRED };
    }
    if (source && synthetic.assetId === source.assetId) {
      return { ok: false, code: "REFERENCE_PACK_SOURCE_PORTRAIT_ANCHOR_FORBIDDEN" };
    }
    return {
      ok: true,
      anchor: {
        assetId: synthetic.assetId,
        contentHash: synthetic.contentHash,
        semanticRole: "SYNTHETIC_IDENTITY_ANCHOR",
      },
    };
  }
  if (!master) {
    return source
      ? { ok: false, code: "REFERENCE_PACK_SOURCE_PORTRAIT_ANCHOR_FORBIDDEN" }
      : { ok: false, code: REFERENCE_PACK_ANCHOR_REQUIRED };
  }
  if (source && master.assetId === source.assetId) {
    return { ok: false, code: "REFERENCE_PACK_SOURCE_PORTRAIT_ANCHOR_FORBIDDEN" };
  }
  return {
    ok: true,
    anchor: {
      assetId: master.assetId,
      contentHash: master.contentHash,
      semanticRole: "IDENTITY_MASTER",
    },
  };
}

export function validateCharacterReferenceAsset(input: {
  asset: CharacterReferenceAssetEvidence;
  orgId: string;
  workspaceId: string;
  contentHash: string;
}) {
  const { asset } = input;
  if (asset.deletedAt) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_ASSET_DELETED",
      "Deleted assets cannot become Character references."
    );
  }
  if (asset.workspaceId !== input.workspaceId) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_CROSS_WORKSPACE",
      "Reference assets must belong to the Character workspace."
    );
  }
  if (asset.orgId !== input.orgId) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_CROSS_ORG",
      "Reference assets must belong to the Character organization."
    );
  }
  if (asset.type !== "image" || !asset.mimeType?.toLowerCase().startsWith("image/")) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_ASSET_NOT_IMAGE",
      "Character reference views require an image asset."
    );
  }
  if (asset.status !== "ready") {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_ASSET_NOT_READY",
      "Character reference views require a ready asset."
    );
  }
  if (!asset.contentHash || asset.contentHash !== input.contentHash) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_CONTENT_HASH_MISMATCH",
      "Reference asset content hash does not match the requested image."
    );
  }
  const prefix = `${input.workspaceId}/`;
  if (!asset.storagePath.startsWith(prefix) || asset.storagePath.includes("..")) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_STORAGE_PATH_INVALID",
      "Reference asset storage must stay inside the Character workspace."
    );
  }
}

export function referenceViewConsumable(view: Pick<AiStoryCharacterReferenceView, "status" | "characterAssetSemantic">) {
  return view.status === "APPROVED" && view.characterAssetSemantic !== "CHARACTER_SOURCE_PORTRAIT";
}

export function currentApprovedReferenceViews(pack: AiStoryCharacterReferencePack) {
  const byRole = new Map<AiStoryCharacterReferenceViewRole, AiStoryCharacterReferenceView>();
  for (const view of pack.views) {
    if (!referenceViewConsumable(view)) continue;
    const existing = byRole.get(view.role);
    if (!existing || view.lineageIndex > existing.lineageIndex) byRole.set(view.role, view);
  }
  return CHARACTER_REFERENCE_SELECTION_ORDER.flatMap((role) => {
    const view = byRole.get(role);
    return view ? [view] : [];
  });
}

export function selectCharacterReferences(input: {
  pack: AiStoryCharacterReferencePack;
  reusableCharacterVersionId: string;
  identityFingerprint: string;
  maxReferenceCount: number;
  anchorContentHash?: string;
}): CharacterReferenceSelection {
  if (input.reusableCharacterVersionId !== input.pack.reusableCharacterVersionId) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_CHARACTER_VERSION_MISMATCH",
      "A Reference Pack can be consumed only for its pinned Character version."
    );
  }
  if (input.identityFingerprint !== input.pack.identityFingerprint) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_IDENTITY_FINGERPRINT_MISMATCH",
      "A Reference Pack cannot move onto a different identity fingerprint."
    );
  }
  if (input.anchorContentHash && input.anchorContentHash !== input.pack.anchor.contentHash) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_ANCHOR_MISMATCH",
      "Derived references from a previous anchor cannot be consumed for a new anchor."
    );
  }
  if (!Number.isInteger(input.maxReferenceCount) || input.maxReferenceCount < 0) {
    throw new AiStoryCharacterReferencePackError(
      "REFERENCE_PACK_REFERENCE_BUDGET_INVALID",
      "Reference selection requires a non-negative reference budget."
    );
  }
  const refs = currentApprovedReferenceViews(input.pack)
    .slice(0, input.maxReferenceCount)
    .map((view) => ({
      role: view.role,
      assetId: view.assetId,
      contentHash: view.contentHash,
      characterAssetSemantic: view.characterAssetSemantic,
      lineageIndex: view.lineageIndex,
    }));
  return CharacterReferenceSelectionSchema.parse({
    referencePackId: input.pack.referencePackId,
    packFingerprint: input.pack.packFingerprint,
    reusableCharacterId: input.pack.reusableCharacterId,
    reusableCharacterVersionId: input.pack.reusableCharacterVersionId,
    identityFingerprint: input.pack.identityFingerprint,
    anchorAssetId: input.pack.anchor.assetId,
    anchorContentHash: input.pack.anchor.contentHash,
    maxReferenceCount: input.maxReferenceCount,
    refs,
  });
}

export function referencePackAppliesToCharacterVersion(
  pack: AiStoryCharacterReferencePack,
  character: Pick<AiStoryReusableCharacterVersion, "reusableCharacterId" | "reusableCharacterVersionId" | "identityFingerprint">
) {
  return (
    pack.reusableCharacterId === character.reusableCharacterId &&
    pack.reusableCharacterVersionId === character.reusableCharacterVersionId &&
    pack.identityFingerprint === character.identityFingerprint
  );
}

export function characterReferencePackMeetsMinimum(pack: AiStoryCharacterReferencePack) {
  const approved = new Set(currentApprovedReferenceViews(pack).map((view) => view.role));
  return CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS.every((role) => approved.has(role));
}

export function approvedDependencyViews(
  pack: AiStoryCharacterReferencePack,
  role: AiStoryCharacterReferenceViewRole
) {
  const required = CHARACTER_REFERENCE_VIEW_DEPENDENCIES[role];
  const current = new Map(currentApprovedReferenceViews(pack).map((view) => [view.role, view]));
  const resolved = [];
  for (const dependency of required) {
    const view = current.get(dependency);
    if (!view) {
      throw new AiStoryCharacterReferencePackError(
        "REFERENCE_PACK_DEPENDENCY_MISSING",
        `Reference view ${role} requires an approved ${dependency} from this anchor.`
      );
    }
    resolved.push({ role: view.role, assetId: view.assetId, contentHash: view.contentHash });
  }
  return resolved;
}

export function viewsAfterAnchorChange(views: readonly AiStoryCharacterReferenceView[]) {
  return views.map((view) => {
    if (view.role === "ANCHOR" || view.status === "REJECTED" || view.status === "STALE") return view;
    return { ...view, status: "STALE" as const };
  });
}

export function viewsAfterSupersedingRole(
  views: readonly AiStoryCharacterReferenceView[],
  role: AiStoryCharacterReferenceViewRole
) {
  const supersededAssets = new Set(
    views.filter((view) => view.role === role && view.status === "APPROVED").map((view) => view.assetId)
  );
  return views.map((view) => {
    if (view.role === role && view.status === "APPROVED") return { ...view, status: "STALE" as const };
    const dependsOnSuperseded = view.dependsOn.some(
      (dependency) => dependency.role === role && supersededAssets.has(dependency.assetId)
    );
    if (!dependsOnSuperseded || view.status === "REJECTED" || view.status === "STALE") return view;
    return { ...view, status: "STALE" as const };
  });
}

export function sourcePortraitAssetId(
  assets: readonly Pick<AiStoryReusableCharacterCanonicalAsset, "assetId" | "role">[]
) {
  return assets.find((asset) => asset.role === "CHARACTER_SOURCE_PORTRAIT")?.assetId ?? null;
}

export function episodePresentationLeakedIntoReferenceIdentity(input: {
  identityCore: AiStoryReusableCharacterVersion["identityCore"];
  defaultLook: AiStoryReusableCharacterVersion["defaultLook"];
  text: string;
  episodeLook: AiStoryCharacterEpisodeLook;
}) {
  const identityText = JSON.stringify({ identityCore: input.identityCore, defaultLook: input.defaultLook });
  return EPISODE_PRESENTATION_FIELDS.filter((field) => {
    const value = input.episodeLook[field];
    return Boolean(value && !identityText.includes(value) && input.text.includes(value));
  });
}

export function buildCharacterReferenceAssetMetadata(input: {
  pack: AiStoryCharacterReferencePack;
  view: AiStoryCharacterReferenceView;
}) {
  return {
    characterAssetSemantic: input.view.characterAssetSemantic,
    reusableCharacterId: input.pack.reusableCharacterId,
    reusableCharacterVersionId: input.pack.reusableCharacterVersionId,
    referencePackId: input.pack.referencePackId,
    referenceViewRole: input.view.role,
    anchorAssetId: input.view.anchorAssetId,
    anchorContentHash: input.view.anchorContentHash,
    humanApproved: input.view.status === "APPROVED",
    generationInputFingerprint: input.view.generationInputFingerprint,
  };
}

export type CharacterReferencePackSurfaceView = {
  viewId: string;
  role: AiStoryCharacterReferenceViewRole;
  status: AiStoryCharacterReferenceViewStatus;
  assetId: string;
  contentHash: string;
  lineageIndex: number;
  current: boolean;
};

export function summarizeCharacterReferencePackSurface(input: {
  character: Pick<
    AiStoryReusableCharacterVersion,
    | "identityMode"
    | "characterConsistencyMode"
    | "canonicalAssets"
    | "reusableCharacterId"
    | "reusableCharacterVersionId"
    | "identityFingerprint"
  >;
  pack?: AiStoryCharacterReferencePack | null;
}) {
  const resolved = resolveCharacterReferencePackAnchor(input.character);
  const pack = input.pack ?? null;
  const currentIds = new Set(
    pack ? currentApprovedReferenceViews(pack).map((view) => view.viewId) : []
  );
  const summarize = (status: AiStoryCharacterReferenceViewStatus): CharacterReferencePackSurfaceView[] =>
    (pack?.views ?? [])
      .filter((view) => view.status === status)
      .map((view) => ({
        viewId: view.viewId,
        role: view.role,
        status: view.status,
        assetId: view.assetId,
        contentHash: view.contentHash,
        lineageIndex: view.lineageIndex,
        current: currentIds.has(view.viewId),
      }));
  const pending = [
    ...summarize("GENERATED"),
    ...summarize("PENDING_HUMAN_REVIEW"),
  ];
  return {
    reusableCharacterId: input.character.reusableCharacterId,
    reusableCharacterVersionId: input.character.reusableCharacterVersionId,
    identityFingerprint: input.character.identityFingerprint,
    anchor: resolved.ok
      ? {
          ...resolved.anchor,
          label: resolved.anchor.semanticRole === "IDENTITY_MASTER" ? "Identity Master" : "Synthetic identity anchor",
        }
      : null,
    anchorBlockCode: resolved.ok ? null : resolved.code,
    sourcePortraitAssetId: sourcePortraitAssetId(input.character.canonicalAssets),
    sourcePortraitIsAnchor: false as const,
    packBound: Boolean(pack),
    requiredViews: CHARACTER_REFERENCE_PACK_REQUIRED_VIEWS,
    optionalViews: CHARACTER_REFERENCE_PACK_OPTIONAL_VIEWS,
    approved: summarize("APPROVED"),
    pending,
    stale: summarize("STALE"),
    rejected: summarize("REJECTED"),
  };
}
