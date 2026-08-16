import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VIDEO_STUDIO_OPS_FAILURE_CLASSES,
  VIDEO_STUDIO_OPS_FORBIDDEN_KEYS,
  boundOpsDiagnosticMessage,
  emitVideoStudioOpsEvent,
  sanitizeVideoStudioOpsEvent,
} from "../packages/shared/src/video-studio-ops-evidence";
import { applyTaskExportFailure } from "../packages/agents/src/task-export";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const IDS = {
  orgId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  campaignId: "33333333-3333-4333-8333-333333333333",
  taskId: "44444444-4444-4444-8444-444444444444",
  creativeId: "55555555-5555-4555-8555-555555555555",
  jobId: "pipeline-44444444-4444-4444-8444-444444444444",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VS-RC-OBS-01 operational event shape", () => {
  it("includes stable correlation IDs for pipeline, render, export, and retry-render events", () => {
    const pipeline = sanitizeVideoStudioOpsEvent({
      event: "pipeline.started",
      stage: "agent.pipeline",
      outcome: "started",
      ...IDS,
      attempt: 1,
    });
    const render = sanitizeVideoStudioOpsEvent({
      event: "render.failed",
      stage: "ffmpeg.render",
      outcome: "failed",
      ...IDS,
      failureClass: "RENDITION_FAILURE",
      attempt: 2,
    });
    const exported = sanitizeVideoStudioOpsEvent({
      event: "export.failed",
      stage: "ffmpeg.export_task",
      outcome: "failed",
      ...IDS,
      failureClass: "EXPORT_FAILURE",
      resolution: "720p",
    });
    const retry = sanitizeVideoStudioOpsEvent({
      event: "retry_render.accepted",
      stage: "retry-render",
      outcome: "enqueued",
      ...IDS,
      recoveryKind: "retry_render",
    });
    for (const event of [pipeline, render, exported, retry]) {
      expect(event.kind).toBe("video_studio.ops");
      expect(event.orgId).toBe(IDS.orgId);
      expect(event.workspaceId).toBe(IDS.workspaceId);
      expect(event.campaignId).toBe(IDS.campaignId);
      expect(event.taskId).toBe(IDS.taskId);
    }
    expect(render.creativeId).toBe(IDS.creativeId);
    expect(render.failureClass).toBe("RENDITION_FAILURE");
    expect(exported.failureClass).toBe("EXPORT_FAILURE");
    expect(retry.recoveryKind).toBe("retry_render");
  });

  it("instruments pipeline, render, export, and retry-render production paths", () => {
    const pipeline = read("packages/agents/src/pipeline-lifecycle.ts");
    const queue = read("packages/queue/src/index.ts");
    const worker = read("apps/worker/src/processors/index.ts");
    const exportHandler = read("apps/worker/src/processors/export-handler.ts");
    const retryRender = read("apps/web/src/app/api/creatives/[id]/retry-render/route.ts");
    expect(pipeline).toContain('event: "pipeline.terminal_failure"');
    expect(queue).toContain('event: "pipeline.enqueued"');
    expect(queue).toContain('event: "render.enqueued"');
    expect(queue).toContain('event: "export.enqueued"');
    expect(worker).toContain('event: "pipeline.started"');
    expect(worker).toContain('failureClass: "RENDITION_FAILURE"');
    expect(exportHandler).toContain("persistTaskExportFailure");
    expect(retryRender).toContain('event: "retry_render.accepted"');
    expect(retryRender).toContain("enqueueRender");
    expect(retryRender).not.toContain("/generate");
  });
});

describe("VS-RC-OBS-01 forbidden data redaction", () => {
  it("drops forbidden keys from structured payloads", () => {
    const event = sanitizeVideoStudioOpsEvent({
      event: "pipeline.started",
      stage: "agent.pipeline",
      outcome: "started",
      ...IDS,
      authorization: "Bearer secret-token",
      apiKey: "sk-live",
      token: "abc",
      cookie: "sid=1",
      signedUrl: "https://example.supabase.co/storage/v1/object/sign/campaign-assets/x?token=abc",
      stack: "Error: boom\n    at fail",
      rawPrompt: "Write a hook about the product",
    } as never);
    const serialized = JSON.stringify(event);
    for (const key of VIDEO_STUDIO_OPS_FORBIDDEN_KEYS) {
      expect(event).not.toHaveProperty(key);
      expect(serialized).not.toContain(`"${key}"`);
    }
    expect(serialized).not.toContain("Bearer secret-token");
    expect(serialized).not.toContain("sk-live");
    expect(serialized).not.toContain("object/sign");
    expect(serialized).not.toContain("Write a hook");
  });

  it("bounds diagnostic messages and redacts URL/token material", () => {
    const message = boundOpsDiagnosticMessage(
      "Failed https://example.supabase.co/storage/v1/object/sign/pack.zip?token=abc signedUrl=https://leak"
    );
    expect(message).not.toMatch(/https?:\/\//);
    expect(message).not.toContain("token=abc");
    expect(message.length).toBeLessThanOrEqual(200);
  });

  it("emits only the sanitized JSON object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    emitVideoStudioOpsEvent({
      event: "export.failed",
      stage: "ffmpeg.export_task",
      outcome: "failed",
      ...IDS,
      failureClass: "EXPORT_FAILURE",
      signedUrl: "https://signed.example/token=1",
      stack: "nope",
    } as never);
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(payload.kind).toBe("video_studio.ops");
    expect(payload).not.toHaveProperty("signedUrl");
    expect(payload).not.toHaveProperty("stack");
  });
});

describe("VS-RC-OBS-01 failure classification", () => {
  it("keeps operator classes distinct without new lifecycle states", () => {
    expect(VIDEO_STUDIO_OPS_FAILURE_CLASSES).toEqual([
      "PIPELINE_FAILURE",
      "RENDITION_FAILURE",
      "PREVIEW_DELIVERY_FAILURE",
      "EXPORT_FAILURE",
      "AUTHORIZATION_DENIAL",
      "WRONG_CAMPAIGN_TASK",
    ]);
    const classified = VIDEO_STUDIO_OPS_FAILURE_CLASSES.map((failureClass) =>
      sanitizeVideoStudioOpsEvent({
        event: "classified",
        stage: "ops",
        outcome: "failed",
        failureClass,
      })
    );
    expect(new Set(classified.map((event) => event.failureClass)).size).toBe(6);
    expect(read("packages/shared/src/video-studio-ops-evidence.ts")).not.toContain(
      "status: failureClass"
    );
  });
});

describe("VS-RC-OBS-01 export failure durable write-back", () => {
  it("marks export_request failed without replacing unrelated stepProgress", () => {
    const prior = {
      edit_director_plan: {
        status: "completed" as const,
        output: {
          mode: "AI_DIRECTED",
          attemptCount: 1,
          fallbackReason: null,
          fingerprints: ["fp-1"],
        },
      },
      VIDEO_COMPOSITION_COMPLETE: {
        status: "completed" as const,
        output: { creativeIds: [IDS.creativeId] },
      },
      export_request: {
        status: "running" as const,
        startedAt: "2026-08-16T00:00:00.000Z",
        output: {
          resolution: "720p" as const,
          status: "exporting" as const,
          requestedAt: "2026-08-16T00:00:00.000Z",
        },
      },
    };
    const next = applyTaskExportFailure(prior, {
      error: "Export ZIP missing video files\nffprobe /usr/bin/ffmpeg --secret=abc",
    });
    expect(next.export_request?.status).toBe("failed");
    expect(next.export_request?.error).toBe("Export ZIP missing video files");
    expect((next.export_request?.output as { status?: string; error?: string }).status).toBe(
      "failed"
    );
    expect((next.export_request?.output as { error?: string }).error).toBe(
      "Export ZIP missing video files"
    );
    expect(next.edit_director_plan).toEqual(prior.edit_director_plan);
    expect(next.VIDEO_COMPOSITION_COMPLETE).toEqual(prior.VIDEO_COMPOSITION_COMPLETE);
    expect(read("apps/worker/src/processors/export-handler.ts")).toContain(
      "await persistTaskExportFailure"
    );
    expect(read("apps/worker/src/processors/export-handler.ts")).toContain("throw error");
  });

  it("leaves the export success merge path in place", () => {
    const exportHandler = read("apps/worker/src/processors/export-handler.ts");
    expect(exportHandler).toContain('status: "completed"');
    expect(exportHandler).toContain("progress.export_packs = exportPacks");
    expect(exportHandler).toContain('event: "export.completed"');
  });
});

describe("VS-RC-OBS-01 retry distinction", () => {
  it("keeps pipeline resume on the same taskId and increments retryCount", () => {
    const orchestrator = read("packages/agents/src/orchestrator.ts");
    expect(orchestrator).toContain("retryCount: task.retryCount + 1");
    expect(orchestrator).toContain("recoveryKind: \"pipeline_resume\"");
    expect(orchestrator).toContain("eq(schema.tasks.id, taskId)");
    expect(orchestrator).not.toContain("insert(schema.tasks)");
  });

  it("keeps same-Creative retry-render identity", () => {
    const retryRender = read("apps/web/src/app/api/creatives/[id]/retry-render/route.ts");
    expect(retryRender).toContain("taskId: creative.taskId");
    expect(retryRender).toContain("creativeId: creative.id");
    expect(retryRender).toContain("recoveryKind: \"retry_render\"");
    expect(retryRender).not.toContain("generationInputFingerprint");
    expect(retryRender).not.toContain("insert(schema.tasks)");
    expect(retryRender).not.toContain("insert(schema.creatives)");
  });

  it("keeps Generate Again as a new task with a new frozen identity", () => {
    const run = read("apps/web/src/lib/campaign-run.ts");
    const generate = read("apps/web/src/components/RunCeoButton.tsx");
    expect(generate).toContain('t("campaign.detail.generateAgain")');
    expect(generate).toContain("/api/campaigns/${campaignId}/generate");
    expect(run).toContain(".insert(schema.tasks)");
    expect(run).toContain("generationInputFingerprint: fingerprint");
    expect(run).toContain("if (active && isActiveCampaignTaskStatus(active.status))");
  });
});

describe("VS-RC-OBS-01 artifact identity", () => {
  it("does not put signed delivery URLs on structured events", () => {
    const event = sanitizeVideoStudioOpsEvent({
      event: "render.completed",
      stage: "ffmpeg.render",
      outcome: "completed",
      ...IDS,
      videoUrl: "https://example.supabase.co/storage/v1/object/sign/preview.mp4?token=abc",
    } as never);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("object/sign");
    expect(serialized).not.toContain("token=abc");
    expect(event).not.toHaveProperty("videoUrl");
    expect(event).not.toHaveProperty("signedUrl");
  });
});
