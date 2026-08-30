import { and, desc, eq, inArray } from "drizzle-orm";
import {
  AiStoryCanonicalSceneSchema,
  AiStoryCharacterAuthorityVersionSchema,
  AiStoryLocationAuthorityVersionSchema,
  AiStorySceneReviewPresentationSchema,
  AiStorySupportingCharacterVersionSchema,
  type AiStoryCanonicalScene,
  type AiStorySceneReviewPresentation,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";

type Db = ReturnType<typeof getDb>;
type SceneIdentity = {
  readonly sceneExecutionId: string;
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly latestAttemptId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function humanize(value: string): string {
  return value
    .replace(/^EXT:[^:]+:/, "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function eventSummary(
  event: AiStoryCanonicalScene["events"][number],
  castNames: ReadonlyMap<string, string>,
): string {
  if (event.type === "ACTION") return event.action;
  if (event.type === "DIALOGUE") {
    const speaker = event.speakerCastReference
      ? castNames.get(`${event.speakerCastReference.scope}:${event.speakerCastReference.id}`)
      : null;
    return `${speaker ?? "Character"}: “${event.line}”`;
  }
  const owner = event.voiceOwnerCastReference
    ? castNames.get(`${event.voiceOwnerCastReference.scope}:${event.voiceOwnerCastReference.id}`)
    : null;
  return `${owner ? `${owner} voice-over` : "Voice-over"}: “${event.line}”`;
}

function stateSummary(fact: AiStoryCanonicalScene["entryState"][number]): string {
  return `${humanize(fact.dimension)}: ${fact.value}`;
}

/**
 * Read-only normal-user projection. Persistent Cast and Location display facts
 * are loaded by the exact immutable version IDs frozen into the Scene. When a
 * Provider Attempt exists, its Scene fingerprint selects the exact Scene
 * revision instead of current/latest authority.
 */
export async function loadAiStorySceneReviewPresentations(input: {
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly scenes: readonly SceneIdentity[];
  readonly db?: Db;
}): Promise<ReadonlyMap<string, AiStorySceneReviewPresentation>> {
  const db = input.db ?? getDb();
  const attemptIds = input.scenes.flatMap((scene) => scene.latestAttemptId ? [scene.latestAttemptId] : []);
  const attemptRows = attemptIds.length
    ? await db.select({
        providerAttemptId: schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
        binding: schema.aiStoryProviderAttemptCompiledBindings.binding,
      }).from(schema.aiStoryProviderAttemptCompiledBindings).where(and(
        inArray(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, attemptIds),
        eq(schema.aiStoryProviderAttemptCompiledBindings.workspaceId, input.workspaceId),
      ))
    : [];
  const fingerprintByAttempt = new Map(attemptRows.map((row) => [row.providerAttemptId, row.binding.sceneFingerprint]));

  const canonicalIds = input.scenes.map((scene) => scene.sceneId).filter((id) => UUID.test(id));
  if (canonicalIds.length === 0) return new Map();
  const sceneRows = await db.select({ snapshot: schema.aiStoryCanonicalSceneVersions.snapshot })
    .from(schema.aiStoryCanonicalSceneVersions)
    .where(and(
      inArray(schema.aiStoryCanonicalSceneVersions.sceneId, canonicalIds),
      eq(schema.aiStoryCanonicalSceneVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryCanonicalSceneVersions.campaignId, input.campaignId),
      eq(schema.aiStoryCanonicalSceneVersions.storyId, input.storyId),
    ))
    .orderBy(desc(schema.aiStoryCanonicalSceneVersions.version));
  const parsedScenes = sceneRows.flatMap((row) => {
    const parsed = AiStoryCanonicalSceneSchema.safeParse(row.snapshot);
    return parsed.success ? [parsed.data] : [];
  });
  const selected = input.scenes.flatMap((identity) => {
    const fingerprint = identity.latestAttemptId
      ? fingerprintByAttempt.get(identity.latestAttemptId)
      : undefined;
    const exact = fingerprint
      ? parsedScenes.find((scene) => scene.sceneId === identity.sceneId && scene.fingerprint === fingerprint)
      : undefined;
    const fallback = parsedScenes.find((scene) => scene.sceneId === identity.sceneId);
    return exact ?? fallback ? [{ identity, scene: (exact ?? fallback)! }] : [];
  });

  const campaignVersionIds = selected.flatMap(({ scene }) => scene.castBindings.flatMap((ref) => ref.scope === "CAMPAIGN_CHARACTER" ? [ref.authorityVersionId] : []));
  const supportingVersionIds = selected.flatMap(({ scene }) => scene.castBindings.flatMap((ref) => ref.scope === "STORY_SUPPORTING_CHARACTER" ? [ref.authorityVersionId] : []));
  const locationVersionIds = selected.flatMap(({ scene }) => scene.locationBinding.scope === "EPHEMERAL_ENVIRONMENT" ? [] : [scene.locationBinding.authorityVersionId]);
  const productAssetIds = selected.flatMap(({ scene }) => scene.productBindings.map((product) => product.sourceAssetId));

  const [characterRows, supportingRows, locationRows, productRows] = await Promise.all([
    campaignVersionIds.length ? db.select({ snapshot: schema.aiStoryCharacterVersions.snapshot }).from(schema.aiStoryCharacterVersions).where(and(inArray(schema.aiStoryCharacterVersions.characterVersionId, campaignVersionIds), eq(schema.aiStoryCharacterVersions.workspaceId, input.workspaceId))) : [],
    supportingVersionIds.length ? db.select({ snapshot: schema.aiStorySupportingCharacterVersions.snapshot }).from(schema.aiStorySupportingCharacterVersions).where(and(inArray(schema.aiStorySupportingCharacterVersions.supportingCharacterVersionId, supportingVersionIds), eq(schema.aiStorySupportingCharacterVersions.workspaceId, input.workspaceId), eq(schema.aiStorySupportingCharacterVersions.storyId, input.storyId))) : [],
    locationVersionIds.length ? db.select({ snapshot: schema.aiStoryLocationVersions.snapshot }).from(schema.aiStoryLocationVersions).where(and(inArray(schema.aiStoryLocationVersions.locationVersionId, locationVersionIds), eq(schema.aiStoryLocationVersions.workspaceId, input.workspaceId))) : [],
    productAssetIds.length ? db.select({ id: schema.assets.id, displayName: schema.assets.displayName, originalFilename: schema.assets.originalFilename }).from(schema.assets).where(and(inArray(schema.assets.id, productAssetIds), eq(schema.assets.workspaceId, input.workspaceId))) : [],
  ]);
  const characters = new Map(characterRows.flatMap((row) => {
    const parsed = AiStoryCharacterAuthorityVersionSchema.safeParse(row.snapshot);
    return parsed.success ? [[parsed.data.characterVersionId, parsed.data] as const] : [];
  }));
  const supporting = new Map(supportingRows.flatMap((row) => {
    const parsed = AiStorySupportingCharacterVersionSchema.safeParse(row.snapshot);
    return parsed.success ? [[parsed.data.supportingCharacterVersionId, parsed.data] as const] : [];
  }));
  const locations = new Map(locationRows.flatMap((row) => {
    const parsed = AiStoryLocationAuthorityVersionSchema.safeParse(row.snapshot);
    return parsed.success ? [[parsed.data.locationVersionId, parsed.data] as const] : [];
  }));
  const products = new Map(productRows.map((row) => [row.id, row]));

  const result = new Map<string, AiStorySceneReviewPresentation>();
  for (const { identity, scene } of selected) {
    const cast: AiStorySceneReviewPresentation["cast"][number][] = [];
    for (const ref of scene.castBindings) {
      if (ref.scope === "EPHEMERAL_ACTOR") {
        cast.push({ castId: ref.id, kind: "Scene actor", displayName: ref.displayName,
          description: ref.appearance || ref.semanticRole, referenceAssetIds: [], recurringInStory: false });
        continue;
      }
      if (ref.scope === "CAMPAIGN_CHARACTER") {
        const version = characters.get(ref.authorityVersionId);
        if (version) cast.push({ castId: ref.id, kind: "Character", displayName: version.name,
          description: version.canonicalFacts.identity, referenceAssetIds: version.visualAssetReferences.map((asset) => asset.assetId), recurringInStory: true });
        continue;
      }
      const version = supporting.get(ref.authorityVersionId);
      if (version) cast.push({ castId: ref.id, kind: "Supporting Character", displayName: version.displayName,
        description: version.identity, referenceAssetIds: version.visualAssetReferences.map((asset) => asset.assetId), recurringInStory: true });
    }
    const castNames = new Map(cast.map((member) => {
      const reference = scene.castBindings.find((ref) => ref.id === member.castId);
      return [`${reference?.scope ?? "CAST"}:${member.castId}`, member.displayName] as const;
    }));
    const locationRef = scene.locationBinding;
    const location = locationRef.scope === "EPHEMERAL_ENVIRONMENT"
      ? { locationId: locationRef.id, kind: "Scene environment" as const, displayName: locationRef.displayName, description: locationRef.environmentDescription, referenceAssetIds: [], promotionAction: "SAVE_FOR_STORY" as const }
      : (() => {
          const version = locations.get(locationRef.authorityVersionId);
          if (!version) return null;
          return { locationId: locationRef.id,
            kind: locationRef.scope === "CAMPAIGN_LOCATION" ? "Recurring Campaign location" as const : "Story location" as const,
            displayName: version.facts.displayName, description: version.facts.appearance,
            referenceAssetIds: version.facts.visualAssetIds,
            promotionAction: locationRef.scope === "STORY_LOCATION" ? "REUSE_IN_CAMPAIGN" as const : null };
        })();
    const actions = scene.events.map((event) => eventSummary(event, castNames));
    const presentation = AiStorySceneReviewPresentationSchema.parse({
      title: `Scene ${scene.order + 1}`,
      summary: actions[0] ?? scene.sceneFunction,
      purpose: humanize(scene.sceneFunction || scene.sceneRole),
      importance: scene.importance === "TRANSITIONAL" ? "Transition" : humanize(scene.importance),
      transitional: scene.importance === "TRANSITIONAL" || /TRANSITION/i.test(scene.sceneFunction),
      cast,
      location,
      products: scene.productBindings.map((binding) => ({
        productAuthorityId: binding.productAuthorityId,
        displayName: products.get(binding.sourceAssetId)?.displayName ?? products.get(binding.sourceAssetId)?.originalFilename ?? "Product",
        referenceAssetId: binding.sourceAssetId,
      })),
      actionSummary: actions,
      startsWith: scene.entryState.map(stateSummary),
      endsWith: scene.exitState.map(stateSummary),
      continuityNotes: [
        ...scene.continuityFacts,
        ...(scene.discontinuity ? [scene.discontinuity.explanation] : []),
      ],
      legacyCompatibility: false,
    });
    result.set(identity.sceneExecutionId, presentation);
  }
  return result;
}
