import { readFileSync } from "node:fs";
import { zodResponseFormat } from "../packages/agents/node_modules/openai/helpers/zod.mjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({
  callStructuredJsonModel,
  callJsonModel: vi.fn(),
}));

import {
  AI_STORY_CAMERA_FAMILIES,
  AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY,
  ShotPlanItemSchema,
  bindProductShotCameraSafety,
} from "@ceo-agent/shared";
import {
  buildShotPlanProviderOutputSchema,
  generateShotPlan,
  materializeShotPlanFromProvider,
} from "../packages/agents/src/ai-story/story-planning-service";

const productScene = {
  id: "plan-product",
  generationAuthority: { productVisualIdentityRequirement: "REQUIRED" as const },
};
const ordinaryScene = {
  id: "plan-ordinary",
  generationAuthority: { productVisualIdentityRequirement: "NONE" as const },
};

function shot(cameraFamily: string, information = "The audience sees the next beat.") {
  return {
    cameraFamily,
    composition: "The subject holds the center of the frame.",
    framing: "Medium",
    lensSuggestion: "35mm",
    durationSec: 3,
    focus: "The subject",
    emotion: "Curious",
    information,
  };
}

function schema() {
  return buildShotPlanProviderOutputSchema([productScene, ordinaryScene]);
}

function assertResponseFormatHasNoUnsupportedNot(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertResponseFormatHasNoUnsupportedNot(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toBe("not");
    assertResponseFormatHasNoUnsupportedNot(child);
  }
}

describe("AI Story shot camera family structural authority", () => {
  beforeEach(() => {
    callStructuredJsonModel.mockReset();
  });

  it("constrains product scenes to identity-safe families and ordinary scenes to the registry", () => {
    const output = schema();
    const base = {
      shotsByScene: {
        scene_0: [shot("STATIC")],
        scene_1: [shot("PAN")],
      },
    };
    for (const cameraFamily of ["STATIC", "SMALL_ARC"] as const) {
      expect(output.safeParse({
        shotsByScene: { ...base.shotsByScene, scene_0: [shot(cameraFamily)] },
      }).success).toBe(true);
    }
    expect(output.safeParse({
      shotsByScene: { ...base.shotsByScene, scene_0: [shot("ORBIT")] },
    }).success).toBe(false);
    expect(output.safeParse({
      shotsByScene: { ...base.shotsByScene, scene_0: [shot("small 10-20 degree arc")] },
    }).success).toBe(false);
    for (const cameraFamily of ["PAN", "TRACKING"] as const) {
      expect(output.safeParse({
        shotsByScene: { ...base.shotsByScene, scene_1: [shot(cameraFamily)] },
      }).success).toBe(true);
    }
    expect(output.safeParse({
      shotsByScene: { ...base.shotsByScene, scene_1: [shot("small cinematic arc")] },
    }).success).toBe(false);
    expect(output.safeParse({
      shotsByScene: { scene_0: [], scene_1: [shot("PAN")] },
    }).success).toBe(false);
  });

  it("maps scene keys to Scene Plan IDs and owns flattened Shot order", () => {
    const shots = materializeShotPlanFromProvider({
      scenePlan: [productScene, ordinaryScene],
      shotsByScene: {
        scene_0: [shot("STATIC", "Opening"), shot("SMALL_ARC", "Detail")],
        scene_1: [shot("TRACKING", "Follow")],
      },
    });
    expect(shots.map((item) => item.sceneId)).toEqual(["plan-product", "plan-product", "plan-ordinary"]);
    expect(shots.map((item) => item.order)).toEqual([0, 1, 2]);
    expect(shots.map((item) => item.id)).toEqual(["shot-001", "shot-002", "shot-003"]);
    expect(shots.map((item) => item.cameraMovement)).toEqual(["STATIC", "SMALL_ARC", "TRACKING"]);
    expect(shots.map((item) => item.cameraType)).toEqual(["STATIC", "SMALL_ARC", "TRACKING"]);
    expect(shots.some((item) => "cameraFamily" in item)).toBe(false);
  });

  it("still binds product camera safety and rejects a contradictory persisted proof", () => {
    const [productShot] = materializeShotPlanFromProvider({
      scenePlan: [productScene],
      shotsByScene: { scene_0: [shot("STATIC")] },
    });
    const bound = bindProductShotCameraSafety({
      scenePlan: [productScene],
      shotPlan: [productShot!],
    });
    expect(bound[0]?.cameraSafety).toMatchObject({
      cameraFamily: "STATIC",
      perspectiveChange: "MINIMAL",
      revealsUnseenProductSurface: false,
      productIdentityTransformation: false,
      policyId: AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.policyId,
    });
    expect(() => bindProductShotCameraSafety({
      scenePlan: [productScene],
      shotPlan: [{
        ...bound[0]!,
        cameraSafety: { ...bound[0]!.cameraSafety!, perspectiveChange: "LARGE" },
      }],
    })).toThrow("PRODUCT_CAMERA_SAFETY_CONTRADICTION");
  });

  it("keeps historical free-text Shot records readable", () => {
    const historical = ShotPlanItemSchema.parse({
      id: "legacy-shot",
      sceneId: "legacy-scene",
      cameraType: "close-up detail",
      cameraMovement: "small cinematic arc",
      composition: "The product fills the frame.",
      framing: "Close",
      durationSec: 2,
      focus: "Product",
      emotion: "Warm",
      information: "A historical free-text camera record.",
      order: 0,
    });
    expect(historical.cameraMovement).toBe("small cinematic arc");
    expect(historical.cameraSafety).toBeUndefined();
  });

  it("generates a strict OpenAI response schema from the camera-family registry", () => {
    const output = schema();
    const format = zodResponseFormat(output, "ai_story_shot_plan_v1");
    assertResponseFormatHasNoUnsupportedNot(format);
    const root = format.json_schema.schema as {
      definitions?: Record<string, { enum?: string[] }>;
      properties: { shotsByScene: { properties: Record<string, { items?: { properties?: { cameraFamily?: { $ref?: string; enum?: string[] } } } }> } };
    };
    const resolve = (schemaNode: { $ref?: string; enum?: string[] } | undefined) => {
      const name = schemaNode?.$ref?.replace("#/definitions/", "");
      return (name ? root.definitions?.[name]?.enum : schemaNode?.enum) ?? [];
    };
    const scenes = root.properties.shotsByScene.properties;
    const productFamilies = resolve(scenes.scene_0?.items?.properties?.cameraFamily);
    const ordinaryFamilies = resolve(scenes.scene_1?.items?.properties?.cameraFamily);
    expect(productFamilies).toEqual([...AI_STORY_PRODUCT_CAMERA_SAFETY_POLICY.identitySafeFamilies]);
    expect(productFamilies).not.toContain("ORBIT");
    expect(ordinaryFamilies).toEqual([...AI_STORY_CAMERA_FAMILIES]);
    expect(ordinaryFamilies).toEqual(expect.arrayContaining(["PAN", "TRACKING", "ORBIT"]));
    expect(JSON.stringify(format)).not.toContain("small 10-20 degree arc");
  });

  it("projects provider tokens through Shot planning without story-specific camera prose", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({
      result: {
        shotsByScene: {
          scene_0: [shot("SMALL_ARC")],
          scene_1: [shot("PAN")],
        },
      },
      usage: { input: 4, output: 2, costUsd: 0 },
    });
    const result = await generateShotPlan({
      story: { title: "Counter" } as never,
      creativeContext: {} as never,
      directorThinking: {} as never,
      storyBeats: [],
      scenePlan: [
        { ...productScene, beatIds: ["beat-1"], purpose: "Open", durationSec: 4, transition: "", continuityNotes: "", order: 0 },
        { ...ordinaryScene, beatIds: ["beat-2"], purpose: "Continue", durationSec: 4, transition: "", continuityNotes: "", order: 1 },
      ],
    });
    expect(result.shotPlan.map((item) => [item.id, item.sceneId, item.order, item.cameraMovement])).toEqual([
      ["shot-001", "plan-product", 0, "SMALL_ARC"],
      ["shot-002", "plan-ordinary", 1, "PAN"],
    ]);
    expect(result.shotPlan[0]?.cameraSafety?.cameraFamily).toBe("SMALL_ARC");
    expect(result.shotPlan[1]?.cameraSafety).toBeUndefined();
    expect(callStructuredJsonModel).toHaveBeenCalledWith(expect.objectContaining({
      schemaName: "ai_story_shot_plan_v1",
      certificationStage: "shot_plan",
      system: expect.stringContaining("shotsByScene"),
    }));
    expect(callStructuredJsonModel.mock.calls[0]?.[0].system).toContain("SMALL_ARC");
    expect(callStructuredJsonModel.mock.calls[0]?.[0].system).not.toContain("10-20");
    expect(readFileSync("packages/agents/src/ai-story/story-planning-service.ts", "utf8"))
      .not.toMatch(/Mini Fan|Nasi Lemak|\bYuki\b/);
  });
});
