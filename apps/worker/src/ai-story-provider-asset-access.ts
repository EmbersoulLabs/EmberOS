import { and, eq, isNull } from "drizzle-orm";
import {
  type ProductVisualAuthorityCertification,
  type MinimaxAssetAccessResolver,
  type SeedanceAssetAccessResolver,
} from "@ceo-agent/agents";
import { getDb, schema } from "@ceo-agent/db";
import { createSignedStorageReadUrl } from "./storage";

type ProviderAssetAccessInput = Parameters<
  SeedanceAssetAccessResolver["resolveProviderAccessibleUri"]
>[0];

type AuthorizedAsset = {
  readonly storagePath: string;
  readonly mimeType: string | null;
};

export type WorkerProviderAssetAccessDependencies = {
  readonly loadAuthorizedAsset?: (
    input: ProviderAssetAccessInput
  ) => Promise<AuthorizedAsset | null>;
  readonly mintSignedUrl?: (storagePath: string) => Promise<string>;
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

/**
 * Resolve a stable Campaign Asset ID to a provider-readable URL just in time.
 * Authorization is proved from server-owned DB fields; caller paths and URLs are not authority.
 */
export function createWorkerProviderAssetAccessResolver(
  deps: WorkerProviderAssetAccessDependencies = {}
): SeedanceAssetAccessResolver & MinimaxAssetAccessResolver {
  const load = deps.loadAuthorizedAsset ?? loadAuthorizedAsset;
  const mint = deps.mintSignedUrl ?? createSignedStorageReadUrl;
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
      const signedUrl = await mint(asset.storagePath);
      if (!/^https:\/\//i.test(signedUrl)) {
        throw new Error("Provider asset resolver returned an invalid URL");
      }
      return signedUrl;
    },
  };
}
