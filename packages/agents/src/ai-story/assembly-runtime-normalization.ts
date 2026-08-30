/**
 * Sprint 3 PR 3.6 — deterministic normalization policy (no creative behavior).
 */
import {
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  AssemblyNormalizationPlanSchema,
  type AssemblyMediaProbe,
  type AssemblyNormalizationPlan,
} from "@ceo-agent/shared/server";

export function buildAssemblyNormalizationPlan(
  probes: readonly AssemblyMediaProbe[]
): AssemblyNormalizationPlan {
  if (probes.length === 0) {
    throw new Error("Normalization plan requires at least one media probe");
  }
  const widths = probes.map((probe) => probe.width);
  const heights = probes.map((probe) => probe.height);
  // Deterministic: use max dimensions so all scenes scale-and-pad to a common canvas.
  const targetWidth = Math.max(...widths);
  const targetHeight = Math.max(...heights);
  // Force even dimensions for yuv420p / libx264.
  const evenWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
  const evenHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;

  return AssemblyNormalizationPlanSchema.parse({
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    targetWidth: evenWidth,
    targetHeight: evenHeight,
    targetFrameRate: 30,
    videoCodec: "h264",
    pixelFormat: "yuv420p",
    audioCodec: "aac",
    audioSampleRate: 48000,
    audioChannels: 2,
    insertSilentAudioWhenMissing: true,
    scaleMode: "scale-and-pad",
    padColor: "black",
    forbidTransitions: true,
    forbidCreativeEffects: true,
  });
}

export function buildNormalizationFilter(plan: AssemblyNormalizationPlan): string {
  return [
    `scale=${plan.targetWidth}:${plan.targetHeight}:force_original_aspect_ratio=decrease:flags=bicubic`,
    `pad=${plan.targetWidth}:${plan.targetHeight}:(ow-iw)/2:(oh-ih)/2:${plan.padColor}`,
    `fps=${plan.targetFrameRate}`,
    `format=${plan.pixelFormat}`,
  ].join(",");
}
