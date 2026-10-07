import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_STORY_CERTIFIED_LOCAL_WORKFLOWS } from "@ceo-agent/shared";
import {
  bindingVisibleAtFrozenCutoff,
  evaluateStoryVersionFreezeContinuity,
  type StoryVersionFreezeBinding,
  type StoryVersionFreezeScene,
} from "@ceo-agent/shared";
import { materializeSequentialLocalPackageV3 } from "../packages/agents/src/ai-story/sequential-local-generation";

const ORG = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const CHARACTER = "33333333-3333-4333-8333-333333333333";
const REUSABLE = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const FINGERPRINT = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VOICE = "66666666-6666-4666-8666-666666666666";
const VOICE_FINGERPRINT = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HISTORICAL_STORY_VERSION = "b7844bbd-ee4f-4257-8f18-4faa806b5e48";
const HISTORICAL_FROZEN_AT = "2026-10-05T00:00:00.000Z";

const scenes: StoryVersionFreezeScene[] = [
  { persistentCharacterIds: [CHARACTER], voiceCharacterIds: [CHARACTER] },
  { persistentCharacterIds: [CHARACTER], voiceCharacterIds: [CHARACTER] },
];

function binding(createdAt: string, voice = true): StoryVersionFreezeBinding {
  return {
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignCharacterId: CHARACTER,
    reusableCharacterId: REUSABLE,
    reusableCharacterVersionId: VERSION,
    identityFingerprint: FINGERPRINT,
    voiceDnaId: voice ? VOICE : null,
    voiceDnaFingerprint: voice ? VOICE_FINGERPRINT : null,
    createdAt,
  };
}

describe("story version freeze continuity guard", () => {
  it("requires the episode binding and voice pin before freeze", () => {
    const freezeAt = "2026-10-06T00:00:00.000Z";
    const pinned = binding("2026-10-05T12:00:00.000Z");
    const decision = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt,
      scenes,
      bindings: [pinned],
    });
    expect(decision).toEqual({ status: "PASS", reasonCode: "PASS" });
    expect(pinned.voiceDnaId).toBe(VOICE);
    expect(pinned.voiceDnaFingerprint).toBe(VOICE_FINGERPRINT);
    expect(bindingVisibleAtFrozenCutoff(pinned.createdAt, freezeAt)).toBe(true);
  });

  it("lets pre-qc resolution see only bindings inside the frozen cutoff", () => {
    const visible = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt: "2026-10-06T00:00:00.000Z",
      scenes,
      bindings: [binding("2026-10-05T12:00:00.000Z")],
    });
    expect(visible.status).toBe("PASS");
  });

  it("keeps a binding created after freeze invisible to that frozen story version", () => {
    const historical = {
      id: HISTORICAL_STORY_VERSION,
      frozenAt: HISTORICAL_FROZEN_AT,
    };
    const late = binding("2026-10-06T12:00:00.000Z");
    const decision = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt: historical.frozenAt,
      scenes,
      bindings: [late],
    });
    expect(decision).toEqual({
      status: "BLOCK",
      reasonCode: "CHARACTER_CONTINUITY_AUTHORITY_REQUIRED",
    });
    expect(historical.frozenAt).toBe(HISTORICAL_FROZEN_AT);
    expect(bindingVisibleAtFrozenCutoff(late.createdAt, historical.frozenAt)).toBe(false);
  });

  it("resolves the same binding from a new story version frozen after it", () => {
    const decision = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt: "2026-10-06T13:00:00.000Z",
      scenes,
      bindings: [binding("2026-10-06T12:00:00.000Z")],
    });
    expect(decision.reasonCode).toBe("PASS");
  });

  it("blocks freeze when the character binding is missing", () => {
    const decision = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt: "2026-10-06T00:00:00.000Z",
      scenes,
      bindings: [],
    });
    expect(decision.reasonCode).toBe("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
  });

  it("uses the latest visible binding pin instead of an earlier unpinned binding", () => {
    const decision = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt: "2026-10-06T15:00:00.000Z",
      scenes,
      bindings: [
        binding("2026-10-06T14:40:00.000Z", false),
        binding("2026-10-06T14:55:30.088Z", true),
      ],
    });
    expect(decision).toEqual({ status: "PASS", reasonCode: "PASS" });
    expect(bindingVisibleAtFrozenCutoff("2026-10-06T14:55:30.088Z", "2026-10-06T14:31:27.923Z")).toBe(false);
    expect(bindingVisibleAtFrozenCutoff("2026-10-06T14:55:30.088Z", "2026-10-06T15:00:00.000Z")).toBe(true);
  });

  it("blocks freeze when required voice dna is not pinned", () => {
    const decision = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt: "2026-10-06T00:00:00.000Z",
      scenes,
      bindings: [binding("2026-10-05T12:00:00.000Z", false)],
    });
    expect(decision.reasonCode).toBe("VOICE_DNA_AUTHORITY_REQUIRED");
  });

  it("leaves a historical frozen version readable when no new continuity is required", () => {
    const decision = evaluateStoryVersionFreezeContinuity({
      orgId: ORG,
      workspaceId: WORKSPACE,
      freezeAt: HISTORICAL_FROZEN_AT,
      scenes: [],
      bindings: [],
    });
    expect(decision).toEqual({ status: "PASS", reasonCode: "PASS" });
  });

  it("does not widen the provider runtime frozen cutoff", () => {
    const source = readFileSync(
      resolve("packages/db/src/queries/ai-story-provider-runtime.ts"),
      "utf8"
    );
    expect(source).toContain(
      "const bindingCutoff = storyVersion.frozenAt ?? storyVersion.createdAt"
    );
    expect(source).toContain(
      "lte(schema.aiStoryEpisodeCharacterBindings.createdAt, bindingCutoff)"
    );
  });

  it("keeps sequential local v3 from releasing unit 2 before unit 1 approval", () => {
    const sequential = readFileSync(
      resolve("packages/agents/src/ai-story/sequential-local-generation.ts"),
      "utf8"
    );
    expect(sequential).toContain("SEQUENTIAL_LOCAL_PREDECESSOR_APPROVAL_REQUIRED");
    expect(sequential).toContain('decision.decision !== "APPROVED"');
    expect(() =>
      materializeSequentialLocalPackageV3({
        basePackage: {
          order: 2,
          recommendedWorkflow: AI_STORY_CERTIFIED_LOCAL_WORKFLOWS[0],
        } as never,
        release: {} as never,
        predecessor: null,
      })
    ).toThrow("SEQUENTIAL_LOCAL_PREDECESSOR_REQUIRED");
  });

  it("does not introduce remote provider fallback or paid generation", () => {
    const guard = readFileSync(
      resolve("packages/shared/src/ai-story-story-version-freeze-guard.ts"),
      "utf8"
    );
    expect(guard).not.toMatch(/openai|elevenlabs|replicate|fallback|tts|comfyui/i);
    const dispatch = readFileSync(
      resolve("packages/agents/src/ai-story/provider-runtime-dispatch-integration.ts"),
      "utf8"
    );
    expect(dispatch).toContain("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
  });
});
