import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AnimationPackagePayloadSchema,
  CreativeContextSchema,
  type PlanningProductAuthorityProjection,
} from "@ceo-agent/shared";
import {
  AiStoryPlanningProductAuthorityError,
  assertPlanningProductAuthorityCurrent,
  bindCreativeContextToProductAuthority,
  planningProductAuthorityPrompt,
  projectStoryProductSourcesToPlanning,
  type StoryProductSourceAuthorityForPlanning,
} from "../packages/agents/src/ai-story/product-authority-planning";
import { resolveEffectiveSceneGenerationAuthority } from "../packages/agents/src/ai-story/scene-execution-compiler";

const id = (n: number) =>
  `93000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (letter: string) => `sha256:${letter.repeat(64)}`;

function source(assetId: string, contentHash = hash("a")) {
  return {
    storyId: id(1),
    assetId,
    usageType: "product_source" as const,
    orgId: id(2),
    workspaceId: id(3),
    campaignId: id(4),
    contentHash,
    status: "ready",
  };
}

function authority(
  assetId = id(10),
  contentHash = hash("a")
): PlanningProductAuthorityProjection {
  return {
    productAuthorityId: assetId,
    sourceAssetId: assetId,
    sourceAssetContentHash: contentHash,
  };
}

function creativeContext(options: {
  productAuthorities?: PlanningProductAuthorityProjection[];
  objects?: string[];
  summary?: string;
} = {}) {
  return CreativeContextSchema.parse({
    storyContext: { summary: options.summary ?? "A Product supports the story." },
    characterContext: { characters: [], relationships: [] },
    productAuthorities: options.productAuthorities,
    worldContext: { objects: options.objects ?? ["vase", "counter", "courier bag"] },
    narrativeContext: {},
    directorContext: {},
  });
}

describe("AI Story Product authority Planning bridge", () => {
  it("projects persisted product_source exactly into V1 Product Planning authority", () => {
    const projected = projectStoryProductSourcesToPlanning([source(id(10), hash("b"))]);
    expect(projected).toEqual([
      {
        productAuthorityId: id(10),
        sourceAssetId: id(10),
        sourceAssetContentHash: hash("b"),
      },
    ]);
  });

  it("never admits a legacy reference row as Product authority", () => {
    expect(() =>
      projectStoryProductSourcesToPlanning([
        { ...source(id(10)), usageType: "reference" },
      ] as unknown as StoryProductSourceAuthorityForPlanning[])
    ).toThrowError(AiStoryPlanningProductAuthorityError);
  });

  it("uses exact persisted IDs, never equal labels, to establish authority", () => {
    const projected = projectStoryProductSourcesToPlanning([
      { ...source(id(11)), displayName: "Spring Bouquet" },
    ]);
    expect(projected).toEqual([authority(id(11))]);
    expect(projected[0]?.productAuthorityId).not.toBe(id(10));
    expect(projected[0]).not.toHaveProperty("displayName");
  });

  it("preserves sourceAssetContentHash byte-for-byte", () => {
    const exactHash = hash("c");
    expect(
      projectStoryProductSourcesToPlanning([source(id(10), exactHash)])[0]
        ?.sourceAssetContentHash
    ).toBe(exactHash);
  });

  it("restores server authority after LLM omission and rejects any override or unknown ID", () => {
    const accepted = [authority()];
    expect(
      bindCreativeContextToProductAuthority({
        creativeContext: creativeContext(),
        productAuthorities: accepted,
      }).productAuthorities
    ).toEqual(accepted);

    for (const attempted of [
      authority(id(99)),
      authority(id(10), hash("d")),
    ]) {
      expect(() =>
        bindCreativeContextToProductAuthority({
          creativeContext: creativeContext({ productAuthorities: [attempted] }),
          productAuthorities: accepted,
        })
      ).toThrowError(AiStoryPlanningProductAuthorityError);
    }
  });

  it("fails later Planning closed when a Product is removed, replaced, or hash-stale", () => {
    const persisted = creativeContext({ productAuthorities: [authority()] });
    for (const current of [
      [],
      [authority(id(11))],
      [authority(id(10), hash("e"))],
    ]) {
      expect(() =>
        assertPlanningProductAuthorityCurrent({
          creativeContext: persisted,
          productAuthorities: current,
        })
      ).toThrowError(/stale/i);
    }
  });

  it("keeps invented generic props outside Product authority", () => {
    const bound = bindCreativeContextToProductAuthority({
      creativeContext: creativeContext({
        objects: ["vase", "table", "counter", "courier bag", "gift card"],
      }),
      productAuthorities: [authority()],
    });
    expect(bound.worldContext.objects).toContain("vase");
    expect(bound.productAuthorities).toEqual([authority()]);
    expect(bound.productAuthorities).toHaveLength(1);
  });

  it("sorts multiple Product sources deterministically and rejects duplicates", () => {
    const first = projectStoryProductSourcesToPlanning([
      source(id(12), hash("c")),
      source(id(10), hash("a")),
      source(id(11), hash("b")),
    ]);
    const second = projectStoryProductSourcesToPlanning([
      source(id(11), hash("b")),
      source(id(12), hash("c")),
      source(id(10), hash("a")),
    ]);
    expect(first).toEqual(second);
    expect(first.map((item) => item.productAuthorityId)).toEqual([
      id(10),
      id(11),
      id(12),
    ]);
    expect(() =>
      projectStoryProductSourcesToPlanning([source(id(10)), source(id(10))])
    ).toThrowError(/duplicate/i);
  });

  it("allows narrative Product use to evolve without changing Product identity", () => {
    const accepted = [authority()];
    const introduction = bindCreativeContextToProductAuthority({
      creativeContext: creativeContext({ summary: "Introduce the Product." }),
      productAuthorities: accepted,
    });
    const delivery = bindCreativeContextToProductAuthority({
      creativeContext: creativeContext({ summary: "Carry it toward delivery." }),
      productAuthorities: accepted,
    });
    expect(introduction.storyContext.summary).not.toBe(delivery.storyContext.summary);
    expect(introduction.productAuthorities).toEqual(delivery.productAuthorities);
  });

  it("does not turn Product availability into a visual requirement or I2V mode", () => {
    const accepted = projectStoryProductSourcesToPlanning([source(id(10))]);
    expect(accepted).toHaveLength(1);
    const resolved = resolveEffectiveSceneGenerationAuthority(
      {
        id: "human-scene",
        beatIds: ["beat-human"],
        purpose: "Human narrative; Product is not visually required",
        durationSec: 6,
        transition: "cut",
        continuityNotes: "Keep this Scene reference-free",
        order: 0,
        generationAuthority: {
          strategy: "TEXT_TO_VIDEO",
          referenceSource: "REFERENCE_FREE_T2V",
          effectiveReferenceIds: [],
          firstFrameAssetId: null,
          productVisualIdentityRequirement: "NONE",
        },
      },
      [id(10)]
    );
    expect(resolved.effectiveReferenceIds).toEqual([]);
    expect(resolved.firstFrameAssetId).toBeNull();
  });

  it("persists one stable Product projection through Creative Context and Animation Package", () => {
    const productAuthorities = [authority()];
    const context = bindCreativeContextToProductAuthority({
      creativeContext: creativeContext(),
      productAuthorities,
    });
    const parsed = AnimationPackagePayloadSchema.parse({
      story: {
        title: "Product story",
        summary: "Narrative",
        objective: "Awareness",
        targetAudience: "Customers",
        tone: "Warm",
        estimatedDuration: "6s",
        story: { opening: "Open", development: "Develop", ending: "End" },
        keyMessages: [],
        cta: "Learn more",
        assetReferences: [],
        warnings: [],
      },
      characters: [],
      creativeContext: context,
      directorThinking: {
        coreMessage: "Message",
        hero: "Narrative lead",
        conflict: "Need",
        turningPoint: "Discovery",
        climax: "Resolution",
        takeaway: "Learn more",
      },
      storyBeats: [
        { id: "beat-1", name: "Opening", purpose: "Open", order: 0, summary: "Open" },
      ],
      scenePlan: [
        { id: "scene-1", beatIds: ["beat-1"], purpose: "Open", durationSec: 6, order: 0 },
      ],
      shotPlan: [
        {
          id: "shot-1",
          sceneId: "scene-1",
          cameraType: "wide",
          cameraMovement: "static",
          composition: "balanced",
          framing: "vertical",
          durationSec: 6,
          focus: "story",
          emotion: "warm",
          information: "opening",
          order: 0,
        },
      ],
      characterContinuity: [],
      worldContinuity: {
        location: "studio",
        lighting: "soft",
        environment: "minimal",
        objects: ["table"],
        timeline: "present",
        worldRules: ["continuity"],
      },
      narrative: context.narrativeContext,
      narrativeIntegration: { consistent: true, issues: [], links: [] },
      status: "review",
    });
    expect(parsed.creativeContext.productAuthorities).toEqual(productAuthorities);
  });

  it("uses the certified resolver and stale guard in the authenticated stage runner", () => {
    const runner = readFileSync(
      "apps/web/src/lib/ai-story-planning-runner.ts",
      "utf8"
    );
    expect(runner).toContain("resolveStoryProductSources");
    expect(runner).toContain("projectStoryProductSourcesToPlanning");
    expect(runner).toContain("assertPlanningProductAuthorityCurrent");
    expect(runner).toContain("productAuthorities: ctx.productAuthorities");
  });

  it("provides only exact server authority to the LLM prompt without display-name matching", () => {
    const prompt = planningProductAuthorityPrompt([authority()]);
    expect(prompt).toContain(id(10));
    expect(prompt).toContain(hash("a"));
    expect(prompt).toContain("exact productAuthorityId");
    expect(prompt).toContain("generic prop");
    expect(prompt).not.toContain("Spring Bouquet");
  });
});
