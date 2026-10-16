import { describe, expect, it } from "vitest";
import {
  assertCreativeCharactersMatchAuthorities,
  projectAcceptedCharactersToPlanning,
  projectStoryProductSourcesToPlanning,
} from "@ceo-agent/agents";

const id = (n: number) =>
  `97000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `sha256:${"a".repeat(64)}`;

describe("AI Story optional authority combination contract", () => {
  it.each([
    { name: "neither Character nor Product", hasCharacter: false, products: [] },
    {
      name: "Product only", hasCharacter: false,
      products: [{ assetId: id(5), usageType: "product_source" as const, contentHash: hash }],
    },
    { name: "Character only", hasCharacter: true, products: [] },
    {
      name: "Character and Product", hasCharacter: true,
      products: [{ assetId: id(5), usageType: "product_source" as const, contentHash: hash }],
    },
  ])("accepts $name without fabricating missing authority", ({ hasCharacter, products }) => {
    const noCharacters = projectAcceptedCharactersToPlanning({
      orgId: id(1), workspaceId: id(2), campaignId: id(3), characters: [],
    });
    const projectedProducts = projectStoryProductSourcesToPlanning(products);
    expect(noCharacters).toEqual([]);
    expect(projectedProducts).toHaveLength(products.length);
    expect(() => assertCreativeCharactersMatchAuthorities({
      characters: hasCharacter
        ? [{ id: id(8), canonicalAuthority: { characterId: id(8) } }]
        : [],
      characterAuthorities: hasCharacter ? [{ characterId: id(8) }] : [],
    })).not.toThrow();
  });

  it("keeps Product authority strict when a Product is actually present", () => {
    expect(() => projectStoryProductSourcesToPlanning([
      { assetId: id(5), usageType: "product_source", contentHash: "not-a-content-hash" },
    ])).toThrow(/Product source cannot enter Planning authority/);
  });

  it("keeps Character authority strict when a Character is actually required", () => {
    expect(() => assertCreativeCharactersMatchAuthorities({
      characters: [{ id: "proposal-1", proposalOnly: true }],
      characterAuthorities: [],
    })).toThrow("CHARACTER_PROPOSAL_ACCEPTANCE_REQUIRED");
  });
});
