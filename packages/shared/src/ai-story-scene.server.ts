import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import {
  AI_STORY_LOCATION_CONTRACT_VERSION,
  AI_STORY_SCENE_CONTRACT_VERSION,
  AiStoryCanonicalSceneSchema,
  AiStoryLocationAuthorityVersionSchema,
  type AiStoryCanonicalScene,
  type AiStoryLocationAuthorityVersion,
  type AiStorySceneIssue,
} from "./ai-story-scene";
import type { AiStoryScriptVersion } from "./ai-story-script";

export function computeAiStoryLocationFingerprint(
  value: Omit<AiStoryLocationAuthorityVersion, "fingerprint" | "locationVersionId"> | AiStoryLocationAuthorityVersion,
) {
  const { fingerprint: _fingerprint, locationVersionId: _locationVersionId, ...truth } = value as AiStoryLocationAuthorityVersion;
  return sha256CanonicalIntegrityHash(truth);
}

export function buildAiStoryLocationVersion(
  input: Omit<AiStoryLocationAuthorityVersion, "fingerprint" | "locationVersionId" | "contractVersion">,
) {
  const base = { ...input, contractVersion: AI_STORY_LOCATION_CONTRACT_VERSION };
  const fingerprint = computeAiStoryLocationFingerprint(base);
  return AiStoryLocationAuthorityVersionSchema.parse({
    ...base,
    fingerprint,
    locationVersionId: deterministicUuidFromFingerprint(
      "ai-story-location-version",
      `${input.locationId}:${input.version}:${fingerprint}`,
    ),
  });
}

function sceneTruth(scene: AiStoryCanonicalScene) {
  return {
    contractVersion: AI_STORY_SCENE_CONTRACT_VERSION,
    sceneId: scene.sceneId,
    storyId: scene.storyId,
    storyVersionId: scene.storyVersionId,
    scriptVersionId: scene.scriptVersionId,
    version: scene.version,
    order: scene.order,
    sourceScriptSceneIds: scene.sourceScriptSceneIds,
    sourceScriptEntryIds: scene.sourceScriptEntryIds,
    sceneFunction: scene.sceneFunction,
    sceneRole: scene.sceneRole,
    importance: scene.importance,
    locationBinding: scene.locationBinding,
    locationState: scene.locationState,
    castBindings: scene.castBindings,
    productBindings: scene.productBindings,
    entryState: scene.entryState,
    events: scene.events,
    exitState: scene.exitState,
    continuityFacts: scene.continuityFacts,
    timeRelation: scene.timeRelation,
    discontinuity: scene.discontinuity,
    mustKeep: scene.mustKeep,
    mustAvoid: scene.mustAvoid,
    lineageOperation: scene.lineageOperation,
    parentSceneVersionIds: scene.parentSceneVersionIds,
  };
}

export function computeAiStorySceneSourceHash(scene: AiStoryCanonicalScene) {
  return sha256CanonicalIntegrityHash(sceneTruth(scene));
}

export function computeAiStorySceneFingerprint(scene: AiStoryCanonicalScene) {
  return sha256CanonicalIntegrityHash({
    sourceHash: computeAiStorySceneSourceHash(scene),
    orgId: scene.orgId,
    workspaceId: scene.workspaceId,
    campaignId: scene.campaignId,
    createdBy: scene.createdBy,
    createdAt: scene.createdAt,
  });
}

export function finalizeAiStoryCanonicalScene(
  input: Omit<
    AiStoryCanonicalScene,
    | "sceneVersionId"
    | "contractVersion"
    | "sourceHash"
    | "fingerprint"
    | "status"
    | "approvedBy"
    | "approvedAt"
    | "frozenAt"
  >,
) {
  const draft: AiStoryCanonicalScene = {
    ...input,
    sceneVersionId: "00000000-0000-4000-8000-000000000000",
    contractVersion: AI_STORY_SCENE_CONTRACT_VERSION,
    sourceHash: `sha256:${"0".repeat(64)}`,
    fingerprint: `sha256:${"0".repeat(64)}`,
    status: "DRAFT",
    approvedBy: null,
    approvedAt: null,
    frozenAt: null,
  };
  const sourceHash = computeAiStorySceneSourceHash(draft);
  const fingerprint = computeAiStorySceneFingerprint(draft);
  return AiStoryCanonicalSceneSchema.parse({
    ...draft,
    sourceHash,
    fingerprint,
    sceneVersionId: deterministicUuidFromFingerprint(
      "ai-story-scene-version",
      `${input.sceneId}:${input.version}:${fingerprint}`,
    ),
  });
}

function stateKey(fact: { dimension: string; subjectId: string }) {
  return `${fact.dimension}:${fact.subjectId}`;
}

function structurallyEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateAiStoryCanonicalScenes(
  scenes: readonly AiStoryCanonicalScene[],
  script: AiStoryScriptVersion,
  knownLocations: readonly AiStoryLocationAuthorityVersion[] = [],
): AiStorySceneIssue[] {
  const issues: AiStorySceneIssue[] = [];
  const add = (
    gate: AiStorySceneIssue["gate"],
    message: string,
    repairOwner: AiStorySceneIssue["repairOwner"] = "SCENE",
    severity: AiStorySceneIssue["severity"] = "BLOCK",
  ) => issues.push({ gate, message, repairOwner, severity });
  const ordered = [...scenes].sort((left, right) => left.order - right.order);

  if (!ordered.length) add("SCENE_EXISTS_GATE", "Canonical Story requires at least one Scene");
  if (
    ordered.some((scene, index) => scene.order !== index) ||
    new Set(scenes.map((scene) => scene.sceneId)).size !== scenes.length
  ) {
    add("SCENE_ORDER_GATE", "Scene order must be unique and contiguous");
  }

  const scriptScenes = new Map(script.scenes.map((scene) => [scene.scriptSceneId, scene] as const));
  const coveredEntries = new Map<string, string[]>();

  for (const scene of scenes) {
    if (
      scene.storyId !== script.storyId ||
      scene.storyVersionId !== script.storyVersionId ||
      scene.scriptVersionId !== script.scriptVersionId
    ) {
      add("SCENE_LINEAGE_GATE", `Scene ${scene.sceneId} lineage differs from frozen Script`, "SCRIPT");
    }
    if (
      scene.sourceHash !== computeAiStorySceneSourceHash(scene) ||
      scene.fingerprint !== computeAiStorySceneFingerprint(scene)
    ) {
      add("SCENE_FINGERPRINT_GATE", `Scene ${scene.sceneId} fingerprint mismatch`);
    }

    const sources = scene.sourceScriptSceneIds.map((id) => scriptScenes.get(id));
    if (sources.some((source) => !source)) {
      add("SCENE_LINEAGE_GATE", `Scene ${scene.sceneId} references unknown Script Scene`, "SCRIPT");
    }
    const scriptEntries = sources.flatMap((source) => source?.entries ?? []);
    const entriesById = new Map(scriptEntries.map((entry) => [entry.entryId, entry] as const));
    for (const event of scene.events) {
      if (!entriesById.has(event.entryId) || !structurallyEqual(entriesById.get(event.entryId), event)) {
        add("SCENE_LINEAGE_GATE", `Scene event ${event.entryId} rewrites Script truth`, "SCRIPT");
      }
      coveredEntries.set(event.entryId, [...(coveredEntries.get(event.entryId) ?? []), scene.sceneId]);
    }
    if (sources.length && sources.some((source) => source?.sceneFunction !== scene.sceneFunction)) {
      add("SCENE_LINEAGE_GATE", `Scene Function changed for ${scene.sceneId}`, "SCRIPT");
    }
    if (
      scene.sourceScriptEntryIds.length !== scene.events.length ||
      scene.events.some((event) => !scene.sourceScriptEntryIds.includes(event.entryId)) ||
      new Set(scene.sourceScriptEntryIds).size !== scene.sourceScriptEntryIds.length
    ) {
      add("SCENE_LINEAGE_GATE", `Scene ${scene.sceneId} source entry lineage differs from Script-derived events`, "SCRIPT");
    }
    if (!scene.sceneRole) add("SCENE_ROLE_GATE", `Scene ${scene.sceneId} lacks semantic role`);

    const location = scene.locationBinding;
    if (location.scope === "CAMPAIGN_LOCATION" && location.campaignId !== scene.campaignId) {
      add("LOCATION_SCOPE_GATE", "Campaign Location crosses Campaign", "LOCATION");
    } else if (location.scope === "STORY_LOCATION" && location.storyId !== scene.storyId) {
      add("LOCATION_SCOPE_GATE", "Story Location crosses Story", "LOCATION");
    } else if (
      location.scope === "EPHEMERAL_ENVIRONMENT" &&
      (location.storyId !== scene.storyId || location.sceneId !== scene.sceneId)
    ) {
      add("LOCATION_SCOPE_GATE", "Ephemeral Environment crosses Scene", "LOCATION");
    }

    if (location.scope !== "EPHEMERAL_ENVIRONMENT") {
      const persistentLocation = knownLocations.find(
        (candidate) =>
          candidate.locationId === location.id &&
          candidate.locationVersionId === location.authorityVersionId,
      );
      if (!persistentLocation) {
        add("LOCATION_VERSION_GATE", "Persistent Location version does not resolve", "LOCATION");
      } else if (persistentLocation.fingerprint !== location.authorityFingerprint) {
        add("LOCATION_VERSION_GATE", "Persistent Location fingerprint mismatch", "LOCATION");
      }
    }

    for (const cast of scene.castBindings) {
      if (cast.scope === "CAMPAIGN_CHARACTER" && cast.campaignId !== scene.campaignId) {
        add("CAST_BINDING_GATE", "Campaign Character crosses Campaign", "CAST");
      } else if (cast.scope === "STORY_SUPPORTING_CHARACTER" && cast.storyId !== scene.storyId) {
        add("CAST_BINDING_GATE", "Supporting Character crosses Story", "CAST");
      } else if (
        cast.scope === "EPHEMERAL_ACTOR" &&
        (cast.storyId !== scene.storyId || !scene.sourceScriptSceneIds.includes(cast.scriptSceneId))
      ) {
        add("CAST_BINDING_GATE", "Ephemeral Actor crosses Script Scene", "CAST");
      }
    }
    if (new Set(scene.castBindings.map((cast) => `${cast.scope}:${cast.id}`)).size !== scene.castBindings.length) {
      add("CAST_BINDING_GATE", "Scene contains duplicate Cast authority bindings", "CAST");
    }
    if (new Set(scene.productBindings.map((product) => product.productAuthorityId)).size !== scene.productBindings.length) {
      add("PRODUCT_BINDING_GATE", "Scene contains duplicate Product authority bindings", "PRODUCT_AUTHORITY");
    }
    const expectedProducts = new Set(sources.flatMap((source) => source?.productAuthorityRefs ?? []));
    const boundProducts = new Set(scene.productBindings.map((product) => product.productAuthorityId));
    if (
      expectedProducts.size !== boundProducts.size ||
      [...expectedProducts].some((productId) => !boundProducts.has(productId))
    ) {
      add("PRODUCT_BINDING_GATE", "Scene Product bindings differ from Script authority", "PRODUCT_AUTHORITY");
    }

    if (!scene.entryState.length && scene.importance !== "TRANSITIONAL") {
      add("ENTRY_STATE_GATE", `Consequential Scene ${scene.sceneId} lacks Entry State`);
    }
    if (!scene.exitState.length && scene.importance !== "TRANSITIONAL") {
      add("EXIT_STATE_GATE", `Consequential Scene ${scene.sceneId} lacks Exit State`);
    }
    const hasPurpose =
      scene.events.length > 0 ||
      scene.continuityFacts.length > 0 ||
      scene.locationState.temporaryFacts.length > 0 ||
      scene.timeRelation !== "UNSPECIFIED";
    if (!hasPurpose) add("SCENE_PURPOSE_GATE", `Scene ${scene.sceneId} is purposeless filler`);
    if (
      scene.discontinuity &&
      (!scene.discontinuity.explanation ||
        !scene.discontinuity.preservesCharacterIdentity ||
        !scene.discontinuity.preservesProductIdentity)
    ) {
      add("DISCONTINUITY_GATE", "Discontinuity cannot bypass identity truth");
    }
  }

  for (const scriptScene of script.scenes) {
    for (const entry of scriptScene.entries) {
      const uses = coveredEntries.get(entry.entryId) ?? [];
      if (uses.length !== 1) {
        add(
          "SCENE_LINEAGE_GATE",
          `Script entry ${entry.entryId} must be covered exactly once; delete/duplication/merge is invalid`,
          "SCRIPT",
        );
      }
    }
  }

  const locationBindings = new Map<string, AiStoryCanonicalScene["locationBinding"][]>();
  for (const scene of scenes) {
    const location = scene.locationBinding;
    locationBindings.set(location.id, [...(locationBindings.get(location.id) ?? []), location]);
  }
  for (const [locationId, bindings] of locationBindings) {
    if (bindings.length < 2) continue;
    if (bindings.some((binding) => binding.scope === "EPHEMERAL_ENVIRONMENT")) {
      add("LOCATION_CONTINUITY_GATE", `Ephemeral Environment ${locationId} cannot silently recur across Scenes`, "LOCATION");
      continue;
    }
    const versions = new Set(bindings.map((binding) => binding.scope === "EPHEMERAL_ENVIRONMENT" ? "" : `${binding.authorityVersionId}:${binding.authorityFingerprint}`));
    if (versions.size > 1) add("LOCATION_CONTINUITY_GATE", `Persistent Location ${locationId} uses inconsistent authority versions`, "LOCATION");
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.discontinuity) continue;
    const currentEntry = new Map(
      current.entryState.map((fact) => [stateKey(fact), fact.value] as const),
    );
    for (const fact of previous.exitState) {
      const nextValue = currentEntry.get(stateKey(fact));
      if (nextValue !== undefined && nextValue !== fact.value) {
        add(
          "SCENE_CONTINUITY_GATE",
          `State discontinuity for ${stateKey(fact)} between Scenes ${previous.sceneId} and ${current.sceneId}`,
        );
      }
    }
  }
  return issues;
}

export function assertAiStorySceneTransition(
  from: AiStoryCanonicalScene["status"],
  to: AiStoryCanonicalScene["status"],
) {
  const allowed = {
    DRAFT: ["VALIDATED"],
    VALIDATED: ["APPROVED"],
    APPROVED: ["FROZEN"],
    FROZEN: ["SUPERSEDED"],
    SUPERSEDED: [],
  } as const;
  if (!(allowed[from] as readonly string[]).includes(to)) {
    throw new Error(`SCENE_TRANSITION_DENIED:${from}->${to}`);
  }
}
