import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, resolveCurrentFrozenCanonicalSceneSet, schema } from "@ceo-agent/db";
import {
  AiStoryAuthoritativeSceneProductBindingSchema,
  freezePhotoSceneExtractionInput,
  resolveExplicitAiStorySceneGenerationAuthority,
  type AiStoryCanonicalScene,
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
    readonly sourceAssetId?: string,
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
      binding.sourceAssetId,
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

const PLANNING_PRODUCT_MATERIAL_AUTHORITY_CODES = new Set([
  "DERIVATIVE_AUTHORITY_MISMATCH",
  "PRODUCT_AUTHORITY_MISMATCH",
  "SCENE_PRODUCT_AUTHORITY_REQUIRED",
  "SUITABILITY_AUTHORITY_INVALID",
  "PREPARATION_CAPABILITY_MISMATCH",
  "EFFECTIVE_GENERATION_AUTHORITY_INVALID",
  "PRODUCT_MATERIAL_AUTHORITY_INVALID",
  "PRODUCT_MATERIAL_PREPARATION_REQUIRED",
  "PRODUCT_MATERIAL_UNUSABLE",
  "EXACT_STORY_PRODUCT_AUTHORITY_REQUIRED",
  "DERIVATIVE_LINEAGE_AMBIGUOUS",
  "PRODUCT_SOURCE_VARIANT_AMBIGUOUS",
  "PRODUCT_BACKGROUND_SUITABILITY_AUTHORITY_REQUIRED",
  "CURRENT_STORY_VERSION_REQUIRED",
  "CURRENT_CANONICAL_SCENE_REQUIRED",
  "CURRENT_SCENE_PRODUCT_BINDING_REQUIRED",
  "SCENE_PRODUCT_VISUAL_IDENTITY_REQUIREMENT_UNRESOLVED",
  "SCENE_PRODUCT_IDENTITY_INVALID",
  "CURRENT_STORY_PRODUCT_SOURCE_MISMATCH",
]);

export function readPlanningProductMaterialAuthorityError(
  error: unknown,
): { code: string; message: string; sourceAssetId?: string } | null {
  if (!(error instanceof Error) || !("code" in error)) return null;
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code !== "string" || !PLANNING_PRODUCT_MATERIAL_AUTHORITY_CODES.has(code)) return null;
  const sourceAssetId = (error as Error & { sourceAssetId?: unknown }).sourceAssetId;
  return {
    code,
    message: error.message,
    ...(typeof sourceAssetId === "string" ? { sourceAssetId } : {}),
  };
}

/**
 * Shared Planning authority gate for Readiness and Approval.
 * Image-conditioned Scenes revalidate the exact current Product material.
 * Character-only TEXT_TO_VIDEO Scenes contribute no Product material fingerprint.
 */
export async function revalidatePlanningProductMaterialAuthority(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  actorUserId: string;
  canonicalScenes: readonly Pick<
    AiStoryCanonicalScene,
    "sceneId" | "sceneVersionId" | "generationAuthority"
  >[];
}): Promise<{ fingerprint: string }> {
  const sceneFingerprints: { sceneId: string; fingerprint: string | null }[] = [];
  for (const scene of input.canonicalScenes) {
    const authority = resolveExplicitAiStorySceneGenerationAuthority(scene.generationAuthority);
    if (authority.strategy === "TEXT_TO_VIDEO") {
      sceneFingerprints.push({ sceneId: scene.sceneId, fingerprint: null });
      continue;
    }
    const selection = await resolveCurrentSceneProductMaterialForScheduling({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      campaignId: input.campaignId,
      storyId: input.storyId,
      storyVersionId: input.storyVersionId,
      sceneId: scene.sceneId,
      sceneVersionId: scene.sceneVersionId,
      actorUserId: input.actorUserId,
      generationAuthority: authority,
    });
    sceneFingerprints.push({ sceneId: scene.sceneId, fingerprint: selection.fingerprint });
  }
  return {
    fingerprint: sha256CanonicalIntegrityHash({
      kind: "planning-product-material-authority.v1",
      scenes: sceneFingerprints,
    }),
  };
}
