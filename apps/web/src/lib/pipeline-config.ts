/** User-facing pipeline structure — hides internal step IDs in UI copy. */

export const AGENCY_STEPS = [
  "parse_intent",
  "strategy_plan",
  "ceo_plan",
  "vision_analyze",
  "content_classify",
  "content_generate",
  "hook_generate",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "compliance_check",
  "marketing_score",
  "human_review",
] as const;

export const AUTO_CLIP_STEPS = [
  "parse_intent",
  "vision_analyze",
  "clip_segment",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "export_ready",
] as const;

export type PipelineStepId = (typeof AGENCY_STEPS)[number] | (typeof AUTO_CLIP_STEPS)[number];

export type StepStatus = "completed" | "running" | "pending" | "failed" | "skipped";

export interface PipelinePhase {
  id: string;
  titleKey: string;
  steps: readonly string[];
}

export const AGENCY_PIPELINE_PHASES: PipelinePhase[] = [
  {
    id: "strategy",
    titleKey: "pipeline.phase.strategy",
    steps: ["parse_intent", "strategy_plan", "ceo_plan"],
  },
  {
    id: "contentAnalysis",
    titleKey: "pipeline.phase.contentAnalysis",
    steps: ["vision_analyze", "content_classify"],
  },
  {
    id: "contentCreation",
    titleKey: "pipeline.phase.contentCreation",
    steps: ["content_generate", "hook_generate", "copy_generate"],
  },
  {
    id: "production",
    titleKey: "pipeline.phase.production",
    steps: ["edit_director_plan", "ffmpeg_render"],
  },
  {
    id: "delivery",
    titleKey: "pipeline.phase.delivery",
    steps: ["compliance_check", "marketing_score", "human_review"],
  },
];

export const AUTO_CLIP_PIPELINE_PHASES: PipelinePhase[] = [
  {
    id: "strategy",
    titleKey: "pipeline.phase.strategy",
    steps: ["parse_intent"],
  },
  {
    id: "contentAnalysis",
    titleKey: "pipeline.phase.contentAnalysis",
    steps: ["vision_analyze", "clip_segment"],
  },
  {
    id: "contentCreation",
    titleKey: "pipeline.phase.contentCreation",
    steps: ["copy_generate"],
  },
  {
    id: "production",
    titleKey: "pipeline.phase.production",
    steps: ["edit_director_plan", "ffmpeg_render"],
  },
  {
    id: "delivery",
    titleKey: "pipeline.phase.delivery",
    steps: ["export_ready"],
  },
];

export function computePipelineProgress(
  progress: Record<string, { status: string; percent?: number }>,
  taskStatus: string | undefined,
  steps: readonly string[]
): { percent: number; currentStep: string | null; currentStepIndex: number; videoReady: boolean } {
  if (taskStatus === "completed") {
    return { percent: 100, currentStep: null, currentStepIndex: steps.length, videoReady: true };
  }
  if (taskStatus === "failed") {
    const done = steps.filter((s) => progress[s]?.status === "completed").length;
    const failedStep = steps.find((s) => progress[s]?.status === "failed") ?? null;
    return {
      percent: Math.round((done / steps.length) * 100),
      currentStep: failedStep,
      currentStepIndex: failedStep ? steps.indexOf(failedStep) + 1 : done,
      videoReady: progress.ffmpeg_render?.status === "completed",
    };
  }

  let score = 0;
  let currentStep: string | null = null;

  for (const step of steps) {
    const entry = progress[step];
    const status = entry?.status ?? "pending";
    if (status === "completed") {
      score += 1;
    } else if (status === "running") {
      if (step === "ffmpeg_render" && typeof entry?.percent === "number") {
        score += entry.percent / 100;
      } else {
        score += 0.5;
      }
      if (!currentStep) currentStep = step;
    } else if (!currentStep && status === "pending") {
      currentStep = step;
    }
  }

  if (!currentStep) {
    currentStep = steps.find((s) => progress[s]?.status === "running") ?? null;
  }

  const currentStepIndex = currentStep ? steps.indexOf(currentStep) + 1 : score;

  return {
    percent: Math.min(99, Math.round((score / steps.length) * 100)),
    currentStep,
    currentStepIndex: Math.max(1, Math.ceil(currentStepIndex)),
    videoReady: progress.ffmpeg_render?.status === "completed",
  };
}

/** Rough ETA from remaining progress (avg ~40s per step). */
export function estimateTimeRemaining(percent: number): string {
  if (percent >= 100) return "";
  const totalSec = Math.max(30, Math.round(((100 - percent) / 100) * 6 * 60));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s`;
}

export function normalizeStepStatus(raw?: string): StepStatus {
  if (raw === "completed") return "completed";
  if (raw === "running") return "running";
  if (raw === "failed") return "failed";
  if (raw === "skipped") return "skipped";
  return "pending";
}

/** True when task used Auto Clip (3 standalone shorts), not agency montage. */
export function isAutoClipTask(
  progress: Record<string, { status?: string; output?: unknown }>,
  creativesCount: number
): boolean {
  if (progress.clip_segment) return true;
  const editOut = progress.edit_director_plan?.output;
  if (editOut && typeof editOut === "object" && editOut !== null && "clipCount" in editOut) {
    return true;
  }
  return creativesCount >= 3;
}
