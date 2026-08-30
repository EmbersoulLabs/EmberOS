import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { fetchCurrentExecutionPlan } from "../apps/web/src/lib/ai-story-execution-plan-discovery-client";

const campaignId = "8d1bdda0-fabc-48b2-9936-cc16224f98e3";
const storyId = "36430b98-5f2b-425a-a176-0c9205f3a74c";
const planId = "8831afe0-e22b-561e-ba8a-9087996a9113";

describe("R3 server-backed Execution Plan revisit projection", () => {
  it("discovers the persisted plan with one read-only canonical request", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ executionPlan: { executionPlanId: planId } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(fetchCurrentExecutionPlan({ campaignId, storyId }, fetchImpl)).resolves.toEqual({
      executionPlan: { executionPlanId: planId },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/current`,
      { method: "GET", credentials: "same-origin", cache: "no-store" }
    );
  });

  it("represents a Story with no plan as a canonical empty state", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ executionPlan: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(fetchCurrentExecutionPlan({ campaignId, storyId }, fetchImpl)).resolves.toEqual({
      executionPlan: null,
    });
  });

  it("makes server authority win and keeps sessionStorage cache-only", async () => {
    const page = await readFile(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
      "utf8"
    );
    expect(page).toContain("fetchCurrentExecutionPlan({ campaignId, storyId })");
    expect(page).toContain("setExecutionPlanId(discoveredId)");
    expect(page).toContain("sessionStorage.setItem(executionPlanStorageKey(storyId), discoveredId)");
    expect(page).toContain("sessionStorage.removeItem(executionPlanStorageKey(storyId))");
    expect(page).not.toContain(
      "const stored = sessionStorage.getItem(executionPlanStorageKey(storyId))"
    );
  });

  it("keeps discovery read-only, workspace scoped, and ambiguity fail-closed", async () => {
    const service = await readFile(
      "apps/web/src/lib/ai-story-execution-plan-discovery.ts",
      "utf8"
    );
    const route = await readFile(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/current/route.ts",
      "utf8"
    );
    expect(route).toContain("export async function GET");
    expect(route).not.toContain("export async function POST");
    expect(service).toContain("authorizeAiStoryAccess");
    expect(service).toContain("schema.aiStoryExecutionPlans.workspaceId");
    expect(service).toContain("schema.aiStoryExecutionPlans.storyVersionId");
    expect(service).toContain("schema.aiStoryExecutionPlans.animationPackageId");
    expect(service).toContain("if (plans.length > 1) throw new AmbiguousCurrentExecutionPlanError()");
    expect(service).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });

  it("does not couple discovery to Generate Review or provider execution", async () => {
    const client = await readFile(
      "apps/web/src/lib/ai-story-execution-plan-discovery-client.ts",
      "utf8"
    );
    expect(client).not.toContain("/execution/review");
    expect(client).not.toContain("execute");
    expect(client).not.toContain("provider");
  });
});
