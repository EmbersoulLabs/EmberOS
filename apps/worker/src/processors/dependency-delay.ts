import { DelayedError, type Job } from "bullmq";

export async function delayPipelineJobForDependencies(
  job: Pick<Job, "moveToDelayed" | "token">,
  delayMs: number,
  now: () => number = Date.now
): Promise<never> {
  await job.moveToDelayed(now() + Math.max(delayMs, 1000), job.token);
  throw new DelayedError();
}
