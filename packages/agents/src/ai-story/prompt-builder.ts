/**
 * Prompt Builder — read-only consumer of frozen Animation Package.
 * Produces provider-agnostic prompts; adapters adapt to vendor APIs.
 */
import {
  AnimationPackagePayloadSchema,
  EXECUTION_CAPABILITY_IDS,
  MARKETING_OUTPUT_STRATEGY,
  PromptBuilderPackageSchema,
  resolveMarketingOutputCount,
  type AnimationPackagePayload,
  type MarketingOutputMediaKind,
  type PromptBuilderPackage,
} from "@ceo-agent/shared";

const HOOK_TYPES = [
  "overall",
  "hook",
  "problem",
  "product",
  "cta",
] as const;

export function buildGenerateReviewEstimate(input: {
  animationPackage: AnimationPackagePayload;
  mediaKind: MarketingOutputMediaKind;
}): import("@ceo-agent/shared").GenerateReviewEstimate {
  const pkg = AnimationPackagePayloadSchema.parse(input.animationPackage);
  const shotCount = pkg.shotPlan.length;
  const sceneCount = pkg.scenePlan.length;
  const target = MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS;
  const capabilityId =
    input.mediaKind === "image"
      ? EXECUTION_CAPABILITY_IDS.MARKETING_IMAGE
      : EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO;
  const estimatedDurationSec =
    input.mediaKind === "image"
      ? 45 * target
      : Math.max(
          60,
          pkg.scenePlan.reduce((sum, scene) => sum + scene.durationSec, 0) * target
        );
  const estimatedCostUsd =
    input.mediaKind === "image" ? 0.08 * target : 0.35 * target;

  return {
    storySummary: pkg.story.summary,
    aiSummary: [
      `Director: ${pkg.directorThinking.coreMessage}`,
      `${sceneCount} scenes / ${shotCount} shots`,
      `Target ${target} marketing ${input.mediaKind === "image" ? "creatives" : "videos"} (quality-first)`,
    ].join(" · "),
    estimatedCredits: Math.ceil(estimatedCostUsd * 100),
    estimatedCostUsd,
    estimatedDurationSec,
    preferredCapabilityId: capabilityId,
    risks: [
      ...(pkg.narrativeIntegration.consistent
        ? []
        : ["Narrative integration reported consistency issues — review before execute."]),
      "Provider selection is capability-driven; UI must not assume a vendor.",
      "Export is limited to approved marketing outputs.",
    ],
    targetOutputCount: target,
    mediaKind: input.mediaKind,
  };
}

export function buildPromptPackage(input: {
  storyId: string;
  animationPackageId: string;
  animationPackage: AnimationPackagePayload;
  mediaKind: MarketingOutputMediaKind;
  now?: Date;
}): PromptBuilderPackage {
  const pkg = AnimationPackagePayloadSchema.parse(input.animationPackage);
  const capabilityId =
    input.mediaKind === "image"
      ? EXECUTION_CAPABILITY_IDS.MARKETING_IMAGE
      : EXECUTION_CAPABILITY_IDS.ANIMATION_VIDEO;

  const candidates = HOOK_TYPES.map((hookType, index) => {
    const beat =
      pkg.storyBeats[Math.min(index, pkg.storyBeats.length - 1)] ?? pkg.storyBeats[0]!;
    const continuity = pkg.characterContinuity[0];
    const world = pkg.worldContinuity;
    const qualityScore = scoreOutputCandidate(pkg, index);
    return {
      id: `output-${index}`,
      qualityScore,
      reason: hookType,
      mediaKind: input.mediaKind,
      hookType,
      beat,
      continuity,
      world,
    };
  });

  const resolved = resolveMarketingOutputCount({ candidates });
  const selected = resolved.selected.map((item) => {
    const full = candidates.find((c) => c.id === item.id)!;
    return full;
  });

  const shotPromptsBase = [...pkg.shotPlan]
    .sort((a, b) => a.order - b.order)
    .map((shot) => {
      const scene = pkg.scenePlan.find((s) => s.id === shot.sceneId);
      const characterLine = pkg.characterContinuity
        .map((c) => `${c.name}: ${c.appearance}; emotion ${c.emotion}; costume ${c.costume}`)
        .join(" | ");
      return {
        shotId: shot.id,
        sceneId: shot.sceneId,
        order: shot.order,
        prompt: [
          pkg.directorThinking.coreMessage,
          `Focus: ${shot.focus}. Emotion: ${shot.emotion}. Information: ${shot.information}.`,
          `Camera: ${shot.cameraType}, ${shot.cameraMovement}, ${shot.composition}, ${shot.framing}.`,
          shot.lensSuggestion ? `Lens: ${shot.lensSuggestion}.` : "",
          scene ? `Scene purpose: ${scene.purpose}. Transition: ${scene.transition}.` : "",
          `World: ${pkg.worldContinuity.location}; ${pkg.worldContinuity.lighting}; ${pkg.worldContinuity.environment}.`,
          characterLine ? `Characters: ${characterLine}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        negativePrompt: "low quality, watermark, text overlay, distorted faces, flicker",
        durationSec: shot.durationSec,
        camera: {
          type: shot.cameraType,
          movement: shot.cameraMovement,
          composition: shot.composition,
          framing: shot.framing,
          lens: shot.lensSuggestion,
        },
        continuityNotes: scene?.continuityNotes ?? "",
      };
    });

  const outputBriefs = selected.map((item, outputIndex) => {
    const hook = item.hookType;
    const title = `${pkg.story.title} — ${hook}`;
    const caption = [
      pkg.directorThinking.takeaway,
      pkg.story.cta,
    ]
      .filter(Boolean)
      .join(" ");
    const hashtags = pkg.creativeContext.narrativeContext.themes
      .slice(0, 5)
      .map((theme) => `#${theme.replace(/\s+/g, "")}`);
    return {
      outputIndex,
      title,
      hookType: hook,
      qualityScore: item.qualityScore,
      shotPrompts: shotPromptsBase.map((shot) => ({
        ...shot,
        prompt: `[${hook}] ${shot.prompt}`,
      })),
      caption,
      hashtags,
      metadata: {
        beatId: item.beat.id,
        directorCoreMessage: pkg.directorThinking.coreMessage,
        mediaKind: input.mediaKind,
      },
    };
  });

  return PromptBuilderPackageSchema.parse({
    storyId: input.storyId,
    animationPackageId: input.animationPackageId,
    mediaKind: input.mediaKind,
    capabilityId,
    outputBriefs,
    builtAt: (input.now ?? new Date()).toISOString(),
  });
}

function scoreOutputCandidate(pkg: AnimationPackagePayload, index: number): number {
  let score = 0.7;
  if (pkg.narrativeIntegration.consistent) score += 0.15;
  if (pkg.shotPlan.length >= 3) score += 0.05;
  if (pkg.characterContinuity.length > 0) score += 0.05;
  if (pkg.worldContinuity.objects.length > 0) score += 0.05;
  // Slight decay for later variants so quality-first may drop weak tails.
  score -= index * 0.04;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}
