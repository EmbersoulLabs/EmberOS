import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({
  callJsonModel: vi.fn(),
  callStructuredJsonModel,
}));

import {
  bindMentionedCatalogChoiceEvidence,
  bindVisualClaimSubjectEvidence,
  bindSceneGroundingProposalIdsByPlanOrder,
  buildScenePlanProviderOutputSchema,
  deriveAllowedSceneVisualSubjects,
  generateScenePlan,
  normalizeExistenceOnlySceneGrounding,
  reconcileSupportingOnlySceneAuthority,
  omitCharacterNamedVisualClaims,
  retainSupportedSceneGroundingEvidence,
  removeUnsupportedObservedAppearance,
} from "../packages/agents/src/ai-story/story-planning-service";

const input = {
  story: {
    title: "Fresh Lily Bouquet",
    summary: "A florist arranges fresh lilies.",
    objective: "Awareness",
    targetAudience: "Local customers",
    tone: "Friendly",
    estimatedDuration: "15s",
    story: { opening: "Open", development: "Arrange", ending: "Present" },
    keyMessages: [],
    cta: "Order today",
    assetReferences: [],
    warnings: [],
  },
  creativeContext: {
    storyContext: { title: "Fresh Lily Bouquet", summary: "A florist arranges fresh lilies.", objective: "Awareness", targetAudience: "Local customers", tone: "Friendly", estimatedDuration: "15s", keyMessages: [], cta: "Order today" },
    characterContext: { characters: [], relationships: [] },
    productAuthorities: [],
    worldContext: { locations: ["Flower shop"], visualStyle: "Natural", lighting: "Warm", environment: "Shop", objects: ["Lilies"], timeline: "Present", worldRules: ["Flowers stay fresh"] },
    narrativeContext: { arc: "Arrange and present", pacing: "Quick", emotionalJourney: "Satisfied", themes: ["Craft"], dialogue: [] },
    directorContext: {},
  },
  directorThinking: { coreMessage: "Fresh craft", hero: "Florist", conflict: "Time", turningPoint: "Bouquet completes", climax: "Presentation", takeaway: "Order today" },
  storyBeats: [{ id: "beat-001", name: "Opening", purpose: "Introduce", order: 0, summary: "The florist begins." }],
  assetGrounding: {
    contractVersion: "ai-story-scene-grounding-context.v1" as const,
    orgId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "20000000-0000-4000-8000-000000000002",
    storyId: "30000000-0000-4000-8000-000000000003",
    storyVersionId: "40000000-0000-4000-8000-000000000004",
    matchingResultId: "50000000-0000-4000-8000-000000000005",
    bindings: [],
  },
};

const plannedScene = {
  id: "scene-001",
  beatIds: ["beat-001"],
  purpose: "Introduce the florist and lilies.",
  durationSec: 8,
  transition: "cut",
  continuityNotes: "The same florist remains in the flower shop.",
  order: 0,
  generationAuthority: {
    strategy: "TEXT_TO_VIDEO" as const,
    referenceSource: "REFERENCE_FREE_T2V" as const,
    referenceAssetIds: [] as string[],
    firstFrameAssetId: null,
    productVisualIdentityRequirement: "NONE" as const,
  },
};
const groundingFields = {
  narrativeIntent: "Introduce the florist.",
  visualIntent: "Show the florist in the flower shop.",
  evidence: [] as { bindingId: string; groundedFacts: string[] }[],
  visualClaims: [] as { subject: string; detail: string; evidenceLevel: "EXISTENCE_ONLY" | "OBSERVED_APPEARANCE" }[],
};
const groundingSelection = { sceneId: "scene-001", ...groundingFields };
const validProviderResult = {
  scenePlan: [{ ...plannedScene, grounding: groundingFields }],
};

function captureError(action: () => unknown): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("AI Story Scene Plan strict structured output", () => {
  beforeEach(() => callStructuredJsonModel.mockReset());

  it("uses the strict provider schema and accepts a canonical scene plan", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({ result: validProviderResult, usage: { input: 20, output: 10, costUsd: 0.01 } });

    const result = await generateScenePlan(input);

    expect(result.scenePlan).toMatchObject([plannedScene]);
    expect(result.scenePlan[0]?.groundingLineage).toMatchObject({
      storyVersionId: input.assetGrounding.storyVersionId,
      matchingResultId: input.assetGrounding.matchingResultId,
      evidence: [],
    });
    expect(callStructuredJsonModel).toHaveBeenCalledWith(expect.objectContaining({
      schemaName: "ai_story_scene_plan_v1",
      certificationStage: "scene_plan",
    }));
    const structuredSchema = callStructuredJsonModel.mock.calls[0]?.[0]?.schema;
    expect(structuredSchema.safeParse({
      ...validProviderResult,
      scenePlan: [{
        ...validProviderResult.scenePlan[0],
        generationAuthority: {
          strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
          referenceSource: "SCENE_EXPLICIT",
          referenceAssetIds: [input.assetGrounding.bindings[0]?.assetId ?? "60000000-0000-4000-8000-000000000006"],
          firstFrameAssetId: input.assetGrounding.bindings[0]?.assetId ?? "60000000-0000-4000-8000-000000000006",
          productVisualIdentityRequirement: "NONE",
        },
      }],
    }).success).toBe(false);
  });

  it("requires grounding on every scene instead of a separate optional selection list", async () => {
    const second = {
      ...plannedScene,
      id: "scene-002",
      order: 1,
      grounding: {
        ...groundingFields,
        narrativeIntent: "Continue the florist scene.",
        visualIntent: "Keep the same flower shop.",
      },
    };
    callStructuredJsonModel.mockResolvedValueOnce({
      result: { scenePlan: [validProviderResult.scenePlan[0], second] },
      usage: { input: 20, output: 10, costUsd: 0.01 },
    });

    const result = await generateScenePlan(input);

    expect(result.scenePlan.map((scene) => scene.id)).toEqual(["scene-001", "scene-002"]);
    expect(result.scenePlan.every((scene) => scene.groundingLineage)).toBe(true);
  });

  it("fails closed on a provider decode issue", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({ result: null, decodeIssue: "INVALID_JSON", usage: { input: 20, output: 10, costUsd: 0.01 } });

    await expect(generateScenePlan(input)).rejects.toThrow("SCENE_PLAN_INVALID_JSON");
  });

  it("removes unsupported appearance detail from existence-only model claims", () => {
    expect(normalizeExistenceOnlySceneGrounding([{
      sceneId: "scene-001",
      narrativeIntent: "Show the accepted restaurant name.",
      visualIntent: "Reference the visible restaurant name only.",
      evidence: [],
      visualClaims: [{
        subject: "Tapao Jom!",
        detail: "a neon storefront sign",
        evidenceLevel: "EXISTENCE_ONLY",
      }],
    }])[0]?.visualClaims[0]).toEqual({
      subject: "Tapao Jom!",
      detail: "Tapao Jom!",
      evidenceLevel: "EXISTENCE_ONLY",
    });
  });

  it("binds equal-length grounding selections to canonical Scene ids by plan order", () => {
    expect(bindSceneGroundingProposalIdsByPlanOrder({
      sceneIds: ["scene-001", "scene-002"],
      proposals: [
        { ...groundingSelection, sceneId: "scene-1" },
        { ...groundingSelection, sceneId: "scene-2" },
      ],
    }).map((proposal) => proposal.sceneId)).toEqual(["scene-001", "scene-002"]);
  });

  it("does not fabricate missing Scene grounding selections", () => {
    expect(bindSceneGroundingProposalIdsByPlanOrder({
      sceneIds: ["scene-001", "scene-002"],
      proposals: [groundingSelection],
    })).toHaveLength(1);
  });

  it("constrains model grounding evidence to exact accepted binding ids", () => {
    const accepted = "80000000-0000-4000-8000-000000000010";
    const invented = "80000000-0000-4000-8000-000000000099";
    const schema = buildScenePlanProviderOutputSchema([accepted]);
    const withBinding = (bindingId: string) => ({
      scenePlan: [{
        ...plannedScene,
        grounding: {
          ...groundingFields,
          evidence: [{ bindingId, groundedFacts: ["Nasi Lemak"] }],
        },
      }],
    });
    expect(schema.safeParse(withBinding(accepted)).success).toBe(true);
    expect(schema.safeParse(withBinding(invented)).success).toBe(false);
    expect(schema.safeParse({
      scenePlan: [{ ...plannedScene }],
    }).success).toBe(false);
  });

  it("constrains provider visual subjects to exact accepted Asset authority", () => {
    const accepted = "80000000-0000-4000-8000-000000000010";
    const schema = buildScenePlanProviderOutputSchema([accepted], ["Nasi Lemak"]);
    const withSubject = (subject: string) => ({
      scenePlan: [{
        ...plannedScene,
        grounding: {
          ...groundingFields,
          evidence: [{ bindingId: accepted, groundedFacts: ["Nasi Lemak"] }],
          visualClaims: [{ subject, detail: subject, evidenceLevel: "EXISTENCE_ONLY" }],
        },
      }],
    });

    expect(schema.safeParse(withSubject("Nasi Lemak")).success).toBe(true);
    expect(schema.safeParse(withSubject("Yuki enjoying Nasi Lemak")).success).toBe(false);
    expect(schema.safeParse(withSubject("Yuki holding Mini Fan")).success).toBe(false);
  });

  it("requires an empty visual claim list when accepted Asset authority exposes no subjects", () => {
    const schema = buildScenePlanProviderOutputSchema([]);
    expect(schema.safeParse(validProviderResult).success).toBe(true);
    expect(schema.safeParse({
      scenePlan: [{
        ...plannedScene,
        grounding: {
          ...groundingFields,
          narrativeIntent: "Yuki smiles while greeting a customer.",
          visualIntent: "Show Yuki greeting the customer.",
          visualClaims: [{ subject: "Yuki", detail: "Yuki", evidenceLevel: "EXISTENCE_ONLY" }],
        },
      }],
    }).success).toBe(false);
  });

  it("derives canonical Asset subjects, excludes exact Character names, and deduplicates spelling", () => {
    const context = {
      ...input.assetGrounding,
      bindings: [{
        bindingId: "80000000-0000-4000-8000-000000000010",
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "SUPPORTING_REFERENCE" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
        observedFacts: ["Yuki", "Nasi Lemak"],
        namedItems: ["Yuki", "Nasi Lemak", "Menu"],
        productCandidates: [{
          name: "nasi lemak",
          relationship: "CATALOG_CHOICE" as const,
          evidence: ["visible menu text"],
        }],
      }],
    };

    expect(deriveAllowedSceneVisualSubjects({ context, characterNames: ["Yuki"] }))
      .toEqual(["Nasi Lemak", "Menu"]);
  });

  it("drops story character names from asset visual claims", () => {
    const [proposal] = omitCharacterNamedVisualClaims({
      characterNames: ["Yuki"],
      proposals: [{
        ...groundingSelection,
        visualClaims: [
          { subject: "Yuki", detail: "Yuki", evidenceLevel: "EXISTENCE_ONLY" },
          { subject: "Mini Fan", detail: "Mini Fan", evidenceLevel: "EXISTENCE_ONLY" },
        ],
      }],
    });
    expect(proposal?.visualClaims.map((claim) => claim.subject)).toEqual(["Mini Fan"]);
  });

  it("downgrades unsupported model appearance instead of accepting invented detail", () => {
    const bindingId = "80000000-0000-4000-8000-000000000010";
    const context = {
      ...input.assetGrounding,
      bindings: [{
        bindingId,
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "PRODUCT_AUTHORITY" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
        observedFacts: ["rice"],
        namedItems: ["Nasi Lemak"],
        productCandidates: [{
          name: "Nasi Lemak",
          relationship: "PRIMARY_PRODUCT" as const,
          evidence: ["rice and sambal composition"],
        }],
      }],
    };
    const proposals = [{
      ...groundingSelection,
      evidence: [{ bindingId, groundedFacts: ["Nasi Lemak"] }],
      visualClaims: [{
        subject: "Nasi Lemak",
        detail: "a golden restaurant-quality dish",
        evidenceLevel: "OBSERVED_APPEARANCE" as const,
      }],
    }];
    expect(removeUnsupportedObservedAppearance({ context, proposals })[0]?.visualClaims[0]).toEqual({
      subject: "Nasi Lemak",
      detail: "Nasi Lemak",
      evidenceLevel: "EXISTENCE_ONLY",
    });
  });

  it("binds a mentioned future menu choice to its accepted catalog evidence", () => {
    const menuBindingId = "80000000-0000-4000-8000-000000000010";
    const context = {
      ...input.assetGrounding,
      bindings: [{
        bindingId: menuBindingId,
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "SUPPORTING_REFERENCE" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
        observedFacts: ["Ayam Rendang"],
        namedItems: ["Menu", "Ayam Rendang"],
        productCandidates: [{
          name: "Ayam Rendang",
          relationship: "CATALOG_CHOICE" as const,
          evidence: ["visible menu text"],
        }],
      }],
    };
    const proposals = [{
      ...groundingSelection,
      narrativeIntent: "The customer plans to try Ayam Rendang tomorrow.",
      evidence: [],
    }];

    expect(bindMentionedCatalogChoiceEvidence({ context, proposals })[0]?.evidence).toEqual([{
      bindingId: menuBindingId,
      groundedFacts: ["Ayam Rendang"],
    }]);
  });

  it("keeps supporting-only T2V evidence outside Product identity authority", () => {
    const scene = {
      ...validProviderResult.scenePlan[0]!,
      generationAuthority: {
        ...validProviderResult.scenePlan[0]!.generationAuthority,
        productVisualIdentityRequirement: "REQUIRED" as const,
      },
    };
    const lineage = {
      contractVersion: "ai-story-scene-grounding-lineage.v1" as const,
      storyId: input.assetGrounding.storyId,
      storyVersionId: input.assetGrounding.storyVersionId,
      matchingResultId: input.assetGrounding.matchingResultId,
      narrativeIntent: "The customer asks for more sambal.",
      visualIntent: "Show sambal as a supporting condiment.",
      evidence: [{
        bindingId: "80000000-0000-4000-8000-000000000010",
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "SUPPORTING_REFERENCE" as const,
        semanticSnapshotId: "70000000-0000-4000-8000-000000000008",
        groundedFacts: ["sambal"],
      }],
      visualClaims: [{ subject: "sambal", detail: "sambal", evidenceLevel: "EXISTENCE_ONLY" as const }],
    };

    expect(reconcileSupportingOnlySceneAuthority({ scene, lineage }))
      .toEqual(expect.objectContaining({
        strategy: "TEXT_TO_VIDEO",
        referenceSource: "REFERENCE_FREE_T2V",
        productVisualIdentityRequirement: "NONE",
      }));
  });

  it("does not use a supporting-only Asset as an image-conditioned Product frame", () => {
    const scene = {
      ...validProviderResult.scenePlan[0]!,
      generationAuthority: {
        strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
        referenceSource: "SCENE_EXPLICIT" as const,
        referenceAssetIds: ["60000000-0000-4000-8000-000000000006"],
        firstFrameAssetId: "60000000-0000-4000-8000-000000000006",
        productVisualIdentityRequirement: "REQUIRED" as const,
      },
    };
    const lineage = {
      contractVersion: "ai-story-scene-grounding-lineage.v1" as const,
      storyId: input.assetGrounding.storyId,
      storyVersionId: input.assetGrounding.storyVersionId,
      matchingResultId: input.assetGrounding.matchingResultId,
      narrativeIntent: "The customer reads the menu.",
      visualIntent: "Show the menu.",
      evidence: [{
        bindingId: "80000000-0000-4000-8000-000000000010",
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "SUPPORTING_REFERENCE" as const,
        semanticSnapshotId: "70000000-0000-4000-8000-000000000008",
        groundedFacts: ["Menu"],
      }],
      visualClaims: [{ subject: "Menu", detail: "Menu", evidenceLevel: "EXISTENCE_ONLY" as const }],
    };

    expect(reconcileSupportingOnlySceneAuthority({ scene, lineage })).toEqual({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    });
  });

  it("retains only facts supported by the exact selected binding", () => {
    const menuBindingId = "80000000-0000-4000-8000-000000000010";
    const context = {
      ...input.assetGrounding,
      bindings: [{
        bindingId: menuBindingId,
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "SUPPORTING_REFERENCE" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
        observedFacts: ["Ayam Rendang"],
        namedItems: ["Menu", "Ayam Rendang"],
        productCandidates: [],
      }],
    };
    const proposals = [{
      ...groundingSelection,
      evidence: [{ bindingId: menuBindingId, groundedFacts: ["Ayam Rendang", "lobster"] }],
    }];

    expect(retainSupportedSceneGroundingEvidence({ context, proposals })[0]?.evidence).toEqual([{
      bindingId: menuBindingId,
      groundedFacts: ["Ayam Rendang"],
    }]);
  });

  it("auto-binds an exact visual subject to its unique accepted binding", () => {
    const bindingId = "80000000-0000-4000-8000-000000000010";
    const context = {
      ...input.assetGrounding,
      bindings: [{
        bindingId,
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "SUPPORTING_REFERENCE" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
        observedFacts: [],
        namedItems: ["Nasi Lemak"],
        productCandidates: [],
      }],
    };
    const [proposal] = bindVisualClaimSubjectEvidence({
      context,
      characterNames: ["Yuki"],
      proposals: [{
        ...groundingSelection,
        evidence: [],
        visualClaims: [{ subject: "Nasi Lemak", detail: "Nasi Lemak", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    });

    expect(proposal?.evidence).toEqual([{ bindingId, groundedFacts: ["Nasi Lemak"] }]);
  });

  it("merges canonical subject evidence without duplicating the binding or fact", () => {
    const bindingId = "80000000-0000-4000-8000-000000000010";
    const context = {
      ...input.assetGrounding,
      bindings: [{
        bindingId,
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "PRODUCT_AUTHORITY" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
        observedFacts: ["rice and sambal"],
        namedItems: ["Nasi Lemak"],
        productCandidates: [{
          name: "Nasi Lemak",
          relationship: "PRIMARY_PRODUCT" as const,
          evidence: ["rice and sambal"],
        }],
      }],
    };
    const [proposal] = bindVisualClaimSubjectEvidence({
      context,
      characterNames: [],
      proposals: [{
        ...groundingSelection,
        evidence: [{ bindingId, groundedFacts: ["rice and sambal", "Nasi Lemak"] }],
        visualClaims: [{ subject: "Nasi Lemak", detail: "Nasi Lemak", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    });

    expect(proposal?.evidence).toEqual([{
      bindingId,
      groundedFacts: ["rice and sambal", "Nasi Lemak"],
    }]);
  });

  it("adds the canonical subject binding without reinterpreting unrelated evidence", () => {
    const subjectBindingId = "80000000-0000-4000-8000-000000000010";
    const unrelatedBindingId = "80000000-0000-4000-8000-000000000011";
    const context = {
      ...input.assetGrounding,
      bindings: [{
        bindingId: subjectBindingId,
        assetId: "60000000-0000-4000-8000-000000000006",
        role: "SUPPORTING_REFERENCE" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
        observedFacts: [],
        namedItems: [],
        productCandidates: [{
          name: "Nasi Lemak",
          relationship: "CATALOG_CHOICE" as const,
          evidence: ["menu text"],
        }],
      }, {
        bindingId: unrelatedBindingId,
        assetId: "60000000-0000-4000-8000-000000000007",
        role: "PRODUCT_AUTHORITY" as const,
        analysisSnapshotId: "70000000-0000-4000-8000-000000000009",
        observedFacts: ["pink fan"],
        namedItems: ["Mini Fan"],
        productCandidates: [],
      }],
    };
    const [proposal] = bindVisualClaimSubjectEvidence({
      context,
      characterNames: [],
      proposals: [{
        ...groundingSelection,
        evidence: [{ bindingId: unrelatedBindingId, groundedFacts: ["pink fan"] }],
        visualClaims: [{ subject: "Nasi Lemak", detail: "Nasi Lemak", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    });

    expect(proposal?.evidence).toEqual([
      { bindingId: unrelatedBindingId, groundedFacts: ["pink fan"] },
      { bindingId: subjectBindingId, groundedFacts: ["Nasi Lemak"] },
    ]);
  });

  it("fails closed when an exact visual subject has no accepted binding", () => {
    const error = captureError(() => bindVisualClaimSubjectEvidence({
      context: input.assetGrounding,
      characterNames: [],
      proposals: [{
        ...groundingSelection,
        visualClaims: [{ subject: "Nasi Lemak", detail: "Nasi Lemak", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    }));
    expect(error).toMatchObject({ code: "SCENE_GROUNDING_SUBJECT_BINDING_REQUIRED" });
  });

  it("fails closed instead of choosing between duplicate subject bindings", () => {
    const binding = {
      assetId: "60000000-0000-4000-8000-000000000006",
      role: "SUPPORTING_REFERENCE" as const,
      analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
      observedFacts: [],
      namedItems: ["Nasi Lemak"],
      productCandidates: [],
    };
    const error = captureError(() => bindVisualClaimSubjectEvidence({
      context: {
        ...input.assetGrounding,
        bindings: [
          { ...binding, bindingId: "80000000-0000-4000-8000-000000000010" },
          { ...binding, bindingId: "80000000-0000-4000-8000-000000000011" },
        ],
      },
      characterNames: [],
      proposals: [{
        ...groundingSelection,
        visualClaims: [{ subject: "Nasi Lemak", detail: "Nasi Lemak", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    }));
    expect(error).toMatchObject({ code: "SCENE_GROUNDING_SUBJECT_BINDING_AMBIGUOUS" });
  });

  it("never auto-binds a canonical Character name as Asset evidence", () => {
    const error = captureError(() => bindVisualClaimSubjectEvidence({
      context: {
        ...input.assetGrounding,
        bindings: [{
          bindingId: "80000000-0000-4000-8000-000000000010",
          assetId: "60000000-0000-4000-8000-000000000006",
          role: "SUPPORTING_REFERENCE" as const,
          analysisSnapshotId: "70000000-0000-4000-8000-000000000008",
          observedFacts: [],
          namedItems: ["Yuki"],
          productCandidates: [],
        }],
      },
      characterNames: ["Yuki"],
      proposals: [{
        ...groundingSelection,
        visualClaims: [{ subject: "Yuki", detail: "Yuki", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    }));
    expect(error).toMatchObject({ code: "SCENE_GROUNDING_SUBJECT_BINDING_REQUIRED" });
  });

  it("fails closed when structured fields conflict with canonical generation authority", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({
      result: {
        scenePlan: [{
          ...plannedScene,
          generationAuthority: {
            ...plannedScene.generationAuthority,
            referenceSource: "SCENE_EXPLICIT" as const,
          },
          grounding: groundingFields,
        }],
      },
      usage: { input: 20, output: 10, costUsd: 0.01 },
    });

    await expect(generateScenePlan(input)).rejects.toThrow();
  });
});
