import { Queue, type ConnectionOptions } from "bullmq";
export { copyCacheKey, getCopyCache, setCopyCache } from "./copy-cache";
import { QUEUE_NAMES } from "./jobs";

export { QUEUE_NAMES } from "./jobs";

let connection: ConnectionOptions | null = null;

export function getRedisConnection(): ConnectionOptions {
  if (!connection) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    connection = { url, maxRetriesPerRequest: null };
  }
  return connection;
}

/**
 * BullMQ key prefix — isolates local dev from Railway/production workers on shared Upstash.
 * Set BULLMQ_PREFIX=local (or LOCAL_DEV=true) in .env.local when using cloud Redis locally.
 */
export function getBullmqPrefix(): string | undefined {
  const explicit = process.env.BULLMQ_PREFIX?.trim();
  if (explicit) return explicit;
  if (process.env.LOCAL_DEV === "true") return "local";
  return undefined;
}

export function logQueueConfig(): void {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const host = (() => {
    try {
      return new URL(url.replace(/^redis:\/\//, "http://")).hostname;
    } catch {
      return url;
    }
  })();
  const prefix = getBullmqPrefix();
  console.log(`[queue] redis=${host} prefix=${prefix ?? "(production — shared with remote workers)"}`);
  if (/upstash\.io/i.test(url) && !prefix) {
    console.warn(
      "[queue] WARNING: Upstash Redis without BULLMQ_PREFIX — remote Railway worker may steal jobs (old pipeline). Set LOCAL_DEV=true and BULLMQ_PREFIX=local in .env.local"
    );
  }
}

const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: getRedisConnection(),
        prefix: getBullmqPrefix(),
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
    mode?: "preview" | "final" | "subtitles_only";
    outputResolution?: "720p" | "1080p" | "2k";
    resolution?: "preview" | "export";
  }
) {
  const mode =
    data.mode ?? (data.resolution === "export" ? "final" : data.resolution === "preview" ? "preview" : "preview");
  const queue = renderQueue();
  const suffix = data.outputResolution ? `-${data.outputResolution}` : `-${mode}`;
  const job = await queue.add(
    "ffmpeg.render",
    { ...data, mode },
    { jobId: `render-${data.creativeId}${suffix}-${Date.now()}` }
  );
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
    console.log(
      `[queue] render enqueued job=${job.id} creative=${data.creativeId} task=${data.taskId} ` +
        `waiting=${counts.waiting ?? 0} active=${counts.active ?? 0} delayed=${counts.delayed ?? 0}`
    );
  } catch {
    console.log(`[queue] render enqueued job=${job.id} creative=${data.creativeId} task=${data.taskId}`);
  }
  return job;
}

export async function getRenderQueueCounts() {
  const queue = renderQueue();
  return queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
}

export async function enqueueExport(data: {
  creativeId: string;
  workspaceId: string;
  orgId: string;
  campaignId: string;
  platforms: string[];
}) {
  const queue = exportQueue();
  const jobId = `export-${data.creativeId}-${Date.now()}`;
  return queue.add("ffmpeg.export", data, { jobId });
}

export async function enqueueTaskExport(data: {
  taskId: string;
  workspaceId: string;
  orgId: string;
  campaignId: string;
  platforms: string[];
  resolution?: "720p" | "1080p" | "2k";
}) {
  const queue = exportQueue();
  const resolution = data.resolution ?? "720p";
  const jobId = `export-task-${data.taskId}-${resolution}-${Date.now()}`;
  return queue.add("ffmpeg.export_task", { ...data, resolution }, { jobId });
}

export async function enqueueProbe(data: {
  assetId: string;
  workspaceId: string;
  storagePath: string;
}) {
  const queue = probeQueue();
  return queue.add("ffmpeg.probe", data, { jobId: `probe-${data.assetId}` });
}
