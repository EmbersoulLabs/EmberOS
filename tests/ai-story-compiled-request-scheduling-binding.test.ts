import { describe, expect, it } from "vitest";
import {
  compileImmutableSeedanceRequestFromSceneCompilation,
  validateAiStoryCompiledRequestFingerprint,
} from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const AUTHORITY = {
  qcEvaluationId: "30000000-0000-4000-8000-000000000001",
  qcFingerprint: `sha256:${"a".repeat(64)}`,
  qcCapabilityVersion: "seedance-modelark-test.v1",
  directorFingerprint: `sha256:${"b".repeat(64)}`,
  motionFingerprint: `sha256:${"c".repeat(64)}`,
} as const;

function inputs(mode: "T2V" | "I2V") {
  const compilation = makePhase2aCompilation({ sceneOrder: [0] });
  const baseIntent = compilation.intents[0]!;
  const baseInstructions = compilation.instructionsBySceneExecutionId[
    baseIntent.identity.sceneExecutionId
  ]!;
  if (mode === "I2V") {
    return { intent: baseIntent, instructions: baseInstructions };
  }
  const generationAuthority = {
    strategy: "TEXT_TO_VIDEO" as const,
    referenceSource: "REFERENCE_FREE_T2V" as const,
    effectiveReferenceIds: [],
    firstFrameAssetId: null,
    productVisualIdentityRequirement: "NONE" as const,
  };
  return {
    intent: {
      ...baseIntent,
      referencedAssetIds: [],
      generationAuthority,
    },
    instructions: {
      ...baseInstructions,
      referencedAssetIds: [],
      generationAuthority,
    },
  };
}

function compile(mode: "T2V" | "I2V") {
  return compileImmutableSeedanceRequestFromSceneCompilation({
    ...inputs(mode),
    authority: AUTHORITY,
    adapterVersion: "1.0.0",
    compiledAt: "2026-09-01T00:00:00.000Z",
    resolution: "480p",
  });
}

describe("compiled Provider request scheduling authority", () => {
  it("converges the same protected execution and canonical input", () => {
    const first = compile("T2V");
    const replay = compile("T2V");
    expect(replay).toEqual(first);
    expect(first.generationMode).toBe("TEXT_TO_VIDEO");
    expect(first.referenceMappings).toEqual([]);
    expect(validateAiStoryCompiledRequestFingerprint(first)).toBe(true);
  });

  it("persists pricing-significant T2V/I2V dimensions and distinct fingerprints", () => {
    const t2v = compile("T2V");
    const i2v = compile("I2V");
    expect(t2v.structuredRequest).toMatchObject({
      model: "dreamina-seedance-2-0-260128",
      duration: 4,
      ratio: "9:16",
      resolution: "480p",
    });
    expect(i2v.generationMode).toBe("FIRST_FRAME_IMAGE_TO_VIDEO");
    expect(i2v.referenceMappings[0]).toMatchObject({
      wireRole: "first_frame",
      assetId: inputs("I2V").intent.referencedAssetIds[0],
    });
    expect(i2v.requestFingerprint).not.toBe(t2v.requestFingerprint);
  });

  it("fails closed instead of treating missing I2V references as T2V", () => {
    const { intent, instructions } = inputs("I2V");
    expect(() => compileImmutableSeedanceRequestFromSceneCompilation({
      intent: { ...intent, referencedAssetIds: [] },
      instructions: { ...instructions, referencedAssetIds: [] },
      authority: AUTHORITY,
      adapterVersion: "1.0.0",
      compiledAt: "2026-09-01T00:00:00.000Z",
    })).toThrow(/explicit TEXT_TO_VIDEO authority/);
  });
});
