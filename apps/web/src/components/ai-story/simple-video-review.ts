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

/** One watched-video note. It is not a per-requirement pass. */
export const HUMAN_VISIBLE_REVIEW_ID = "human-visible-review";
/** Sound feedback stays on its own evidence id. */
export const AUDIO_REVIEW_ID = "audio-review";
/** A general note that is not a product, person, motion, or camera defect. */
export const OTHER_REVIEW_ID = "other-review";
export const CUSTOMER_REVIEW_REQUIREMENT_IDS = [HUMAN_VISIBLE_REVIEW_ID, AUDIO_REVIEW_ID, OTHER_REVIEW_ID] as const;

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
  if (code === "HUMAN_VISIBLE_REVIEW_CANNOT_PASS_REQUIREMENTS") return "Looks Good only records that you watched the video. It cannot mark each detail as passed.";
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return "You do not have permission to review this video.";
  return fallback;
}

export function issueCategoryLabel(category: VideoReviewIssueCategory): string {
  return VIDEO_REVIEW_ISSUE_CATEGORIES.find((item) => item.id === category)?.label ?? "Other";
}

export function categoryLabelKey(category: VideoReviewIssueCategory): "review.category.product" | "review.category.character" | "review.category.movement" | "review.category.camera" | "review.category.audio" | "review.category.other" {
  if (category === "product") return "review.category.product";
  if (category === "character") return "review.category.character";
  if (category === "movement") return "review.category.movement";
  if (category === "camera") return "review.category.camera";
  if (category === "audio") return "review.category.audio";
  return "review.category.other";
}

export function requirementForIssue(
  requirements: readonly AiStoryPostQcRequirement[],
  category: VideoReviewIssueCategory,
): AiStoryPostQcRequirement | null {
  if (category === "audio" || category === "other") return null;
  const dimensions = CATEGORY_DIMENSIONS[category];
  return requirements.find((item) => item.visuallyObservable && dimensions.includes(item.dimension)) ?? null;
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
  categoryLabel?: string;
  sentence?: (label: string, range: string) => string;
}): string {
  const range = `${formatReviewClock(input.startSec)}–${formatReviewClock(input.endSec)}`;
  const label = input.categoryLabel ?? issueCategoryLabel(input.category);
  const lead = input.sentence ? input.sentence(label, range) : `${label} needs changes from ${range}.`;
  const note = input.explanation.trim();
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
  const specific = input.category === "audio" || input.category === "other"
    ? null
    : requirementForIssue(input.requirements, input.category);
  if (input.category !== "audio" && input.category !== "other" && !specific) {
    return { error: `This video has no saved ${issueCategoryLabel(input.category).toLowerCase()} check. Pick another problem type.` };
  }
  const start = Math.max(0, Math.round(input.startSec * 1000));
  const end = Math.max(start + 1, Math.round(input.endSec * 1000));
  const requirementId = input.category === "audio"
    ? AUDIO_REVIEW_ID
    : input.category === "other"
      ? OTHER_REVIEW_ID
      : specific!.requirementId;
  const subjects = input.category === "audio" ? ["audio"] : input.category === "other" ? ["other"] : [];
  return {
    limitation: null,
    observation: {
      observationId: input.observationId,
      evidenceVersion: "ai-story-visual-evidence.v1",
      requirementId,
      source: "HUMAN_SUPPLIED_EVIDENCE",
      summary,
      observableSignal: "VIOLATED",
      confidence: { level: "HIGH", score: 1, evidenceQuality: "ADEQUATE" },
      timeRangeMs: { start, end },
      subjects,
      artifactSeverity: specific ? "MODERATE" : "MINOR",
      subjectiveTasteOnly: !specific,
    },
  };
}

export function buildLooksGoodObservation(observationId: string): Record<string, unknown> {
  return {
    observationId,
    evidenceVersion: "ai-story-visual-evidence.v1",
    requirementId: HUMAN_VISIBLE_REVIEW_ID,
    source: "HUMAN_SUPPLIED_EVIDENCE",
    summary: "I watched this video and the visible result looks good.",
    observableSignal: "SATISFIED",
    confidence: { level: "HIGH", score: 1, evidenceQuality: "ADEQUATE" },
    timeRangeMs: null,
    subjects: ["human-visible-review"],
    artifactSeverity: null,
    subjectiveTasteOnly: true,
  };
}

export function customerReviewObservationError(
  observations: readonly {
    requirementId: string;
    source: string;
    subjectiveTasteOnly?: boolean;
    observableSignal?: string;
    subjects?: readonly string[];
  }[],
  allowedRequirementIds: ReadonlySet<string>,
): "POST_QC_EVIDENCE_INVALID" | "HUMAN_VISIBLE_REVIEW_CANNOT_PASS_REQUIREMENTS" | null {
  const notes = new Set<string>(CUSTOMER_REVIEW_REQUIREMENT_IDS);
  if (observations.some((item) => item.source !== "HUMAN_SUPPLIED_EVIDENCE" || (!allowedRequirementIds.has(item.requirementId) && !notes.has(item.requirementId)))) {
    return "POST_QC_EVIDENCE_INVALID";
  }
  if (observations.some((item) => item.requirementId === AUDIO_REVIEW_ID && (item.subjectiveTasteOnly !== true || !item.subjects?.includes("audio")))) {
    return "POST_QC_EVIDENCE_INVALID";
  }
  if (observations.some((item) => item.requirementId === OTHER_REVIEW_ID && (item.subjectiveTasteOnly !== true || !item.subjects?.includes("other")))) {
    return "POST_QC_EVIDENCE_INVALID";
  }
  const holistic = observations.filter((item) => item.requirementId === HUMAN_VISIBLE_REVIEW_ID);
  if (holistic.length === 0) return null;
  const marksIndividualPass = observations.some((item) => item.requirementId !== HUMAN_VISIBLE_REVIEW_ID && item.observableSignal === "SATISFIED" && item.subjectiveTasteOnly !== true);
  if (holistic.length !== 1 || holistic[0]?.subjectiveTasteOnly !== true || marksIndividualPass) {
    return "HUMAN_VISIBLE_REVIEW_CANNOT_PASS_REQUIREMENTS";
  }
  return null;
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
}): { action: "approve" } | { action: "explain"; message: string } {
  if (!input.evaluation) return { action: "approve" };
  if (!input.evaluation.eligibleForHumanReview || !postQcAllowsHumanApproval(input.evaluation)) {
    const blocked = input.evaluation.findings.find((item) => item.result === "REJECT" && item.waiverPolicy === "NON_WAIVABLE_INTEGRITY");
    if (blocked?.dimension === "OUTPUT_INTEGRITY") {
      return { action: "explain", message: "This video file is incomplete, so it cannot be accepted. Replace the video, then review it again." };
    }
    const detail = blocked ? plainReviewMessage(blocked.reason) : "This video still has a problem that must be fixed first.";
    return { action: "explain", message: `This video cannot be accepted yet. ${detail}` };
  }
  return { action: "approve" };
}
