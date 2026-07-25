import { describe, expect, it, vi } from "vitest";
import {
  FinalizationPipeline,
  GateRunner,
  readFinalizationResult,
  recordedGate,
  type Gate,
  type GateResult,
} from "../packages/agents/src/finalization-pipeline";
import { finalizeReviewAfterGates } from "../packages/agents/src/review-finalization";

function result(
  gateId: string,
  status: GateResult["status"] = "PASS"
): GateResult {
  return {
    gateId,
    status,
    warnings: status === "WARNING" ? [`${gateId} warning`] : [],
    provenance: [`gate:${gateId}`],
  };
}

describe("PR-3A.5A canonical Finalization infrastructure", () => {
  it("executes registered gates and aggregates PASS", async () => {
    const execute = vi.fn(async () => result("validation"));
    const gate: Gate = { id: "validation", execute };
    const output = await new GateRunner().run([gate], {
      taskId: "task-1",
      campaignId: "campaign-1",
      finalOutputReferences: ["creative-1"],
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(output.summary).toEqual({
      status: "PASS",
      total: 1,
      passed: 1,
      warnings: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("supports an empty gate set without inventing business gates", async () => {
    const output = await new GateRunner().run([], {
      taskId: "task-1",
      campaignId: "campaign-1",
      finalOutputReferences: [],
    });
    expect(output.summary.status).toBe("PASS");
    expect(output.results).toEqual([]);
  });

  it("aggregates warnings and skipped gates without treating them as failure", async () => {
    const output = await new GateRunner().run(
      [
        recordedGate(result("validation", "WARNING")),
        recordedGate(result("optional", "SKIPPED")),
      ],
      {
        taskId: "task-1",
        campaignId: "campaign-1",
        finalOutputReferences: ["creative-1"],
      }
    );
    expect(output.summary.status).toBe("WARNING");
    expect(output.summary.warnings).toBe(1);
    expect(output.summary.skipped).toBe(1);
  });

  it("rejects failed gates before completion", async () => {
    await expect(
      new FinalizationPipeline().execute({
        taskId: "task-1",
        campaignId: "campaign-1",
        finalOutputReferences: ["creative-1"],
        gates: [recordedGate(result("compliance", "FAIL"))],
      })
    ).rejects.toThrow("Finalization gates failed: compliance");
  });

  it("records only the two Finalization checkpoints", async () => {
    const output = await new FinalizationPipeline().execute({
      taskId: "task-1",
      campaignId: "campaign-1",
      finalOutputReferences: ["creative-1"],
      gates: [recordedGate(result("validation"))],
      timestamp: "2026-07-25T00:00:00.000Z",
    });
    expect(output.pipelineState).toBe("COMPLETED");
    expect(output.checkpointHistory).toEqual([
      "VIDEO_GATES_COMPLETE",
      "VIDEO_COMPLETE",
    ]);
    expect(output.checkpoint).toBe("VIDEO_COMPLETE");
  });

  it("returns immutable results with deterministic fingerprints", async () => {
    const pipeline = new FinalizationPipeline();
    const input = {
      taskId: "task-1",
      campaignId: "campaign-1",
      finalOutputReferences: ["creative-2", "creative-1"],
      gates: [recordedGate(result("validation"))],
    };
    const first = await pipeline.execute({
      ...input,
      timestamp: "2026-07-25T00:00:00.000Z",
    });
    const second = await pipeline.execute({
      ...input,
      timestamp: "2026-07-26T00:00:00.000Z",
    });

    expect(first.deterministicFingerprint).toBe(
      second.deterministicFingerprint
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.gateResults)).toBe(true);
  });

  it("loads a valid persisted result for resume and rejects incompatible data", async () => {
    const output = await new FinalizationPipeline().execute({
      taskId: "task-1",
      campaignId: "campaign-1",
      finalOutputReferences: ["creative-1"],
      gates: [recordedGate(result("validation"))],
    });
    const resumed = readFinalizationResult(
      JSON.parse(JSON.stringify(output)) as unknown
    );
    expect(resumed).toEqual(output);
    expect(Object.isFrozen(resumed)).toBe(true);
    expect(() =>
      readFinalizationResult({ ...output, contractVersion: "2" })
    ).toThrow("Unsupported Finalization contract version");
  });

  it("persists Finalization before invoking the existing Review commit", async () => {
    const commit = vi.fn(async () => undefined);
    const progress = {
      ffmpeg_render: { status: "completed" as const },
      compliance_check: { status: "completed" as const },
      marketing_score: { status: "completed" as const },
    };
    await finalizeReviewAfterGates(
      [{ progress, creativeRegistered: true, outputReady: true }],
      {
        taskId: "task-1",
        campaignId: "campaign-1",
        orgId: "org-1",
        workspaceId: "workspace-1",
        creativeIds: ["creative-1"],
        progress,
      },
      commit
    );

    const committed = commit.mock.calls[0]?.[0];
    expect(committed?.progress.finalization_pipeline?.status).toBe("completed");
    expect(
      (
        committed?.progress.finalization_pipeline?.output as {
          checkpoint?: string;
        }
      )?.checkpoint
    ).toBe("VIDEO_COMPLETE");
  });

  it("does not invoke Review commit when an existing mandatory gate fails", async () => {
    const commit = vi.fn(async () => undefined);
    const progress = {
      ffmpeg_render: { status: "completed" as const },
      compliance_check: { status: "failed" as const },
      marketing_score: { status: "completed" as const },
    };
    await expect(
      finalizeReviewAfterGates(
        [{ progress, creativeRegistered: true, outputReady: true }],
        {
          taskId: "task-1",
          campaignId: "campaign-1",
          orgId: "org-1",
          workspaceId: "workspace-1",
          creativeIds: ["creative-1"],
          progress,
        },
        commit
      )
    ).rejects.toThrow(/compliance/);
    expect(commit).not.toHaveBeenCalled();
  });
});
