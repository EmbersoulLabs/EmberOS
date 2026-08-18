/**
 * Execution compiler — Story → Beat → Scene → Shot hierarchy for Seedance.
 * Read-only consumer of frozen Animation Package + resolved Campaign Assets.
 */
import {
  AnimationPackagePayloadSchema,
  EXECUTION_CAPABILITY_IDS,
  ExecutionManifestSchema,
  MARKETING_OUTPUT_STRATEGY,
  PRODUCT_IDENTITY_CONSTRAINTS,
  resolveMarketingOutputCount,
  type AnimationPackagePayload,
  type ExecutionManifest,
  type GenerateReviewEstimate,
} from "@ceo-agent/shared";

export type ResolvedCampaignAsset = {
  assetId: string;
  storagePath: string;
  displayName?: string | null;
};

export class MissingCampaignAssetsError extends Error {
  readonly code = "MISSING_CAMPAIGN_ASSETS";
  constructor(readonly missingAssetIds: readonly string[]) {
    super(
      `Animation Package references Campaign Assets that are missing or not linked: ${missingAssetIds.join(", ")}`
    );
    this.name = "MissingCampaignAssetsError";
  }
}

export function collectReferencedAssetIds(
  animationPackage: AnimationPackagePayload
): string[] {
  const ids = new Set<string>();
  for (const id of animationPackage.story.assetReferences ?? []) {
    if (id) ids.add(id);
  }
  return [...ids];
}

export function assertCampaignAssetsResolved(
  requiredIds: readonly string[],
  resolved: readonly ResolvedCampaignAsset[]
): ResolvedCampaignAsset[] {
  const byId = new Map(resolved.map((a) => [a.assetId, a]));
  const missing = requiredIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new MissingCampaignAssetsError(missing);
  }
  if (requiredIds.length === 0) {
    throw new MissingCampaignAssetsError([]);
  }
  return requiredIds.map((id) => byId.get(id)!);
}

export function buildGenerateReviewEstimate(input: {
  animationPackage: AnimationPackagePayload;
  referencedAssetIds: readonly string[];
}): GenerateReviewEstimate {
  const pkg = AnimationPackagePayloadSchema.parse(input.animationPackage);
  const shotCount = pkg.shotPlan.length;
  const sceneCount = pkg.scenePlan.length;
  const target = MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS;
  const estimatedDurationSec = Math.max(
    60,
    pkg.scenePlan.reduce((sum, scene) => sum + scene.durationSec, 0) * target
  );
  const estimatedCostUsd = 0.35 * target;

  return {
    storySummary: pkg.story.summary,
    aiSummary: [
      `Director: ${pkg.directorThinking.coreMessage}`,
      `${sceneCount} scenes / ${shotCount} shots`,
      `${input.referencedAssetIds.length} Campaign Asset reference(s)`,
      `Target ${target} marketing videos (quality-first, PD-055)`,
    ].join(" · "),
    estimatedCredits: Math.ceil(estimatedCostUsd * 100),
    estimatedCostUsd,
    estimatedDurationSec,
    preferredCapabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    risks: [
      ...(pkg.narrativeIntegration.consistent
        ? []
        : ["Narrative integration reported consistency issues — review before execute."]),
      ...(input.referencedAssetIds.length === 0
        ? ["No Campaign Asset references on the Story Draft — execution will fail until assets are linked."]
        : []),
      "Provider selection is capability-driven (animation-video-generation); UI must not assume a vendor.",
      "Product identity must be preserved from referenced Campaign Assets — no product recreation.",
      "Export is limited to approved execution video outputs.",
    ],
    targetOutputCount: target,
    referencedAssetIds: [...input.referencedAssetIds],
  };
}

/**
 * Compile one deterministic ordered Seedance request while retaining scene/shot maps.
 */
export function compileExecutionManifest(input: {
  storyId: string;
  animationPackageId: string;
  animationPackage: AnimationPackagePayload;
  resolvedAssets: readonly ResolvedCampaignAsset[];
  now?: Date;
}): ExecutionManifest {
  const pkg = AnimationPackagePayloadSchema.parse(input.animationPackage);
  const referencedAssetIds = collectReferencedAssetIds(pkg);
  const assets = assertCampaignAssetsResolved(referencedAssetIds, input.resolvedAssets);

  const scenesSorted = [...pkg.scenePlan].sort((a, b) => a.order - b.order);
  const shotsSorted = [...pkg.shotPlan].sort((a, b) => a.order - b.order);

  const compiledShots = shotsSorted.map((shot, sectionIndex) => {
    const scene = scenesSorted.find((s) => s.id === shot.sceneId);
    const beatIds = scene?.beatIds ?? [];
    const characterLine = pkg.characterContinuity
      .map(
        (c) =>
          `${c.name}: appearance ${c.appearance}; emotion ${c.emotion}; costume ${c.costume}; pose ${c.pose}; identity ${c.identity}`
      )
      .join(" | ");
    const promptSection = [
      `SHOT ${sectionIndex + 1} id=${shot.id} scene=${shot.sceneId} order=${shot.order}`,
      `Duration: ${shot.durationSec}s`,
      `Camera: type=${shot.cameraType}; movement=${shot.cameraMovement}; composition=${shot.composition}; framing=${shot.framing}` +
        (shot.lensSuggestion ? `; lens=${shot.lensSuggestion}` : ""),
      `Focus: ${shot.focus}. Emotion: ${shot.emotion}. Information: ${shot.information}.`,
      scene
        ? `Scene purpose: ${scene.purpose}. Transition: ${scene.transition || "none"}. Continuity: ${scene.continuityNotes || "n/a"}.`
        : "",
      beatIds.length ? `Beats: ${beatIds.join(", ")}` : "",
      `World: location=${pkg.worldContinuity.location}; lighting=${pkg.worldContinuity.lighting}; environment=${pkg.worldContinuity.environment}; timeline=${pkg.worldContinuity.timeline}.`,
      `World rules: ${pkg.worldContinuity.worldRules.join("; ")}`,
      characterLine ? `Character continuity: ${characterLine}` : "",
      `Director core message: ${pkg.directorThinking.coreMessage}`,
      ...PRODUCT_IDENTITY_CONSTRAINTS,
      `Subject Campaign Assets: ${assets.map((a) => a.assetId).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      shotId: shot.id,
      sceneId: shot.sceneId,
      beatIds,
      order: shot.order,
      durationSec: shot.durationSec,
      cameraType: shot.cameraType,
      cameraMovement: shot.cameraMovement,
      composition: shot.composition,
      framing: shot.framing,
      lensSuggestion: shot.lensSuggestion,
      focus: shot.focus,
      emotion: shot.emotion,
      information: shot.information,
      transition: scene?.transition ?? "",
      continuityNotes: scene?.continuityNotes ?? "",
      subjectAssetIds: referencedAssetIds,
      promptSection,
    };
  });

  const totalDuration = compiledShots.reduce((sum, s) => sum + s.durationSec, 0);
  const prompt = [
    "AI Story animation execution — preserve Story → Beat → Scene → Shot order exactly.",
    `Title: ${pkg.story.title}`,
    `Summary: ${pkg.story.summary}`,
    `Hero: ${pkg.directorThinking.hero}. Conflict: ${pkg.directorThinking.conflict}.`,
    `Turning point: ${pkg.directorThinking.turningPoint}. Climax: ${pkg.directorThinking.climax}.`,
    `Takeaway / CTA: ${pkg.directorThinking.takeaway} / ${pkg.story.cta}`,
    "",
    ...PRODUCT_IDENTITY_CONSTRAINTS,
    "",
    "=== ORDERED SHOTS ===",
    ...compiledShots.map((s) => s.promptSection),
  ].join("\n\n");

  const candidates = Array.from({ length: MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS }).map(
    (_, index) => ({
      id: `video-output-${index}`,
      qualityScore: Math.max(0.5, 0.92 - index * 0.04),
      reason: `variant-${index}`,
    })
  );
  const resolvedCount = resolveMarketingOutputCount({ candidates });

  // One Seedance request produces one final ordered video; variants reuse the same
  // compiled hierarchy with a variant tag (quality-first may keep 3–5 outputs).
  void resolvedCount;

  return ExecutionManifestSchema.parse({
    storyId: input.storyId,
    animationPackageId: input.animationPackageId,
    capabilityId: EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO,
    referencedAssetIds,
    identityConstraints: [...PRODUCT_IDENTITY_CONSTRAINTS],
    characterContinuity: pkg.characterContinuity as unknown as Record<string, unknown>[],
    worldContinuity: pkg.worldContinuity as unknown as Record<string, unknown>,
    scenes: scenesSorted.map((scene) => ({
      sceneId: scene.id,
      beatIds: scene.beatIds,
      order: scene.order,
      purpose: scene.purpose,
      durationSec: scene.durationSec,
      transition: scene.transition,
      shotIds: shotsSorted.filter((s) => s.sceneId === scene.id).map((s) => s.id),
    })),
    shots: compiledShots,
    compiledProviderRequest: {
      prompt,
      negativePrompt:
        "redesigned product, wrong logo, altered packaging text, low quality, watermark, flicker, identity drift",
      durationSec: Math.max(1, totalDuration),
      aspectRatio: "9:16",
      assetReferences: assets.map((a) => ({
        assetId: a.assetId,
        storagePath: a.storagePath,
        role: "product",
      })),
      shotMap: compiledShots.map((shot, sectionIndex) => ({
        shotId: shot.shotId,
        sceneId: shot.sceneId,
        sectionIndex,
      })),
    },
    builtAt: (input.now ?? new Date()).toISOString(),
  });
}

export function buildOutputVariantsFromManifest(
  manifest: ExecutionManifest,
  storyTitle: string
): Array<{
  outputIndex: number;
  title: string;
  qualityScore: number;
  caption: string;
  hashtags: string[];
}> {
  const candidates = Array.from({ length: MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS }).map(
    (_, index) => ({
      id: `video-output-${index}`,
      qualityScore: Math.max(0.5, 0.92 - index * 0.04),
      reason: ["overall", "hook", "problem", "product", "cta"][index] ?? `variant-${index}`,
    })
  );
  const resolved = resolveMarketingOutputCount({ candidates });
  return resolved.selected.map((item, outputIndex) => ({
    outputIndex,
    title: `${storyTitle} — ${item.reason}`,
    qualityScore: item.qualityScore,
    caption: "",
    hashtags: [],
  }));
}
