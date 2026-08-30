import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createPlanningApprovalRequestGate,
  dispatchPlanningApproval,
} from "../apps/web/src/lib/ai-story-planning-approval-client";

const request = {
  campaignId: "8d1bdda0-fabc-48b2-9936-cc16224f98e3",
  storyId: "36430b98-5f2b-425a-a176-0c9205f3a74c",
};

describe("AI Story planning approval client dispatch", () => {
  it("dispatches exactly one canonical POST with no request body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ready_for_execution", storyId: request.storyId }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(dispatchPlanningApproval(request, fetchImpl)).resolves.toMatchObject({
      status: "ready_for_execution",
      storyId: request.storyId,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/campaigns/${request.campaignId}/ai-stories/${request.storyId}/planning/approve`,
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      })
    );
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("converges pointer/keyboard or double-submit attempts to one request", async () => {
    let resolveDispatch!: (value: { status: string }) => void;
    const dispatch = vi.fn(
      () =>
        new Promise<{ status: string }>((resolve) => {
          resolveDispatch = resolve;
        })
    );
    const gate = createPlanningApprovalRequestGate(dispatch);

    const pointer = gate.approve(request);
    const keyboard = gate.approve(request);
    expect(dispatch).toHaveBeenCalledTimes(1);

    resolveDispatch({ status: "ready_for_execution" });
    await expect(Promise.all([pointer, keyboard])).resolves.toEqual([
      { status: "ready_for_execution" },
      { status: "ready_for_execution" },
    ]);

    await expect(gate.approve(request)).resolves.toEqual({
      status: "ready_for_execution",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("surfaces a bounded failure and allows an explicit retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Planning approval denied", code: "DENIED" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ready_for_execution" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    const gate = createPlanningApprovalRequestGate((input) =>
      dispatchPlanningApproval(input, fetchImpl)
    );

    await expect(gate.approve(request)).rejects.toMatchObject({
      code: "DENIED",
      message: "Planning approval denied",
    });
    await expect(gate.approve(request)).resolves.toMatchObject({
      status: "ready_for_execution",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses native submit semantics and visible approval states", async () => {
    const component = await readFile(
      "apps/web/src/components/ai-story/PlanningApprovalControl.tsx",
      "utf8"
    );
    const page = await readFile(
      "apps/web/src/app/w/[slug]/campaigns/[id]/ai-stories/[storyId]/page.tsx",
      "utf8"
    );

    expect(component).toContain("<form onSubmit={submitApproval}");
    expect(component).toContain('type="submit"');
    expect(component).toContain('aria-busy={pending}');
    expect(component).toContain('role="status"');
    expect(component).toContain('role="alert"');
    expect(component).toContain('"Approving…"');
    expect(component).toContain('"Approved"');
    expect(component).not.toContain("onClick=");
    expect(page).toContain("<PlanningApprovalControl");
    expect(page).not.toContain("async function approvePlanning()");
  });
});
