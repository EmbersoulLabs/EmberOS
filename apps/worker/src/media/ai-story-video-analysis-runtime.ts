/**
 * Wires the existing vision-prep pipeline to lazy video analysis.
 * Does not reimplement frame extraction and does not run during upload.
 */
import {
  callVisionJsonModel,
  ensureAiStoryVideoAssetAnalysis,
  extractOpenAiVideoObservation,
  type AuthorizedVideoAsset,
} from "@ceo-agent/agents";
import { createSqlVideoAnalysisSnapshotRepository } from "@ceo-agent/db";
import type { Sql } from "postgres";
import { prepareVisionFromStorage } from "./vision-prep";

export function createAiStoryVideoAnalysisRuntime(sql: Sql) {
  const repository = createSqlVideoAnalysisSnapshotRepository(sql);
  return {
    ensure(input: {
      readonly orgId: string;
      readonly workspaceId: string;
      readonly assetId: string;
      readonly contentHash: string;
      readonly planningContext?: { readonly campaignId?: string; readonly episodeId?: string };
      readonly findAsset: (requested: {
        readonly orgId: string;
        readonly workspaceId: string;
        readonly assetId: string;
      }) => Promise<AuthorizedVideoAsset | null>;
    }) {
      return ensureAiStoryVideoAssetAnalysis({
        ...input,
        repository,
        prepareVision: (asset) => prepareVisionFromStorage({
          storagePath: asset.storagePath,
          mediaType: "video",
          durationSec: asset.durationSec ?? undefined,
        }),
        extractObservation: (prepared) => extractOpenAiVideoObservation({
          prepared,
          callVision: async (system, userText, imageDataUrls, schemaHint) => {
            const response = await callVisionJsonModel(system, userText, imageDataUrls, schemaHint);
            return {
              result: response.result,
              usage: response.usage,
              providerRequestId: response.providerRequestId,
            };
          },
        }),
      });
    },
  };
}
