import { describe, expect, it } from "vitest";
import { AiStoryCompiledProviderRequestSchema } from "@ceo-agent/shared";
import {
  computeAiStoryCompiledRequestFingerprint,
  compileImmutableSeedanceRequestFromSceneCompilation,
  validateAiStoryCompiledRequestFingerprint,
} from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import {
  certificationCompiledRequestStableSemantics,
  certifyScheduledRequestAgainstPreflight,
  compareCertificationCompiledRequestSemantics,
} from "../packages/agents/src/ai-story/certification-compiled-request-semantics";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";
import { compileSeedanceNativeDialogueCertificationRequest } from "./helpers/ai-story-seedance-native-dialogue-cert";

const AUTHORITY = {
  qcEvaluationId: "30000000-0000-4000-8000-000000000001",
  qcFingerprint: `sha256:${"a".repeat(64)}`,
  qcCapabilityVersion: "seedance-modelark-test.v1",
  directorFingerprint: `sha256:${"b".repeat(64)}`,
  motionFingerprint: `sha256:${"c".repeat(64)}`,
} as const;

function compileAt(compiledAt: string) {
  const compilation = makePhase2aCompilation({ sceneOrder: [0] });
  const baseIntent = compilation.intents[0]!;
  const baseInstructions = compilation.instructionsBySceneExecutionId[baseIntent.identity.sceneExecutionId]!;
  const generationAuthority = {
    strategy: "TEXT_TO_VIDEO" as const,
    referenceSource: "REFERENCE_FREE_T2V" as const,
    effectiveReferenceIds: [],
    firstFrameAssetId: null,
    productVisualIdentityRequirement: "NONE" as const,
  };
  return compileImmutableSeedanceRequestFromSceneCompilation({
    intent: { ...baseIntent, referencedAssetIds: [], generationAuthority },
    instructions: { ...baseInstructions, referencedAssetIds: [], generationAuthority },
    authority: AUTHORITY,
    adapterVersion: "1.0.0",
    compiledAt,
    resolution: "480p",
  });
}

function reidentify<T extends Record<string, unknown>>(request: T, patch: Record<string, unknown>) {
  const merged = { ...request, ...patch };
  const { requestFingerprint: _ignored, ...withoutFingerprint } = merged;
  return AiStoryCompiledProviderRequestSchema.parse({
    ...withoutFingerprint,
    requestFingerprint: computeAiStoryCompiledRequestFingerprint(
      withoutFingerprint as never
    ),
  });
}

describe("certification compiled request stable semantics", () => {
  const preflight = compileAt("2026-09-01T00:00:00.000Z");

  it("treats a later compilation clock as the same provider request", () => {
    const scheduled = compileAt("2026-09-28T07:32:16.198Z");
    expect(scheduled.compiledAt).not.toBe(preflight.compiledAt);
    expect(scheduled.compiledRequestId).not.toBe(preflight.compiledRequestId);
    expect(scheduled.requestFingerprint).not.toBe(preflight.requestFingerprint);
    expect(validateAiStoryCompiledRequestFingerprint(preflight)).toBe(true);
    expect(validateAiStoryCompiledRequestFingerprint(scheduled)).toBe(true);
    expect(compareCertificationCompiledRequestSemantics(scheduled, preflight)).toEqual({
      equivalent: true,
      differences: [],
    });
    expect(certifyScheduledRequestAgainstPreflight({ scheduled, preflight })).toMatchObject({
      selfFingerprintValid: true,
      stableSemanticEquivalent: true,
    });
    const stable = certificationCompiledRequestStableSemantics(scheduled);
    expect(stable).not.toHaveProperty("compiledAt");
    expect(stable).not.toHaveProperty("compiledRequestId");
    expect(stable).not.toHaveProperty("requestFingerprint");
  });

  it("treats a different compiled request id as the same provider request", () => {
    const scheduled = reidentify(preflight, {
      compiledRequestId: "50000000-0000-4000-8000-000000000099",
    });
    expect(scheduled.requestFingerprint).not.toBe(preflight.requestFingerprint);
    expect(validateAiStoryCompiledRequestFingerprint(scheduled)).toBe(true);
    expect(compareCertificationCompiledRequestSemantics(scheduled, preflight).equivalent).toBe(true);
  });

  it("rejects a changed prompt, QC fingerprint, derivative, mode, duration, resolution, audio, or added reference", () => {
    const cases = [
      reidentify(preflight, { compiledPromptFingerprint: `sha256:${"1".repeat(64)}` }),
      reidentify(preflight, { qcFingerprint: `sha256:${"2".repeat(64)}` }),
      reidentify(preflight, {
        referenceMappings: [{
          referenceId: "50000000-0000-4000-8000-000000000111",
          assetId: "50000000-0000-4000-8000-000000000112",
          authorityType: "PRODUCT",
          authorityId: "50000000-0000-4000-8000-000000000112",
          authorityClass: "REQUIRED",
          wireRole: "first_frame",
          semanticBinding: "Replacement product derivative",
        }],
      }),
      reidentify(preflight, { generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO" }),
      reidentify(preflight, {
        structuredRequest: {
          ...preflight.structuredRequest,
          duration: preflight.structuredRequest.duration === 5 ? 10 : 5,
        },
      }),
      reidentify(preflight, {
        structuredRequest: {
          ...preflight.structuredRequest,
          resolution: preflight.structuredRequest.resolution === "720p" ? "480p" : "720p",
        },
      }),
      reidentify(preflight, {
        structuredRequest: {
          ...preflight.structuredRequest,
          watermark: !preflight.structuredRequest.watermark,
        },
      }),
    ];
    for (const scheduled of cases) {
      expect(validateAiStoryCompiledRequestFingerprint(scheduled)).toBe(true);
      expect(compareCertificationCompiledRequestSemantics(scheduled, preflight).equivalent).toBe(false);
    }
    const native = compileSeedanceNativeDialogueCertificationRequest();
    expect(native.baseRequest.structuredRequest.generateAudio).toBe(false);
    expect(native.request.structuredRequest.generateAudio).toBe(true);
    expect(validateAiStoryCompiledRequestFingerprint(native.baseRequest)).toBe(true);
    expect(validateAiStoryCompiledRequestFingerprint(native.request)).toBe(true);
    expect(compareCertificationCompiledRequestSemantics(native.request, native.baseRequest).equivalent).toBe(false);
    expect(() => reidentify(preflight, { modelId: "other-model" })).toThrow();
    const tampered = {
      ...preflight,
      requestFingerprint: `sha256:${"0".repeat(64)}`,
    };
    expect(validateAiStoryCompiledRequestFingerprint(tampered)).toBe(false);
    expect(certifyScheduledRequestAgainstPreflight({
      scheduled: tampered,
      preflight,
    }).stableSemanticEquivalent).toBe(false);
  });
});
