import { postQcAllowsHumanApproval, type AiStoryPostGenerationQcEvaluation, type AiStoryPostQcRequirement } from "@ceo-agent/shared";

export const VIDEO_REVIEW_ISSUE_CATEGORIES = [
  { id: "product", label: "Product" },
  { id: "character", label: "Character" },
  { id: "movement", label: "Movement" },
  { id: "camera", label: "Camera" },
  { id: "audio", label: "Audio" },
  { id: "other", label: "Other" },
] as const;

export type VideoReviewIssueCategory = (typeof VIDEO_REVIEW_ISSUE_CATEGORIES)[number]["id"];

const CATEGORY_DIMENSIONS: Record<Exclude<VideoReviewIssueCategory, "audio" | "other">, readonly string[]> = {
  product: ["PRODUCT_FIDELITY"],
  character: ["CHARACTER_FIDELITY"],
  movement: ["MOTION_EXECUTION", "ACTION_COMPLETION"],
  camera: ["DIRECTOR_EXECUTION"],
};

const UUID_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export type ReviewSignal = "SATISFIED" | "VIOLATED";

export function sceneProgressLabel(sceneIndex: number, sceneTotal: number): string {
  return `Scene ${sceneIndex} of ${sceneTotal}`;
}

export function formatReviewClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remain = safe % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function plainRequirementLabel(item: { requirementId: string; summary: string }): string {
  if (item.requirementId === "character-identity") return "The person matches the person you approved";
  if (item.requirementId === "product-identity") return "The product matches the product you approved";
  if (item.requirementId.startsWith("continuity:")) return "The video continues smoothly from the previous moment";
  if (item.requirementId.startsWith("director:") || item.requirementId.includes("CAMERA") || item.requirementId.includes("FOCUS")) return "The camera movement matches what you asked for";
  if (item.requirementId.startsWith("scene-action:")) return "The action in the video finishes";
  if (item.requirementId.startsWith("must-avoid:")) return "The video leaves out what you asked to leave out";
  const summary = item.summary.replace(UUID_TEXT, "the approved detail").replace(/\s+/g, " ").trim();
  return summary || "A required detail is visible";
}

export function plainReviewMessage(value: string): string {
  return value
    .replace(/QC interpretation:\s*/gi, "")
    .replace(/observable evidence indicates the canonical requirement was not satisfied\.\s*/gi, "")
    .replace(/available observable evidence satisfies the canonical requirement\.\s*/gi, "")
    .replace(UUID_TEXT, "the saved record")
    .replace(/\s+/g, " ")
    .trim();
}

export function plainReviewError(code: string | undefined, fallback: string): string {
  if (code === "COMMERCIAL_AUDIO_ASSEMBLY_REQUIRED") return "The video with music is not ready yet. Wait until the music mix finishes, then review that video.";
  if (code === "MISSING_LICENSED_MUSIC") return "No licensed music is available, so this video cannot be accepted yet.";
  if (code === "GENERATED_SCENE_POST_QC_REQUIRED" || code === "GENERATION_RESULT_DECISION_ALREADY_FROZEN") return "The saved check does not match this video anymore. Reload the page and review the current video.";
  if (code === "POST_QC_EVIDENCE_INVALID") return "That note could not be saved because it does not belong to this video.";
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return "You do not have permission to review this video.";
  return fallback;
}

export function issueCategoryLabel(category: VideoReviewIssueCategory): string {
  return VIDEO_REVIEW_ISSUE_CATEGORIES.find((item) => item.id === category)?.label ?? "Other";
}

export function requirementForIssue(
  requirements: readonly AiStoryPostQcRequirement[],
  category: VideoReviewIssueCategory,
): AiStoryPostQcRequirement | null {
  if (category === "audio" || category === "other") return null;
  const dimensions = CATEGORY_DIMENSIONS[category];
  return requirements.find((item) => item.visuallyObservable && dimensions.includes(item.dimension)) ?? null;
}

export function noteRequirement(requirements: readonly AiStoryPostQcRequirement[]): AiStoryPostQcRequirement | null {
  return requirements.find((item) => item.visuallyObservable && item.dimension === "MUST_KEEP")
    ?? requirements.find((item) => item.visuallyObservable)
    ?? null;
}

export function validateChangeWindow(startSec: number, endSec: number, durationSec: number | null): string | null {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return "Choose a start and an end on the video.";
  if (startSec < 0 || endSec < 0) return "Keep the times inside the video.";
  if (endSec <= startSec) return "The end time needs to be after the start time.";
  if (durationSec !== null && Number.isFinite(durationSec) && (startSec > durationSec + 0.05 || endSec > durationSec + 0.05)) {
    return "Those times go past the end of the video.";
  }
  return null;
}

export function formatChangeSummary(input: {
  category: VideoReviewIssueCategory;
  startSec: number;
  endSec: number;
  explanation: string;
}): string {
  const range = `${formatReviewClock(input.startSec)}–${formatReviewClock(input.endSec)}`;
  const note = input.explanation.trim();
  const lead = `${issueCategoryLabel(input.category)} needs changes from ${range}.`;
  return note ? `${lead} ${note}` : lead;
}

export function buildChangeObservation(input: {
  observationId: string;
  requirements: readonly AiStoryPostQcRequirement[];
  category: VideoReviewIssueCategory;
  startSec: number;
  endSec: number;
  summary: string;
  durationSec: number | null;
}): { observation: Record<string, unknown>; limitation: string | null } | { error: string } {
  const windowError = validateChangeWindow(input.startSec, input.endSec, input.durationSec);
  if (windowError) return { error: windowError };
  const summary = input.summary.trim();
  if (!summary || summary.length > 3000) return { error: "Write a short note about what should change." };
  const specific = requirementForIssue(input.requirements, input.category);
  const target = specific ?? ((input.category === "audio" || input.category === "other") ? noteRequirement(input.requirements) : null);
  if (!target) {
    if (input.category === "audio") return { error: "This video has no separate sound check, and no visible check can store the note." };
    if (input.category === "other") return { error: "This video has no visible check that can store a general note." };
    return { error: `This video has no saved ${issueCategoryLabel(input.category).toLowerCase()} check. Pick another problem type.` };
  }
  const start = Math.max(0, Math.round(input.startSec * 1000));
  const end = Math.max(start + 1, Math.round(input.endSec * 1000));
  const limitation = specific
    ? null
    : input.category === "audio"
      ? "Sound notes are saved on the general visible check. This review has no separate sound check."
      : "Other notes are saved on the general visible check. They do not mark the product or person as wrong.";
  return {
    limitation,
    observation: {
      observationId: input.observationId,
      evidenceVersion: "ai-story-visual-evidence.v1",
      requirementId: target.requirementId,
      source: "HUMAN_SUPPLIED_EVIDENCE",
      summary,
      observableSignal: "VIOLATED",
      confidence: { level: "HIGH", score: 1, evidenceQuality: "ADEQUATE" },
      timeRangeMs: { start, end },
      subjects: [],
      artifactSeverity: specific ? "MODERATE" : "MINOR",
      subjectiveTasteOnly: !specific,
    },
  };
}

export function explicitCheckObservations(input: {
  requirements: readonly AiStoryPostQcRequirement[];
  signals: Readonly<Record<string, ReviewSignal | undefined>>;
  observationIdFor: (requirementId: string) => string;
}): Record<string, unknown>[] {
  const seen = new Set<string>();
  const observations: Record<string, unknown>[] = [];
  for (const item of input.requirements) {
    if (!item.visuallyObservable || seen.has(item.requirementId)) continue;
    seen.add(item.requirementId);
    const signal = input.signals[item.requirementId];
    if (signal !== "SATISFIED" && signal !== "VIOLATED") continue;
    observations.push({
      observationId: input.observationIdFor(item.requirementId),
      evidenceVersion: "ai-story-visual-evidence.v1",
      requirementId: item.requirementId,
      source: "HUMAN_SUPPLIED_EVIDENCE",
      summary: `I watched the video. ${plainRequirementLabel(item)}`,
      observableSignal: signal,
      confidence: { level: "HIGH", score: 1, evidenceQuality: "ADEQUATE" },
      timeRangeMs: null,
      subjects: [],
      artifactSeverity: signal === "VIOLATED" ? "MODERATE" : null,
      subjectiveTasteOnly: false,
    });
  }
  return observations;
}

export function looksGoodDecision(input: {
  evaluation: AiStoryPostGenerationQcEvaluation | null;
  requirements: readonly AiStoryPostQcRequirement[];
}): { action: "approve" } | { action: "explain"; message: string } {
  if (!input.evaluation) {
    return {
      action: "explain",
      message: "This video has not been checked yet. Looks Good cannot accept it until you confirm what you see. Nothing is marked as passed for you.",
    };
  }
  const labels = new Map(input.requirements.map((item) => [item.requirementId, plainRequirementLabel(item)]));
  const unverified = input.evaluation.findings.filter((item) => item.result === "UNVERIFIED");
  if (unverified.length > 0) {
    const names = unverified.map((item) => labels.get(item.requirementId) ?? "A required detail").slice(0, 4);
    return {
      action: "explain",
      message: `Some checks are still unconfirmed, so this video cannot be accepted yet: ${names.join("; ")}. Confirm only what you actually see.`,
    };
  }
  if (!input.evaluation.eligibleForHumanReview || !postQcAllowsHumanApproval(input.evaluation)) {
    const blocked = input.evaluation.findings.find((item) => item.result === "REJECT");
    const detail = blocked ? plainReviewMessage(blocked.reason) : "This video still has a problem that must be fixed first.";
    return { action: "explain", message: `This video cannot be accepted yet. ${detail}` };
  }
  return { action: "approve" };
}
