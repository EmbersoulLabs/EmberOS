import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  friendlyWorkspaceFailure,
  mapTaskDisplayState,
  resolveContinueCampaign,
} from "../apps/web/src/lib/campaign-workspace";

describe("Wave 4 Campaign Workspace shell", () => {
  it("resolves Continue Campaign only from durable review or task facts", () => {
    expect(resolveContinueCampaign({
      slug: "workspace",
      campaignId: "campaign",
      campaignStatus: "processing",
    })).toBeNull();

    expect(resolveContinueCampaign({
      slug: "workspace",
      campaignId: "campaign",
      campaignStatus: "processing",
      taskId: "task",
      taskStatus: "running",
    })).toMatchObject({ label: "Continue workflow", state: "IN_PROGRESS" });

    expect(resolveContinueCampaign({
      slug: "workspace",
      campaignId: "campaign",
      campaignStatus: "pending_client_review",
      taskId: "task",
      taskStatus: "completed",
    })).toMatchObject({ label: "Continue review", state: "PENDING_REVIEW" });
  });

  it("maps main task facts without inventing universal states", () => {
    expect(mapTaskDisplayState()).toBe("NOT_STARTED");
    expect(mapTaskDisplayState("queued")).toBe("QUEUED");
    expect(mapTaskDisplayState("running")).toBe("IN_PROGRESS");
    expect(mapTaskDisplayState("failed")).toBe("RECOVERY_AVAILABLE");
    expect(mapTaskDisplayState("completed")).toBe("COMPLETED");
    expect(friendlyWorkspaceFailure("failed")).not.toMatch(/SQL|outbox|lease|stack/i);
  });

  it("uses the Blueprint IA and main module compositions", () => {
    const source = readFileSync("apps/web/src/components/campaign/CampaignDashboard.tsx", "utf8");
    expect(source).toContain("Continue Campaign");
    expect(source).toContain("Overview");
    expect(source).toContain("Photo Scene");
    expect(source).toContain("Video Studio");
    expect(source).toContain("AI Story");
    expect(source).toContain("Marketing Package");
    expect(source).toContain("Activity");
    expect(source).toContain("PhotoSceneExtractionPanel");
    expect(source).toContain("MarketingPackagePanel");
    expect(source).not.toContain("RunCeoButton");
    expect(source).not.toMatch(/saveOverview|Manual initial Generate/);
  });

  it("keeps Overview read-only and adds no Workspace polling loop", () => {
    const dashboard = readFileSync("apps/web/src/components/campaign/CampaignDashboard.tsx", "utf8");
    const page = readFileSync("apps/web/src/app/w/[slug]/campaigns/[id]/page.tsx", "utf8");
    expect(dashboard).not.toMatch(/<input|<textarea|<select/);
    expect(dashboard).not.toContain("Save");
    expect(page).not.toContain("setInterval");
  });

  it("provides a mobile Campaign Open affordance", () => {
    const source = readFileSync("apps/web/src/app/w/[slug]/campaigns/page.tsx", "utf8");
    expect(source).toContain("aria-label={`Open ${c.name}`}");
    expect(source).toContain("min-h-11");
  });
});
