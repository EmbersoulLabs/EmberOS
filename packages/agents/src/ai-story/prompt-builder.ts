/**
 * @deprecated Prompt building moved to execution-compiler (video-only).
 * Re-exports for transitional imports; prefer importing from execution-compiler.
 */
export {
  MissingCampaignAssetsError,
  assertCampaignAssetsResolved,
  buildGenerateReviewEstimate,
  buildOutputVariantsFromManifest,
  collectReferencedAssetIds,
  compileExecutionManifest,
  type ResolvedCampaignAsset,
} from "./execution-compiler";
