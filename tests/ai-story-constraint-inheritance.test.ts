import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compileInheritedCommercialMustKeep,
  computeAiStoryScriptSemanticInputFingerprint,
  isServerCompiledParticipationDrift,
  planningPackageIsStaleForCompiledOutline,
} from "@ceo-agent/shared/server";
import { resolveCommercialActionParticipation } from "@ceo-agent/shared/server";

const useIntent = "The character holds the product and uses it. Show cooling through hair movement.";
const revealIntent = "Reveal the product on a shelf and display it for the audience.";
const symbolIntent = "The mark symbolizes trust and represents the brand.";

describe("commercial constraint inheritance", () => {
  it("1 derives active product use from preserved creative intent", () => {
    expect(resolveCommercialActionParticipation(useIntent)).toBe("ENABLE");
  });

  it("2 keeps a display-only product passive", () => {
    expect(resolveCommercialActionParticipation(revealIntent)).toBe("REVEAL");
  });

  it("3 keeps a symbolic role symbolic", () => {
    expect(resolveCommercialActionParticipation(symbolIntent)).toBe("SYMBOLIZE");
  });

  it("4 does not treat an unrelated word as product use", () => {
    expect(resolveCommercialActionParticipation("The user sees a useful result.")).toBe("REVEAL");
  });

  it("5 compiles physical-use sentences into inherited must-keep", () => {
    expect(compileInheritedCommercialMustKeep([useIntent], "ENABLE")).toEqual([
      "The character holds the product and uses it.",
      "Show cooling through hair movement.",
    ]);
  });

  it("6 does not invent physical must-keep for a reveal-only story", () => {
    expect(compileInheritedCommercialMustKeep([revealIntent], "REVEAL")).toEqual([]);
  });

  it("7 carries the same inherited obligation onto every participation kind that is active", () => {
    expect(compileInheritedCommercialMustKeep([useIntent], "INTENSIFY")).toEqual(
      compileInheritedCommercialMustKeep([useIntent], "ENABLE"),
    );
  });

  it("8 uses a generic fallback when active participation has no extractable sentence", () => {
    expect(compileInheritedCommercialMustKeep(["The story continues."], "CAUSE")).toEqual([
      "The authorized product stays in physical use unless a visible action changes that state.",
    ]);
  });

  it("9 does not hardcode a story, character, or product name in the compiler", () => {
    const source = readFileSync("packages/shared/src/ai-story-commercial-story-outline-policy.server.ts", "utf8");
    for (const forbidden of ["Yuki", "mini fan", "pink", "905e4a22", "29131823"]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("10 promotion copies inherited must-keep instead of clearing it", () => {
    const source = readFileSync("packages/shared/src/ai-story-script-semantic-writer.server.ts", "utf8");
    expect(source).toContain("compileInheritedCommercialMustKeep");
    expect(source).not.toContain("mustKeep: []");
  });

  it("11 scene compilation includes episode intent when the script fingerprint does", () => {
    const source = readFileSync("apps/web/src/lib/ai-story-canonical-scene-producer.ts", "utf8");
    expect(source).toContain("episodeIntent: input.episodeIntent");
  });

  it("12 animation package uses the story-bound character set", () => {
    const source = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    const stage = source.slice(source.indexOf('case "animation_package"'));
    expect(stage).toContain("selectStoryBoundCharacterAuthorities");
    expect(stage).toContain("episodeIntent");
  });

  it("13 an episode intent changes the script fingerprint", () => {
    const base = {
      storyId: "11111111-1111-4111-8111-111111111111",
      storyVersionId: "22222222-2222-4222-8222-222222222222",
      outlineVersionId: "33333333-3333-4333-8333-333333333333",
      outlineSourceHash: `sha256:${"a".repeat(64)}`,
      story: {
        title: "Story", summary: "Summary", objective: "Objective", targetAudience: "People",
        tone: "Warm", estimatedDuration: "8s",
        story: { opening: "Open", development: "Middle", ending: "End" },
        keyMessages: [], cta: "Continue", assetReferences: [], warnings: [],
      },
      storyBeats: [{ id: "beat-1", name: "Open", purpose: "Begin", order: 0, summary: "Begin" }],
      scenePlan: [{ id: "scene-1", beatIds: ["beat-1"], purpose: "Begin", durationSec: 8, transition: "", continuityNotes: "", order: 0 }],
      creativeContext: {
        storyContext: { title: "Story", summary: "Summary", objective: "Objective", targetAudience: "People", tone: "Warm", estimatedDuration: "8s" },
        characterContext: { characters: [], relationships: [] },
        worldContext: { locations: [], visualStyle: "", lighting: "", environment: "", objects: [], timeline: "", worldRules: [] },
        narrativeContext: { arc: "", pacing: "", emotionalJourney: "", themes: [] },
      },
      directorThinking: { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" },
      characterAuthorities: [],
      productAuthorityIds: [],
    };
    const withoutIntent = computeAiStoryScriptSemanticInputFingerprint(base);
    const withIntent = computeAiStoryScriptSemanticInputFingerprint({
      ...base,
      episodeIntent: {
        contractVersion: "ai-story-episode-intent.v1",
        acceptedAt: "2026-09-29T00:00:00.000Z",
        episodeType: "COMMERCIAL_STORY",
        requestedDurationSec: 8,
        aspectRatio: "9:16",
        spokenLanguage: "en-SG",
        dialogueStyle: "Casual",
        nativeCharacterDialogue: true,
        pacing: "NATURAL",
        cta: "Continue",
        visualTextLanguages: ["en"],
        visualTextPolicy: { criticalSurfacePolicy: "PROVIDER_NON_LEGIBLE" },
      },
    });
    expect(withIntent).not.toBe(withoutIntent);
  });

  it("15 recompiles reveal to enable only when preserved intent requires physical use", () => {
    const shared = {
      userCreativeIntent: ["The character holds the product. Show airflow movement."],
      commercialIntegration: {
        commercialAuthorityRefs: ["11111111-1111-4111-8111-111111111111"],
        integrationType: "PRODUCT" as const,
        entryPoint: { kind: "BEAT_ID" as const, beatId: "22222222-2222-4222-8222-222222222222" },
        narrativeFunction: "PRODUCT_INTERVENTION",
        preIntegrationState: "before",
        postIntegrationState: "after",
        storyConsequence: "The product stays in the action.",
        audienceUnderstanding: "The audience sees the use.",
        naturalnessRationale: "The use is part of the scene.",
        commercialActionOrParticipation: "REVEAL" as const,
      },
    };
    const next = structuredClone(shared);
    next.commercialIntegration.commercialActionOrParticipation = "ENABLE";
    expect(isServerCompiledParticipationDrift(shared as never, next as never)).toBe(true);
    const passive = structuredClone(shared);
    passive.userCreativeIntent = ["Reveal the product on a shelf."];
    passive.commercialIntegration.commercialActionOrParticipation = "REVEAL";
    const passiveNext = structuredClone(passive);
    const changedIntent = structuredClone(next);
    changedIntent.userCreativeIntent = ["A different obligation."];
    expect(isServerCompiledParticipationDrift(shared as never, changedIntent as never)).toBe(false);
    expect(isServerCompiledParticipationDrift(passive as never, passiveNext as never)).toBe(false);
    expect(resolveCommercialActionParticipation(passive.userCreativeIntent[0]!)).toBe("REVEAL");
  });

  it("16 a stale shot plan does not keep an outdated compiled participation", () => {
    expect(planningPackageIsStaleForCompiledOutline({
      packageCreatedAt: "2026-09-29T02:00:00.000Z",
      outlineFrozenAt: "2026-09-29T01:00:00.000Z",
      storedParticipation: "REVEAL",
      userCreativeIntent: ["The character holds the product."],
    })).toBe(true);
    expect(planningPackageIsStaleForCompiledOutline({
      packageCreatedAt: "2026-09-29T03:00:00.000Z",
      outlineFrozenAt: "2026-09-29T02:00:00.000Z",
      storedParticipation: "REVEAL",
      userCreativeIntent: ["Reveal the product on a shelf."],
    })).toBe(false);
    expect(planningPackageIsStaleForCompiledOutline({
      packageCreatedAt: "2026-09-29T02:00:00.000Z",
      outlineFrozenAt: "2026-09-29T03:00:00.000Z",
      storedParticipation: "ENABLE",
      userCreativeIntent: ["The character holds the product."],
    })).toBe(true);
  });

  it("14 omitting episode intent preserves the historical fingerprint input", () => {
    const source = readFileSync("packages/shared/src/ai-story-script.server.ts", "utf8");
    expect(source).toContain("...(episodeIntent ? { episodeIntent } : {})");
  });
});
