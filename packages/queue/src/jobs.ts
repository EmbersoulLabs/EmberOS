import { z } from "zod";

export const QUEUE_NAMES = {
  AGENT: "agent",
  RENDER: "render",
  EXPORT: "export",
  PROBE: "probe",
} as const;

export const AgentJobSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("agent.ceo"),
    data: z.object({
      taskId: z.string().uuid(),
      campaignId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      orgId: z.string().uuid(),
    }),
  }),
  z.object({
    name: z.literal("agent.vision"),
    data: z.object({
      taskId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      orgId: z.string().uuid(),
      assetIds: z.array(z.string().uuid()),
    }),
  }),
  z.object({
    name: z.literal("agent.copy"),
    data: z.object({
      taskId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      orgId: z.string().uuid(),
      platforms: z.array(z.string()),
    }),
  }),
  z.object({
    name: z.literal("agent.edit"),
    data: z.object({
      taskId: z.string().uuid(),
      creativeId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      orgId: z.string().uuid(),
    }),
  }),
  z.object({
    name: z.literal("agent.compliance"),
    data: z.object({
      taskId: z.string().uuid(),
      creativeId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      orgId: z.string().uuid(),
    }),
  }),
  z.object({
    name: z.literal("agent.publish"),
    data: z.object({
      taskId: z.string().uuid(),
      creativeId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      orgId: z.string().uuid(),
    }),
  }),
  z.object({
    name: z.literal("agent.pipeline"),
    data: z.object({
      taskId: z.string().uuid(),
      campaignId: z.string().uuid(),
      workspaceId: z.string().uuid(),
      orgId: z.string().uuid(),
    }),
  }),
]);

export type AgentJob = z.infer<typeof AgentJobSchema>;

export const RenderJobSchema = z.object({
  name: z.literal("ffmpeg.render"),
  data: z.object({
    taskId: z.string().uuid(),
    creativeId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    orgId: z.string().uuid(),
    campaignId: z.string().uuid(),
    resolution: z.enum(["preview", "export"]).default("preview"),
  }),
});

export const ExportJobSchema = z.object({
  name: z.literal("ffmpeg.export"),
  data: z.object({
    creativeId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    orgId: z.string().uuid(),
    campaignId: z.string().uuid(),
    platforms: z.array(z.string()),
  }),
});

export const ProbeJobSchema = z.object({
  name: z.literal("ffmpeg.probe"),
  data: z.object({
    assetId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    storagePath: z.string(),
  }),
});

export type RenderJob = z.infer<typeof RenderJobSchema>;
export type ExportJob = z.infer<typeof ExportJobSchema>;
export type ProbeJob = z.infer<typeof ProbeJobSchema>;
