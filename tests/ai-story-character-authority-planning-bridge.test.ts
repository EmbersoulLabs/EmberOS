import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CreativeContextSchema } from "@ceo-agent/shared";
import { buildAiStoryCharacterVersion } from "@ceo-agent/shared/server";
import {
  AiStoryPlanningCharacterAuthorityError,
  assertPlanningCharacterAuthorityCurrent,
  bindCharacterContinuityToCharacterAuthority,
  bindCreativeContextToCharacterAuthority,
  projectAcceptedCharactersToPlanning,
} from "../packages/agents/src/ai-story/character-authority-planning";
import { resolveEffectiveSceneGenerationAuthority } from "../packages/agents/src/ai-story/scene-execution-compiler";

const id = (n: number) =>
  `91000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

const scope = { orgId: id(1), workspaceId: id(2), campaignId: id(3) };

function maraVersion() {
  return buildAiStoryCharacterVersion({
    characterId: id(4),
    ...scope,
    version: 2,
    status: "ACTIVE",
    facts: {
      name: "Mara",
      identity: "The campaign's thoughtful florist and delivery lead.",
      appearance: "Dark wavy hair, forest-green coat, calm attentive gaze.",
      personality: "Warm, observant, and quietly determined.",
      emotionalArc: "Moves from careful preparation to confident connection.",
      relationships: [
        {
          relationshipId: id(5),
          relatedCharacterId: id(6),
          relationshipType: "customer",
          baseline: "Mara listens before offering guidance.",
        },
      ],
      visualAssetIds: [],
    },
    visualAssetReferences: [],
    supersedesCharacterVersionId: id(7),
    createdBy: id(8),
    createdAt: "2026-09-09T04:00:00.000Z",
  });
}

function generatedContext(character: Record<string, unknown>) {
  return CreativeContextSchema.parse({
    storyContext: {},
    characterContext: { characters: [character], relationships: [] },
    worldContext: {},
    narrativeContext: {},
    directorContext: {},
  });
}

describe("AI Story canonical Character authority Planning bridge", () => {
  it("projects the accepted Character deterministically with exact lineage and no visual requirement", () => {
    const character = maraVersion();
    const first = projectAcceptedCharactersToPlanning({ ...scope, characters: [character] });
    const second = projectAcceptedCharactersToPlanning({ ...scope, characters: [character] });

    expect(first).toEqual(second);
    expect(first[0]).toEqual({
      characterId: character.characterId,
      characterVersionId: character.characterVersionId,
      characterFingerprint: character.fingerprint,
      name: "Mara",
      canonicalFacts: character.canonicalFacts,
    });
    expect(first[0]).not.toHaveProperty("visualAssetReferences");
  });

  it("allows narrative role selection but replaces LLM identity and appearance with accepted facts", () => {
    const character = maraVersion();
    const authorities = projectAcceptedCharactersToPlanning({ ...scope, characters: [character] });
    const bound = bindCreativeContextToCharacterAuthority({
      creativeContext: generatedContext({
        id: character.characterId,
        name: "A different name",
        role: "Delivery protagonist",
        description: "LLM invented identity",
        motivation: "LLM invented personality",
        visualNotes: "LLM invented appearance",
      }),
      characterAuthorities: authorities,
    });

    expect(bound.characterContext.characters[0]).toMatchObject({
      id: character.characterId,
      name: character.name,
      role: "Delivery protagonist",
      description: character.canonicalFacts.identity,
      visualNotes: character.canonicalFacts.appearance,
      canonicalAuthority: authorities[0],
    });
    expect(bound.characterContext.characters[0]?.motivation).toContain(
      character.canonicalFacts.personality
    );
  });

  it("requires exact authority identity; matching a canonical name alone fails closed", () => {
    const character = maraVersion();
    const authorities = projectAcceptedCharactersToPlanning({ ...scope, characters: [character] });
    expect(() =>
      bindCreativeContextToCharacterAuthority({
        creativeContext: generatedContext({
          id: "mara-by-name",
          name: "Mara",
          role: "Lead",
          description: "Different",
          motivation: "Different",
          visualNotes: "Different",
        }),
        characterAuthorities: authorities,
      })
    ).toThrowError(AiStoryPlanningCharacterAuthorityError);
  });

  it("keeps new LLM Characters proposal-only and never promotes them to Campaign authority", () => {
    const bound = bindCreativeContextToCharacterAuthority({
      creativeContext: generatedContext({
        id: "courier-proposal",
        name: "Courier",
        role: "Supporting",
        description: "A passing courier",
        motivation: "Complete the route",
        visualNotes: "Blue jacket",
      }),
      characterAuthorities: [],
    });
    expect(bound.characterContext.characters[0]).toMatchObject({
      id: "courier-proposal",
      proposalOnly: true,
    });
    expect(bound.characterContext.characters[0]).not.toHaveProperty("canonicalAuthority");
  });

  it("preserves stable identity across changing Scene state", () => {
    const character = maraVersion();
    const authorities = projectAcceptedCharactersToPlanning({ ...scope, characters: [character] });
    const creativeContext = bindCreativeContextToCharacterAuthority({
      creativeContext: generatedContext({
        id: character.characterId,
        name: character.name,
        role: "Lead",
        description: "ignored",
        motivation: "ignored",
        visualNotes: "ignored",
      }),
      characterAuthorities: authorities,
    });
    const sceneState = (emotion: string, pose: string) =>
      bindCharacterContinuityToCharacterAuthority({
        creativeContext,
        characterContinuity: [
          {
            characterId: character.characterId,
            name: "Mara",
            identity: "attempted override",
            appearance: "attempted override",
            emotion,
            costume: "Story-authorized rain layer",
            accessories: "Bouquet",
            age: "Adult",
            pose,
          },
        ],
      })[0]!;

    const scene1 = sceneState("Focused", "Selecting flowers at the workbench");
    const scene2 = sceneState("Hopeful", "Walking forward on an urban path");
    expect(scene1.identity).toBe(character.canonicalFacts.identity);
    expect(scene2.identity).toBe(character.canonicalFacts.identity);
    expect(scene1.appearance).toBe(character.canonicalFacts.appearance);
    expect(scene2.appearance).toBe(character.canonicalFacts.appearance);
    expect(scene1.emotion).not.toBe(scene2.emotion);
    expect(scene1.pose).not.toBe(scene2.pose);
    expect(scene2.accessories).toBe("Bouquet");
  });

  it("fails closed when a persisted Planning draft carries stale Character lineage", () => {
    const character = maraVersion();
    const authorities = projectAcceptedCharactersToPlanning({ ...scope, characters: [character] });
    const creativeContext = bindCreativeContextToCharacterAuthority({
      creativeContext: generatedContext({ id: character.characterId, name: "Mara" }),
      characterAuthorities: authorities,
    });
    const stale = [{ ...authorities[0]!, characterFingerprint: `sha256:${"f".repeat(64)}` }];
    expect(() =>
      assertPlanningCharacterAuthorityCurrent({ creativeContext, characterAuthorities: stale })
    ).toThrowError(/stale/i);
  });

  it("keeps human reference-free T2V reference-free while retaining text authority", () => {
    const character = maraVersion();
    const authority = projectAcceptedCharactersToPlanning({ ...scope, characters: [character] })[0]!;
    const generation = resolveEffectiveSceneGenerationAuthority(
      {
        id: "scene-2",
        beatIds: ["beat-2"],
        purpose: "Mara advances toward delivery",
        durationSec: 6,
        transition: "cut",
        continuityNotes: "Preserve Mara and bouquet",
        order: 1,
        generationAuthority: {
          strategy: "TEXT_TO_VIDEO",
          referenceSource: "REFERENCE_FREE_T2V",
          effectiveReferenceIds: [],
          firstFrameAssetId: null,
          productVisualIdentityRequirement: "NONE",
        },
      },
      [id(90)]
    );

    expect(generation.effectiveReferenceIds).toEqual([]);
    expect(generation.firstFrameAssetId).toBeNull();
    expect(authority.canonicalFacts.identity).toContain("florist");
    expect(authority.canonicalFacts.appearance).toContain("forest-green coat");
    expect(authority).not.toHaveProperty("visualAssetReferences");
  });

  it("loads canonical Character authority in the authenticated stage runner", () => {
    const runner = readFileSync(
      "apps/web/src/lib/ai-story-planning-runner.ts",
      "utf8"
    );
    const route = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/stages/[stage]/route.ts",
      "utf8"
    );
    expect(runner).toContain("AiStoryCharacterAuthorityService");
    expect(runner).toContain("projectAcceptedCharactersToPlanning");
    expect(runner).toContain("actorUserId");
    expect(route).toContain("actorUserId: user.id");
  });
});
