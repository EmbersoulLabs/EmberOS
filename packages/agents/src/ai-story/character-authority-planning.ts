import {
  AiStoryCharacterAuthorityVersionSchema,
  CharacterContinuityEntrySchema,
  CreativeContextSchema,
  PlanningCharacterAuthorityProjectionSchema,
  type AiStoryCharacterAuthorityVersion,
  type CharacterContinuityEntry,
  type CreativeContext,
  type PlanningCharacterAuthorityProjection,
} from "@ceo-agent/shared";
import { computeAiStoryCharacterFingerprint } from "@ceo-agent/shared/server";

export class AiStoryPlanningCharacterAuthorityError extends Error {
  constructor(
    readonly code:
      | "CHARACTER_AUTHORITY_SCOPE_MISMATCH"
      | "CHARACTER_AUTHORITY_NOT_ACTIVE"
      | "CHARACTER_AUTHORITY_FINGERPRINT_MISMATCH"
      | "CHARACTER_AUTHORITY_IDENTITY_REQUIRED"
      | "CHARACTER_AUTHORITY_CONTINUITY_MISSING"
      | "CHARACTER_AUTHORITY_STALE",
    message: string
  ) {
    super(message);
    this.name = "AiStoryPlanningCharacterAuthorityError";
  }
}

export function projectAcceptedCharactersToPlanning(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  characters: readonly AiStoryCharacterAuthorityVersion[];
}): PlanningCharacterAuthorityProjection[] {
  return input.characters
    .map((raw) => {
      const character = AiStoryCharacterAuthorityVersionSchema.parse(raw);
      if (
        character.orgId !== input.orgId ||
        character.workspaceId !== input.workspaceId ||
        character.campaignId !== input.campaignId
      ) {
        throw new AiStoryPlanningCharacterAuthorityError(
          "CHARACTER_AUTHORITY_SCOPE_MISMATCH",
          `Character ${character.characterId} is outside the Planning scope`
        );
      }
      if (character.status !== "ACTIVE") {
        throw new AiStoryPlanningCharacterAuthorityError(
          "CHARACTER_AUTHORITY_NOT_ACTIVE",
          `Character ${character.characterId} is not active`
        );
      }
      if (computeAiStoryCharacterFingerprint(character) !== character.fingerprint) {
        throw new AiStoryPlanningCharacterAuthorityError(
          "CHARACTER_AUTHORITY_FINGERPRINT_MISMATCH",
          `Character ${character.characterId} fingerprint is stale or invalid`
        );
      }
      return PlanningCharacterAuthorityProjectionSchema.parse({
        characterId: character.characterId,
        characterVersionId: character.characterVersionId,
        characterFingerprint: character.fingerprint,
        name: character.name,
        canonicalFacts: character.canonicalFacts,
      });
    })
    .sort((left, right) => left.characterId.localeCompare(right.characterId));
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function compatibilityCharacter(
  proposed: CreativeContext["characterContext"]["characters"][number],
  authority: PlanningCharacterAuthorityProjection
): CreativeContext["characterContext"]["characters"][number] {
  return {
    id: authority.characterId,
    name: authority.name,
    role: proposed.role,
    description: authority.canonicalFacts.identity,
    motivation: [
      authority.canonicalFacts.personality,
      `Emotional arc baseline: ${authority.canonicalFacts.emotionalArc}`,
    ].join(" "),
    visualNotes: authority.canonicalFacts.appearance,
    canonicalAuthority: authority,
  };
}

/**
 * Applies accepted Character truth after the LLM response. An exact Character
 * ID selects authority; a matching display name can only detect an unsafe
 * collision and can never establish authority.
 */
export function bindCreativeContextToCharacterAuthority(input: {
  creativeContext: CreativeContext;
  characterAuthorities: readonly PlanningCharacterAuthorityProjection[];
}): CreativeContext {
  const creativeContext = CreativeContextSchema.parse(input.creativeContext);
  const authorities = input.characterAuthorities.map((item) =>
    PlanningCharacterAuthorityProjectionSchema.parse(item)
  );
  const byId = new Map(authorities.map((item) => [item.characterId, item]));
  const byName = new Map(authorities.map((item) => [normalizedName(item.name), item]));

  const characters = creativeContext.characterContext.characters.map((proposed) => {
    const exact = proposed.id ? byId.get(proposed.id) : undefined;
    if (exact) return compatibilityCharacter(proposed, exact);

    const colliding = byName.get(normalizedName(proposed.name));
    if (colliding) {
      throw new AiStoryPlanningCharacterAuthorityError(
        "CHARACTER_AUTHORITY_IDENTITY_REQUIRED",
        `Planning must select accepted Character ${colliding.characterId} by exact ID; name matching is not authority`
      );
    }
    const { canonicalAuthority: _untrustedAuthority, ...proposal } = proposed;
    return { ...proposal, proposalOnly: true as const };
  });

  return CreativeContextSchema.parse({
    ...creativeContext,
    characterContext: { ...creativeContext.characterContext, characters },
  });
}

/** Existing Planning drafts may continue only while their exact accepted lineage is current. */
export function assertPlanningCharacterAuthorityCurrent(input: {
  creativeContext: CreativeContext;
  characterAuthorities: readonly PlanningCharacterAuthorityProjection[];
}): void {
  const creativeContext = CreativeContextSchema.parse(input.creativeContext);
  const currentById = new Map(
    input.characterAuthorities.map((item) => {
      const parsed = PlanningCharacterAuthorityProjectionSchema.parse(item);
      return [parsed.characterId, parsed] as const;
    })
  );
  const currentByName = new Map(
    input.characterAuthorities.map((item) => [normalizedName(item.name), item] as const)
  );
  for (const character of creativeContext.characterContext.characters) {
    const binding = character.canonicalAuthority;
    if (!binding) {
      if (currentByName.has(normalizedName(character.name))) {
        throw new AiStoryPlanningCharacterAuthorityError(
          "CHARACTER_AUTHORITY_IDENTITY_REQUIRED",
          `Persisted Planning character ${character.name} does not carry exact accepted authority`
        );
      }
      continue;
    }
    const current = currentById.get(binding.characterId);
    const expectedCompatibility = current
      ? compatibilityCharacter(character, current)
      : undefined;
    if (
      !current ||
      current.characterVersionId !== binding.characterVersionId ||
      current.characterFingerprint !== binding.characterFingerprint ||
      JSON.stringify(current.canonicalFacts) !== JSON.stringify(binding.canonicalFacts) ||
      character.id !== expectedCompatibility?.id ||
      character.name !== expectedCompatibility?.name ||
      character.description !== expectedCompatibility?.description ||
      character.motivation !== expectedCompatibility?.motivation ||
      character.visualNotes !== expectedCompatibility?.visualNotes
    ) {
      throw new AiStoryPlanningCharacterAuthorityError(
        "CHARACTER_AUTHORITY_STALE",
        `Persisted Planning Character ${binding.characterId} is stale; regenerate Creative Context from latest authority`
      );
    }
  }
}

/** Stable identity/appearance are authority projections; Scene state remains LLM-derived. */
export function bindCharacterContinuityToCharacterAuthority(input: {
  creativeContext: CreativeContext;
  characterContinuity: readonly CharacterContinuityEntry[];
}): CharacterContinuityEntry[] {
  const creativeContext = CreativeContextSchema.parse(input.creativeContext);
  const continuity = input.characterContinuity.map((entry) =>
    CharacterContinuityEntrySchema.parse(entry)
  );
  const canonicalCharacters = creativeContext.characterContext.characters.filter(
    (character) => character.canonicalAuthority
  );
  const canonicalIds = new Set(
    canonicalCharacters.map((character) => character.canonicalAuthority!.characterId)
  );
  const canonicalNames = new Map(
    canonicalCharacters.map((character) => [normalizedName(character.name), character])
  );

  const bound = continuity.map((entry) => {
    const canonical = entry.characterId
      ? canonicalCharacters.find(
          (character) => character.canonicalAuthority!.characterId === entry.characterId
        )
      : undefined;
    if (canonical) {
      const authority = canonical.canonicalAuthority!;
      return CharacterContinuityEntrySchema.parse({
        ...entry,
        characterId: authority.characterId,
        name: authority.name,
        identity: authority.canonicalFacts.identity,
        appearance: authority.canonicalFacts.appearance,
        canonicalAuthority: {
          characterId: authority.characterId,
          characterVersionId: authority.characterVersionId,
          characterFingerprint: authority.characterFingerprint,
        },
      });
    }
    const colliding = canonicalNames.get(normalizedName(entry.name));
    if (colliding) {
      throw new AiStoryPlanningCharacterAuthorityError(
        "CHARACTER_AUTHORITY_IDENTITY_REQUIRED",
        `Continuity must bind accepted Character ${colliding.canonicalAuthority!.characterId} by exact ID`
      );
    }
    const { canonicalAuthority: _untrustedAuthority, ...dynamicEntry } = entry;
    return CharacterContinuityEntrySchema.parse(dynamicEntry);
  });

  for (const characterId of canonicalIds) {
    if (!bound.some((entry) => entry.characterId === characterId)) {
      throw new AiStoryPlanningCharacterAuthorityError(
        "CHARACTER_AUTHORITY_CONTINUITY_MISSING",
        `Planning omitted continuity for accepted Character ${characterId}`
      );
    }
  }
  return bound;
}

export function planningCharacterAuthorityPrompt(
  characterAuthorities: readonly PlanningCharacterAuthorityProjection[]
): string {
  if (characterAuthorities.length === 0) {
    return "No accepted Campaign Character authority is currently available.";
  }
  return [
    "ACCEPTED CANONICAL CHARACTER AUTHORITY (stable facts are immutable):",
    JSON.stringify(characterAuthorities, null, 2),
    "Select an accepted Character only by its exact characterId. Preserve its name, identity, appearance, personality, emotional-arc baseline, relationships, version, and fingerprint. Generate only narrative use and evolving Scene state. Any new persistent Character is proposal-only.",
  ].join("\n");
}
