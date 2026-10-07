/**
 * Fail-closed Story Version freeze guard.
 * A frozen cutoff never gains Character or Voice authority created after it.
 */

export const STORY_VERSION_FREEZE_BLOCK_REASONS = [
  "CHARACTER_CONTINUITY_AUTHORITY_REQUIRED",
  "VOICE_DNA_AUTHORITY_REQUIRED",
] as const;

export type StoryVersionFreezeBlockReason =
  (typeof STORY_VERSION_FREEZE_BLOCK_REASONS)[number];

export type StoryVersionFreezeScene = {
  readonly persistentCharacterIds: readonly string[];
  readonly voiceCharacterIds?: readonly string[];
  readonly continuityRequiredCharacterIds?: readonly string[];
};

export type StoryVersionFreezeBinding = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignCharacterId: string;
  readonly reusableCharacterId: string;
  readonly reusableCharacterVersionId: string;
  readonly identityFingerprint: string;
  readonly voiceDnaId?: string | null;
  readonly voiceDnaFingerprint?: string | null;
  readonly createdAt: string;
};

export type StoryVersionFreezeContinuityDecision = {
  readonly status: "PASS" | "BLOCK";
  readonly reasonCode: "PASS" | StoryVersionFreezeBlockReason;
};

function requiredCharacters(scenes: readonly StoryVersionFreezeScene[]) {
  const counts = new Map<string, { scenes: number; voice: boolean; explicit: boolean }>();
  for (const scene of scenes) {
    const voice = new Set(scene.voiceCharacterIds ?? []);
    const explicit = new Set(scene.continuityRequiredCharacterIds ?? []);
    for (const characterId of new Set(scene.persistentCharacterIds)) {
      const current = counts.get(characterId) ?? { scenes: 0, voice: false, explicit: false };
      current.scenes += 1;
      current.voice = current.voice || voice.has(characterId);
      current.explicit = current.explicit || explicit.has(characterId);
      counts.set(characterId, current);
    }
  }
  return [...counts.entries()].filter(
    ([, value]) => value.scenes >= 2 || value.voice || value.explicit
  );
}

export function bindingVisibleAtFrozenCutoff(
  bindingCreatedAt: string,
  frozenAt: string
) {
  return bindingCreatedAt <= frozenAt;
}

export function evaluateStoryVersionFreezeContinuity(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly freezeAt: string;
  readonly scenes: readonly StoryVersionFreezeScene[];
  readonly bindings: readonly StoryVersionFreezeBinding[];
}): StoryVersionFreezeContinuityDecision {
  const required = requiredCharacters(input.scenes);
  if (required.length === 0) return { status: "PASS", reasonCode: "PASS" };

  const visible = input.bindings.filter(
    (binding) =>
      binding.orgId === input.orgId &&
      binding.workspaceId === input.workspaceId &&
      binding.reusableCharacterId.length > 0 &&
      binding.reusableCharacterVersionId.length > 0 &&
      binding.identityFingerprint.length > 0 &&
      bindingVisibleAtFrozenCutoff(binding.createdAt, input.freezeAt)
  );
  const latestVisible = new Map<string, StoryVersionFreezeBinding>();
  for (const binding of visible) {
    const current = latestVisible.get(binding.campaignCharacterId);
    if (!current || binding.createdAt > current.createdAt) {
      latestVisible.set(binding.campaignCharacterId, binding);
    }
  }

  for (const [characterId, requirement] of required) {
    const binding = latestVisible.get(characterId);
    if (!binding) {
      return {
        status: "BLOCK",
        reasonCode: "CHARACTER_CONTINUITY_AUTHORITY_REQUIRED",
      };
    }
    if (
      requirement.voice &&
      (!binding.voiceDnaId || !binding.voiceDnaFingerprint)
    ) {
      return { status: "BLOCK", reasonCode: "VOICE_DNA_AUTHORITY_REQUIRED" };
    }
  }
  return { status: "PASS", reasonCode: "PASS" };
}
