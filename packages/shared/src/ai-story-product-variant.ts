/** Appearance words already used by asset semantic facts. Not a product catalog. */
const APPEARANCE_TOKENS = [
  "beige", "black", "blue", "brown", "gold", "gray", "grey", "green",
  "navy", "orange", "pink", "purple", "red", "silver", "teal", "white", "yellow",
] as const;

export const AI_STORY_PRODUCT_VARIANT_STATUSES = [
  "not_required",
  "analysis_required",
  "selection_required",
  "confirmed",
  "conflict",
] as const;

export type AiStoryProductVariantStatus = (typeof AI_STORY_PRODUCT_VARIANT_STATUSES)[number];

export type ProductVariantSemanticFacts = {
  observed?: {
    namedItems?: readonly string[];
    objects?: readonly string[];
    visibleText?: readonly string[];
  };
  inferred?: {
    productCandidates?: readonly { name?: string; relationship?: string }[];
    productVariantCandidates?: readonly ProductVariantCandidateEvidence[];
  };
};

export type ProductVariantCandidateEvidence = {
  label: string;
  observableAttributes: readonly string[];
  confidence: number;
  evidence: readonly string[];
  regionEvidence?: {
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  };
};

export type ProductVariantResolution = {
  status: AiStoryProductVariantStatus;
  variant: string | null;
  candidates: string[];
  code?:
    | "PRODUCT_VARIANT_ANALYSIS_REQUIRED"
    | "PRODUCT_VARIANT_SELECTION_REQUIRED"
    | "PRODUCT_VARIANT_CONFLICT";
};

export type ProductVariantVisualGrounding = {
  status: "analysis_required" | "confirmed" | "user_reference_required";
  visualReferenceId: string | null;
  visualReferenceContentHash: string | null;
  sourceMultiVariant: boolean | null;
  lineage: {
    kind: "SOURCE_ASSET" | "DERIVED_REGION";
    sourceAssetId: string;
    sourceAssetContentHash: string | null;
    analysisSnapshotId?: string;
  } | null;
  code?: "PRODUCT_VARIANT_ANALYSIS_REQUIRED" | "PRODUCT_VARIANT_VISUAL_REFERENCE_REQUIRED";
};

function titleCase(token: string): string {
  return token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase();
}

function appearanceTokensIn(text: string): string[] {
  const found = new Set<string>();
  for (const token of APPEARANCE_TOKENS) {
    if (new RegExp(`\\b${token}\\b`, "i").test(text)) found.add(titleCase(token));
  }
  return [...found];
}

/** Candidates come only from durable semantic facts. Empty means unknown, not conflict. */
export function extractProductVariantCandidates(facts: ProductVariantSemanticFacts | null | undefined): string[] {
  if (!facts) return [];
  const found = new Set<string>();
  for (const candidate of facts.inferred?.productVariantCandidates ?? []) {
    if (candidate.label.trim() && candidate.confidence >= 0.5 && candidate.evidence.length > 0) {
      found.add(candidate.label.trim());
    }
  }
  const phrases = [
    ...(facts.observed?.namedItems ?? []),
    ...(facts.observed?.objects ?? []),
    ...(facts.observed?.visibleText ?? []),
    ...(facts.inferred?.productCandidates ?? []).map((candidate) => candidate.name ?? ""),
  ];
  for (const phrase of phrases) {
    for (const token of appearanceTokensIn(phrase)) found.add(token);
  }
  for (const candidate of facts.inferred?.productCandidates ?? []) {
    if (candidate.relationship === "CATALOG_CHOICE" && candidate.name?.trim()) {
      found.add(candidate.name.trim());
    }
  }
  return [...found].sort((left, right) => left.localeCompare(right));
}

function matchCandidate(candidates: readonly string[], value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return candidates.find((candidate) => candidate.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0)
    ?? candidates.find((candidate) => candidate.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
    ?? null;
}

/**
 * Propose from source facts and user intent. Confirmation freezes one candidate.
 * A requested appearance that the source facts do not contain is a conflict.
 */
export function resolveProductVariantMapping(input: {
  candidates: readonly string[];
  userIntent?: string | null;
  selectedVariant?: string | null;
  confirmed?: boolean;
}): ProductVariantResolution {
  const candidates = [...new Set(input.candidates.map((candidate) => candidate.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const requested = appearanceTokensIn(input.userIntent ?? "");
  const selectedInput = input.selectedVariant?.trim() || null;
  const variantMatters = requested.length > 0 || selectedInput !== null;
  if (candidates.length === 0) {
    if (variantMatters) {
      return {
        status: "analysis_required",
        variant: selectedInput,
        candidates,
        code: "PRODUCT_VARIANT_ANALYSIS_REQUIRED",
      };
    }
    return { status: "not_required", variant: null, candidates };
  }
  const missing = requested.filter((token) => !candidates.some((candidate) => candidate.toLocaleLowerCase() === token.toLocaleLowerCase()));
  if (missing.length > 0) {
    return { status: "conflict", variant: null, candidates, code: "PRODUCT_VARIANT_CONFLICT" };
  }
  const selected = matchCandidate(candidates, selectedInput);
  if (selectedInput && !selected) {
    return { status: "conflict", variant: null, candidates, code: "PRODUCT_VARIANT_CONFLICT" };
  }
  const intentMatch = requested.length === 1 ? matchCandidate(candidates, requested[0]) : null;
  const determined = selected ?? intentMatch ?? (candidates.length === 1 ? candidates[0]! : null);
  if (!determined) {
    return {
      status: "selection_required",
      variant: null,
      candidates,
      code: "PRODUCT_VARIANT_SELECTION_REQUIRED",
    };
  }
  if (input.confirmed) {
    return { status: "confirmed", variant: determined, candidates };
  }
  return {
    status: "selection_required",
    variant: determined,
    candidates,
    code: "PRODUCT_VARIANT_SELECTION_REQUIRED",
  };
}

/**
 * Intake grounding is deliberately stricter than semantic selection. A
 * multi-variant source is not executable merely because a label was chosen.
 * V1 accepts the original source only when it is itself single-variant; a
 * clear replacement Asset is the normal user resolution for ambiguity.
 */
export function resolveProductVariantVisualGrounding(input: {
  sourceAssetId: string;
  sourceAssetContentHash?: string | null;
  resolution: ProductVariantResolution;
  derivedReference?: {
    assetId: string;
    contentHash: string;
    sourceAssetId: string;
    sourceAssetContentHash: string;
    analysisSnapshotId: string;
    variant: string;
  } | null;
}): ProductVariantVisualGrounding {
  if (input.resolution.status === "analysis_required") {
    return {
      status: "analysis_required",
      visualReferenceId: null,
      visualReferenceContentHash: null,
      sourceMultiVariant: null,
      lineage: null,
      code: "PRODUCT_VARIANT_ANALYSIS_REQUIRED",
    };
  }
  if (input.resolution.candidates.length > 1) {
    const derived = input.derivedReference;
    if (
      derived
      && input.resolution.variant
      && derived.variant.toLocaleLowerCase() === input.resolution.variant.toLocaleLowerCase()
      && derived.sourceAssetId === input.sourceAssetId
      && derived.sourceAssetContentHash === input.sourceAssetContentHash
    ) {
      return {
        status: "confirmed",
        visualReferenceId: derived.assetId,
        visualReferenceContentHash: derived.contentHash,
        sourceMultiVariant: true,
        lineage: {
          kind: "DERIVED_REGION",
          sourceAssetId: input.sourceAssetId,
          sourceAssetContentHash: input.sourceAssetContentHash ?? null,
          analysisSnapshotId: derived.analysisSnapshotId,
        },
      };
    }
    return {
      status: "user_reference_required",
      visualReferenceId: null,
      visualReferenceContentHash: null,
      sourceMultiVariant: true,
      lineage: null,
      code: "PRODUCT_VARIANT_VISUAL_REFERENCE_REQUIRED",
    };
  }
  return {
    status: "confirmed",
    visualReferenceId: input.sourceAssetId,
    visualReferenceContentHash: input.sourceAssetContentHash ?? null,
    sourceMultiVariant: false,
    lineage: {
      kind: "SOURCE_ASSET",
      sourceAssetId: input.sourceAssetId,
      sourceAssetContentHash: input.sourceAssetContentHash ?? null,
    },
  };
}

export function withConfirmedVariant<T extends object>(value: T, confirmedVariant: string | null | undefined): T & { confirmedVariant?: string } {
  return confirmedVariant ? { ...value, confirmedVariant } : value;
}
