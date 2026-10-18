import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOperationalWorkspaceRole, projectMarketingCampaignRead, projectMarketingTaskRead } from "../apps/web/src/lib/campaign-marketing-access";

describe("campaign marketing access projection", () => {
  it("keeps the marketing package and drops operational task data", () => {
    const projected = projectMarketingCampaignRead(
      {
        id: "campaign",
        name: "Cafe",
        status: "ready",
        platforms: ["tiktok"],
        goal: "awareness",
        objective: null,
        objectiveCustom: null,
        targetAudience: null,
        campaignBrief: null,
        createdAt: "2026-10-11T00:00:00.000Z",
        updatedAt: "2026-10-11T00:00:00.000Z",
      },
      {
        id: "task",
        status: "completed",
        campaignId: "campaign",
        createdAt: "2026-10-11T00:00:00.000Z",
        stepProgress: {
          content_generate: { status: "completed", output: { captions: { tiktok: "抖音中文" } }, contentRevision: 2 },
          strategy_plan: { status: "completed", output: { product: "coffee" } },
          export_packs: { "720p": { output: { exportPackUrl: "https://signed.example/secret.zip" } } },
          vision_analyze: { output: { transcriptSummary: "internal" } },
        },
      }
    );

    expect(projected.campaignAccess).toBe("marketing");
    expect(projected.canDelete).toBe(false);
    expect(projected.assets).toEqual([]);
    expect(projected.creatives).toEqual([]);
    expect(projected.task?.stepProgress.content_generate).toMatchObject({ contentRevision: 2 });
    expect(projected.task?.stepProgress.strategy_plan).toBeTruthy();
    expect(projected.task?.stepProgress).not.toHaveProperty("export_packs");
    expect(projected.task?.stepProgress).not.toHaveProperty("vision_analyze");
    expect(JSON.stringify(projected)).not.toContain("signed.example");
  });

  it("keeps operator mutations off the marketing member helper", () => {
    const route = readFileSync("apps/web/src/app/api/campaigns/[id]/route.ts", "utf8");
    const operatorGate = readFileSync("apps/web/src/lib/controlled-self-use-workspace-access.ts", "utf8");
    const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function PATCH"));
    const mutations = route.slice(route.indexOf("export async function PATCH"));

    expect(getBody).toContain("requireControlledSelfUseWorkspaceOperator");
    expect(getBody).toContain("requireCampaignMarketingMember");
    expect(getBody).toContain("projectMarketingCampaignRead");
    expect(mutations).not.toContain("requireCampaignMarketingMember");
    expect(mutations).toContain("requireControlledSelfUseWorkspaceOperator");
    expect(operatorGate).toContain('requireWorkspaceRole(input.workspaceId, input.userId, "operator")');
    expect(operatorGate).toContain('requireWorkspaceRole(input.workspaceId, input.userId, "editor")');
  });

  it("projects a direct task read below operator and keeps the operator payload path", () => {
    const projected = projectMarketingTaskRead({
      id: "task",
      status: "completed",
      campaignId: "campaign",
      workspaceId: "workspace",
      createdAt: "2026-10-11T00:00:00.000Z",
      stepProgress: {
        content_generate: { status: "completed", contentRevision: 2 },
        export_packs: { "720p": { output: { filename: "operator-only-pack.zip" } } },
      },
    });
    expect(projected.taskAccess).toBe("marketing");
    expect(projected.creatives).toEqual([]);
    expect(projected.clipCount).toBe(0);
    expect(projected.task.stepProgress).not.toHaveProperty("export_packs");
    expect(JSON.stringify(projected)).not.toContain("operator-only-pack.zip");
    const failed = {
      id: "task",
      status: "failed",
      campaignId: "campaign",
      workspaceId: "workspace",
      createdAt: "2026-10-11T00:00:00.000Z",
      stepProgress: {
        content_generate: {
          status: "failed",
          output: {
            ok: false,
            stage: "content",
            schemaVersion: "marketing-output-v1",
            codes: ["UNSUPPORTED_CLAIM"],
            fields: ["voiceScripts.30s"],
            fallback: "none",
            providerRequestId: "chatcmpl-EXnKFxdeteqdqGeiCt94V6vqXUerM",
            issues: [{ field: "voiceScripts.30s", excerpt: "right in the heart of Singapore", claimCategory: "location" }],
          },
        },
      },
    };
    const hidden = projectMarketingTaskRead(failed);
    expect(hidden.task.status).toBe("failed");
    expect(JSON.stringify(hidden)).not.toContain("right in the heart of Singapore");
    expect(JSON.stringify(hidden)).not.toContain("chatcmpl-EXnKFxdeteqdqGeiCt94V6vqXUerM");
    expect(JSON.stringify(hidden)).not.toContain("UNSUPPORTED_CLAIM");
    expect(JSON.stringify(failed.stepProgress)).toContain("voiceScripts.30s");
    expect(isOperationalWorkspaceRole("admin")).toBe(true);
    expect(isOperationalWorkspaceRole("operator")).toBe(true);
    expect(isOperationalWorkspaceRole("editor")).toBe(false);
    expect(isOperationalWorkspaceRole("publisher")).toBe(false);
    expect(isOperationalWorkspaceRole("client_viewer")).toBe(false);

    const route = readFileSync("apps/web/src/app/api/tasks/[id]/route.ts", "utf8");
    const getBody = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
    const postBody = route.slice(route.indexOf("export async function POST"));
    expect(getBody.indexOf("requireWorkspaceRole")).toBeLessThan(getBody.indexOf("projectMarketingTaskRead"));
    expect(getBody.indexOf("projectMarketingTaskRead")).toBeLessThan(getBody.indexOf("withSignedCreativeArtifacts"));
    expect(postBody).toContain('requireWorkspaceRole(task.workspaceId, user.id, "operator")');
    expect(postBody).not.toContain("projectMarketingTaskRead");
  });
});
