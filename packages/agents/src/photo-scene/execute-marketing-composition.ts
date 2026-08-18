import { randomUUID } from "node:crypto";
import {
  DETERMINISTIC_COMPOSITOR_KEY,
  MARKETING_COMPOSITION_EXTERNAL_COST_USD,
  MARKETING_IMAGE_EXT,
  MARKETING_IMAGE_MIME,
  PhotoSceneMarketingError,
  PhotoSceneMarketingInputCapsuleV1Schema,
  isCanonicalSourceContentHash,
  isMarketingErrorCategory,
  marketingLineage,
  planPhotoSceneDerivedAsset,
  parseOfficialSceneObjectIdentity,
  resolveLogoStorageReference,
  userSafeMarketingMessage,
  type MarketingErrorCategory,
  type PhotoSceneAssetSnapshot,
  type PhotoSceneGenerationSnapshot,
  type PhotoSceneMarketingInputCapsuleV1,
} from "@ceo-agent/shared";
import { composeFrozenMarketingImage } from "./compose-marketing-image";

export type MarketingCompositionIo = {
  hashBytes: (bytes: Buffer) => string;
  newAssetId?: () => string;
  readExtractedBytes: (storagePath: string) => Promise<Buffer>;
  readSceneBytes: (identity: { bucket: string; objectKey: string }) => Promise<Buffer>;
  readLogoBytes?: (identity: { bucket: string; objectKey: string }) => Promise<Buffer>;
  writeOutputObject: (storagePath: string, bytes: Buffer, mimeType: string) => Promise<void>;
  loadExtractedAsset: (assetId: string) => Promise<PhotoSceneAssetSnapshot | null>;
  persistReady: (input: {
    generationId: string;
    outputAsset: ReturnType<typeof planPhotoSceneDerivedAsset>;
    width: number;
    height: number;
    fileSizeBytes: number;
    providerKey: string;
    costUsd: string;
  }) => Promise<void>;
  persistFailed: (input: {
    generationId: string;
    errorCode: MarketingErrorCategory;
    boundedError: string;
  }) => Promise<void>;
};

function asError(err: unknown): PhotoSceneMarketingError {
  if (err instanceof PhotoSceneMarketingError) return err;
  const message = err instanceof Error ? err.message : "Composition failed";
  if (/not found|object/i.test(message) && /logo|brand/i.test(message)) {
    return new PhotoSceneMarketingError("BRAND_ASSET_UNAVAILABLE", message);
  }
  if (/not found|object/i.test(message) && /scene|official/i.test(message)) {
    return new PhotoSceneMarketingError("SCENE_NOT_FOUND", message);
  }
  if (/upload|write/i.test(message)) {
    return new PhotoSceneMarketingError("STORAGE_WRITE_FAILED", message);
  }
  return new PhotoSceneMarketingError("COMPOSITION_FAILED", message);
}

export async function executeMarketingComposition(input: {
  generation: PhotoSceneGenerationSnapshot;
  io: MarketingCompositionIo;
}): Promise<{ status: "ready" | "failed"; outputAssetId?: string; errorCode?: MarketingErrorCategory }> {
  const { generation, io } = input;
  if (generation.status === "ready" && generation.outputAssetId) {
    return { status: "ready", outputAssetId: generation.outputAssetId };
  }

  let capsule: PhotoSceneMarketingInputCapsuleV1;
  try {
    capsule = PhotoSceneMarketingInputCapsuleV1Schema.parse(generation.inputCapsule);
  } catch {
    await io.persistFailed({
      generationId: generation.id,
      errorCode: "INVALID_PLACEMENT",
      boundedError: userSafeMarketingMessage("INVALID_PLACEMENT"),
    });
    return { status: "failed", errorCode: "INVALID_PLACEMENT" };
  }

  try {
    const extracted = await io.loadExtractedAsset(generation.sourceAssetId);
    if (!extracted) {
      throw new PhotoSceneMarketingError("INVALID_EXTRACTED_PRODUCT", "Extracted product is missing");
    }
    if (extracted.workspaceId !== generation.workspaceId || extracted.orgId !== generation.orgId) {
      throw new PhotoSceneMarketingError("WORKSPACE_ISOLATION", "Extracted product workspace mismatch");
    }
    if (extracted.id !== capsule.extractedProductAssetId) {
      throw new PhotoSceneMarketingError("SOURCE_IDENTITY_MISMATCH", "Extracted product id mismatch");
    }

    const productBytes = await io.readExtractedBytes(capsule.extractedProductStorageIdentity);
    const productHash = io.hashBytes(productBytes);
    if (productHash !== capsule.extractedProductContentHash || productHash !== generation.sourceContentHash) {
      throw new PhotoSceneMarketingError(
        "SOURCE_IDENTITY_MISMATCH",
        "Extracted product hash no longer matches object bytes"
      );
    }

    const sceneIdentity = parseOfficialSceneObjectIdentity(capsule.scene.backgroundStorageIdentity);
    if (!sceneIdentity) {
      throw new PhotoSceneMarketingError("SCENE_IDENTITY_MISMATCH", "Official scene identity is invalid");
    }
    const sceneBytes = await io.readSceneBytes(sceneIdentity);
    const sceneHash = io.hashBytes(sceneBytes);
    if (sceneHash !== capsule.scene.sceneContentHash) {
      throw new PhotoSceneMarketingError("SCENE_IDENTITY_MISMATCH", "Official scene hash no longer matches object bytes");
    }

    let logoBytes: Buffer | null = null;
    if (capsule.brandSnapshot.logoIdentity) {
      const logoRef = resolveLogoStorageReference(capsule.brandSnapshot.logoIdentity);
      if (!logoRef || !io.readLogoBytes) {
        throw new PhotoSceneMarketingError("BRAND_ASSET_UNAVAILABLE", "Brand logo identity cannot be resolved");
      }
      try {
        logoBytes = await io.readLogoBytes(logoRef);
      } catch (err) {
        throw new PhotoSceneMarketingError(
          "BRAND_ASSET_UNAVAILABLE",
          err instanceof Error ? err.message : "Brand logo object is missing"
        );
      }
      if (capsule.brandSnapshot.logoContentHash) {
        const logoHash = io.hashBytes(logoBytes);
        if (logoHash !== capsule.brandSnapshot.logoContentHash) {
          throw new PhotoSceneMarketingError("BRAND_ASSET_UNAVAILABLE", "Brand logo hash mismatch");
        }
      }
    }

    const outputBytes = composeFrozenMarketingImage({
      capsule,
      sceneBytes,
      productBytes,
      logoBytes,
    });
    const contentHash = io.hashBytes(outputBytes);
    if (!isCanonicalSourceContentHash(contentHash) || !isCanonicalSourceContentHash(generation.inputFingerprint)) {
      throw new PhotoSceneMarketingError("OUTPUT_FINALIZATION_FAILED", "Output hash is not canonical");
    }

    const extractedLineage = extracted.metadata
      ? (extracted.metadata as { photoScene?: { lineage?: { sourceAssetId?: string } } }).photoScene?.lineage
      : undefined;
    const plan = planPhotoSceneDerivedAsset({
      assetId: io.newAssetId?.() ?? randomUUID(),
      orgId: generation.orgId,
      workspaceId: generation.workspaceId,
      campaignId: generation.campaignId,
      ext: MARKETING_IMAGE_EXT,
      mimeType: MARKETING_IMAGE_MIME,
      contentHash,
      role: "marketing_image",
      lineage: marketingLineage({
        generationId: generation.id,
        generationFingerprint: generation.inputFingerprint,
        extractedAssetId: extracted.id,
        extractedContentHash: capsule.extractedProductContentHash,
        sourceAssetId: extractedLineage?.sourceAssetId,
        sceneId: capsule.scene.sceneId,
        sceneVersion: String(capsule.scene.sceneVersion),
        sceneContentHash: capsule.scene.sceneContentHash,
        presetId: capsule.presetId,
        marketingSnapshotHash: capsule.marketingSnapshotHash,
        brandSnapshotHash: capsule.brandSnapshotHash,
      }),
    });

    try {
      await io.writeOutputObject(plan.storagePath, outputBytes, MARKETING_IMAGE_MIME);
    } catch (err) {
      throw new PhotoSceneMarketingError(
        "STORAGE_WRITE_FAILED",
        err instanceof Error ? err.message : "Failed to write marketing image"
      );
    }

    try {
      await io.persistReady({
        generationId: generation.id,
        outputAsset: plan,
        width: capsule.width,
        height: capsule.height,
        fileSizeBytes: outputBytes.length,
        providerKey: DETERMINISTIC_COMPOSITOR_KEY,
        costUsd: String(MARKETING_COMPOSITION_EXTERNAL_COST_USD),
      });
    } catch (err) {
      throw new PhotoSceneMarketingError(
        "OUTPUT_FINALIZATION_FAILED",
        err instanceof Error ? err.message : "Failed to persist marketing image"
      );
    }

    return { status: "ready", outputAssetId: plan.id };
  } catch (err) {
    const mapped = asError(err);
    const code: MarketingErrorCategory = isMarketingErrorCategory(mapped.code)
      ? mapped.code
      : "COMPOSITION_FAILED";
    await io.persistFailed({
      generationId: generation.id,
      errorCode: code,
      boundedError: userSafeMarketingMessage(code),
    });
    return { status: "failed", errorCode: code };
  }
}
