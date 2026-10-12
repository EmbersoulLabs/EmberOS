import {
  AiStoryCharacterAuthorityService,
  resolveCurrentFrozenOutlineForStoryVersion,
  type AiStoryCharacterScope,
  getDb,
} from "@ceo-agent/db";
import {
  AiStoryStructuredDraftSchema,
  StoryPlanningDraftSchema,
  type AiStoryCharacterAuthorityVersion,
  type AiStoryCharacterMutationInput,
  type CreativeContext,
  type StoryPlanningDraft,
} from "@ceo-agent/shared";
import {
  bindProposalToAcceptedCharacter,
  projectAcceptedCharactersToPlanning,
} from "@ceo-agent/agents";
import {
  getLatestAnimationPackageForStory,
  loadLatestCreativeContextForStory,
  readPlanningDraftFromPackage,
  saveCreativeContext,
  savePlanningDraft,
} from "@/lib/ai-story-planning-service";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

type Db = ReturnType<typeof getDb>;

export class AiStoryCharacterProposalAcceptanceError extends Error {
  constructor(
    readonly code:
      | "CHARACTER_ACCEPTANCE_INPUT_INVALID"
      | "CHARACTER_ACCEPTANCE_STORY_NOT_FROZEN"
      | "CHARACTER_ACCEPTANCE_OUTLINE_FROZEN"
      | "CHARACTER_ACCEPTANCE_CONTEXT_REQUIRED"
      | "CHARACTER_ACCEPTANCE_PACKAGE_COMPLETE"
      | "CHARACTER_PROPOSAL_ID_IS_NOT_AUTHORITY",
    message: string,
  ) {
    super(message);
    this.name = "AiStoryCharacterProposalAcceptanceError";
  }
}

export type AcceptOriginalCharacterBeforeOutlineInput = {
  db: Db;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  actorUserId: string;
  proposalKey: string;
  character?: AiStoryCharacterMutationInput;
  characterId?: string;
};

type AcceptanceDependencies = {
  loadStory: typeof loadCampaignAiStory;
  resolveOutline: typeof resolveCurrentFrozenOutlineForStoryVersion;
  loadPackage: typeof getLatestAnimationPackageForStory;
  loadContext: typeof loadLatestCreativeContextForStory;
  createCharacter: (
    scope: AiStoryCharacterScope,
    facts: AiStoryCharacterMutationInput,
  ) => Promise<AiStoryCharacterAuthorityVersion>;
  readCharacter: (
    scope: AiStoryCharacterScope,
    characterId: string,
  ) => Promise<AiStoryCharacterAuthorityVersion>;
  saveContext: typeof saveCreativeContext;
  saveDraft: typeof savePlanningDraft;
};

const defaultDependencies: AcceptanceDependencies = {
  loadStory: loadCampaignAiStory,
  resolveOutline: resolveCurrentFrozenOutlineForStoryVersion,
  loadPackage: getLatestAnimationPackageForStory,
  loadContext: loadLatestCreativeContextForStory,
  createCharacter: (scope, facts) => new AiStoryCharacterAuthorityService().add(scope, facts),
  readCharacter: (scope, characterId) => new AiStoryCharacterAuthorityService().read(scope, characterId),
  saveContext: saveCreativeContext,
  saveDraft: savePlanningDraft,
};

/**
 * Operator acceptance before Outline composition.
 * A new Character is created by the Campaign registry, which assigns the UUID.
 * An existing Character is selected by that registry ID. The proposal key is discarded.
 */
export async function acceptOriginalCharacterBeforeOutlineFreeze(
  input: AcceptOriginalCharacterBeforeOutlineInput,
  deps: AcceptanceDependencies = defaultDependencies,
): Promise<{ characterId: string; creativeContext: CreativeContext; planningDraft: StoryPlanningDraft }> {
  if (Number(Boolean(input.character)) + Number(Boolean(input.characterId)) !== 1) {
    throw new AiStoryCharacterProposalAcceptanceError(
      "CHARACTER_ACCEPTANCE_INPUT_INVALID",
      "Provide either new Character facts or an existing Character ID",
    );
  }
  const loaded = await deps.loadStory(input.db, input.campaignId, input.storyId, input.workspaceId);
  const version = loaded?.currentVersion;
  if (!loaded || !version) {
    throw new AiStoryCharacterProposalAcceptanceError(
      "CHARACTER_ACCEPTANCE_STORY_NOT_FROZEN",
      "Current Story Version authority was not found",
    );
  }
  if (!version.frozenAt) {
    throw new AiStoryCharacterProposalAcceptanceError(
      "CHARACTER_ACCEPTANCE_STORY_NOT_FROZEN",
      "Character acceptance requires the current Story Version to be frozen",
    );
  }
  const outline = await deps.resolveOutline(input.db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: version.id,
  });
  if (outline) {
    throw new AiStoryCharacterProposalAcceptanceError(
      "CHARACTER_ACCEPTANCE_OUTLINE_FROZEN",
      "Character acceptance cannot change a Story whose Outline is already frozen",
    );
  }

  const scope: AiStoryCharacterScope = {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    actorUserId: input.actorUserId,
  };
  const latestPackage = await deps.loadPackage(input.db, {
    campaignId: input.campaignId,
    storyId: input.storyId,
    workspaceId: input.workspaceId,
  });
  if (latestPackage && latestPackage.storyVersionId === version.id && !readPlanningDraftFromPackage(latestPackage)) {
    throw new AiStoryCharacterProposalAcceptanceError(
      "CHARACTER_ACCEPTANCE_PACKAGE_COMPLETE",
      "Character acceptance is closed after the animation package is complete",
    );
  }
  const storedDraft = latestPackage?.storyVersionId === version.id
    ? readPlanningDraftFromPackage(latestPackage)
    : null;
  const storedContext = storedDraft?.creativeContext
    ? storedDraft.creativeContext
    : (await deps.loadContext(input.db, {
        campaignId: input.campaignId,
        storyId: input.storyId,
        workspaceId: input.workspaceId,
      }))?.payload;
  if (!storedContext) {
    throw new AiStoryCharacterProposalAcceptanceError(
      "CHARACTER_ACCEPTANCE_CONTEXT_REQUIRED",
      "Creative Context must exist before a Character proposal can be accepted",
    );
  }

  const character = input.characterId
    ? await deps.readCharacter(scope, input.characterId)
    : await deps.createCharacter(scope, {
        ...input.character!,
        visualAssetIds: input.character!.visualAssetIds ?? [],
      });
  if (character.characterId === input.proposalKey.trim()) {
    throw new AiStoryCharacterProposalAcceptanceError(
      "CHARACTER_PROPOSAL_ID_IS_NOT_AUTHORITY",
      "A Creative Context proposal key cannot become the Character ID",
    );
  }
  const [authority] = projectAcceptedCharactersToPlanning({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    characters: [character],
  });
  const creativeContext = bindProposalToAcceptedCharacter({
    creativeContext: storedContext,
    proposalKey: input.proposalKey,
    characterAuthority: authority!,
  });
  const story = AiStoryStructuredDraftSchema.parse(version.structuredContent);
  const planningDraft = StoryPlanningDraftSchema.parse({
    ...(storedDraft ?? { kind: "planning_draft", completedStages: ["creative_context"] }),
    story,
    creativeContext,
  });
  await deps.saveContext(input.db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: version.id,
    payload: creativeContext,
  });
  await deps.saveDraft(input.db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: version.id,
    payload: planningDraft,
  });
  return { characterId: character.characterId, creativeContext, planningDraft };
}
