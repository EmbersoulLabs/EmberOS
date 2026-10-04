import {
  AiStoryLocalGenerationPackageV3Schema,
  AiStoryLocalPredecessorAuthoritySemanticSchema,
  AiStoryLocalReleaseAuthoritySemanticSchema,
  type AiStoryLocalGenerationPackageV3,
  type AiStoryLocalPredecessorAuthority,
  type AiStoryLocalReleaseAuthority,
} from "./ai-story-local-generation";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import {
  AiStoryEffectiveSceneGenerationAuthorityV2Schema,
  type AiStoryEffectiveSceneGenerationAuthorityV2,
} from "./ai-story-generation-authority";

/**
 * Semantic fingerprints intentionally exclude audit metadata such as actors,
 * wall-clock timestamps, worker attempts, and extraction completion time.
 */
export function computeAiStoryLocalPredecessorAuthorityFingerprint(
  semantic: AiStoryLocalPredecessorAuthority["semantic"],
): string {
  return sha256CanonicalIntegrityHash(
    AiStoryLocalPredecessorAuthoritySemanticSchema.parse(semantic),
  );
}

export function computeAiStoryEffectiveSceneGenerationAuthorityV2Fingerprint(
  authority: AiStoryEffectiveSceneGenerationAuthorityV2,
): string {
  return sha256CanonicalIntegrityHash(
    AiStoryEffectiveSceneGenerationAuthorityV2Schema.parse(authority),
  );
}

export function computeAiStoryLocalReleaseAuthorityFingerprint(
  semantic: AiStoryLocalReleaseAuthority["semantic"],
): string {
  return sha256CanonicalIntegrityHash(
    AiStoryLocalReleaseAuthoritySemanticSchema.parse(semantic),
  );
}

export function deterministicAiStoryLocalReleaseAuthorityId(
  semanticFingerprint: string,
): string {
  return deterministicUuidFromFingerprint(
    "ai-story-scene-release-authority-v2",
    semanticFingerprint,
  );
}

function semanticPackageBody(value: AiStoryLocalGenerationPackageV3) {
  const {
    packageId: _packageId,
    packageFingerprint: _packageFingerprint,
    createdAt: _createdAt,
    releaseAuthority,
    predecessorAuthority,
    ...packageSemantic
  } = value;
  return {
    ...packageSemantic,
    releaseAuthority: {
      semantic: releaseAuthority.semantic,
      semanticFingerprint: releaseAuthority.semanticFingerprint,
    },
    predecessorAuthority: predecessorAuthority
      ? {
          semantic: predecessorAuthority.semantic,
          semanticFingerprint: predecessorAuthority.semanticFingerprint,
        }
      : null,
  };
}

export function computeAiStoryLocalGenerationPackageV3Fingerprint(
  input: AiStoryLocalGenerationPackageV3,
): string {
  const parsed = AiStoryLocalGenerationPackageV3Schema.parse(input);
  return sha256CanonicalIntegrityHash(semanticPackageBody(parsed));
}

export function deterministicAiStoryLocalGenerationPackageV3Id(
  packageFingerprint: string,
): string {
  return deterministicUuidFromFingerprint(
    "ai-story-local-generation-package-v3",
    packageFingerprint,
  );
}

/** Successor identity converges only when every semantic authority converges. */
export function deterministicAiStoryLocalSuccessorPackageV3Id(
  input: AiStoryLocalGenerationPackageV3,
): string {
  return deterministicAiStoryLocalGenerationPackageV3Id(
    computeAiStoryLocalGenerationPackageV3Fingerprint(input),
  );
}
