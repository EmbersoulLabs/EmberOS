import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  type ProductVisualAuthorityCertification,
  type MinimaxAssetAccessResolver,
  type SeedanceAssetAccessResolver,
} from "@ceo-agent/agents";
import { getDb, schema } from "@ceo-agent/db";
import { resolveCurrentFrozenCanonicalSceneSet } from "@ceo-agent/db";
import { AiStoryAuthoritativeSceneProductBindingSchema } from "@ceo-agent/shared";
import { verifyProductVisualMaterialSelectionAuthority } from "@ceo-agent/shared/server";
import { createSignedStorageReadUrl, downloadStorageBytes } from "./storage";

type ProviderAssetAccessInput = Parameters<
  SeedanceAssetAccessResolver["resolveProviderAccessibleUri"]
>[0];

type AuthorizedAsset = {
  readonly storagePath: string;
  readonly mimeType: string | null;
  readonly contentHash?: string | null;
};

export class ProductMaterialPreDispatchAuthorityError extends Error {
  readonly code = "PRODUCT_MATERIAL_AUTHORITY_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "ProductMaterialPreDispatchAuthorityError";
  }
}

export type WorkerProviderAssetAccessDependencies = {
  readonly loadAuthorizedAsset?: (
    input: ProviderAssetAccessInput
  ) => Promise<AuthorizedAsset | null>;
  readonly mintSignedUrl?: (storagePath: string) => Promise<string>;
  readonly readPrivateBytes?: (storagePath: string) => Promise<Buffer>;
  readonly verifyCurrentSelection?: (input: ProviderAssetAccessInput) => Promise<boolean>;
};

export type ProductVisualAuthorityCertificationInput = {
  readonly productAssetId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
};

type VisualAuthorityRow = {
  readonly assetId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storagePath: string;
  readonly mimeType: string | null;
};

type CanonicalCampaignAssetAuthorityInput = {
  readonly assetId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
};

/**
 * Resolve Campaign membership from the canonical many-to-many authority. The
 * nullable assets.campaign_id column records legacy upload origin and is not a
 * current Campaign authorization boundary.
 */
export async function loadCanonicalCampaignAssetAuthority(
  input: CanonicalCampaignAssetAuthorityInput
): Promise<VisualAuthorityRow | null> {
  const [row] = await getDb()
    .select({
      assetId: schema.assets.id,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
      campaignId: schema.campaignAssetRefs.campaignId,
      storagePath: schema.assets.storagePath,
      mimeType: schema.assets.mimeType,
      contentHash: schema.assets.contentHash,
    })
    .from(schema.assets)
    .innerJoin(
      schema.campaignAssetRefs,
      and(
        eq(schema.campaignAssetRefs.assetId, schema.assets.id),
        eq(schema.campaignAssetRefs.campaignId, input.campaignId)
      )
    )
    .innerJoin(
      schema.campaigns,
      and(
        eq(schema.campaigns.id, schema.campaignAssetRefs.campaignId),
        eq(schema.campaigns.orgId, input.orgId),
        eq(schema.campaigns.workspaceId, input.workspaceId)
      )
    )
    .where(
      and(
        eq(schema.assets.id, input.assetId),
        eq(schema.assets.orgId, input.orgId),
        eq(schema.assets.workspaceId, input.workspaceId),
        eq(schema.assets.status, "ready"),
        isNull(schema.assets.deletedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

async function loadVisualAuthorityRow(
  input: ProductVisualAuthorityCertificationInput
): Promise<VisualAuthorityRow | null> {
  return loadCanonicalCampaignAssetAuthority({
    assetId: input.productAssetId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
  });
}

/**
 * Certify stable visual authority from live server-owned rows. A prior Scene ID
 * is continuity metadata only here: no prior Scene media is promoted into the
 * Provider request, so it cannot override or conflict with Image 1 authority.
 */
export function createWorkerProductVisualAuthorityCertifier(
  deps: {
    readonly load?: (
      input: ProductVisualAuthorityCertificationInput
    ) => Promise<VisualAuthorityRow | null>;
  } = {}
) {
  const load = deps.load ?? loadVisualAuthorityRow;
  return async function certifyWorkerProductVisualAuthority(
    input: ProductVisualAuthorityCertificationInput
  ): Promise<ProductVisualAuthorityCertification> {
    const row = await load(input);
    if (
      !row ||
      !row.storagePath.trim() ||
      !row.mimeType?.toLowerCase().startsWith("image/")
    ) {
      throw new Error(
        "Canonical Campaign Product Asset visual authority is not certifiable"
      );
    }
    return {
      contractVersion: "1",
      certificationSource: "SERVER_AUTHORITY",
      status: "CERTIFIED",
      productAssetId: row.assetId,
      orgId: row.orgId,
      workspaceId: row.workspaceId,
      campaignId: row.campaignId,
      executionPlanId: input.executionPlanId,
      sceneExecutionId: input.sceneExecutionId,
      assetExists: true,
      ownershipBound: true,
      campaignProductBinding: true,
      providerAccessibleFirstFrame: true,
      authorityConflictAbsent: true,
      previousSceneVisualAuthorityUsed: false,
    };
  };
}

export const certifyWorkerProductVisualAuthority =
  createWorkerProductVisualAuthorityCertifier();

async function loadAuthorizedAsset(
  input: ProviderAssetAccessInput
): Promise<AuthorizedAsset | null> {
  return loadCanonicalCampaignAssetAuthority(input);
}

/** Recheck current Scene, Story Product source, and exact derivative lineage at dispatch time. */
async function verifyCurrentProductSelection(input: ProviderAssetAccessInput): Promise<boolean> {
  const selection = input.productMaterialSelection;
  const selected = selection?.selectedMaterial;
  if (!selection || !selected || selected.assetId !== input.assetId ||
    selection.selection !== selected.kind ||
    selection.orgId !== input.orgId || selection.workspaceId !== input.workspaceId ||
    selection.campaignId !== input.campaignId ||
    !verifyProductVisualMaterialSelectionAuthority(selection, selection)) return false;
  const db = getDb();
  const scenes = await resolveCurrentFrozenCanonicalSceneSet(db, selection);
  const scene = scenes?.find((candidate) => candidate.sceneId === selection.sceneId);
  const exactBindings = scene?.productBindings.filter((candidate) => {
    const parsed = AiStoryAuthoritativeSceneProductBindingSchema.safeParse(candidate);
    const binding = parsed.success ? parsed.data : null;
    return binding?.productAuthorityId === selection.productAuthority.productAuthorityId &&
      binding.sourceAssetId === selection.productAuthority.sourceAssetId &&
      binding.sourceAssetContentHash === selection.productAuthority.sourceAssetContentHash &&
      binding.visualIdentityRequirement === selection.visualRequirement.sceneRequirement;
  }) ?? [];
  if (!scene || scene.sceneVersionId !== selection.sceneVersionId ||
    exactBindings.length !== 1 || scene.productBindings.length !== 1) return false;
  const [story, sourceLink, sourceCampaignLink, sourceAsset] = await Promise.all([
    db.select({ currentVersionId: schema.aiStories.currentVersionId }).from(schema.aiStories)
      .where(and(eq(schema.aiStories.id, selection.storyId), eq(schema.aiStories.orgId, selection.orgId),
        eq(schema.aiStories.workspaceId, selection.workspaceId), eq(schema.aiStories.campaignId, selection.campaignId))).limit(1),
    db.select({ assetId: schema.aiStoryAssetLinks.assetId }).from(schema.aiStoryAssetLinks)
      .where(and(eq(schema.aiStoryAssetLinks.storyId, selection.storyId),
        eq(schema.aiStoryAssetLinks.assetId, selection.productAuthority.sourceAssetId),
        eq(schema.aiStoryAssetLinks.usageType, "product_source"))).limit(1),
    db.select({ assetId: schema.campaignAssetRefs.assetId }).from(schema.campaignAssetRefs)
      .where(and(eq(schema.campaignAssetRefs.campaignId, selection.campaignId),
        eq(schema.campaignAssetRefs.assetId, selection.productAuthority.sourceAssetId))).limit(1),
    db.select({ contentHash: schema.assets.contentHash, status: schema.assets.status,
      deletedAt: schema.assets.deletedAt, storagePath: schema.assets.storagePath })
      .from(schema.assets).where(and(eq(schema.assets.id, selection.productAuthority.sourceAssetId),
        eq(schema.assets.orgId, selection.orgId), eq(schema.assets.workspaceId, selection.workspaceId))).limit(1),
  ]);
  if (story[0]?.currentVersionId !== selection.storyVersionId || !sourceLink[0] || !sourceCampaignLink[0] ||
    sourceAsset[0]?.contentHash !== selection.productAuthority.sourceAssetContentHash ||
    sourceAsset[0]?.status !== "ready" || sourceAsset[0]?.deletedAt ||
    !sourceAsset[0]?.storagePath || /^https?:\/\//i.test(sourceAsset[0].storagePath)) return false;
  const sourceBytes = await downloadStorageBytes(sourceAsset[0].storagePath);
  if (`sha256:${createHash("sha256").update(sourceBytes).digest("hex")}` !==
    selection.productAuthority.sourceAssetContentHash) return false;
  if (selected.kind === "EXTRACTED_DERIVATIVE") {
    const [generation] = await db.select().from(schema.photoSceneGenerations).where(and(
      eq(schema.photoSceneGenerations.id, selected.generationId),
      eq(schema.photoSceneGenerations.orgId, selection.orgId),
      eq(schema.photoSceneGenerations.workspaceId, selection.workspaceId),
      eq(schema.photoSceneGenerations.campaignId, selection.campaignId),
      eq(schema.photoSceneGenerations.sourceAssetId, selection.productAuthority.sourceAssetId),
      eq(schema.photoSceneGenerations.sourceContentHash, selection.productAuthority.sourceAssetContentHash),
      eq(schema.photoSceneGenerations.outputAssetId, selected.assetId),
      eq(schema.photoSceneGenerations.inputFingerprint, selected.generationFingerprint),
      eq(schema.photoSceneGenerations.status, "ready"),
    )).limit(1);
    if (!generation || generation.operation !== "product_extraction") return false;
  }
  return true;
}

/**
 * Resolve a stable Campaign Asset ID to a provider-readable URL just in time.
 * Authorization is proved from server-owned DB fields; caller paths and URLs are not authority.
 */
export function createWorkerProviderAssetAccessResolver(
  deps: WorkerProviderAssetAccessDependencies = {}
): SeedanceAssetAccessResolver & MinimaxAssetAccessResolver {
  const load = deps.loadAuthorizedAsset ?? loadAuthorizedAsset;
  const mint = deps.mintSignedUrl ?? createSignedStorageReadUrl;
  const readBytes = deps.readPrivateBytes ?? downloadStorageBytes;
  const verifyCurrent = deps.verifyCurrentSelection ?? verifyCurrentProductSelection;
  return {
    async resolveProviderAccessibleUri(input): Promise<string> {
      const asset = await load(input);
      if (!asset) {
        throw new Error("Campaign Asset is not authorized for this execution envelope");
      }
      if (!asset.mimeType?.toLowerCase().startsWith("image/")) {
        throw new Error("Campaign Asset is not a supported visual reference");
      }
      if (input.storagePath && input.storagePath !== asset.storagePath) {
        throw new Error("Campaign Asset storage identity mismatch");
      }
      if ("productMaterialSelection" in input && input.productMaterialSelection) {
        const selected = input.productMaterialSelection.selectedMaterial;
        if (!selected || asset.contentHash !== selected.contentHash ||
          !asset.storagePath || /^https?:\/\//i.test(asset.storagePath) ||
          !(await verifyCurrent(input))) {
          throw new ProductMaterialPreDispatchAuthorityError("Current canonical Scene Product material authority is invalid");
        }
        const bytes = await readBytes(asset.storagePath);
        const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        if (actualHash !== selected.contentHash) {
          throw new ProductMaterialPreDispatchAuthorityError("Private Product material content hash changed");
        }
      }
      const signedUrl = await mint(asset.storagePath);
      if (!/^https:\/\//i.test(signedUrl)) {
        throw new Error("Provider asset resolver returned an invalid URL");
      }
      return signedUrl;
    },
  };
}
