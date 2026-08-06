/**
 * Sprint 0004 — OPS-002 / PD-045 behavioral coverage.
 * Source-of-truth checks + pure helpers (no live DB).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACTIVE_CAMPAIGN_TASK_STATUSES,
  CEO_MAX_RETRIES,
  ReviewDecideBodySchema,
  getPipelineStageOutput,
  isActiveCampaignTaskStatus,
  isPipelineStageComplete,
  type StepProgress,
} from "@ceo-agent/shared";

const wizard = readFileSync(
  resolve("apps/web/src/app/w/[slug]/campaigns/new/page.tsx"),
  "utf8"
);
const runRoute = readFileSync(
  resolve("apps/web/src/app/api/campaigns/[id]/run/route.ts"),
  "utf8"
);
const campaignRun = readFileSync(resolve("apps/web/src/lib/campaign-run.ts"), "utf8");
const decideRoute = readFileSync(
  resolve("apps/web/src/app/api/reviews/[id]/decide/route.ts"),
  "utf8"
);
const lifecycle = readFileSync(
  resolve("packages/agents/src/pipeline-lifecycle.ts"),
  "utf8"
);
const orchestrator = readFileSync(resolve("packages/agents/src/orchestrator.ts"), "utf8");
const runCeo = readFileSync(resolve("apps/web/src/components/RunCeoButton.tsx"), "utf8");

describe("PD-045 Create Campaign auto-starts pipeline", () => {
  it("Create Campaign POSTs /generate then redirects to Campaign Overview", () => {
    expect(wizard).toContain("PD-045");
    expect(wizard).toMatch(/\/api\/campaigns\/\$\{id\}\/generate/);
    expect(wizard).toMatch(/router\.push\(`\/w\/\$\{slug\}\/campaigns\/\$\{id\}`\)/);
  });

  it("starts the run before opening Overview and does not force Task Progress", () => {
    expect(wizard.indexOf("/generate")).toBeLessThan(wizard.indexOf("router.push"));
    expect(wizard).not.toMatch(/\/campaigns\/\$\{id\}\/task\?taskId=/);
  });
});

describe("OPS-002 Rule 1 — one active run per Campaign", () => {
  it("treats queued, running, retrying, and resume as active", () => {
    expect(ACTIVE_CAMPAIGN_TASK_STATUSES).toEqual([
      "queued",
      "running",
      "retrying",
      "resume",
    ]);
    for (const s of ACTIVE_CAMPAIGN_TASK_STATUSES) {
      expect(isActiveCampaignTaskStatus(s)).toBe(true);
    }
    expect(isActiveCampaignTaskStatus("failed")).toBe(false);
    expect(isActiveCampaignTaskStatus("completed")).toBe(false);
  });

  it("startOrReuseCampaignRun is invoked from authoritative Generate path", () => {
    const generateRoute = readFileSync(
      resolve("apps/web/src/app/api/campaigns/[id]/generate/route.ts"),
      "utf8"
    );
    expect(campaignRun).toContain("findActiveCampaignTask");
    expect(campaignRun).toContain("startOrReuseCampaignRun");
    expect(campaignRun).toContain("reused: true");
    expect(campaignRun).toContain("enqueuePipeline");
    expect(generateRoute).toContain("executeCampaignGenerate");
    expect(runRoute).toContain("executeCampaignGenerate");
    expect(runRoute).toMatch(/result\.reused \? 200 : 202/);
  });

  it("RunCeoButton hides while an active execution exists", () => {
    expect(runCeo).toMatch(/status === "retrying"/);
    expect(runCeo).toMatch(/status === "resume"/);
  });
});

describe("OPS-002 Rule 2 — Retry is Resume", () => {
  it("skips completed pipeline stages on resume", () => {
    const progress: StepProgress = {
      parse_intent: { status: "completed", output: { intent: "x" } },
      vision_analyze: { status: "failed", error: "boom" },
      strategy_plan: { status: "skipped" },
    };
    expect(isPipelineStageComplete(progress, "parse_intent")).toBe(true);
    expect(isPipelineStageComplete(progress, "strategy_plan")).toBe(true);
    expect(isPipelineStageComplete(progress, "vision_analyze")).toBe(false);
    expect(getPipelineStageOutput(progress, "parse_intent")).toEqual({ intent: "x" });
  });

  it("orchestrator resume path uses isPipelineStageComplete and retry sets retrying", () => {
    expect(orchestrator).toContain("isPipelineStageComplete");
    expect(orchestrator).toContain("resume skip=");
    expect(orchestrator).toMatch(/status:\s*"retrying"/);
    expect(orchestrator).toContain("Retry = Resume");
  });
});

describe("OPS-002 Rule 3 — terminal Failed only after retries exhausted", () => {
  it("failPipelineExecution distinguishes retrying vs failed", () => {
    expect(lifecycle).toContain('status: "retrying"');
    expect(lifecycle).toContain("retryCount >= CEO_MAX_RETRIES");
    expect(lifecycle).toContain("pipeline.recoverable_failure");
    expect(lifecycle).toContain("pipeline.terminal_failure");
    expect(CEO_MAX_RETRIES).toBe(2);
  });
});

describe("OPS-002 Rule 4 — Review decision idempotency", () => {
  it("shared schema only allows approved|rejected", () => {
    expect(ReviewDecideBodySchema.safeParse({ decision: "approved" }).success).toBe(true);
    expect(ReviewDecideBodySchema.safeParse({ decision: "rejected" }).success).toBe(true);
    expect(ReviewDecideBodySchema.safeParse({ decision: "pending" }).success).toBe(false);
    expect(ReviewDecideBodySchema.safeParse({ decision: "maybe" }).success).toBe(false);
    expect(ReviewDecideBodySchema.safeParse({}).success).toBe(false);
  });

  it("decide route validates body, rejects non-pending, and uses conditional update", () => {
    expect(decideRoute).toContain("ReviewDecideBodySchema");
    expect(decideRoute).toContain("ALREADY_DECIDED");
    expect(decideRoute).toContain('eq(schema.reviews.decision, "pending")');
    expect(decideRoute).toContain("VALIDATION_ERROR");
  });
});

describe("Marketing score persistence — never silent", () => {
  it("surfaces marketing_scores insert failures", () => {
    expect(orchestrator).toContain("marketing_score_persist_failed");
    expect(orchestrator).toContain("Marketing score persistence failed");
    expect(orchestrator).not.toMatch(
      /insert\(schema\.marketingScores\)[\s\S]{0,400}catch \{\s*\/\/ Table may not/
    );
  });
});
