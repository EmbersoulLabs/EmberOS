import { describe, expect, it } from "vitest";
import {
  AiStoryCanonicalSceneCompiledInstructionsSchema,
  AiStorySceneCompiledInstructionsSchema,
} from "@ceo-agent/shared";

const historical = {
  contractVersion: "1" as const,
  capabilityId: "animation-video-generation" as const,
  sceneId: "scene-1",
  sceneVersionId: "43bbcac2-6827-5e00-ae68-b5686da3d441",
  sceneFingerprint: `sha256:${"a".repeat(64)}`,
  scriptVersionId: "fe6abb99-156b-555b-b159-d4b7a4d0802c",
  sceneSetFingerprint: `sha256:${"b".repeat(64)}`,
  sceneOrder: 0,
  purpose: "arranging flowers naturally",
  durationMs: 8000,
  shots: [{
    shotId: "shot-1",
    order: 0,
    durationMs: 8000,
    focus: "arranging flowers naturally",
    information: "These flowers are ready for today.",
  }],
  productIdentityConstraints: ["Preserve approved product identity."],
};

describe("historical Scene instruction compatibility", () => {
  it("defaults descriptive camera fields that were absent from certified historical snapshots", () => {
    const parsed = AiStorySceneCompiledInstructionsSchema.parse(historical);
    expect(parsed.shots[0]).toMatchObject({
      cameraType: "",
      cameraMovement: "",
      composition: "",
      framing: "",
      emotion: "",
    });
  });

  it("keeps canonical new-write instructions fail-closed", () => {
    expect(() =>
      AiStoryCanonicalSceneCompiledInstructionsSchema.parse(historical)
    ).toThrow();
  });
});
