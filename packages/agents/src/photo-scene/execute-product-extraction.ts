import { randomUUID } from "node:crypto";
import {
  EXTRACTED_PRODUCT_EXT,
  EXTRACTED_PRODUCT_MIME,
  PhotoSceneExtractionError,
  extractedProductLineage,
  isCanonicalSourceContentHash,
  isExtractionErrorCategory,
  planPhotoSceneDerivedAsset,
  userSafeExtractionMessage,
  type ExtractionErrorCategory,
  type PhotoSceneAssetSnapshot,
  type PhotoSceneExtractionInputCapsuleV1,
  type PhotoSceneGenerationSnapshot,
} from "@ceo-agent/shared";
import type { BackgroundRemovalProvider } from "./background-removal";
import { validateExtractedPng } from "./png";

export type ProductExtractionIo = {
  provider: BackgroundRemovalProvider;
  hashBytes: (bytes: Buffer) => string;
  newAssetId?: () => string;
  readSourceBytes: (storagePath: string) => Promise<Buffer>;
  writeOutputObject: (storagePath: string, bytes: Buffer, mimeType: string) => Promise<void>;
  loadSourceAsset: (assetId: string) => Promise<PhotoSceneAssetSnapshot | null>;
  persistReady: (input: {
    generationId: string;
    outputAsset: ReturnType<typeof planPhotoSceneDerivedAsset>;
    width: number;
    height: number;
    fileSizeBytes: number;
    providerKey: string;
    costUsd: string | null;
  }) => Promise<void>;
  persistFailed: (input: {
    generationId: string;
    errorCode: ExtractionErrorCategory;
    boundedError: string;
  }) => Promise<void>;
};

function asError(err: unknown): PhotoSceneExtractionError {
  if (err instanceof PhotoSceneExtractionError) return err;
  const message = err instanceof Error ? err.message : "Extraction failed";
  if (/not found|object/i.test(message) && /storage|download/i.test(message)) {
    return new PhotoSceneExtractionError("SOURCE_OBJECT_MISSING", message);
  }
  if (/upload/i.test(message)) {
    return new PhotoSceneExtractionError("STORAGE_WRITE_FAILED", message);
  }
  if (/unavailable|not configured/i.test(message)) {
    return new PhotoSceneExtractionError("PROVIDER_UNAVAILABLE", message);
  }
  if (/reject|400|401|403/i.test(message)) {
    return new PhotoSceneExtractionError("PROVIDER_REJECTED", message);
  }
  return new PhotoSceneExtractionError("PROVIDER_UNAVAILABLE", message);
}

export async function executeProductExtraction(input: {
  generation: PhotoSceneGenerationSnapshot;
  io: ProductExtractionIo;
}): Promise<{ status: "ready" | "failed"; outputAssetId?: string; errorCode?: ExtractionErrorCategory }> {
  const { generation, io } = input;
  if (generation.status === "ready" && generation.outputAssetId) {
    return { status: "ready", outputAssetId: generation.outputAssetId };
  }

  const capsule = generation.inputCapsule as PhotoSceneExtractionInputCapsuleV1;
  try {
    const source = await io.loadSourceAsset(generation.sourceAssetId);
    if (!source) {
      throw new PhotoSceneExtractionError("INVALID_SOURCE", "Source asset is missing");
    }
    if (source.workspaceId !== generation.workspaceId || source.orgId !== generation.orgId) {
      throw new PhotoSceneExtractionError("WORKSPACE_ISOLATION", "Source asset workspace mismatch");
    }

    let sourceBytes: Buffer;
    try {
      sourceBytes = await io.readSourceBytes(capsule.storagePath);
    } catch (err) {
      throw new PhotoSceneExtractionError(
        "SOURCE_OBJECT_MISSING",
        err instanceof Error ? err.message : "Source object is missing"
      );
    }

    const actualHash = io.hashBytes(sourceBytes);
    if (actualHash !== generation.sourceContentHash) {
      throw new PhotoSceneExtractionError(
        "SOURCE_IDENTITY_MISSING",
        "Stored source contentHash no longer matches object bytes"
      );
    }

    let providerOutput;
    try {
      providerOutput = await io.provider.removeBackground({
        bytes: sourceBytes,
        mimeType: capsule.mimeType,
        sourceAssetId: generation.sourceAssetId,
        workspaceId: generation.workspaceId,
      });
    } catch (err) {
      throw asError(err);
    }

    const validated = validateExtractedPng(providerOutput.bytes);
    const contentHash = io.hashBytes(providerOutput.bytes);
    if (!isCanonicalSourceContentHash(contentHash)) {
      throw new PhotoSceneExtractionError("OUTPUT_FINALIZATION_FAILED", "Output hash is not canonical");
    }
    if (isCanonicalSourceContentHash(generation.inputFingerprint) === false) {
      throw new PhotoSceneExtractionError("OUTPUT_FINALIZATION_FAILED", "Generation fingerprint is invalid");
    }

    const assetId = io.newAssetId?.() ?? randomUUID();
    const plan = planPhotoSceneDerivedAsset({
      assetId,
      orgId: generation.orgId,
      workspaceId: generation.workspaceId,
      campaignId: generation.campaignId,
      ext: EXTRACTED_PRODUCT_EXT,
      mimeType: EXTRACTED_PRODUCT_MIME,
      contentHash,
      role: "extracted_product",
      lineage: extractedProductLineage({
        sourceAssetId: generation.sourceAssetId,
        sourceContentHash: generation.sourceContentHash,
        generationId: generation.id,
        generationFingerprint: generation.inputFingerprint,
      }),
    });

    try {
      await io.writeOutputObject(plan.storagePath, providerOutput.bytes, EXTRACTED_PRODUCT_MIME);
    } catch (err) {
      throw new PhotoSceneExtractionError(
        "STORAGE_WRITE_FAILED",
        err instanceof Error ? err.message : "Failed to write extracted object"
      );
    }

    const costUsd =
      typeof providerOutput.costUsd === "number" && Number.isFinite(providerOutput.costUsd)
        ? String(providerOutput.costUsd)
        : null;

    try {
      await io.persistReady({
        generationId: generation.id,
        outputAsset: plan,
        width: validated.width,
        height: validated.height,
        fileSizeBytes: validated.byteLength,
        providerKey: io.provider.key,
        costUsd,
      });
    } catch (err) {
      throw new PhotoSceneExtractionError(
        "OUTPUT_FINALIZATION_FAILED",
        err instanceof Error ? err.message : "Failed to persist extracted asset"
      );
    }

    return { status: "ready", outputAssetId: plan.id };
  } catch (err) {
    const mapped = asError(err);
    const code: ExtractionErrorCategory = isExtractionErrorCategory(mapped.code)
      ? mapped.code
      : "PROVIDER_UNAVAILABLE";
    await io.persistFailed({
      generationId: generation.id,
      errorCode: code,
      boundedError: userSafeExtractionMessage(code),
    });
    return { status: "failed", errorCode: code };
  }
}
