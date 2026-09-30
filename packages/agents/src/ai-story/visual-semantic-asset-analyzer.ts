import { z } from "zod";
import {
  AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
  AiStoryAssetAnalysisResultSchema,
  AiStoryVisualSemanticFactsSchema,
  type AiStoryAssetAnalysisSnapshot,
} from "@ceo-agent/shared";
import { callVisionJsonModel } from "../llm";
import type {
  AssetIntelligenceAnalyzer,
  FinalizedAssetForAnalysis,
} from "./asset-analysis-service";

export const VISUAL_SEMANTIC_ANALYZER_VERSION =
  "emberos-asset-visual-semantic-analyzer.v3" as const;

const ModelSemanticOutputSchema = AiStoryVisualSemanticFactsSchema.omit({
  contractVersion: true,
});

export type VisualSemanticModelAdapter = (input: {
  readonly system: string;
  readonly user: string;
  readonly imageDataUrl: string;
}) => Promise<z.input<typeof ModelSemanticOutputSchema>>;

const defaultModelAdapter: VisualSemanticModelAdapter = async (input) => {
  const response = await callVisionJsonModel<unknown>(
    input.system,
    input.user,
    [input.imageDataUrl],
    JSON.stringify({
      observed: {
        visibleText: ["exact directly readable text"],
        namedItems: ["directly readable or visually unambiguous named item"],
        objects: ["directly visible object"],
        people: ["non-identifying visible person description"],
        environmentCues: ["directly visible environment cue"],
        brandOrLogoCues: ["directly visible brand or logo cue"],
      },
      inferred: {
        categories: ["MENU_OR_CATALOG | PRODUCT | PACKAGING | ADDON_OR_COMPONENT | PERSON_OR_CHARACTER | ENVIRONMENT_OR_LOCATION | BRAND_OR_LOGO | DOCUMENT_OR_SCREENSHOT | OTHER"],
        productCandidates: [{
          name: "grounded candidate name",
          relationship: "PRIMARY_PRODUCT | ADDON_OR_COMPONENT | CATALOG_CHOICE | UNSPECIFIED_PRODUCT",
          confidence: "number from 0 to 1",
          evidence: ["reference to an observed fact"],
        }],
        productVariantCandidates: [{
          label: "short observable variant label such as Pink or Matte Black",
          observableAttributes: ["directly visible color, finish, pattern, or form"],
          confidence: "number from 0 to 1",
          evidence: ["reference to a directly observed fact"],
          regionEvidence: {
            x: "normalized left coordinate from 0 to 1",
            y: "normalized top coordinate from 0 to 1",
            width: "normalized width from 0 to 1",
            height: "normalized height from 0 to 1",
            confidence: "number from 0 to 1",
          },
        }],
        productGroundingSupported: false,
        characterGroundingSupported: false,
      },
    }),
    { maxRetries: 0 }
  );
  return ModelSemanticOutputSchema.parse(response.result);
};

function fileKind(type: string) {
  switch (type.trim().toLowerCase()) {
    case "image":
      return "IMAGE" as const;
    case "video":
      return "VIDEO" as const;
    case "audio":
      return "AUDIO" as const;
    case "pdf":
    case "document":
      return "DOCUMENT" as const;
    default:
      return "OTHER" as const;
  }
}

/** One cache-miss vision call that records evidence separately from inference. */
export class VisualSemanticAssetAnalyzer implements AssetIntelligenceAnalyzer {
  readonly analyzerVersion = VISUAL_SEMANTIC_ANALYZER_VERSION;
  readonly schemaVersion = AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION;

  constructor(private readonly modelAdapter: VisualSemanticModelAdapter = defaultModelAdapter) {}

  async analyze(input: {
    readonly asset: FinalizedAssetForAnalysis & { readonly contentHash: string };
    readonly loadRawBytes?: () => Promise<Uint8Array>;
  }): Promise<AiStoryAssetAnalysisSnapshot["analysis"]> {
    const kind = fileKind(input.asset.type);
    if (kind !== "IMAGE" || !input.loadRawBytes) {
      throw new Error("VISUAL_SEMANTIC_IMAGE_BYTES_REQUIRED");
    }
    const bytes = await input.loadRawBytes();
    if (bytes.byteLength === 0) throw new Error("VISUAL_SEMANTIC_IMAGE_EMPTY");
    const mimeType = input.asset.mimeType?.startsWith("image/")
      ? input.asset.mimeType
      : "image/jpeg";
    const result = ModelSemanticOutputSchema.parse(
      await this.modelAdapter({
        system: [
          "Analyze one visual asset as evidence for a general creative-production system.",
          "Report only directly visible text, names, objects, people, environments, and brand/logo cues under observed.",
          "Put classifications and relationships under inferred; never upgrade uncertainty into observation.",
          "Product candidates must cite visible evidence. Distinguish a primary product, add-on/component, catalog choice, and unspecified product when supported.",
          "Report productVariantCandidates only for visually distinguishable variants. Use observable color, finish, pattern, or form; never invent catalogue data.",
          "When several variants are visible, return one candidate per distinguishable variant. Include normalized region evidence only when the candidate can be localized confidently.",
          "When no variant distinction is visually supported, return an empty productVariantCandidates array.",
          "Do not invent names, prices, claims, brands, or relationships. Use empty arrays when unsupported.",
        ].join(" "),
        user: "Return the typed semantic analysis for this single asset.",
        imageDataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
      })
    );
    const semantics = AiStoryVisualSemanticFactsSchema.parse({
      contractVersion: AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
      ...result,
    });
    // Product grounding is a deterministic affordance derived from the
    // model's evidence-bearing candidates. Do not make it depend on the
    // model also remembering to repeat that conclusion in a separate boolean:
    // production vision responses can contain a high-confidence candidate
    // with cited evidence while conservatively leaving the boolean false.
    const productGrounding = semantics.inferred.productCandidates.some(
      (candidate) => candidate.confidence >= 0.6 && candidate.evidence.length > 0
    );
    const characterGrounding =
      semantics.inferred.characterGroundingSupported &&
      semantics.observed.people.length > 0;

    return AiStoryAssetAnalysisResultSchema.parse({
      fileKind: kind,
      usable: true,
      rejectionReasons: [],
      affordances: {
        visualReference: true,
        firstFrame: true,
        sourceMotion: false,
        sourceAudio: false,
        productGrounding,
        characterGrounding,
      },
      facts: {
        mimeType: input.asset.mimeType,
        width: input.asset.width,
        height: input.asset.height,
        fileSizeBytes: input.asset.fileSizeBytes,
        storageFinalized: true,
        visualSemantics: semantics,
      },
    });
  }
}
