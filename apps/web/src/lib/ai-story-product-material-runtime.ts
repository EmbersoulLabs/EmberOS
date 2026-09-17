import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, resolveCurrentFrozenCanonicalSceneSet, schema } from "@ceo-agent/db";
import {
  AiStoryAuthoritativeSceneProductBindingSchema,
  freezePhotoSceneExtractionInput,
  resolveExplicitAiStorySceneGenerationAuthority,
  type AiStoryEffectiveSceneGenerationAuthority,
  type ProductVisualMaterialSelectionAuthority,
} from "@ceo-agent/shared";
import { deriveProductVisualMaterialSelectionAuthority, sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveStoryProductBackgroundSuitability } from "@/lib/ai-story-product-background-suitability";
import { resolveExactStoryProductDerivative } from "@/lib/ai-story-exact-product-derivative";
import { resolveCurrentSceneProductAuthority } from "@/lib/ai-story-resolved-product-authority";

export class AiStoryProductMaterialRuntimeError extends Error {
  constructor(
    readonly code:
      | "PRODUCT_MATERIAL_AUTHORITY_INVALID"
      | "PRODUCT_MATERIAL_PREPARATION_REQUIRED"
      | "PRODUCT_MATERIAL_UNUSABLE",
    message: string,
  ) {
    super(message);
    this.name = "AiStoryProductMaterialRuntimeError";
  }
}

/**
 * Read-only, just-in-time bridge from the exact current FROZEN Scene Product
 * binding to the existing canonical material-selection policy. It never starts
 * extraction, creates an Asset, signs a URL, or selects a generation mode.
 */
export async function resolveCurrentSceneProductMaterialForScheduling(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  sceneId: string;
  sceneVersionId: string;
  actorUserId: string;
  generationAuthority: AiStoryEffectiveSceneGenerationAuthority;
}): Promise<ProductVisualMaterialSelectionAuthority> {
  const db = getDb();
  const scenes = await resolveCurrentFrozenCanonicalSceneSet(db, input);
  const scene = scenes?.find((candidate) => candidate.sceneId === input.sceneId);
  if (
    !scene || scene.sceneVersionId !== input.sceneVersionId ||
    scene.storyVersionId !== input.storyVersionId || scene.status !== "FROZEN" ||
    scene.productBindings.length !== 1
  ) {
    throw new AiStoryProductMaterialRuntimeError(
      "PRODUCT_MATERIAL_AUTHORITY_INVALID",
      "Image-conditioned execution requires one exact current FROZEN Scene Product binding",
    );
  }
  if (sha256CanonicalIntegrityHash(resolveExplicitAiStorySceneGenerationAuthority(scene.generationAuthority)) !==
      sha256CanonicalIntegrityHash(input.generationAuthority)) {
    throw new AiStoryProductMaterialRuntimeError(
      "PRODUCT_MATERIAL_AUTHORITY_INVALID",
      "Scheduling mode does not match the exact current Canonical Scene decision",
    );
  }
  const binding = AiStoryAuthoritativeSceneProductBindingSchema.parse(scene.productBindings[0]);
  const productInput = {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    productAuthorityId: binding.productAuthorityId,
  };
  const resolvedProductAuthority = await resolveCurrentSceneProductAuthority(db, {
    ...productInput,
    sceneId: input.sceneId,
    actorUserId: input.actorUserId,
  });
  const [suitability, derivativeResolution, sourceRows] = await Promise.all([
    deriveStoryProductBackgroundSuitability(db, productInput),
    resolveExactStoryProductDerivative(db, productInput),
    db.select().from(schema.assets).where(and(
      eq(schema.assets.id, binding.sourceAssetId),
      eq(schema.assets.orgId, input.orgId),
      eq(schema.assets.workspaceId, input.workspaceId),
      eq(schema.assets.status, "ready"),
      isNull(schema.assets.deletedAt),
    )).limit(1),
  ]);
  const source = sourceRows[0];
  if (!source || source.contentHash !== binding.sourceAssetContentHash) {
    throw new AiStoryProductMaterialRuntimeError(
      "PRODUCT_MATERIAL_AUTHORITY_INVALID",
      "Current Product source Asset content identity changed",
    );
  }
  const selection = deriveProductVisualMaterialSelectionAuthority({
    sceneScope: {
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      sceneId: input.sceneId,
      sceneVersionId: input.sceneVersionId,
    },
    sceneProductBinding: binding,
    resolvedProductAuthority,
    effectiveGenerationAuthority: input.generationAuthority,
    suitability,
    derivativeResolution,
    preparationInput: freezePhotoSceneExtractionInput({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      source,
    }),
  });
  if (selection.selection === "PRODUCT_PREPARATION_REQUIRED") {
    throw new AiStoryProductMaterialRuntimeError(
      "PRODUCT_MATERIAL_PREPARATION_REQUIRED",
      "The exact Product derivative must be prepared before image-conditioned execution",
    );
  }
  if (!selection.selectedMaterial || selection.selection === "PRODUCT_VISUAL_INPUT_UNUSABLE") {
    throw new AiStoryProductMaterialRuntimeError(
      "PRODUCT_MATERIAL_UNUSABLE",
      "The current Scene Product has no usable image-conditioned material",
    );
  }
  const material = selection.selectedMaterial;
  const [asset] = await db.select({
    assetId: schema.assets.id,
    orgId: schema.assets.orgId,
    workspaceId: schema.assets.workspaceId,
    contentHash: schema.assets.contentHash,
    mimeType: schema.assets.mimeType,
    storagePath: schema.assets.storagePath,
    campaignId: schema.campaignAssetRefs.campaignId,
  }).from(schema.assets).innerJoin(schema.campaignAssetRefs, and(
    eq(schema.campaignAssetRefs.assetId, schema.assets.id),
    eq(schema.campaignAssetRefs.campaignId, input.campaignId),
  )).where(and(
    eq(schema.assets.id, material.assetId),
    eq(schema.assets.orgId, input.orgId),
    eq(schema.assets.workspaceId, input.workspaceId),
    eq(schema.assets.status, "ready"),
    isNull(schema.assets.deletedAt),
  )).limit(1);
  if (
    !asset || asset.campaignId !== input.campaignId ||
    asset.orgId !== input.orgId || asset.workspaceId !== input.workspaceId ||
    asset.contentHash !== material.contentHash ||
    !asset.mimeType?.toLowerCase().startsWith("image/") ||
    !asset.storagePath || /^https?:\/\//i.test(asset.storagePath)
  ) {
    throw new AiStoryProductMaterialRuntimeError(
      "PRODUCT_MATERIAL_AUTHORITY_INVALID",
      "Selected Product material is stale, out of scope, or not private image material",
    );
  }
  // Source bytes were already checked by suitability. Verify derivative bytes
  // too so an Asset metadata hash cannot stand in for the private object.
  if (material.kind === "EXTRACTED_DERIVATIVE") {
    const { data, error } = await createAdminClient().storage
      .from(process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets")
      .download(asset.storagePath);
    if (error || !data) {
      throw new AiStoryProductMaterialRuntimeError(
        "PRODUCT_MATERIAL_UNUSABLE", "Selected private derivative object is missing",
      );
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actualHash !== material.contentHash) {
      throw new AiStoryProductMaterialRuntimeError(
        "PRODUCT_MATERIAL_AUTHORITY_INVALID", "Selected private derivative bytes changed",
      );
    }
  }
  return selection;
}
