import { z } from "zod";

export const CANONICAL_SOURCE_CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export const SourceAssetContentHashSchema = z
  .string()
  .regex(
    CANONICAL_SOURCE_CONTENT_HASH_PATTERN,
    "Expected sha256:<64 lowercase hex>"
  );

export type SourceAssetContentHash = z.infer<typeof SourceAssetContentHashSchema>;

export function isCanonicalSourceContentHash(
  value: unknown
): value is SourceAssetContentHash {
  return (
    typeof value === "string" &&
    CANONICAL_SOURCE_CONTENT_HASH_PATTERN.test(value)
  );
}
