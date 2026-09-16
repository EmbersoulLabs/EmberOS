import { describe, expect, it } from "vitest";
import {
  AnimationPackagePayloadSchema,
  AuthoritativeAnimationPackagePayloadSchema,
  type AiStoryCanonicalScene,
} from "@ceo-agent/shared";
import {
  buildAiStoryAnimationPackageCanonicalSceneAuthorityV1,
  computeAiStoryCanonicalSceneSetFingerprint,
  assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent,
} from "@ceo-agent/shared/server";
import { compileSceneExecutionIntents } from "../packages/agents/src/ai-story/scene-execution-compiler";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";
import { isCurrentCanonicalExecutionPlan } from "../apps/web/src/lib/ai-story-execution-plan-discovery";

const id = (n: number) => `8a000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;
const STORY = id(1);
const STORY_VERSION = id(2);
const SCRIPT = id(3);

function scene(patch: Partial<AiStoryCanonicalScene> = {}): AiStoryCanonicalScene {
  return {
    sceneId: id(4),
    sceneVersionId: id(5),
    storyId: STORY,
    storyVersionId: STORY_VERSION,
    scriptVersionId: SCRIPT,
    order: 0,
    fingerprint: hash("a"),
    sourceScriptSceneIds: [id(6)],
    status: "FROZEN",
    ...patch,
  } as AiStoryCanonicalScene;
}

function authoritativePackage(canonicalScene = scene()) {
  const legacy = animationPackageFixture("ready_for_execution");
  return AuthoritativeAnimationPackagePayloadSchema.parse({
    ...legacy,
    canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
      storyId: STORY,
      storyVersionId: STORY_VERSION,
      scenePlan: legacy.scenePlan,
      canonicalScenes: [canonicalScene],
    }),
  });
}

const context = {
  orgId: id(10), workspaceId: id(11), campaignId: id(12), storyId: STORY,
  storyVersionId: STORY_VERSION, storyVersionNumber: 1,
  storyVersionFrozenAt: "2026-09-16T00:00:00.000Z", animationPackageId: id(13),
  animationPackageStatus: "ready_for_execution", compiledAt: "2026-09-16T01:00:00.000Z",
};

describe("AI Story Package 2 canonical lineage", () => {
  it("keeps legacy Packages readable but rejects them as authoritative new writes", () => {
    const legacy = animationPackageFixture("review");
    expect(AnimationPackagePayloadSchema.safeParse(legacy).success).toBe(true);
    expect(AuthoritativeAnimationPackagePayloadSchema.safeParse(legacy).success).toBe(false);
  });

  it("builds one deterministic planning-to-canonical binding and fingerprint", () => {
    const pkg = authoritativePackage();
    expect(pkg.canonicalSceneAuthority.scenes[0]).toMatchObject({
      order: 0,
      planningSceneId: "scene-001",
      sceneId: id(4),
      sceneVersionId: id(5),
      sceneFingerprint: hash("a"),
      sourceScriptSceneIds: [id(6)],
    });
    expect(pkg.canonicalSceneAuthority.sceneSetFingerprint).toBe(
      computeAiStoryCanonicalSceneSetFingerprint({
        storyId: STORY, storyVersionId: STORY_VERSION, scriptVersionId: SCRIPT, scenes: [scene()],
      })
    );
    expect(() => buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
      storyId: STORY, storyVersionId: STORY_VERSION,
      scenePlan: [...pkg.scenePlan, { ...pkg.scenePlan[0]!, id: "extra", order: 1 }],
      canonicalScenes: [scene()],
    })).toThrowError(expect.objectContaining({ code: "ANIMATION_PACKAGE_CANONICAL_SCENE_MAPPING_INVALID" }));
    expect(assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({
      storyId: STORY, storyVersionId: STORY_VERSION, scenePlan: pkg.scenePlan,
      canonicalScenes: [scene()], authority: pkg.canonicalSceneAuthority,
    })).toEqual(pkg.canonicalSceneAuthority);
    expect(() => assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({
      storyId: STORY, storyVersionId: STORY_VERSION, scenePlan: pkg.scenePlan,
      canonicalScenes: [scene({ sceneVersionId: id(7), fingerprint: hash("b") })],
      authority: pkg.canonicalSceneAuthority,
    })).toThrowError(expect.objectContaining({ code: "ANIMATION_PACKAGE_CANONICAL_SCENE_AUTHORITY_STALE" }));
  });

  it("compiles canonical Scene identity while retaining planning-only shot selection", () => {
    const compiled = compileSceneExecutionIntents(authoritativePackage(), context);
    const intent = compiled.intents[0]!;
    expect(intent.identity.sceneId).toBe(id(4));
    expect(intent.identity.sceneId).not.toBe("scene-001");
    expect(intent.identity.sceneVersionId).toBe(id(5));
    expect(intent.identity.sceneFingerprint).toBe(hash("a"));
    expect(intent.identity.scriptVersionId).toBe(SCRIPT);
    expect(intent.shotReferences[0]!.sceneId).toBe(id(4));
    expect(compiled.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]).toMatchObject({
      sceneId: id(4), sceneVersionId: id(5), sceneFingerprint: hash("a"), scriptVersionId: SCRIPT,
    });
  });

  it("changes durable identities on Scene revision and remains deterministic for equivalent authority", () => {
    const first = compileSceneExecutionIntents(authoritativePackage(), context);
    const same = compileSceneExecutionIntents(authoritativePackage(), context);
    const revisedScene = scene({ sceneVersionId: id(7), fingerprint: hash("b"), version: 2 });
    const revised = compileSceneExecutionIntents(authoritativePackage(revisedScene), context);
    expect(same.storyExecutionPlan).toEqual(first.storyExecutionPlan);
    expect(revised.intents[0]!.identity.sceneExecutionId).not.toBe(first.intents[0]!.identity.sceneExecutionId);
    expect(revised.intents[0]!.identity.idempotencyKey).not.toBe(first.intents[0]!.identity.idempotencyKey);
    expect(revised.intents[0]!.compilationHash).not.toBe(first.intents[0]!.compilationHash);
    expect(revised.storyExecutionPlan.animationPackage.integrityHash).not.toBe(first.storyExecutionPlan.animationPackage.integrityHash);
  });

  it("accepts only complete exact current plans and rejects legacy, stale, partial, or wrong lineage", () => {
    const canonicalScene = scene();
    const pkg = authoritativePackage(canonicalScene);
    const compiled = compileSceneExecutionIntents(pkg, context);
    const exact = {
      plan: compiled.storyExecutionPlan,
      intents: compiled.intents,
      animationPackageId: context.animationPackageId,
      binding: pkg.canonicalSceneAuthority,
      canonicalScenes: [canonicalScene],
    };
    expect(isCurrentCanonicalExecutionPlan(exact)).toBe(true);
    expect(isCurrentCanonicalExecutionPlan({ ...exact, intents: [] })).toBe(false);
    expect(isCurrentCanonicalExecutionPlan({
      ...exact,
      canonicalScenes: [scene({ sceneVersionId: id(7), fingerprint: hash("b") })],
    })).toBe(false);
    expect(isCurrentCanonicalExecutionPlan({
      ...exact,
      binding: { ...pkg.canonicalSceneAuthority, sceneSetFingerprint: hash("f") },
    })).toBe(false);
    const legacy = structuredClone(compiled.storyExecutionPlan) as unknown as {
      animationPackage: { scriptVersionId?: string };
    };
    delete legacy.animationPackage.scriptVersionId;
    expect(isCurrentCanonicalExecutionPlan({ ...exact, plan: legacy })).toBe(false);
  });
});
