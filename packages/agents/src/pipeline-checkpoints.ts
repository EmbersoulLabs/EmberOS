import type { StepProgress } from "@ceo-agent/shared";
import type {
  PipelineExecutionResult,
  PipelineType,
} from "./workflow-contracts";

const RESULT_STEPS: Readonly<
  Partial<Record<PipelineType, string>>
> = {
  VIDEO: "video_pipeline_output",
  IMAGE_UNDERSTANDING: "image_understanding_output",
  MARKETING: "marketing_pipeline_output",
};

export function readCompletedPipelineResults(
  progress: StepProgress
): Partial<Record<PipelineType, PipelineExecutionResult>> {
  const results: Partial<Record<PipelineType, PipelineExecutionResult>> = {};
  for (const [pipelineType, stepId] of Object.entries(RESULT_STEPS) as Array<
    [PipelineType, string]
  >) {
    const step = progress[stepId];
    const result = step?.output as PipelineExecutionResult | undefined;
    if (
      step?.status === "completed" &&
      result?.pipelineType === pipelineType &&
      result.state === "COMPLETED"
    ) {
      results[pipelineType] = result;
    }
  }
  return results;
}
