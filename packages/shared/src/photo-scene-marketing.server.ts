import type { PhotoSceneMarketingFingerprintIdentityV1 } from "./photo-scene-marketing";
import { PhotoSceneMarketingFingerprintIdentityV1Schema } from "./photo-scene-marketing";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export function fingerprintPhotoSceneMarketingIdentityV1(
  input: PhotoSceneMarketingFingerprintIdentityV1
): string {
  return sha256CanonicalIntegrityHash(PhotoSceneMarketingFingerprintIdentityV1Schema.parse(input));
}

export function fingerprintPhotoSceneSnapshot(value: unknown): string {
  return sha256CanonicalIntegrityHash(value);
}
