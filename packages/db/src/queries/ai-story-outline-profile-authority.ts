import { and, eq, isNull } from "drizzle-orm";
import {
  AiStoryOutlineProfileReferenceSchema,
  canonicalAiStoryOutlineProfileReference,
  type AiStoryOutlineProfileReference,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import { aiStories } from "../schema";

type Db = ReturnType<typeof getDb>;

export type AiStoryOutlineProfileAuthorityScope = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
};

type Dependencies = {
  loadStoredProfile: (
    db: Db,
    scope: AiStoryOutlineProfileAuthorityScope
  ) => Promise<unknown | null>;
};

export class AiStoryOutlineProfileAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryOutlineProfileAuthorityError";
  }
}

async function loadStoredProfile(db: Db, scope: AiStoryOutlineProfileAuthorityScope) {
  const [story] = await db
    .select({ outlineProfile: aiStories.outlineProfile })
    .from(aiStories)
    .where(and(
      eq(aiStories.id, scope.storyId),
      eq(aiStories.orgId, scope.orgId),
      eq(aiStories.workspaceId, scope.workspaceId),
      eq(aiStories.campaignId, scope.campaignId),
      isNull(aiStories.archivedAt)
    ))
    .limit(1);
  return story?.outlineProfile ?? null;
}

const defaultDependencies: Dependencies = { loadStoredProfile };

/** Resolves exact Story-owned Profile authority. This function performs SELECT only. */
export async function resolveAiStoryOutlineProfileAuthority(
  db: Db,
  scope: AiStoryOutlineProfileAuthorityScope,
  dependencies: Dependencies = defaultDependencies
): Promise<AiStoryOutlineProfileReference> {
  const stored = await dependencies.loadStoredProfile(db, scope);
  if (stored === null) {
    throw new AiStoryOutlineProfileAuthorityError(
      "STORY_OUTLINE_PROFILE_UNRESOLVED",
      "AI Story has no explicit Outline Profile authority"
    );
  }
  const parsed = AiStoryOutlineProfileReferenceSchema.safeParse(stored);
  if (!parsed.success) {
    throw new AiStoryOutlineProfileAuthorityError(
      "STORY_OUTLINE_PROFILE_INVALID",
      "AI Story contains invalid Outline Profile authority"
    );
  }
  return canonicalAiStoryOutlineProfileReference(parsed.data);
}
