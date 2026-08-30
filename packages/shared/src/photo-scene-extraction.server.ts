import type { PhotoSceneExtractionFingerprintIdentityV1 } from "./photo-scene-extraction";
import { PhotoSceneExtractionFingerprintIdentityV1Schema } from "./photo-scene-extraction";
import { sha256CanonicalIntegrityHash } from "./canonical-integrity";

export function fingerprintPhotoSceneExtractionIdentityV1(
  input: PhotoSceneExtractionFingerprintIdentityV1
): string {
  return sha256CanonicalIntegrityHash(PhotoSceneExtractionFingerprintIdentityV1Schema.parse(input));
}
