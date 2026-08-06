import { describe, expect, it, vi } from "vitest";
import {
  FinalizationPipeline,
  GateRunner,
  readFinalizationResult,
  resolveFinalizationResult,
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
        inputCheckpoint: "VIDEO_RENDER_COMPLETE",
        gates: [recordedGate(result("compliance", "FAIL"))],
      })
    ).rejects.toThrow("Finalization gates failed: compliance");
  });

  it("records only the two Finalization checkpoints", async () => {
    const output = await new FinalizationPipeline().execute({
      taskId: "task-1",
      campaignId: "campaign-1",
      finalOutputReferences: ["creative-1"],
      inputCheckpoint: "VIDEO_RENDER_COMPLETE",
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
      inputCheckpoint: "VIDEO_RENDER_COMPLETE" as const,
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
    expect(first.timestamp).not.toBe(second.timestamp);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.gateResults)).toBe(true);
  });

  it("loads a valid persisted result for resume and rejects incompatible data", async () => {
    const output = await new FinalizationPipeline().execute({
      taskId: "task-1",
      campaignId: "campaign-1",
      finalOutputReferences: ["creative-1"],
      inputCheckpoint: "VIDEO_RENDER_COMPLETE",
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

  it("rejects Finalization before VIDEO_RENDER_COMPLETE", async () => {
    for (const inputCheckpoint of [
      "VIDEO_RENDERING",
      "VIDEO_COMPOSITION_COMPLETE",
      "UNKNOWN",
    ] as const) {
      await expect(
        new FinalizationPipeline().execute({
          taskId: "task-1",
          campaignId: "campaign-1",
          finalOutputReferences: ["creative-1"],
          inputCheckpoint,
          gates: [],
        } as never)
      ).rejects.toThrow(
        `Finalization requires VIDEO_RENDER_COMPLETE, received ${inputCheckpoint}`
      );
    }
  });

  it("accepts VIDEO_RENDER_COMPLETE as the Finalization boundary", async () => {
    await expect(
      new FinalizationPipeline().execute({
        taskId: "task-1",
        campaignId: "campaign-1",
        finalOutputReferences: ["creative-1"],
        inputCheckpoint: "VIDEO_RENDER_COMPLETE",
        gates: [],
      })
    ).resolves.toMatchObject({
      pipelineState: "COMPLETED",
      checkpoint: "VIDEO_COMPLETE",
    });
  });

  it("rejects VIDEO_RENDER_COMPLETE without a final render reference", async () => {
    for (const finalOutputReferences of [undefined, [], [""]] as const) {
      await expect(
        new FinalizationPipeline().execute({
          taskId: "task-1",
          campaignId: "campaign-1",
          finalOutputReferences,
          inputCheckpoint: "VIDEO_RENDER_COMPLETE",
          gates: [],
        } as never)
      ).rejects.toThrow(
        "Finalization requires at least one valid final output reference"
      );
    }
  });

  it("rejects a conflicting final output after Finalization was accepted", async () => {
    const pipeline = new FinalizationPipeline();
    const baseInput = {
      taskId: "task-1",
      campaignId: "campaign-1",
      inputCheckpoint: "VIDEO_RENDER_COMPLETE" as const,
      gates: [recordedGate(result("validation"))],
    };
    const first = await pipeline.execute({
      ...baseInput,
      finalOutputReferences: ["output.mp4"],
    });
    const conflicting = await pipeline.execute({
      ...baseInput,
      finalOutputReferences: ["different-output.mp4"],
    });

    expect(() => resolveFinalizationResult(first, conflicting)).toThrow(
      "Conflicting Finalization result"
    );
    expect(first.deterministicFingerprint).not.toBe(
      conflicting.deterministicFingerprint
    );
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
        finalOutputReferences: ["https://example.test/creative-1.mp4"],
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
          finalOutputReferences: ["https://example.test/creative-1.mp4"],
          progress,
        },
        commit
      )
    ).rejects.toThrow(/compliance/);
    expect(commit).not.toHaveBeenCalled();
  });
});
