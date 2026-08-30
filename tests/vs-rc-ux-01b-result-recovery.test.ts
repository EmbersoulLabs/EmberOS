import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VIDEO_STUDIO_OUTPUT_COUNT,
  projectVideoStudioResult,
  resolveCreativeRecoveryPollDecision,
} from "../apps/web/src/lib/video-studio-result-state";

const CAMPAIGN = "campaign-a";
const task = (status: string, campaignId = CAMPAIGN) => ({ status, campaignId });
const ready = (id: string) => ({ id, videoUrl: `signed:${id}`, renderStatus: "preview_ready" });
const failed = (id: string) => ({ id, renderStatus: "failed", renderProgress: { error: "provider detail" } });

describe("VS-RC-UX-01B persisted result projection", () => {
  it("projects no task as ready and always returns exactly three slots", () => {
    const result = projectVideoStudioResult({ routeCampaignId: CAMPAIGN });
    expect(result.state).toBe("READY");
    expect(result.slots).toHaveLength(VIDEO_STUDIO_OUTPUT_COUNT);
  });

  it.each([
    ["queued", "QUEUED"],
    ["running", "PROCESSING"],
    ["retrying", "PROCESSING"],
  ])("maps persisted task %s to %s", (status, expected) => {
    expect(projectVideoStudioResult({ task: task(status), routeCampaignId: CAMPAIGN }).state).toBe(expected);
  });

  it("projects persisted active rendition state as recovery without a client retry flag", () => {
    const persisted = {
      task: task("completed"),
      routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), { id: "two", renderStatus: "preview_rendering" }, ready("three")],
    };
    const result = projectVideoStudioResult(persisted);
    expect(result.state).toBe("RECOVERING");
    expect(projectVideoStudioResult(structuredClone(persisted)).state).toBe("RECOVERING");
  });

  it("reconstructs recovery on revisit and converges from persisted ready state", () => {
    const active = {
      task: task("failed"), routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), { id: "two", renderStatus: "preview_rendering" }, ready("three")],
    };
    expect(projectVideoStudioResult(active).state).toBe("RECOVERING");
    expect(projectVideoStudioResult({ ...active, creatives: [ready("one"), ready("two"), ready("three")] }).state).toBe("COMPLETE");
  });

  it("poll budget exhaustion pauses an active rendition without declaring failure", () => {
    const active = { id: "two", status: "processing", renderStatus: "preview_rendering" };
    expect(resolveCreativeRecoveryPollDecision(active, 60, 60)).toBe("PAUSE_ACTIVE");
    expect(projectVideoStudioResult({
      task: task("completed"), routeCampaignId: CAMPAIGN, creatives: [ready("one"), active, ready("three")],
    }).state).toBe("RECOVERING");
  });

  it("only persisted ready or failure evidence terminates recovery truth", () => {
    expect(resolveCreativeRecoveryPollDecision(ready("two"), 1, 60)).toBe("READY");
    expect(resolveCreativeRecoveryPollDecision(failed("two"), 1, 60)).toBe("FAILED");
    expect(resolveCreativeRecoveryPollDecision({ id: "two", renderStatus: "preview_rendering" }, 1, 60)).toBe("CONTINUE");
  });

  it("requires all three ready outputs for complete", () => {
    const result = projectVideoStudioResult({
      task: task("completed"), routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), ready("two"), ready("three")],
    });
    expect(result.state).toBe("COMPLETE");
    expect(result.readyCount).toBe(3);
  });

  it("projects two ready and one failed as partial", () => {
    const result = projectVideoStudioResult({
      task: task("completed"), routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), ready("two"), failed("three")],
    });
    expect(result.state).toBe("PARTIAL");
    expect(result.failedCount).toBe(1);
  });

  it("projects two ready and one terminally missing as partial", () => {
    const result = projectVideoStudioResult({
      task: task("completed"), routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), ready("two")],
    });
    expect(result.state).toBe("PARTIAL");
    expect(result.missingCount).toBe(1);
  });

  it("projects terminal task failure without usable output as failed", () => {
    expect(projectVideoStudioResult({
      task: task("failed"), routeCampaignId: CAMPAIGN, creatives: [failed("one")],
    }).state).toBe("FAILED");
  });

  it("keeps preview delivery failure distinct from render failure", () => {
    const result = projectVideoStudioResult({
      task: task("completed"), routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), ready("two"), ready("three")],
      previewDeliveryErrorIds: new Set(["two"]),
    });
    expect(result.state).toBe("PARTIAL");
    expect(result.slots[1]?.state).toBe("PREVIEW_DELIVERY_ERROR");
  });

  it("fails closed for a task bound to another campaign", () => {
    expect(projectVideoStudioResult({
      task: task("completed", "campaign-b"), routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), ready("two"), ready("three")],
    }).state).toBe("STALE_OR_WRONG_TASK");
  });

  it("keeps presentation processing while export persistence is active", () => {
    expect(projectVideoStudioResult({
      task: task("completed"), routeCampaignId: CAMPAIGN,
      creatives: [ready("one"), ready("two"), ready("three")], exportStatus: "export_pending",
    }).state).toBe("PROCESSING");
  });
});

describe("VS-RC-UX-01B production UI contract", () => {
  const taskSurface = readFileSync(resolve("apps/web/src/app/w/[slug]/campaigns/[id]/task/TaskProgressContent.tsx"), "utf8");
  const clips = readFileSync(resolve("apps/web/src/components/pipeline/ClipPreviewGrid.tsx"), "utf8");
  const generate = readFileSync(resolve("apps/web/src/components/RunCeoButton.tsx"), "utf8");

  it("checks campaign binding before persisting task result into client state", () => {
    expect(taskSurface.indexOf("data.task?.campaignId !== campaignId")).toBeGreaterThan(-1);
    expect(taskSurface.indexOf("data.task?.campaignId !== campaignId")).toBeLessThan(taskSurface.indexOf("setTask(data.task)"));
  });

  it("uses bounded safe failure copy instead of raw task/provider errors", () => {
    expect(taskSurface).toContain('t("pipeline.generationSafeError")');
    expect(clips).not.toContain("{progress.error}");
  });

  it("checks retry response and polls the same Creative without generation/render fallback", () => {
    expect(clips).toContain("if (!response.ok)");
    expect(clips).toContain("loadClip(creativeId)");
    expect(clips).not.toContain("/generate");
    expect(clips).not.toContain("/api/tasks/");
    expect(clips).not.toContain("onRecoveryStateChange");
    expect(clips).toContain('decision === "PAUSE_ACTIVE"');
  });

  it("labels /generate as a new generation rather than retry", () => {
    expect(generate).toContain('t("campaign.detail.generateAgain")');
    expect(generate).not.toContain('t("campaign.detail.rerun")');
  });
});
