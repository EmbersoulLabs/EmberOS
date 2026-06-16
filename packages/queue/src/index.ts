import { Queue, type ConnectionOptions } from "bullmq";
import { QUEUE_NAMES } from "./jobs";

let connection: ConnectionOptions | null = null;

export function getRedisConnection(): ConnectionOptions {
  if (!connection) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    connection = { url, maxRetriesPerRequest: null };
  }
  return connection;
}

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: getRedisConnection(),
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
        },
      })
    );
  }
  return queues.get(name)!;
}

export const agentQueue = () => getQueue(QUEUE_NAMES.AGENT);
export const renderQueue = () => getQueue(QUEUE_NAMES.RENDER);
export const exportQueue = () => getQueue(QUEUE_NAMES.EXPORT);
export const probeQueue = () => getQueue(QUEUE_NAMES.PROBE);

export async function enqueuePipeline(taskId: string, campaignId: string, workspaceId: string, orgId: string) {
  const queue = agentQueue();
  return queue.add(
    "agent.pipeline",
    { taskId, campaignId, workspaceId, orgId },
    { jobId: `pipeline-${taskId}` }
  );
}

export async function enqueueRender(
  data: {
    taskId: string;
    creativeId: string;
    workspaceId: string;
    orgId: string;
    campaignId: string;
    resolution?: "preview" | "export";
  }
) {
  const queue = renderQueue();
  return queue.add("ffmpeg.render", data, {
    jobId: `render-${data.creativeId}-${data.resolution ?? "preview"}`,
  });
}

export async function enqueueExport(data: {
  creativeId: string;
  workspaceId: string;
  orgId: string;
  campaignId: string;
  platforms: string[];
}) {
  const queue = exportQueue();
  return queue.add("ffmpeg.export", data, { jobId: `export-${data.creativeId}` });
}

export async function enqueueProbe(data: {
  assetId: string;
  workspaceId: string;
  storagePath: string;
}) {
  const queue = probeQueue();
  return queue.add("ffmpeg.probe", data, { jobId: `probe-${data.assetId}` });
}
