import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  automaticPipelineFailureAuthority,
  withTaskFailureTransitionAuthority,
} from "../packages/agents/src/pipeline-lifecycle";
import { DEFAULT_JOB_ATTEMPTS } from "../packages/queue/src/index";

const worker = readFileSync(
  resolve("apps/worker/src/processors/index.ts"),
  "utf8"
);
const lifecycle = readFileSync(
  resolve("packages/agents/src/pipeline-lifecycle.ts"),
  "utf8"
);
const orchestrator = readFileSync(
  resolve("packages/agents/src/orchestrator.ts"),
  "utf8"
);
const renderHandler = readFileSync(
  resolve("apps/worker/src/processors/render-handler.ts"),
  "utf8"
);
const artifactDelivery = readFileSync(
  resolve("apps/web/src/lib/video-artifact-delivery.ts"),
  "utf8"
);

describe("VS-RC-FIX-02 BullMQ attempt authority", () => {
  it("uses the real queue attempt configuration", () => {
    expect(DEFAULT_JOB_ATTEMPTS).toBe(3);
    expect(worker).toContain("job.opts.attempts ?? DEFAULT_JOB_ATTEMPTS");
  });

  it("classifies the first failed automatic attempt as retrying", () => {
    expect(
      automaticPipelineFailureAuthority({
        attemptsMade: 1,
        maxAttempts: DEFAULT_JOB_ATTEMPTS,
      })
    ).toMatchObject({ outcome: "retrying", anotherAttemptRemains: true });
  });

  it("classifies an intermediate failed attempt as retrying", () => {
    expect(
      automaticPipelineFailureAuthority({
        attemptsMade: DEFAULT_JOB_ATTEMPTS - 1,
        maxAttempts: DEFAULT_JOB_ATTEMPTS,
      })
    ).toMatchObject({ outcome: "retrying", anotherAttemptRemains: true });
  });

  it("classifies final exhaustion as failed", () => {
    expect(
      automaticPipelineFailureAuthority({
        attemptsMade: DEFAULT_JOB_ATTEMPTS,
        maxAttempts: DEFAULT_JOB_ATTEMPTS,
      })
    ).toMatchObject({ outcome: "failed", anotherAttemptRemains: false });
  });

  it("fails closed on malformed BullMQ counters", () => {
    expect(() =>
      automaticPipelineFailureAuthority({ attemptsMade: 0, maxAttempts: 3 })
    ).toThrow(/attemptsMade/);
    expect(() =>
      automaticPipelineFailureAuthority({ attemptsMade: 1, maxAttempts: 0 })
    ).toThrow(/maxAttempts/);
  });
});

describe("VS-RC-FIX-02 terminal convergence wiring", () => {
  it("persists every agent.pipeline failed event through the lifecycle helper", () => {
    expect(worker).toContain("automaticPipelineFailureAuthority");
    expect(worker).toContain("authority.outcome === \"failed\"");
    expect(worker).toMatch(
      /authority\.outcome === "failed",\s*true\s*\)/
    );
  });

  it("forces terminal failure after final automatic exhaustion", () => {
    expect(worker).toContain("forceTerminal");
    expect(lifecycle).toContain("params.forceTerminal === true");
    expect(lifecycle).toMatch(/status: "failed"/);
  });

  it("does not mutate logical manual retry accounting", () => {
    expect(worker).not.toContain("retryCount:");
    expect(orchestrator).toContain("retryCount: task.retryCount + 1");
    expect(orchestrator).toContain("Retry = Resume");
  });

  it("makes duplicate terminal failure handling idempotent", () => {
    expect(lifecycle).toContain(
      'task?.status === "completed" || task?.status === "failed"'
    );
    expect(lifecycle).toContain('notInArray(schema.tasks.status, ["completed", "failed"])');
  });

  it("protects completed task and campaign state from delayed failures", () => {
    expect(lifecycle).toContain('task?.status === "completed"');
    expect(lifecycle).toContain("withTaskFailureTransitionAuthority");
    expect(lifecycle).toContain("if (!acquired) return false");
  });

  it("preserves failed-step and error evidence", () => {
    expect(worker).toContain("resolveAgentFailureStep");
    expect(lifecycle).toContain("markRunningStepsFailed");
    expect(lifecycle).toContain("errorMessage: params.message");
    expect(lifecycle).toContain("stepProgress: progress");
  });

  it("allows a successful retry to progress from running to completed", () => {
    expect(orchestrator).toMatch(/status: "running"/);
    expect(orchestrator).toMatch(/status: "processing"/);
    expect(renderHandler).toContain(
      'status: failed ? "failed" : allDone ? "completed" : "running"'
    );
  });
});

describe("VS-RC-FIX-02E1 task-transition ownership", () => {
  it("persists ordinary terminal task and campaign failure together", async () => {
    let task = "retrying";
    let campaign = "processing";
    const acquired = await withTaskFailureTransitionAuthority({
      transitionTask: async () => {
        task = "failed";
        return true;
      },
      propagateCampaignFailure: async () => {
        campaign = "failed";
      },
    });
    expect(acquired).toBe(true);
    expect(task).toBe("failed");
    expect(campaign).toBe("failed");
  });

  it("does not propagate campaign failure when a success commit wins the race", async () => {
    let task = "retrying";
    let campaign = "processing";
    let resumeTransition!: () => void;
    let transitionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      transitionStarted = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      resumeTransition = resolve;
    });

    const staleFailure = withTaskFailureTransitionAuthority({
      transitionTask: async () => {
        transitionStarted();
        await resume;
        if (task === "completed") return false;
        task = "failed";
        return true;
      },
      propagateCampaignFailure: async () => {
        campaign = "failed";
      },
    });

    await started;
    task = "completed";
    campaign = "pending_internal_review";
    resumeTransition();

    await expect(staleFailure).resolves.toBe(false);
    expect(task).toBe("completed");
    expect(campaign).toBe("pending_internal_review");
  });

  it("makes duplicate final failure propagation idempotent", async () => {
    let task = "retrying";
    let campaignWrites = 0;
    const apply = () =>
      withTaskFailureTransitionAuthority({
        transitionTask: async () => {
          if (task === "failed") return false;
          task = "failed";
          return true;
        },
        propagateCampaignFailure: async () => {
          campaignWrites += 1;
        },
      });

    await expect(apply()).resolves.toBe(true);
    await expect(apply()).resolves.toBe(false);
    expect(campaignWrites).toBe(1);
  });
});

describe("VS-RC-FIX-02 identity and checkpoint boundaries", () => {
  it("preserves completed checkpoints for retry resume", () => {
    expect(orchestrator).toContain("isPipelineStageComplete");
    expect(orchestrator).toContain("resume skip=");
    expect(lifecycle).not.toContain("generationInputFingerprint:");
    expect(lifecycle).not.toContain("generationInputCapsule:");
  });

  it("does not change source, editing, render, or deterministic fallback identity", () => {
    for (const forbidden of [
      "sourceAssetContentHash",
      "editingPlanFingerprint",
      "renderCacheFingerprint",
      "generationInputFingerprint",
      "deterministicRenderKey",
    ]) {
      expect(worker).not.toContain(forbidden);
      expect(lifecycle).not.toContain(forbidden);
    }
  });

  it("leaves FIX-01 private signed delivery authority untouched", () => {
    expect(artifactDelivery).toContain("createSignedUrl");
    expect(artifactDelivery).not.toContain("getPublicUrl");
    expect(worker).not.toContain("createSignedUrl");
    expect(lifecycle).not.toContain("createSignedUrl");
  });
});
