import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

/** Same asset and variant reuse one visual identity. A variant change does not match. */
export function productVisualIdentityFingerprint(input: {
  productAuthorityId: string;
  sourceAssetContentHash: string;
  confirmedVariant?: string | null;
}): string {
  return sha256CanonicalIntegrityHash({
    productAuthorityId: input.productAuthorityId,
    sourceAssetContentHash: input.sourceAssetContentHash,
    ...(input.confirmedVariant ? { confirmedVariant: input.confirmedVariant } : {}),
  });
}
