import { describe, expect, it } from "vitest";
import {
  projectNarrativeWorldState,
  resolveActiveAuthorityProjection,
  resolveActiveSceneIntent,
  type CreativeAuthorityLayer,
  type NarrativeSceneSnapshot,
} from "../packages/agents/src/ai-story/active-intent-world-state";

const complete = (overrides: Partial<CreativeAuthorityLayer> = {}): CreativeAuthorityLayer => ({
  authorityId: "scene-v1",
  kind: "CANONICAL_SCENE_INTENT",
  classification: "ACTIVE",
  governs: [
    "location", "charactersPresent", "actions", "continuityRequirements", "changes",
    "mustNotInherit", "narrativePurpose", "possessions", "incomingTransition", "outgoingTransition",
  ],
  values: {
    location: { id: "shop", label: "Flower shop" },
    charactersPresent: ["mara"],
    actions: ["Mara presents the bouquet"],
    continuityRequirements: ["Preserve bouquet identity"],
    changes: [],
    mustNotInherit: [],
    narrativePurpose: "Florist presentation",
    possessions: [{ objectId: "bouquet", holder: "mara" }],
    incomingTransition: null,
    outgoingTransition: null,
  },
  ...overrides,
});

function scene(
  sceneId: string,
  order: number,
  locationId: string,
  charactersPresent: readonly string[],
  possessionFacts: NarrativeSceneSnapshot["possessionFacts"] = []
): NarrativeSceneSnapshot {
  return { sceneId, order, location: { id: locationId, label: locationId.toUpperCase() }, charactersPresent, possessionFacts };
}

describe("AI Story V1 Latest Authority Wins", () => {
  it("projects Human Review correction over retry target and retains rejected history as audit only", () => {
    const original = complete({ classification: "REJECTED" });
    const retry = complete({
      authorityId: "retry-v2",
      kind: "REVIEW_RETRY_TARGET",
      values: {
        ...complete().values,
        location: { id: "urban-walkway", label: "Urban walkway" },
        actions: ["Mara walks forward carrying the bouquet", "A courier passes in the background"],
        narrativePurpose: "Delivery journey",
        mustNotInherit: ["static florist workbench presentation"],
      },
    });
    const review = complete({
      authorityId: "review-v3",
      kind: "HUMAN_REVIEW_CORRECTION",
      values: {
        ...retry.values,
        changes: ["Location and action corrected by latest Human Review"],
      },
    });
    const result = resolveActiveSceneIntent([original, retry, review]);

    expect(result.location.id).toBe("urban-walkway");
    expect(result.actions).toContain("A courier passes in the background");
    expect(JSON.stringify(result)).not.toContain("Mara presents the bouquet");
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ authorityId: "scene-v1", classification: "REJECTED" }),
      expect.objectContaining({ authorityId: "review-v3", classification: "ACTIVE" }),
    ]));
  });

  it("fails closed when current authority governs a required field but omits its value", () => {
    const stale = complete();
    const incomplete: CreativeAuthorityLayer = {
      authorityId: "review-incomplete",
      kind: "HUMAN_REVIEW_CORRECTION",
      classification: "ACTIVE",
      governs: ["location"],
      values: {},
    };
    expect(() => resolveActiveSceneIntent([stale, incomplete])).toThrow(
      "ACTIVE_SCENE_INTENT_AUTHORITY_INCOMPLETE:review-incomplete:location"
    );
  });

  it("never restores a superseded field through legacy nullish fallback", () => {
    const result = resolveActiveAuthorityProjection([
      complete({ classification: "SUPERSEDED" }),
      {
        authorityId: "current",
        kind: "REVIEW_RETRY_TARGET",
        classification: "ACTIVE",
        governs: ["actions"],
        values: { actions: ["Current delivery action"] },
      },
    ], ["actions"]);
    expect(result.values.actions).toEqual(["Current delivery action"]);
    expect(JSON.stringify(result.values)).not.toContain("presents the bouquet");
  });
});

describe("AI Story V1 narrative world state", () => {
  it("invalidates flower shop after exit and makes home the only active environment", () => {
    const scenes = [
      scene("a", 0, "flower-shop", ["mara"]),
      { ...scene("b", 1, "street", ["mara"]), transitions: [{ type: "EXIT_LOCATION" as const, locationId: "flower-shop" }] },
      scene("c", 2, "home", ["mara"]),
    ];
    const result = projectNarrativeWorldState(scenes, "c");
    expect(result.currentLocation.id).toBe("home");
    expect(result.historicalLocations.map((location) => location.id)).toEqual(["flower-shop", "street"]);
    expect(result.charactersPresent).toEqual(["mara"]);
    expect(result.incomingTransition).toEqual({ type: "MOVE_TO_LOCATION", fromLocationId: "street", toLocationId: "home" });
  });

  it("moves coffee possession to the park without carrying the barista forward", () => {
    const scenes = [
      scene("a", 0, "cafe", ["customer", "barista"], [{ objectId: "coffee", holder: "customer" }]),
      scene("b", 1, "street", ["customer"], [{ objectId: "coffee", holder: "customer" }]),
      scene("c", 2, "park", ["customer"], [{ objectId: "coffee", holder: "customer" }]),
    ];
    const result = projectNarrativeWorldState(scenes, "c");
    expect(result.currentLocation.id).toBe("park");
    expect(result.possessions).toContainEqual({ objectId: "coffee", holder: "customer" });
    expect(result.charactersPresent).not.toContain("barista");
    expect(result.historicalLocations).toContainEqual({ id: "cafe", label: "CAFE" });
  });

  it("moves dog and owner from home to park without keeping home active", () => {
    const scenes = [
      scene("a", 0, "home", ["dog"]),
      scene("b", 1, "street", ["dog", "owner"]),
      scene("c", 2, "park", ["dog", "owner"]),
    ];
    const result = projectNarrativeWorldState(scenes, "c");
    expect(result.currentLocation.id).toBe("park");
    expect(result.charactersPresent).toEqual(["dog", "owner"]);
    expect(result.historicalLocations.map((location) => location.id)).toContain("home");
    expect(result.historicalLocations.map((location) => location.id)).not.toContain("park");
  });

  it("applies latest possession transfer instead of retaining both holders", () => {
    const scenes: NarrativeSceneSnapshot[] = [
      scene("a", 0, "walkway", ["mara"], [{ objectId: "bouquet", holder: "mara" }]),
      {
        ...scene("b", 1, "doorstep", ["mara", "avery"]),
        transitions: [{ type: "TRANSFER_OBJECT", objectId: "bouquet", fromHolderId: "mara", toHolderId: "avery" }],
      },
    ];
    expect(projectNarrativeWorldState(scenes, "b").possessions).toEqual([
      { objectId: "bouquet", holder: "avery" },
    ]);
  });
});
