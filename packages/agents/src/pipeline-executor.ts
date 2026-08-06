import type {
  MediaPipelineType,
  PipelineExecutionPlan,
  PipelineExecutionResult,
  PipelineType,
} from "./workflow-contracts";

export type PipelineRunner = () => Promise<PipelineExecutionResult>;

/**
 * Executes explicitly approved concurrency groups. The current production
 * orchestrator does not call this until media runners are safely independent.
 */
export async function executePipelinePlan(
  plan: PipelineExecutionPlan,
  runners: Partial<Record<MediaPipelineType, PipelineRunner>>
): Promise<PipelineExecutionResult[]> {
  const outputs: PipelineExecutionResult[] = [];
  for (const group of plan.concurrencyGroups) {
    const groupOutputs = await Promise.all(
      group.map(async (pipelineType) => {
        const runner = runners[pipelineType];
        if (!runner) {
          throw new Error(`No runner registered for required pipeline: ${pipelineType}`);
        }
        const result = await runner();
        if (result.pipelineType !== pipelineType) {
          throw new Error(
            `Pipeline runner returned ${result.pipelineType}; expected ${pipelineType}`
          );
        }
        return result;
      })
    );
    outputs.push(...groupOutputs);
  }
  return outputs.sort((a, b) => a.pipelineType.localeCompare(b.pipelineType));
}

export type CampaignPipelineHandler<T> = () => Promise<T>;

/**
 * Production compatibility executor. The Router owns the routing decision;
 * handlers preserve the existing Auto Clip and General Agency implementations.
 */
export async function executeCampaignPipelinePlan<T>(
  plan: PipelineExecutionPlan,
  handlers: Partial<Record<PipelineType, CampaignPipelineHandler<T>>>
): Promise<T> {
  const required = plan.routes.filter(
    (route) =>
      route.pipelineType !== "MARKETING" &&
      route.pipelineType !== "PRODUCT_IMAGE" &&
      route.state !== "NOT_REQUIRED"
  );
  const executable = required.filter((route) => route.state !== "COMPLETED");
  const candidates = executable.length > 0 ? executable : required;
  const primary =
    candidates.find((route) => route.pipelineType === "VIDEO") ??
    candidates.find((route) => route.pipelineType === "IMAGE_UNDERSTANDING");
  if (!primary) {
    throw new Error("Pipeline execution plan has no executable media route");
  }
  const handler = handlers[primary.pipelineType];
  if (!handler) {
    throw new Error(
      `No production handler registered for ${primary.pipelineType}`
    );
  }
  return handler();
}
