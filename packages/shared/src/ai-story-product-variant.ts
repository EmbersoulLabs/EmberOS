/** Appearance words already used by asset semantic facts. Not a product catalog. */
const APPEARANCE_TOKENS = [
  "beige", "black", "blue", "brown", "gold", "gray", "grey", "green",
  "navy", "orange", "pink", "purple", "red", "silver", "teal", "white", "yellow",
] as const;

export const AI_STORY_PRODUCT_VARIANT_STATUSES = [
  "not_required",
  "proposed",
  "confirmed",
  "unresolved",
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
  };
};

export type ProductVariantResolution = {
  status: AiStoryProductVariantStatus;
  variant: string | null;
  candidates: string[];
  code?: "PRODUCT_VARIANT_CONFLICT" | "PRODUCT_VARIANT_UNRESOLVED";
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

/** Candidates come only from durable semantic facts. Empty means no variant distinction. */
export function extractProductVariantCandidates(facts: ProductVariantSemanticFacts | null | undefined): string[] {
  if (!facts) return [];
  const found = new Set<string>();
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
  const missing = requested.filter((token) => !candidates.some((candidate) => candidate.toLocaleLowerCase() === token.toLocaleLowerCase()));
  if (missing.length > 0) {
    return { status: "conflict", variant: null, candidates, code: "PRODUCT_VARIANT_CONFLICT" };
  }
  const selected = matchCandidate(candidates, input.selectedVariant);
  const intentMatch = requested.length === 1 ? matchCandidate(candidates, requested[0]) : null;
  const determined = selected ?? intentMatch ?? (candidates.length === 1 ? candidates[0]! : null);
  if (candidates.length === 0) {
    return { status: "not_required", variant: null, candidates };
  }
  if (!determined) {
    return { status: "unresolved", variant: null, candidates, code: "PRODUCT_VARIANT_UNRESOLVED" };
  }
  if (input.confirmed) {
    return { status: "confirmed", variant: determined, candidates };
  }
  return { status: "proposed", variant: determined, candidates };
}

export function withConfirmedVariant<T extends object>(value: T, confirmedVariant: string | null | undefined): T & { confirmedVariant?: string } {
  return confirmedVariant ? { ...value, confirmedVariant } : value;
}
