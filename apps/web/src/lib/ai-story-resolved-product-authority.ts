import { and, eq, isNull } from "drizzle-orm";
import {
  AiStoryCanonicalSceneAuthorityService,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  AiStoryAuthoritativeSceneProductBindingSchema,
  AiStoryResolvedProductAuthoritySchema,
  type AiStoryCanonicalScene,
} from "@ceo-agent/shared";
import {
  resolveStoryProductSources,
  type AiStoryResolvedProductSource,
} from "@/lib/ai-story-product-sources";

type Db = ReturnType<typeof getDb>;

export type CurrentSceneProductAuthorityInput = {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  sceneId: string;
  productAuthorityId: string;
  actorUserId: string;
};

type Dependencies = {
  loadCurrentStoryVersionId: (
    db: Db,
    input: CurrentSceneProductAuthorityInput
  ) => Promise<string | null>;
  readCurrentScenes: (
    db: Db,
    input: CurrentSceneProductAuthorityInput & { storyVersionId: string }
  ) => Promise<readonly AiStoryCanonicalScene[]>;
  resolveProductSources: (
    db: Db,
    input: Pick<
      CurrentSceneProductAuthorityInput,
      "orgId" | "workspaceId" | "campaignId" | "storyId"
    >
  ) => Promise<readonly AiStoryResolvedProductSource[]>;
};

export class CurrentSceneProductAuthorityResolutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CurrentSceneProductAuthorityResolutionError";
  }
}

async function loadCurrentStoryVersionId(
  db: Db,
  input: CurrentSceneProductAuthorityInput
): Promise<string | null> {
  const [story] = await db
    .select({ currentVersionId: schema.aiStories.currentVersionId })
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.id, input.storyId),
        eq(schema.aiStories.orgId, input.orgId),
        eq(schema.aiStories.workspaceId, input.workspaceId),
        eq(schema.aiStories.campaignId, input.campaignId),
        isNull(schema.aiStories.archivedAt)
      )
    )
    .limit(1);
  return story?.currentVersionId ?? null;
}

async function readCurrentScenes(
  db: Db,
  input: CurrentSceneProductAuthorityInput & { storyVersionId: string }
) {
  return new AiStoryCanonicalSceneAuthorityService(db).readCurrentSet({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    actorUserId: input.actorUserId,
  });
}

const defaultDependencies: Dependencies = {
  loadCurrentStoryVersionId,
  readCurrentScenes,
  resolveProductSources: resolveStoryProductSources,
};

function productStateFacts(scene: AiStoryCanonicalScene, productAuthorityId: string) {
  return [...scene.entryState, ...scene.exitState]
    .filter((fact) => fact.subjectId === productAuthorityId)
    .map((fact) => `${fact.dimension}: ${fact.value}`)
    .filter((fact, index, facts) => facts.indexOf(fact) === index)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Re-resolves one Product from current server-owned Story and Scene authority.
 * The projection performs SELECTs only and never accepts caller-supplied semantics.
 */
export async function resolveCurrentSceneProductAuthority(
  db: Db,
  input: CurrentSceneProductAuthorityInput,
  dependencies: Dependencies = defaultDependencies
) {
  const currentStoryVersionId = await dependencies.loadCurrentStoryVersionId(db, input);
  if (!currentStoryVersionId) {
    throw new CurrentSceneProductAuthorityResolutionError(
      "CURRENT_STORY_VERSION_REQUIRED",
      "Story does not have a current canonical version"
    );
  }

  const scenes = await dependencies.readCurrentScenes(db, {
    ...input,
    storyVersionId: currentStoryVersionId,
  });
  const scene = scenes.find((candidate) => candidate.sceneId === input.sceneId);
  if (
    !scene ||
    scene.orgId !== input.orgId ||
    scene.workspaceId !== input.workspaceId ||
    scene.campaignId !== input.campaignId ||
    scene.storyId !== input.storyId ||
    scene.storyVersionId !== currentStoryVersionId
  ) {
    throw new CurrentSceneProductAuthorityResolutionError(
      "CURRENT_CANONICAL_SCENE_REQUIRED",
      "Requested Scene is not current for the current Story version"
    );
  }

  const matchingBindings = scene.productBindings.filter(
    (candidate) => candidate.productAuthorityId === input.productAuthorityId
  );
  if (matchingBindings.length !== 1) {
    throw new CurrentSceneProductAuthorityResolutionError(
      "CURRENT_SCENE_PRODUCT_BINDING_REQUIRED",
      "Product is not bound exactly once to the current canonical Scene"
    );
  }
  const bindingResult = AiStoryAuthoritativeSceneProductBindingSchema.safeParse(
    matchingBindings[0]
  );
  if (!bindingResult.success) {
    throw new CurrentSceneProductAuthorityResolutionError(
      "SCENE_PRODUCT_VISUAL_IDENTITY_REQUIREMENT_UNRESOLVED",
      "Current Scene Product binding lacks explicit visual identity requirement authority"
    );
  }
  const binding = bindingResult.data;
  if (binding.productAuthorityId !== binding.sourceAssetId) {
    throw new CurrentSceneProductAuthorityResolutionError(
      "SCENE_PRODUCT_IDENTITY_INVALID",
      "Current Scene Product authority is not bound to its canonical source Asset"
    );
  }

  const sources = await dependencies.resolveProductSources(db, {
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
  });
  const matchingSources = sources.filter(
    (candidate) => candidate.assetId === binding.productAuthorityId
  );
  const source = matchingSources[0];
  if (
    matchingSources.length !== 1 ||
    !source ||
    source.assetId !== binding.sourceAssetId ||
    source.contentHash !== binding.sourceAssetContentHash
  ) {
    throw new CurrentSceneProductAuthorityResolutionError(
      "CURRENT_STORY_PRODUCT_SOURCE_MISMATCH",
      "Current Scene Product binding differs from current Story product_source authority"
    );
  }

  return AiStoryResolvedProductAuthoritySchema.parse({
    productAuthorityId: binding.productAuthorityId,
    sourceAssetId: binding.sourceAssetId,
    sourceAssetContentHash: binding.sourceAssetContentHash,
    displayName: `Product ${binding.productAuthorityId}`,
    identityFacts: [
      `Canonical Product source ${binding.sourceAssetId} with content identity ${binding.sourceAssetContentHash}`,
    ],
    visibleEvidenceGoals: [],
    sceneStateFacts: productStateFacts(scene, binding.productAuthorityId),
    mustKeep: [],
    mustAvoid: [],
    visualIdentityRequirement: binding.visualIdentityRequirement,
  });
}
